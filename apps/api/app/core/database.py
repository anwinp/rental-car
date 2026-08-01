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
from app.core.tenancy import TenantMismatch, current_tenant_id, resolve_tenant

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
    if not tenant_id:
        return
    connection.execute(
        text("SELECT set_config('app.current_tenant_id', :tid, true)"),
        {"tid": str(tenant_id)},
    )


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
        try:
            if request is not None:
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


async def get_db(
    claims: "UserClaims",  # noqa: F821 — imported at call site to avoid circular
    request_id: str,
    client_ip: str,
    session: AsyncSession,
) -> AsyncGenerator[AsyncSession, None]:
    """
    Set all 5 PostgreSQL GUC session variables within this transaction.
    Must be called BEFORE any query that touches RLS-protected tables.

    The `true` third argument to set_config() scopes the value to the
    current transaction only — critical for connection-pool reuse safety.
    """
    await session.execute(
        text(
            "SELECT "
            "  set_config('app.current_tenant_id', :tid,  true), "
            "  set_config('app.current_user_id',   :uid,  true), "
            "  set_config('app.current_role',       :role, true), "
            "  set_config('app.client_ip',          :ip,   true), "
            "  set_config('app.request_id',         :rid,  true)"
        ),
        {
            "tid":  str(claims.tenant_id),
            "uid":  str(claims.user_id),
            "role": claims.primary_role,
            "ip":   client_ip,
            "rid":  request_id,
        },
    )
    yield session


async def check_db_health() -> bool:
    """Ping the database. Returns True on success, False on any error."""
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
