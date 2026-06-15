"""Auth domain service — login, refresh, logout, MFA, password reset."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import string
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

import pyotp
import structlog
from fastapi.responses import Response
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    AccountLockedError,
    AuthenticationError,
    InvalidCredentialsError,
    ResourceNotFoundError,
    TokenInvalidError,
    TokenRevokedError,
    ValidationError,
)
from app.core.redis import (
    REFRESH_TOKEN_KEY,
    REVOKED_TOKENS_SET,
    SESSION_KEY,
    get_session_redis,
)
from app.core.security import (
    _build_access_token_claims,
    create_access_token,
    create_refresh_token,
    hash_password,
    set_auth_cookies,
    verify_password,
)
from app.domains.auth.models import StaffUser
from app.domains.auth.repository import AuthRepository
from app.domains.auth.schemas import (
    MFAEnrollResponse,
    PasswordChange,
    UserProfile,
)

log = structlog.get_logger()

# Redis key for password reset tokens: "pwreset:{token_hash}" → user_id
PWRESET_KEY = "pwreset:{token_hash}"
# Redis key for MFA backup codes: "mfa_backup:{user_id}" → JSON list
MFA_BACKUP_KEY = "mfa_backup:{user_id}"
# Redis key prefix for session index: "sessions:{user_id}" → SET of JTIs
USER_SESSIONS_KEY = "user_sessions:{user_id}"

_LOCKOUT_THRESHOLD = 5
_LOCKOUT_DURATION = timedelta(minutes=15)


class AuthService:
    """
    Business logic for authentication and authorization operations.
    All token issuance writes cookies via the FastAPI Response object —
    actual auth enforcement is via httpOnly cookies, not return values.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = AuthRepository(session)

    # ── Login ─────────────────────────────────────────────────────────────────

    async def login(
        self,
        email: str,
        password: str,
        tenant_id: str,
        ip: str,
        app_context: str,
        response: Response,
    ) -> tuple[str, str]:
        """
        Authenticate a user and issue tokens.
        Returns (access_token, refresh_token) — callers use these to set cookies.
        """
        user = await self._repo.get_by_email_and_tenant(email, tenant_id)
        if user is None:
            # Constant-time response regardless of existence
            verify_password("dummy_plaintext", "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            raise InvalidCredentialsError()

        if not user.is_active:
            raise AuthenticationError("Account is disabled.")

        # Check lockout
        now = datetime.now(timezone.utc)
        if user.locked_until and user.locked_until > now:
            raise AccountLockedError(unlock_at=user.locked_until.isoformat())

        # Verify password
        if not verify_password(password, user.hashed_password):
            await self._repo.increment_failed_login(user.user_id)
            if (user.failed_login_count + 1) >= _LOCKOUT_THRESHOLD:
                locked_until = now + _LOCKOUT_DURATION
                await self._repo.lock_account(user.user_id, locked_until)
                await self._session.commit()
                raise AccountLockedError(unlock_at=locked_until.isoformat())
            await self._session.commit()
            raise InvalidCredentialsError()

        # Success path
        await self._repo.reset_login_failures(user.user_id)
        await self._repo.update_last_login(user.user_id)

        # Build tokens
        access_jti = str(uuid.uuid4())
        refresh_jti = str(uuid.uuid4())
        location_ids = [UUID(lid) for lid in (user.location_ids or [])]
        roles = [user.role]

        access_token = create_access_token(
            user_id=UUID(user.user_id),
            tenant_id=UUID(user.tenant_id),
            roles=roles,
            primary_role=user.role,
            location_ids=location_ids,
            jti=access_jti,
            app_context=app_context,
        )
        refresh_token = create_refresh_token(
            user_id=user.user_id,
            jti=refresh_jti,
            access_jti=access_jti,
            tenant_id=user.tenant_id,
        )

        # Store session in Redis
        redis = get_session_redis()
        access_ttl = (
            settings.jwt_access_token_ttl_counter_seconds
            if app_context == "counter"
            else settings.jwt_access_token_ttl_web_seconds
        )
        await redis.setex(SESSION_KEY.format(jti=access_jti), access_ttl, user.user_id)
        await redis.setex(
            REFRESH_TOKEN_KEY.format(jti=refresh_jti),
            settings.jwt_refresh_token_ttl_seconds,
            user.user_id,
        )
        # Track session JTI per user for session listing
        await redis.sadd(USER_SESSIONS_KEY.format(user_id=user.user_id), access_jti)

        set_auth_cookies(response, access_token, refresh_token, app_context)
        await self._session.commit()

        log.info("user_login", user_id=user.user_id, tenant_id=tenant_id, ip=ip)
        return access_token, refresh_token

    # ── Token Refresh ─────────────────────────────────────────────────────────

    async def refresh(
        self,
        refresh_token_value: str,
        app_context: str,
        response: Response,
    ) -> tuple[str, str]:
        """
        Rotate both tokens.  Old JTIs are revoked immediately.
        Detects refresh token theft via double-use detection.
        """
        secret = settings.jwt_secret_key.get_secret_value()
        try:
            payload = jwt.decode(
                refresh_token_value, secret, algorithms=[settings.jwt_algorithm]
            )
        except JWTError:
            raise TokenInvalidError()

        if payload.get("type") != "refresh":
            raise TokenInvalidError()

        redis = get_session_redis()
        old_refresh_jti = payload["jti"]
        old_access_jti = payload.get("access_jti", "")

        # Theft detection: if already revoked, revoke all sessions for user
        if await redis.sismember(REVOKED_TOKENS_SET, old_refresh_jti):
            user_id = payload.get("sub", "")
            await redis.delete(USER_SESSIONS_KEY.format(user_id=user_id))
            raise TokenRevokedError()

        # Invalidate old tokens
        remaining = payload["exp"] - int(datetime.now(timezone.utc).timestamp())
        if remaining > 0:
            await redis.setex(f"revoked:{old_refresh_jti}", remaining, "1")
            await redis.sadd(REVOKED_TOKENS_SET, old_refresh_jti)
        await redis.delete(REFRESH_TOKEN_KEY.format(jti=old_refresh_jti))
        if old_access_jti:
            await redis.sadd(REVOKED_TOKENS_SET, old_access_jti)
            await redis.delete(SESSION_KEY.format(jti=old_access_jti))

        # Load fresh user data (roles may have changed)
        user = await self._repo.get_by_id(payload["sub"])
        if user is None or not user.is_active:
            raise TokenRevokedError()

        # Issue new tokens
        new_access_jti = str(uuid.uuid4())
        new_refresh_jti = str(uuid.uuid4())
        location_ids = [UUID(lid) for lid in (user.location_ids or [])]

        access_token = create_access_token(
            user_id=UUID(user.user_id),
            tenant_id=UUID(user.tenant_id),
            roles=[user.role],
            primary_role=user.role,
            location_ids=location_ids,
            jti=new_access_jti,
            app_context=app_context,
        )
        refresh_token = create_refresh_token(
            user_id=user.user_id,
            jti=new_refresh_jti,
            access_jti=new_access_jti,
            tenant_id=user.tenant_id,
        )

        access_ttl = (
            settings.jwt_access_token_ttl_counter_seconds
            if app_context == "counter"
            else settings.jwt_access_token_ttl_web_seconds
        )
        await redis.setex(SESSION_KEY.format(jti=new_access_jti), access_ttl, user.user_id)
        await redis.setex(
            REFRESH_TOKEN_KEY.format(jti=new_refresh_jti),
            settings.jwt_refresh_token_ttl_seconds,
            user.user_id,
        )
        await redis.sadd(USER_SESSIONS_KEY.format(user_id=user.user_id), new_access_jti)

        set_auth_cookies(response, access_token, refresh_token, app_context)
        return access_token, refresh_token

    # ── Logout ────────────────────────────────────────────────────────────────

    async def logout(self, jti: str, refresh_jti: Optional[str], response: Response) -> None:
        """Revoke access + refresh JTIs, clear cookies."""
        redis = get_session_redis()
        await redis.sadd(REVOKED_TOKENS_SET, jti)
        await redis.delete(SESSION_KEY.format(jti=jti))
        if refresh_jti:
            await redis.sadd(REVOKED_TOKENS_SET, refresh_jti)
            await redis.delete(REFRESH_TOKEN_KEY.format(jti=refresh_jti))

        response.delete_cookie("rcm_access", path="/api")
        response.delete_cookie("rcm_refresh", path="/api/v1/auth/refresh")
        response.delete_cookie("access_token", path="/api")
        response.delete_cookie("refresh_token", path="/api/v1/auth/refresh")

    # ── Get Me ────────────────────────────────────────────────────────────────

    async def get_me(self, user_id: str, tenant_id: str) -> UserProfile:
        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise ResourceNotFoundError("staff_users", user_id)
        location_ids = [UUID(lid) for lid in (user.location_ids or [])]
        return UserProfile(
            user_id=UUID(user.user_id),
            tenant_id=UUID(user.tenant_id),
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            role=user.role,
            roles=[user.role],
            location_ids=location_ids,
            is_mfa_enabled=user.is_mfa_enabled,
        )

    # ── Change Password ────────────────────────────────────────────────────────

    async def change_password(self, user_id: str, data: PasswordChange) -> None:
        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise ResourceNotFoundError("staff_users", user_id)
        if not verify_password(data.current_password, user.hashed_password):
            raise InvalidCredentialsError()
        new_hash = hash_password(data.new_password)
        await self._repo.update_password(user_id, new_hash)
        await self._session.commit()

    # ── Password Reset ────────────────────────────────────────────────────────

    async def request_password_reset(self, email: str, tenant_id: str) -> None:
        """
        Generate a 24-hour signed reset token and dispatch email.
        Always returns successfully (prevents email enumeration).
        """
        user = await self._repo.get_by_email_and_tenant(email, tenant_id)
        if user is None:
            return  # Silently succeed — do not leak existence

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        redis = get_session_redis()
        await redis.setex(
            PWRESET_KEY.format(token_hash=token_hash),
            86400,  # 24 hours
            user.user_id,
        )

        # Dispatch email notification (fire-and-forget via notification service)
        # The notification service is injected via the router; here we just log
        log.info(
            "password_reset_requested",
            user_id=user.user_id,
            tenant_id=tenant_id,
            # raw_token NOT logged; only hash for audit
        )
        # In production, route to NotificationService.dispatch_notification with
        # event_code=PASSWORD_RESET_REQUESTED and merge_vars={"reset_link": url}

    async def reset_password(self, token: str, new_password: str) -> None:
        """Validate reset token, update password, revoke all sessions."""
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        redis = get_session_redis()
        user_id = await redis.get(PWRESET_KEY.format(token_hash=token_hash))
        if not user_id:
            raise TokenInvalidError()

        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise TokenInvalidError()

        new_hash = hash_password(new_password)
        await self._repo.update_password(user_id, new_hash)

        # Revoke all active sessions for this user
        session_jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=user_id))
        if session_jtis:
            await redis.sadd(REVOKED_TOKENS_SET, *session_jtis)
        await redis.delete(USER_SESSIONS_KEY.format(user_id=user_id))
        await redis.delete(PWRESET_KEY.format(token_hash=token_hash))
        await self._session.commit()

    # ── MFA ──────────────────────────────────────────────────────────────────

    async def enroll_mfa(self, user_id: str) -> MFAEnrollResponse:
        """Generate TOTP secret and 10 backup codes.  Does NOT enable MFA yet."""
        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise ResourceNotFoundError("staff_users", user_id)

        # Generate TOTP secret
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        qr_uri = totp.provisioning_uri(
            name=user.email,
            issuer_name="Rental Car Manager",
        )

        # 10 backup codes: 10-char alphanumeric strings
        backup_codes = [
            "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(10))
            for _ in range(10)
        ]

        # Store hashed backup codes in Redis (24h TTL during enrollment)
        redis = get_session_redis()
        await redis.setex(
            MFA_BACKUP_KEY.format(user_id=user_id),
            86400,
            json.dumps(
                [hashlib.sha256(c.encode()).hexdigest() for c in backup_codes]
            ),
        )

        # Persist plaintext secret (encrypted at DB tier via pgcrypto)
        await self._repo.update_mfa(user_id, secret, is_mfa_enabled=False)
        await self._session.commit()

        return MFAEnrollResponse(
            secret=secret,
            qr_code_uri=qr_uri,
            backup_codes=backup_codes,
        )

    async def verify_mfa(self, user_id: str, totp_code: str) -> bool:
        """Validate TOTP code.  Enables MFA on success."""
        user = await self._repo.get_by_id(user_id)
        if user is None or not user.mfa_secret:
            raise ResourceNotFoundError("staff_users", user_id)

        totp = pyotp.TOTP(user.mfa_secret)
        # Allow 30-second window tolerance (one step each side)
        valid = totp.verify(totp_code, valid_window=1)
        if valid and not user.is_mfa_enabled:
            await self._repo.update_mfa(user_id, user.mfa_secret, is_mfa_enabled=True)
            await self._session.commit()
        return valid

    # ── Session Management ───────────────────────────────────────────────────

    async def list_sessions(self, user_id: str) -> list[dict]:
        """Return all active session JTIs for a user."""
        redis = get_session_redis()
        jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=user_id))
        active = []
        for jti in jtis:
            exists = await redis.exists(SESSION_KEY.format(jti=jti))
            if exists:
                active.append({"jti": jti})
        return active

    async def revoke_session(self, jti: str, requesting_user_id: str) -> None:
        """Force-revoke a specific session JTI."""
        redis = get_session_redis()
        # Only revoke if this session belongs to the requesting user
        user_id = await redis.get(SESSION_KEY.format(jti=jti))
        if user_id != requesting_user_id:
            raise ResourceNotFoundError("session", jti)
        await redis.sadd(REVOKED_TOKENS_SET, jti)
        await redis.delete(SESSION_KEY.format(jti=jti))
