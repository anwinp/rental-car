"""Authenticating a machine, and binding it to a tenant.

A session cookie says which person is calling. An API key says which
integration is calling, on behalf of which workspace. The second is what this
module establishes, and the important part is that it binds the tenant the same
way a human session does — so row-level security covers machine callers with no
second implementation to keep in step.

That last point is the whole design. It would be easy to write a partner API
that filters by tenant_id in each query and forgets once; instead the key
resolves a tenant, the tenant is bound onto the transaction, and RLS refuses
everything else exactly as it does for a signed-in user.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import structlog
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()

# Visible in logs, support tickets and screenshots. Naming the environment in
# the key means nobody has to guess whether a leaked string is live.
_PREFIX = "rcm_live_"
_PREFIX_STORED = 16          # characters kept in the clear, for display only
_SECRET_BYTES = 32           # 256 bits of CSPRNG output

# Every scope this system understands. A key may hold nothing else — an
# unknown scope in the database grants no access rather than being ignored.
SCOPES: dict[str, str] = {
    "read": "Read vehicles, availability, locations and reservations.",
}


@dataclass(frozen=True)
class ApiCaller:
    """An authenticated integration. Deliberately not a UserClaims.

    A machine is not a person: it has no roles, no location scope and no
    permissions matrix. Giving it a shape that could be passed where a human is
    expected is how a partner key ends up satisfying a check written for staff.
    """
    key_id: uuid.UUID
    tenant_id: uuid.UUID
    label: str
    scopes: frozenset[str]


def generate_key() -> tuple[str, str, str]:
    """Return (full key, sha256 hash, stored prefix).

    The full key is returned to the caller exactly once and never persisted.
    """
    secret = secrets.token_urlsafe(_SECRET_BYTES)
    full = f"{_PREFIX}{secret}"
    return full, hash_key(full), full[:_PREFIX_STORED]


def hash_key(full: str) -> str:
    """SHA-256, hex.

    Not bcrypt. This runs on every request, and the input is 256 bits of
    CSPRNG output rather than a human-chosen password — there is no dictionary
    to slow an attacker down, only entropy, and brute-forcing 256 bits is not
    made harder by a work factor.
    """
    return hashlib.sha256(full.encode()).hexdigest()


async def get_api_caller(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> ApiCaller:
    """Resolve an API key to a caller, and bind its tenant for the request.

    Raises 401 for anything wrong — missing, unknown, revoked, expired — with
    one message. Which of those it was is not the caller's business, and
    distinguishing them turns this into an oracle for which keys exist.
    """
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supply an API key in the X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    from app.core.database import AsyncSessionLocal

    digest = hash_key(x_api_key.strip())

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                text(
                    "SELECT key_id, tenant_id, label, scopes, expires_at, revoked_at "
                    "  FROM api_keys WHERE key_hash = :h"
                ),
                {"h": digest},
            )
        ).mappings().first()

        # Looked up by hash, so an attacker's guess is compared against a stored
        # digest by the index rather than by string comparison in Python — there
        # is no early-exit to time.
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="That API key is not valid.",
                headers={"WWW-Authenticate": "ApiKey"},
            )

        now = datetime.now(timezone.utc)
        if row["revoked_at"] is not None or (
            row["expires_at"] is not None and row["expires_at"] <= now
        ):
            log.info("api_key_rejected", key_id=str(row["key_id"]),
                     revoked=row["revoked_at"] is not None)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="That API key is not valid.",
                headers={"WWW-Authenticate": "ApiKey"},
            )

        ip = (request.headers.get("X-Forwarded-For", "") or "").split(",")[0].strip() \
            or (request.client.host if request.client else None)
        # Best effort. A workspace losing the ability to call its own API
        # because a bookkeeping write failed would be the wrong trade.
        try:
            await session.execute(
                text(
                    "UPDATE api_keys SET last_used_at = now(), last_used_ip = :ip "
                    " WHERE key_id = :k"
                ),
                {"ip": ip, "k": str(row["key_id"])},
            )
            await session.commit()
        except Exception:  # noqa: BLE001
            log.warning("api_key_touch_failed", key_id=str(row["key_id"]))

    scopes = frozenset(s for s in (row["scopes"] or []) if s in SCOPES)
    return ApiCaller(
        key_id=row["key_id"],
        tenant_id=row["tenant_id"],
        label=row["label"],
        scopes=scopes,
    )


def require_scope(scope: str):
    """Dependency factory: the caller must hold `scope`."""
    if scope not in SCOPES:
        raise RuntimeError(f"Unknown scope in a gate: {scope!r}")

    async def _gate(caller: ApiCaller = Depends(get_api_caller)) -> ApiCaller:
        if scope not in caller.scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This key does not have the '{scope}' scope.",
            )
        return caller

    return _gate


async def api_session(
    caller: ApiCaller = Depends(require_scope("read")),
) -> AsyncSession:  # type: ignore[misc]
    """A database session with the key's tenant bound.

    This is what makes RLS cover machine callers. Without it every partner
    query would have to remember its own tenant predicate, and the first one
    that forgot would read another workspace's fleet.
    """
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :t, true)"),
            {"t": str(caller.tenant_id)},
        )
        try:
            yield session
        finally:
            await session.rollback()
