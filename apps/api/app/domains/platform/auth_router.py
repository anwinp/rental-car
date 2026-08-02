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

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import Text, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session_untenanted
from app.core.redis import get_session_redis
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

# Separate keyspace from the tenant MFA challenges. A platform challenge
# redeemed as a tenant one, or the reverse, would be a privilege boundary
# crossed by a naming collision.
PLATFORM_MFA_PENDING = "platform_mfa_pending:{challenge}"
PLATFORM_MFA_ATTEMPTS = "platform_mfa_attempts:{challenge}"
_MFA_CHALLENGE_TTL = 300      # seconds
_MFA_MAX_ATTEMPTS = 5         # per challenge, then it is destroyed

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
            "       updated_at = now() "
            " WHERE admin_id = :a"
        ),
        {"a": row["admin_id"]},
    )
    await session.commit()

    # A correct password is not a session when a second factor is armed. The
    # challenge id is the only thing handed back; no cookie is set until the
    # code is verified, so a stolen password alone reaches nothing.
    if row["is_mfa_enabled"]:
        challenge = secrets.token_urlsafe(24)
        redis = get_session_redis()
        await redis.setex(
            PLATFORM_MFA_PENDING.format(challenge=challenge),
            _MFA_CHALLENGE_TTL,
            str(row["admin_id"]),
        )
        log.info("platform_login_mfa_required", admin_id=str(row["admin_id"]))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Enter the code from your authenticator app.",
            headers={"X-MFA-Challenge": challenge},
        )

    await _finish_login(session, row["admin_id"])
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


# ── Second factor ────────────────────────────────────────────────────────────
#
# Built after shipping the console without it, and the gap was the exact shape
# this codebase keeps producing: platform_admins carried is_mfa_enabled,
# mfa_secret and mfa_backup_codes from migration 073, the console header
# displayed "MFA off", and no endpoint could ever set the flag to true. A
# control that is visible, describes a real risk, and cannot be operated.

class MFAChallengeRequest(BaseModel):
    challenge: str
    code: str


class MFAEnrollRequest(BaseModel):
    # Enrolling over an armed account needs the password, so a hijacked session
    # cannot quietly replace the second factor with the attacker's own.
    current_password: str


class MFAEnrollResponse(BaseModel):
    secret: str
    provisioning_uri: str
    backup_codes: list[str]


class MFAConfirmRequest(BaseModel):
    code: str


class MFADisableRequest(BaseModel):
    current_password: str
    code: str


async def _finish_login(session: AsyncSession, admin_id) -> None:
    await session.execute(
        text("UPDATE platform_admins SET last_login_at = now() WHERE admin_id = :a"),
        {"a": str(admin_id)},
    )
    await session.commit()


def _verify_totp(secret: str, code: str) -> bool:
    import pyotp

    # One step of drift either way: a phone a few seconds off should not lock
    # an operator out of every customer's account.
    return pyotp.TOTP(secret).verify(code.strip().replace(" ", ""), valid_window=1)


@router.post("/mfa/challenge", response_model=PlatformProfile)
async def platform_mfa_challenge(
    payload: MFAChallengeRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session_untenanted),
) -> PlatformProfile:
    """Second step of sign-in: the code, against a challenge from step one."""
    await enforce_limit(
        request, bucket="platform-mfa", limit=20, window_seconds=300,
        subject=payload.challenge, message="Too many attempts. Start again.",
    )

    redis = get_session_redis()
    key = PLATFORM_MFA_PENDING.format(challenge=payload.challenge)
    admin_id = await redis.get(key)
    if not admin_id:
        raise HTTPException(status_code=401, detail="That sign-in attempt expired. Start again.")
    admin_id = admin_id.decode() if isinstance(admin_id, bytes) else str(admin_id)

    # Counted per challenge and destructive at the limit, so an attacker cannot
    # sit on one challenge and walk the 1,000,000 code space.
    attempts = await redis.incr(PLATFORM_MFA_ATTEMPTS.format(challenge=payload.challenge))
    await redis.expire(PLATFORM_MFA_ATTEMPTS.format(challenge=payload.challenge),
                       _MFA_CHALLENGE_TTL)
    if attempts > _MFA_MAX_ATTEMPTS:
        await redis.delete(key)
        raise HTTPException(status_code=401, detail="Too many attempts. Start again.")

    row = (
        await session.execute(
            text(
                "SELECT admin_id, email, full_name, is_mfa_enabled, mfa_secret, "
                "       mfa_backup_codes, token_epoch, last_login_at "
                "  FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": admin_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    supplied = payload.code.strip().replace(" ", "").upper()
    ok = bool(row["mfa_secret"]) and _verify_totp(row["mfa_secret"], supplied)

    if not ok:
        # A backup code is single-use and spent whether or not the rest of the
        # sign-in succeeds — a code that can be replayed is not a backup code.
        codes = list(row["mfa_backup_codes"] or [])
        if supplied in codes:
            codes.remove(supplied)
            await session.execute(
                text(
                    "UPDATE platform_admins SET mfa_backup_codes = :c, "
                    "       updated_at = now() WHERE admin_id = :a"
                ).bindparams(bindparam("c", type_=ARRAY(Text))),
                {"c": codes, "a": admin_id},
            )
            await session.commit()
            ok = True
            log.warning("platform_mfa_backup_code_used", admin_id=admin_id,
                        remaining=len(codes))

    if not ok:
        raise HTTPException(status_code=401, detail="That code is not right.")

    await redis.delete(key)
    await _finish_login(session, admin_id)

    token = create_platform_token(
        admin_id=row["admin_id"], email=row["email"],
        jti=str(uuid.uuid4()), epoch=int(row["token_epoch"]),
    )
    set_platform_cookie(response, token)
    log.info("platform_login", admin_id=admin_id, email=row["email"], mfa=True)

    return PlatformProfile(
        admin_id=row["admin_id"], email=row["email"], full_name=row["full_name"],
        is_mfa_enabled=True, last_login_at=row["last_login_at"],
    )


@router.post("/mfa/enroll", response_model=MFAEnrollResponse)
async def platform_mfa_enroll(
    payload: MFAEnrollRequest,
    claims: PlatformClaims = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_session_untenanted),
) -> MFAEnrollResponse:
    """Generate a secret and backup codes. Does NOT arm anything yet.

    Arming happens in /mfa/confirm, after a code from the app has been shown to
    work. Enrolling and arming in one step is how people lock themselves out of
    a system that administers every customer.
    """
    import pyotp

    row = (
        await session.execute(
            text(
                "SELECT email, password_hash FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": str(claims.admin_id)},
        )
    ).mappings().first()
    if row is None or not verify_password(payload.current_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="That password is not right.")

    secret = pyotp.random_base32()
    codes = [secrets.token_hex(4).upper() for _ in range(10)]

    await session.execute(
        text(
            "UPDATE platform_admins "
            "   SET mfa_secret = :s, mfa_backup_codes = :c, updated_at = now() "
            " WHERE admin_id = :a"
        ).bindparams(bindparam("c", type_=ARRAY(Text))),
        {"s": secret, "c": codes, "a": str(claims.admin_id)},
    )
    await session.commit()

    return MFAEnrollResponse(
        secret=secret,
        provisioning_uri=pyotp.TOTP(secret).provisioning_uri(
            name=row["email"], issuer_name="Ceez Platform",
        ),
        backup_codes=codes,
    )


@router.post("/mfa/confirm", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def platform_mfa_confirm(
    payload: MFAConfirmRequest,
    claims: PlatformClaims = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_session_untenanted),
) -> None:
    """Arm the second factor, once a code from the app verifies."""
    row = (
        await session.execute(
            text(
                "SELECT mfa_secret FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": str(claims.admin_id)},
        )
    ).mappings().first()
    if row is None or not row["mfa_secret"]:
        raise HTTPException(status_code=400, detail="Start enrolment first.")
    if not _verify_totp(row["mfa_secret"], payload.code):
        raise HTTPException(status_code=400, detail="That code is not right.")

    await session.execute(
        text(
            "UPDATE platform_admins SET is_mfa_enabled = true, updated_at = now() "
            " WHERE admin_id = :a"
        ),
        {"a": str(claims.admin_id)},
    )
    await session.commit()
    log.warning("platform_mfa_enabled", admin_id=str(claims.admin_id),
                email=claims.email)


@router.post("/mfa/disable", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def platform_mfa_disable(
    payload: MFADisableRequest,
    claims: PlatformClaims = Depends(get_current_platform_admin),
    session: AsyncSession = Depends(get_session_untenanted),
) -> None:
    """Turn the second factor off. Needs the password AND a current code.

    Both, because a session cookie alone must not be enough to remove the
    control that exists to make a stolen session insufficient.
    """
    row = (
        await session.execute(
            text(
                "SELECT password_hash, mfa_secret, is_mfa_enabled "
                "  FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": str(claims.admin_id)},
        )
    ).mappings().first()
    if row is None or not row["is_mfa_enabled"]:
        raise HTTPException(status_code=400, detail="It is not switched on.")
    if not verify_password(payload.current_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="That password is not right.")
    if not _verify_totp(row["mfa_secret"] or "", payload.code):
        raise HTTPException(status_code=400, detail="That code is not right.")

    await session.execute(
        text(
            "UPDATE platform_admins "
            "   SET is_mfa_enabled = false, mfa_secret = NULL, "
            "       mfa_backup_codes = NULL, updated_at = now() "
            " WHERE admin_id = :a"
        ),
        {"a": str(claims.admin_id)},
    )
    await session.commit()
    log.warning("platform_mfa_disabled", admin_id=str(claims.admin_id),
                email=claims.email)
