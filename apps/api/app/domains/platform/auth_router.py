"""Sign-in for the platform operator.

Separate from /auth/login because the identity is separate. /auth/login resolves
a tenant first and refuses without one — correct for a tenant employee, and the
reason the console's own sign-in form could never work.

Nothing here reads or writes a tenant table, and no request handled here binds
app.current_tenant_id. A platform session starts with no row visibility into any
customer's data and gains it only where a console endpoint binds a tenant
explicitly, one operation at a time.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session_untenanted
from app.core.platform_security import (
    PlatformClaims,
    clear_platform_cookie,
    create_platform_token,
    get_current_platform_admin,
    set_platform_cookie,
)
from app.core.ratelimit import enforce_limit
from app.core.security import hash_password, verify_password

log = structlog.get_logger()

router = APIRouter(prefix="/platform/auth", tags=["platform-auth"])

# Same policy as staff sign-in. Divergence here would be a gap, not a feature.
_MAX_FAILURES = 5
_LOCKOUT_MINUTES = 15

# A hash to verify against when the address is unknown, so a miss costs roughly
# the same wall-clock as a hit and response time does not enumerate operators.
_DUMMY_HASH = "$2b$12$K3JNi5xUCBt9M6a3Q0mF0eZ8Q2vJ0y1Xk8H9nQ7cD3vL5wR2tY4bS"


class PlatformLoginRequest(BaseModel):
    email: str
    password: str


class PlatformProfile(BaseModel):
    admin_id: uuid.UUID
    email: str
    full_name: str
    is_mfa_enabled: bool
    last_login_at: datetime | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12)


def _unauthorised() -> HTTPException:
    """One message for every failure mode: wrong address, wrong password,
    deactivated, locked. Which one it was is not the caller's business."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password.",
    )


@router.post("/login", response_model=PlatformProfile)
async def platform_login(
    payload: PlatformLoginRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session_untenanted),
) -> PlatformProfile:
    await enforce_limit(
        request, bucket="platform-login", limit=10, window_seconds=300,
        subject=payload.email,
        message="Too many sign-in attempts. Try again in a few minutes.",
    )

    row = (
        await session.execute(
            text(
                "SELECT admin_id, email, password_hash, full_name, is_active, "
                "       is_mfa_enabled, failed_login_count, locked_until, "
                "       token_epoch, last_login_at "
                "  FROM platform_admins "
                " WHERE lower(email) = lower(:e) AND deleted_at IS NULL"
            ),
            {"e": payload.email},
        )
    ).mappings().first()

    if row is None:
        verify_password("dummy_plaintext", _DUMMY_HASH)
        raise _unauthorised()

    now = datetime.now(timezone.utc)
    if row["locked_until"] and row["locked_until"] > now:
        raise _unauthorised()
    if not row["is_active"]:
        raise _unauthorised()

    if not verify_password(payload.password, row["password_hash"]):
        failures = int(row["failed_login_count"]) + 1
        lock_at = now + timedelta(minutes=_LOCKOUT_MINUTES) if failures >= _MAX_FAILURES else None
        await session.execute(
            text(
                "UPDATE platform_admins "
                "   SET failed_login_count = :n, locked_until = :lock, updated_at = now() "
                " WHERE admin_id = :a"
            ),
            {"n": failures, "lock": lock_at, "a": row["admin_id"]},
        )
        await session.commit()
        log.warning("platform_login_failed", email=payload.email, failures=failures)
        raise _unauthorised()

    await session.execute(
        text(
            "UPDATE platform_admins "
            "   SET failed_login_count = 0, locked_until = NULL, "
            "       last_login_at = now(), updated_at = now() "
            " WHERE admin_id = :a"
        ),
        {"a": row["admin_id"]},
    )
    await session.commit()

    token = create_platform_token(
        admin_id=row["admin_id"],
        email=row["email"],
        jti=str(uuid.uuid4()),
        epoch=int(row["token_epoch"]),
    )
    set_platform_cookie(response, token)
    log.info("platform_login", admin_id=str(row["admin_id"]), email=row["email"])

    return PlatformProfile(
        admin_id=row["admin_id"],
        email=row["email"],
        full_name=row["full_name"],
        is_mfa_enabled=row["is_mfa_enabled"],
        last_login_at=row["last_login_at"],
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def platform_logout(
    response: Response,
    claims: PlatformClaims = Depends(get_current_platform_admin),
) -> None:
    from app.core.redis import get_session_redis
    from app.domains.auth.service import REVOKED_TOKENS_SET

    redis = get_session_redis()
    await redis.sadd(REVOKED_TOKENS_SET, claims.jti)
    clear_platform_cookie(response)


@router.get("/me", response_model=PlatformProfile)
async def platform_me(
    claims: PlatformClaims = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_session_untenanted),
) -> PlatformProfile:
    row = (
        await session.execute(
            text(
                "SELECT admin_id, email, full_name, is_mfa_enabled, last_login_at "
                "  FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": str(claims.admin_id)},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated")
    return PlatformProfile(**row)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT,
             response_model=None)
async def platform_change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    claims: PlatformClaims = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_session_untenanted),
) -> None:
    await enforce_limit(
        request, bucket="platform-pwchange", limit=5, window_seconds=900,
        subject=str(claims.admin_id),
        message="Too many attempts. Try again shortly.",
    )

    row = (
        await session.execute(
            text(
                "SELECT password_hash, token_epoch FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": str(claims.admin_id)},
        )
    ).mappings().first()
    if row is None or not verify_password(payload.current_password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Current password is incorrect.")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Choose a password you have not used here before.")

    # Bumping the epoch is what actually ends the other sessions: every token
    # minted under the old epoch stops validating, whatever its jti.
    await session.execute(
        text(
            "UPDATE platform_admins "
            "   SET password_hash = :h, password_changed_at = now(), "
            "       token_epoch = token_epoch + 1, updated_at = now() "
            " WHERE admin_id = :a"
        ),
        {"h": hash_password(payload.new_password), "a": str(claims.admin_id)},
    )
    await session.commit()

    # Including this one — the browser is signed out and must sign in again.
    clear_platform_cookie(response)
    log.info("platform_password_changed", admin_id=str(claims.admin_id))
