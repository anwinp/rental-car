from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import structlog
from fastapi import HTTPException, Request
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session as SyncSession
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.tenancy import (
    TenantMismatch,
    current_actor,
    current_tenant_id,
    resolve_tenant,
)

# ── Connecting through PgBouncer in transaction-pooling mode ─────────────────
# Server connections are rebound to a different client on every transaction, so
# any server-side state that outlives a transaction breaks. Prepared statements
# are exactly that, and there are THREE separate caches to disable — missing any
# one of them still fails, just less often:
#
#   statement_cache_size=0           asyncpg's own cache. Left on, statement
#                                    names collide across clients sharing a
#                                    server connection:
#                                      DuplicatePreparedStatementError:
#                                      "__asyncpg_stmt_8__" already exists
#
#   prepared_statement_cache_size=0  SQLAlchemy's asyncpg dialect keeps its OWN
#                                    cache, default 100. Left on, a statement
#                                    prepared in an earlier transaction is
#                                    reused after PgBouncer has moved the client
#                                    to a different server connection:
#                                      InvalidSQLStatementNameError:
#                                      prepared statement "..." does not exist
#
#   prepared_statement_name_func     Unique names, so anything that does slip
#                                    through cannot collide with another client.
#
# NullPool on top: PgBouncer already pools, and holding SQLAlchemy-side
# connections across transactions is what exposes the state above. This is the
# configuration SQLAlchemy documents for PgBouncer.
#
# Connecting straight to Postgres (local dev) keeps the caches and real pooling
# — that is why this never reproduced outside production.
_engine_kwargs: dict = {}
if settings.db_via_pgbouncer:
    _engine_kwargs |= {
        "poolclass": NullPool,  # note: incompatible with pool_size/max_overflow
        "connect_args": {
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
            "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",
        },
    }
else:
    _engine_kwargs |= {
        "pool_size": 5,
        "max_overflow": 10,
        "pool_pre_ping": True,
        "pool_recycle": 3600,
    }

engine = create_async_engine(
    settings.database_url.get_secret_value(),
    echo=settings.env == "development",
    **_engine_kwargs,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def dispose_engine() -> None:
    """Called from lifespan shutdown."""
    await engine.dispose()


# ── Tenant stamping ──────────────────────────────────────────────────────────
# The RLS predicate reads app.current_tenant_id, and set_config(..., true) is
# TRANSACTION-scoped — which is what makes it safe under connection pooling, but
# also means it is lost the moment a handler commits. Stamping it on every
# transaction start keeps the tenant attached for a handler's whole lifetime,
# including after an intermediate commit, without any call site having to know.
@event.listens_for(SyncSession, "after_begin")
def _stamp_tenant_on_transaction(session, transaction, connection) -> None:  # noqa: ANN001
    tenant_id = current_tenant_id.get()
    actor = current_actor.get() or {}
    if not tenant_id and not actor:
        return

    # All five variables the audit triggers read, not only the one RLS needs.
    #
    # Set individually, and ONLY when a value exists. The trigger casts these
    # with a bare ::UUID, ::user_role and ::INET — no NULLIF — so an empty
    # string does not read as "absent", it raises: `SELECT ''::uuid` is an
    # error, and it would be an error inside a trigger, which means every
    # INSERT and UPDATE on the seven audited tables would fail. An unset GUC
    # read with missing_ok returns NULL, which casts cleanly, so the safe way
    # to say "nobody" is to say nothing at all.
    settings: list[tuple[str, str]] = []
    if tenant_id:
        settings.append(("app.current_tenant_id", str(tenant_id)))
    if actor.get("user_id"):
        settings.append(("app.current_user_id", str(actor["user_id"])))
    if actor.get("role"):
        settings.append(("app.current_role", str(actor["role"])))
    if actor.get("ip"):
        settings.append(("app.client_ip", str(actor["ip"])))
    if actor.get("request_id"):
        settings.append(("app.request_id", str(actor["request_id"])))

    if not settings:
        return

    clauses = ", ".join(
        f"set_config(:k{i}, :v{i}, true)" for i in range(len(settings))
    )
    params = {}
    for i, (key, value) in enumerate(settings):
        params[f"k{i}"] = key
        params[f"v{i}"] = value
    connection.execute(text(f"SELECT {clauses}"), params)


def _actor_from_request(request: Request) -> dict:
    """Who is making this request, for the audit trail.

    Best-effort by design. An unauthenticated request has no actor and that is
    a fact worth recording as NULL, not a reason to fail. Decoding is wrapped
    because a malformed cookie must not turn into a 500 on a route that does
    not require authentication in the first place — the auth dependency is what
    rejects a bad token, not this.
    """
    token = request.cookies.get("rcm_access")
    if not token:
        return {}
    try:
        from app.core.security import decode_token

        claims = decode_token(token)
    except Exception:  # noqa: BLE001 — see docstring
        return {}
    return {
        "user_id": str(claims.user_id),
        "role": claims.primary_role,
        "ip": (request.headers.get("X-Forwarded-For", "") or "").split(",")[0].strip()
        or (request.client.host if request.client else ""),
        "request_id": getattr(request.state, "request_id", "") or "",
    }


async def get_session(request: Request = None) -> AsyncGenerator[AsyncSession, None]:  # noqa: RUF013
    """Request-scoped session with the tenant already bound.

    Every domain router depends on this, so binding the tenant here is what
    makes RLS effective across the whole API rather than route by route.

    Resolution order is enforced in app/core/tenancy.py: a signed JWT claim
    first, then the hostname, and a caller-supplied header only when neither
    applies. A request that asserts two different tenants is rejected outright.

    Requests with no tenant at all (health, registration, the marketing site)
    are served with no tenant bound — under RLS those simply see no tenant rows,
    which is the correct outcome rather than a silent fallback.
    """
    async with AsyncSessionLocal() as session:
        ctx_token = None
        actor_token = None
        try:
            if request is not None:
                # Identity for the audit trail, published before any query runs.
                # Read from the signed token, never from a header: an audit row
                # naming an actor the caller chose is worse than one naming
                # nobody.
                actor_token = current_actor.set(_actor_from_request(request))

                try:
                    tenant_id = await resolve_tenant(request, session)
                except TenantMismatch as exc:
                    raise HTTPException(status_code=403, detail=str(exc)) from exc

                if tenant_id:
                    ctx_token = current_tenant_id.set(tenant_id)

                    # Make the tenant visible to logging. The access log reads
                    # request.state.tenant_id, which only the legacy
                    # get_tenant_id dependency ever set — and nothing uses that
                    # dependency any more, so every log line carried
                    # tenant_id=null. During an incident that is the difference
                    # between "one workspace is failing" and "we cannot tell".
                    #
                    # Bound into structlog's contextvars as well so it appears on
                    # every line emitted while handling this request, not just
                    # the single access-log entry at the end.
                    request.state.tenant_id = tenant_id
                    try:
                        structlog.contextvars.bind_contextvars(tenant_id=tenant_id)
                    except Exception:  # noqa: BLE001 — logging must never break a request
                        pass

                    # Stamp the transaction already open from the slug lookup;
                    # later transactions are covered by the after_begin hook.
                    await session.execute(
                        text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                        {"tid": tenant_id},
                    )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            if actor_token is not None:
                current_actor.reset(actor_token)
            if ctx_token is not None:
                current_tenant_id.reset(ctx_token)
                try:
                    structlog.contextvars.unbind_contextvars("tenant_id")
                except Exception:  # noqa: BLE001
                    pass


async def get_session_untenanted() -> AsyncGenerator[AsyncSession, None]:
    """Session with no tenant bound.

    For genuinely tenant-less work: health checks, the tenant registry itself,
    and registration (which creates the tenant it will later belong to).
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def check_db_health() -> bool:
    """Ping the database. Returns True on success, False on any error."""
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
