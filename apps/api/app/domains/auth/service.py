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
    MFARequiredError,
    AuthenticationError,
    InvalidCredentialsError,
    ResourceNotFoundError,
    TokenInvalidError,
    TokenRevokedError,
    ValidationError,
)
from app.core.redis import (
    MFA_ATTEMPT_KEY,
    MFA_PENDING_KEY,
    REFRESH_TOKEN_KEY,
    REVOKED_TOKENS_SET,
    SESSION_KEY,
    get_session_redis,
)
from sqlalchemy import Text, bindparam, text as _text
from sqlalchemy.dialects.postgresql import ARRAY

from app.core.security import (
    _build_access_token_claims,
    bump_epoch,
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
# One hour. The previous 24h window is a long time for a credential that
# arrives in an inbox and grants a password change; an hour is the usual bound
# and still comfortable for someone who reads mail on a phone.
_PWRESET_TTL_SECONDS = 3600
# Redis key for MFA backup codes: "mfa_backup:{user_id}" → JSON list
MFA_BACKUP_KEY = "mfa_backup:{user_id}"
# Redis key prefix for session index: "sessions:{user_id}" → SET of JTIs
USER_SESSIONS_KEY = "user_sessions:{user_id}"

_LOCKOUT_THRESHOLD = 5
# An MFA challenge is a short-lived stand-in for a completed password check.
_MFA_CHALLENGE_TTL = 300      # seconds
_MFA_MAX_ATTEMPTS = 5         # per challenge, then it is destroyed
_LOCKOUT_DURATION = timedelta(minutes=15)


# A real bcrypt hash of a value nobody can supply. Used only to spend the same
# work as a genuine password check when the account does not exist.
_DUMMY_HASH = "$2b$12$iqwcNBJwCgPbaA9tMO5R.uJeNQvsbBkIKbiDhH20Nym.KFmJogkCy"


class AuthService:
    """
    Business logic for authentication and authorization operations.
    All token issuance writes cookies via the FastAPI Response object —
    actual auth enforcement is via httpOnly cookies, not return values.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = AuthRepository(session)

    # ── Tenant standing ───────────────────────────────────────────────────────

    async def _assert_tenant_active(self, tenant_id: str) -> None:
        """Refuse authentication for a tenant that is not in good standing.

        `tenants` carries no RLS (it is the registry the resolver reads before
        any tenant context exists), so this is a plain lookup.
        """
        from sqlalchemy import text

        row = (
            await self._session.execute(
                text(
                    "SELECT status FROM tenants "
                    "WHERE tenant_id = :tid AND deleted_at IS NULL"
                ),
                {"tid": str(tenant_id)},
            )
        ).first()

        if row is None:
            # Do not disclose whether the tenant exists.
            raise InvalidCredentialsError()

        status = (row[0] or "").upper()
        if status == "SUSPENDED":
            raise AuthenticationError(
                "This workspace is suspended. Contact your administrator."
            )
        if status == "EXPIRED":
            # A hard lockout: no sign-in at all once the term lapses. Which
            # makes the wording load-bearing — the person reading it cannot get
            # in to find a renewal page, so it has to say where the link is
            # rather than leave them clicking "forgot password".
            raise AuthenticationError(
                "This workspace's subscription has ended. Nothing has been "
                "deleted. Use the renewal link emailed to the workspace owner "
                "to restore access."
            )
        if status in ("CANCELLED", "DELETED"):
            raise AuthenticationError("This workspace is no longer active.")
        if status == "PENDING_VERIFICATION":
            raise AuthenticationError(
                "Confirm your email address to activate this workspace."
            )

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
        # MT-07: the organisation's own standing gates every sign-in. Checked
        # before credentials so a suspended tenant cannot be probed for valid
        # passwords, and re-checked on refresh so suspension takes effect within
        # one token lifetime rather than at next sign-in.
        await self._assert_tenant_active(tenant_id)

        user = await self._repo.get_by_email_and_tenant(email, tenant_id)
        if user is None:
            # Burn roughly the same time as a real verify so response latency
            # does not reveal whether the account exists.
            #
            # The previous placeholder was not a valid bcrypt hash (its checksum
            # was short), so passlib raised ValueError and this path returned
            # 500 instead of 401 — which leaked existence far more loudly than
            # timing ever would: 401 meant "real user, wrong password" and 500
            # meant "no such user".
            verify_password("dummy_plaintext", _DUMMY_HASH)
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

        # Second factor. Until now `is_mfa_enabled` was written by enrollment
        # and read by nothing on this path, so a user who had carefully set up
        # an authenticator still got a full-privilege session from the password
        # alone — the control existed in the UI and in the column, and nowhere
        # in between.
        #
        # Everything below this point issues a session, so the challenge has to
        # interrupt here. What goes back to the caller is an opaque id with no
        # authority of its own; the session is minted in complete_mfa_login.
        if user.is_mfa_enabled and user.mfa_secret:
            challenge_id = secrets.token_urlsafe(32)
            redis = get_session_redis()
            await redis.setex(
                MFA_PENDING_KEY.format(challenge_id=challenge_id),
                _MFA_CHALLENGE_TTL,
                json.dumps(
                    {
                        "user_id": str(user.user_id),
                        "tenant_id": str(user.tenant_id),
                        "app_context": app_context,
                        "ip": ip,
                    }
                ),
            )
            await self._session.commit()
            log.info("mfa_challenge_issued", user_id=user.user_id, tenant_id=tenant_id)
            raise MFARequiredError(challenge_id, _MFA_CHALLENGE_TTL)

        await self._repo.update_last_login(user.user_id)

        # Build tokens
        access_jti = str(uuid.uuid4())
        refresh_jti = str(uuid.uuid4())
        user_epoch = int(getattr(user, "token_epoch", 0) or 0)
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
            epoch=user_epoch,
        )
        refresh_token = create_refresh_token(
            user_id=user.user_id,
            jti=refresh_jti,
            access_jti=access_jti,
            tenant_id=user.tenant_id,
            epoch=user_epoch,
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

    async def complete_mfa_login(
        self,
        challenge_id: str,
        code: str,
        response: Response,
    ) -> tuple[str, str]:
        """Exchange an MFA challenge plus a valid code for a real session.

        Accepts either a TOTP code or one of the enrollment backup codes. Backup
        codes are single-use and consumed here — they were generated with a
        24-hour TTL and read by nothing, so anyone who actually lost their
        authenticator was locked out permanently despite holding ten valid codes.
        """
        redis = get_session_redis()
        key = MFA_PENDING_KEY.format(challenge_id=challenge_id)
        raw = await redis.get(key)
        if not raw:
            raise TokenInvalidError()

        # Brute force is the obvious attack on a 6-digit code, and pyotp's
        # valid_window=1 means roughly three codes are live at any moment.
        attempts = await redis.incr(MFA_ATTEMPT_KEY.format(challenge_id=challenge_id))
        if attempts == 1:
            await redis.expire(
                MFA_ATTEMPT_KEY.format(challenge_id=challenge_id), _MFA_CHALLENGE_TTL
            )
        if attempts > _MFA_MAX_ATTEMPTS:
            await redis.delete(key)
            log.warning("mfa_challenge_exhausted", challenge_id=challenge_id[:8])
            raise TokenInvalidError()

        pending = json.loads(raw)
        user_id = pending["user_id"]
        app_context = pending.get("app_context", "web")

        await self._session.execute(
            _text("SELECT set_config('app.current_tenant_id', :t, true)"),
            {"t": str(pending["tenant_id"])},
        )
        user = await self._repo.get_by_id(user_id)
        if user is None or not user.is_active or not user.mfa_secret:
            raise TokenInvalidError()

        # Re-check the workspace: a suspension between the two steps must land.
        await self._assert_tenant_active(user.tenant_id)

        code = (code or "").strip().replace(" ", "")
        verified = pyotp.TOTP(user.mfa_secret).verify(code, valid_window=1)

        if not verified:
            verified = await self._consume_backup_code(
                user_id, code, tenant_id=str(user.tenant_id)
            )

        if not verified:
            raise InvalidCredentialsError()

        # One challenge, one session.
        await redis.delete(key)
        await redis.delete(MFA_ATTEMPT_KEY.format(challenge_id=challenge_id))

        await self._repo.update_last_login(user_id)
        return await self._issue_session(user, app_context, response)

    async def _consume_backup_code(
        self, user_id: str, code: str, *, tenant_id: str
    ) -> bool:
        """Spend a single-use backup code. Returns True if one matched.

        Reads Redis first because it is the fast path, and falls back to the
        durable copy in Postgres. Backup codes used to live ONLY in Redis —
        which is a cache here, running volatile-lru with no persistence
        guarantee — so flushing or replacing it permanently locked out every
        MFA-enabled account, with no admin reset anywhere in the product to
        recover from it.
        """
        raw = await get_session_redis().get(MFA_BACKUP_KEY.format(user_id=user_id))
        codes: list[str] | None = None
        if raw:
            try:
                codes = json.loads(raw)
            except (TypeError, ValueError):
                codes = None

        if codes is None:
            row = (
                await self._session.execute(
                    _text(
                        "SELECT mfa_backup_codes FROM staff_users "
                        " WHERE user_id = :u AND tenant_id = :t"
                    ),
                    {"u": user_id, "t": tenant_id},
                )
            ).first()
            codes = list(row[0]) if row and row[0] else None
            if codes is None:
                return False
            log.info("mfa_backup_codes_from_db", user_id=user_id)

        upper = code.upper()
        match = None
        for stored in codes:
            # Codes are stored hashed; compare in constant time.
            if hmac.compare_digest(
                hashlib.sha256(upper.encode()).hexdigest(), stored
            ):
                match = stored
                break
        if match is None:
            return False

        codes.remove(match)
        # Spend it in both places, or a Redis flush would resurrect a code that
        # has already been used once.
        await get_session_redis().set(
            MFA_BACKUP_KEY.format(user_id=user_id), json.dumps(codes)
        )
        await self._session.execute(
            _text(
                "UPDATE staff_users SET mfa_backup_codes = :c "
                " WHERE user_id = :u AND tenant_id = :t"
            ).bindparams(bindparam("c", type_=ARRAY(Text))),
            {"c": codes, "u": user_id, "t": tenant_id},
        )
        await self._session.commit()
        log.info("mfa_backup_code_used", user_id=user_id, remaining=len(codes))
        return True

    async def _issue_session(
        self, user: StaffUser, app_context: str, response: Response
    ) -> tuple[str, str]:
        """Mint the token pair, register it in Redis, and set cookies.

        Extracted so the password-only path and the MFA path cannot drift apart
        — the second factor must not accidentally produce a session built
        differently from the first.
        """
        access_jti = str(uuid.uuid4())
        refresh_jti = str(uuid.uuid4())
        user_epoch = int(getattr(user, "token_epoch", 0) or 0)
        location_ids = [UUID(lid) for lid in (user.location_ids or [])]

        access_token = create_access_token(
            user_id=UUID(user.user_id),
            tenant_id=UUID(user.tenant_id),
            roles=[user.role],
            primary_role=user.role,
            location_ids=location_ids,
            jti=access_jti,
            app_context=app_context,
            epoch=user_epoch,
        )
        refresh_token = create_refresh_token(
            user_id=user.user_id,
            jti=refresh_jti,
            access_jti=access_jti,
            tenant_id=user.tenant_id,
            epoch=user_epoch,
        )

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
        await redis.sadd(USER_SESSIONS_KEY.format(user_id=user.user_id), access_jti)

        set_auth_cookies(response, access_token, refresh_token, app_context)
        await self._session.commit()
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

        # Theft detection. A replayed refresh token means the token family is
        # compromised: either the attacker or the legitimate user is presenting
        # one that was already rotated away.
        #
        # This previously deleted user_sessions:{uid} — the INDEX of the live
        # sessions, not the sessions themselves — so the alarm fired while every
        # stolen token kept working. Worse, that index is the input to the
        # password-reset cleanup below, so replaying a token pre-emptively
        # disabled the victim's own recovery path.
        #
        # Bumping the epoch is what actually ends it: every token for this user,
        # of either kind, issued or not yet seen, stops validating on the next
        # request.
        if await redis.sismember(REVOKED_TOKENS_SET, old_refresh_jti):
            user_id = payload.get("sub", "")
            tenant_id = payload.get("tenant_id", "")
            if user_id:
                await self._session.execute(
                    _text("SELECT set_config('app.current_tenant_id', :t, true)"),
                    {"t": str(tenant_id)},
                )
                await bump_epoch(self._session, user_id)
                await self._session.commit()
                jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=user_id))
                if jtis:
                    await redis.sadd(REVOKED_TOKENS_SET, *jtis)
                await redis.delete(USER_SESSIONS_KEY.format(user_id=user_id))
            log.warning(
                "refresh_token_reuse_detected",
                user_id=user_id,
                tenant_id=tenant_id,
                jti=old_refresh_jti,
            )
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

        # A refresh token that predates a password change must not rotate. This
        # is the check that closes the 30-day window a stolen token used to keep
        # after the victim reset their password.
        token_epoch = int(payload.get("epoch", 0))
        user_epoch = int(getattr(user, "token_epoch", 0) or 0)
        if token_epoch < user_epoch:
            raise TokenRevokedError()

        # MT-07: the workspace's standing is re-checked on every rotation, not
        # just at sign-in. Without this a suspended organisation keeps working
        # until its refresh token expires — up to 30 days — because rotation
        # would happily mint new access tokens for it.
        await self._assert_tenant_active(user.tenant_id)

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
            epoch=user_epoch,
        )
        refresh_token = create_refresh_token(
            user_id=user.user_id,
            jti=new_refresh_jti,
            access_jti=new_access_jti,
            tenant_id=user.tenant_id,
            epoch=user_epoch,
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

    async def get_me(self, user_id: str, tenant_id: str, is_customer: bool = False) -> UserProfile:
        if is_customer:
            from app.domains.customers.repository import CustomerRepository
            repo = CustomerRepository(self._session, UUID(tenant_id))
            customer = await repo.get(UUID(user_id))
            if customer is None:
                raise ResourceNotFoundError("customers", user_id)
            return UserProfile(
                user_id=UUID(customer.customer_id),
                tenant_id=UUID(customer.tenant_id),
                email=customer.email,
                first_name=customer.first_name,
                last_name=customer.last_name,
                role="CUSTOMER",
                roles=["CUSTOMER"],
                location_ids=[],
                is_mfa_enabled=False,
            )

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

    # ── Google OAuth ──────────────────────────────────────────────────────────

    async def oauth_google_exchange(
        self,
        code: str,
        redirect_uri: str,
        tenant_id: str,
    ) -> tuple[str, str]:
        """
        Exchange a Google authorization code for a customer session.
        Returns (access_token, refresh_token) — callers set the cookies.
        """
        import httpx
        from app.domains.customers.repository import CustomerRepository

        # Exchange authorization code for Google access token
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code":          code,
                    "client_id":     settings.google_client_id,
                    "client_secret": settings.google_client_secret.get_secret_value(),
                    "redirect_uri":  redirect_uri,
                    "grant_type":    "authorization_code",
                },
            )
            if token_resp.status_code != 200:
                log.error("google_token_exchange_failed", status=token_resp.status_code, body=token_resp.text)
                raise AuthenticationError("Google authorization failed.")

            google_access_token = token_resp.json().get("access_token")

            # Fetch Google user profile
            userinfo_resp = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {google_access_token}"},
            )
            if userinfo_resp.status_code != 200:
                raise AuthenticationError("Failed to retrieve Google profile.")
            userinfo = userinfo_resp.json()

        google_sub = str(userinfo.get("id") or userinfo.get("sub") or "")
        email = (userinfo.get("email") or "").lower().strip()
        first_name = userinfo.get("given_name") or userinfo.get("name", "Google").split()[0]
        last_name = userinfo.get("family_name") or ""

        if not google_sub or not email:
            raise AuthenticationError("Google did not return a usable identity.")

        tenant_uuid = UUID(tenant_id)
        repo = CustomerRepository(self._session, tenant_uuid)

        # Find by Google sub → link email → create new
        customer = await repo.get_by_google_sub(google_sub, tenant_uuid)
        if customer is None:
            customer = await repo.get_by_email(email, tenant_uuid)
            if customer is not None:
                # Link the Google identity to the existing account
                await repo.update(
                    UUID(customer.customer_id),
                    oauth_google_sub=google_sub,
                    email_verified=True,
                )
                await self._session.refresh(customer)
            else:
                # First-time Google sign-in — create customer record
                customer = await repo.create(
                    first_name=first_name,
                    last_name=last_name or "User",
                    email=email,
                    email_verified=True,
                    oauth_google_sub=google_sub,
                )

        await self._session.commit()

        # Issue JWT pair for the customer
        customer_uuid = UUID(customer.customer_id)
        access_jti = str(uuid.uuid4())
        refresh_jti = str(uuid.uuid4())

        access_token = create_access_token(
            user_id=customer_uuid,
            tenant_id=tenant_uuid,
            roles=["CUSTOMER"],
            primary_role="CUSTOMER",
            location_ids=[],
            jti=access_jti,
            app_context="web",
        )
        refresh_token = create_refresh_token(
            user_id=str(customer_uuid),
            jti=refresh_jti,
            access_jti=access_jti,
            tenant_id=str(tenant_uuid),
        )

        redis = get_session_redis()
        await redis.setex(
            SESSION_KEY.format(jti=access_jti),
            settings.jwt_access_token_ttl_web_seconds,
            str(customer_uuid),
        )
        await redis.setex(
            REFRESH_TOKEN_KEY.format(jti=refresh_jti),
            settings.jwt_refresh_token_ttl_seconds,
            str(customer_uuid),
        )
        await redis.sadd(USER_SESSIONS_KEY.format(user_id=str(customer_uuid)), access_jti)

        log.info("google_oauth_login", customer_id=str(customer_uuid), tenant_id=tenant_id)
        return access_token, refresh_token

    # ── Change Password ────────────────────────────────────────────────────────

    async def change_password(self, user_id: str, data: PasswordChange) -> None:
        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise ResourceNotFoundError("staff_users", user_id)
        if not verify_password(data.current_password, user.hashed_password):
            raise InvalidCredentialsError()
        new_hash = hash_password(data.new_password)
        await self._repo.update_password(user_id, new_hash)

        # Changing your password ends every session, everywhere. This revoked
        # nothing at all before, so the usual reaction to "I think someone is in
        # my account" left the intruder exactly where they were.
        await bump_epoch(self._session, user_id)
        redis = get_session_redis()
        jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=user_id))
        if jtis:
            await redis.sadd(REVOKED_TOKENS_SET, *jtis)
        await redis.delete(USER_SESSIONS_KEY.format(user_id=user_id))
        await self._session.commit()

    # ── Password Reset ────────────────────────────────────────────────────────

    async def mint_reset_link(
        self, *, user_id: str, tenant_id: str, slug: str
    ) -> str:
        """One single-use recovery link for one account.

        The only place a reset token is created. Both callers — the self-serve
        "I forgot my password" flow and the operator-initiated reset in the
        platform console — go through here so the TTL, the hashing, and the
        payload format cannot drift apart between them. A token that a console
        mints but the redemption path cannot parse is an outage nobody would
        catch until a customer was already locked out.

        The token carries its tenant. Redemption binds it before reading the
        user — without that, a token minted for one workspace is invisible to
        RLS when redeemed anywhere else, and the holder gets "invalid link" for
        a link that was just emailed to them.
        """
        from app.core.config import settings
        from app.core.tenancy import tenant_host

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        await get_session_redis().setex(
            PWRESET_KEY.format(token_hash=token_hash),
            _PWRESET_TTL_SECONDS,
            f"{user_id}|{tenant_id}",
        )
        host = tenant_host(slug, settings.public_admin_host)
        return f"{settings.public_url_scheme}://{host}/reset-password?token={raw_token}"

    async def request_password_reset(
        self, email: str, tenant_id: str | None = None, reset_base_url: str = ""
    ) -> None:
        """Send recovery links for every account this address can sign in to.

        Two things were wrong with the previous implementation.

        The tenant came from the request BODY, so the caller chose whose
        account to reset. Paired with the unauthenticated tenant-config
        endpoint, which returns a tenant_id for any slug, that was a targeted
        account-takeover primitive.

        The link's base URL came from the Origin HEADER, unvalidated. Setting
        Origin to a host you control produced a genuine email, from this
        system, carrying a valid token, pointing anywhere you liked.

        Now: the tenant is only ever derived from the resolved host, and links
        are built from the configured public hosts. Neither is caller-supplied.

        When no tenant can be derived — the platform host, or a bare API call —
        this covers every workspace the address belongs to, one link each, in a
        single email. The response is identical either way, so nothing is
        disclosed to whoever typed the address; only the mailbox owner learns
        anything, and only about their own accounts.

        `reset_base_url` is accepted and ignored. It is kept so an old caller
        cannot silently change behaviour by passing one.
        """
        from app.core.config import settings
        from app.core.mailer import send_email, wrap_html
        from app.core.tenancy import tenant_host

        rows = (
            await self._session.execute(
                _text(
                    "SELECT user_id, tenant_id, slug, display_name, email "
                    "  FROM find_password_reset_targets(:e)"
                ),
                {"e": email},
            )
        ).mappings().all()

        # A host-derived tenant narrows to that workspace. Anything else covers
        # them all — that is the generic case and the one people actually hit.
        if tenant_id:
            rows = [r for r in rows if str(r["tenant_id"]) == str(tenant_id)]

        if not rows:
            # Silently succeed. The caller must not learn whether the address
            # exists, here or in the timing of this return.
            log.info("password_reset_requested", matched=0)
            return

        links: list[tuple[str, str]] = []

        for row in rows:
            links.append((
                row["display_name"],
                await self.mint_reset_link(
                    user_id=str(row["user_id"]),
                    tenant_id=str(row["tenant_id"]),
                    slug=row["slug"],
                ),
            ))

        if len(links) == 1:
            name, url = links[0]
            body = (
                f"<p>We received a request to reset the password for your "
                f"<strong>{name}</strong> account. This link expires in one hour "
                f"and can be used once.</p>"
                "<p>If you did not request this, you can ignore this email — "
                "your password will not change.</p>"
            )
            html = wrap_html(
                "Reset your password", body,
                cta_text="Choose a new password", cta_url=url,
            )
        else:
            # More than one workspace uses this address. Name them, so the
            # person picks rather than guessing which link is which.
            items = "".join(
                f'<li style="margin:0 0 10px"><a href="{url}" '
                f'style="color:#4f46e5">{name}</a></li>'
                for name, url in links
            )
            html = wrap_html(
                "Reset your password",
                "<p>This address can sign in to more than one workspace. Choose "
                "the one you want to reset — each link expires in one hour and "
                "can be used once.</p>"
                f'<ul style="padding-left:18px;margin:18px 0">{items}</ul>'
                "<p>If you did not request this, you can ignore this email — "
                "no password will change.</p>",
            )

        transport = await send_email(
            to_email=rows[0]["email"],
            subject="Reset your RCM password",
            html=html,
            kind="password_reset",
        )

        log.info(
            "password_reset_requested",
            matched=len(rows),
            scoped_to_tenant=bool(tenant_id),
            transport=transport,
            # Raw tokens are never logged; only their hashes are stored, above.
        )

    async def reset_password(self, token: str, new_password: str) -> None:
        """Validate reset token, update password, revoke all sessions."""
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        redis = get_session_redis()
        stored = await redis.get(PWRESET_KEY.format(token_hash=token_hash))
        if not stored:
            raise TokenInvalidError()

        # Tokens carry "user_id|tenant_id". The tenant half is what makes a
        # link redeemable from wherever the person opens their mail: staff_users
        # is under strict RLS, so without binding the token's own tenant the
        # lookup below returns nothing and a perfectly valid link reports itself
        # invalid. Older single-value tokens still redeem, under whatever tenant
        # the request resolved to, as they did before.
        raw = stored.decode() if isinstance(stored, bytes) else str(stored)
        user_id, _, token_tenant = raw.partition("|")
        if token_tenant:
                await self._session.execute(
                _text("SELECT set_config('app.current_tenant_id', :t, true)"),
                {"t": token_tenant},
            )

        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise TokenInvalidError()

        new_hash = hash_password(new_password)
        await self._repo.update_password(user_id, new_hash)

        # Raise the credential epoch FIRST. The JTI sweep below only ever held
        # access tokens; refresh JTIs were never added to that index and
        # refresh:{jti} keys were never deleted, so a stolen refresh token used
        # to survive the reset and keep minting sessions for another 30 days.
        # The epoch invalidates both kinds at once, including tokens this
        # process has no way to enumerate.
        await bump_epoch(self._session, str(user_id))

        # Still sweep the known JTIs: it makes the revocation immediate rather
        # than waiting out the 5-minute epoch cache.
        session_jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=user_id))
        if session_jtis:
            await redis.sadd(REVOKED_TOKENS_SET, *session_jtis)
        await redis.delete(USER_SESSIONS_KEY.format(user_id=user_id))
        await redis.delete(PWRESET_KEY.format(token_hash=token_hash))
        await self._session.commit()

    # ── MFA ──────────────────────────────────────────────────────────────────

    async def enroll_mfa(
        self, user_id: str, current_password: str | None = None
    ) -> MFAEnrollResponse:
        """Generate a TOTP secret and 10 backup codes. Does NOT enable MFA yet.

        Re-enrolling used to silently DISARM an account that already had MFA
        on. It overwrote the secret and the backup codes and set
        is_mfa_enabled=False unconditionally, with no password check and no
        confirmation — so anyone holding a session cookie (a stolen laptop, an
        unlocked machine at the counter) could turn the second factor off with
        a single call, and a user who merely opened the enrolment screen and
        closed it disarmed themselves without being told.

        Now: enrolling over an armed account requires the account password.
        That keeps the legitimate "I replaced my phone" path open while making
        a hijacked session insufficient on its own.
        """
        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise ResourceNotFoundError("staff_users", user_id)

        if user.is_mfa_enabled:
            if not current_password or not verify_password(
                current_password, user.hashed_password
            ):
                # Not InvalidCredentialsError: that one takes no message and
                # says "Invalid email address or password", which is wrong and
                # confusing here — the person is already signed in and the
                # email was never in question.
                raise AuthenticationError(
                    "Enter your account password to set up a new authenticator."
                )

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
        # No TTL. These previously expired 24 hours after enrollment, so the
        # ten codes a user is told to keep somewhere safe were dead long before
        # the day they lost their phone — which is the only day they matter.
        hashed = [hashlib.sha256(c.encode()).hexdigest() for c in backup_codes]
        await redis.set(
            MFA_BACKUP_KEY.format(user_id=user_id), json.dumps(hashed)
        )
        # The durable copy. staff_users.mfa_backup_codes has existed since the
        # original schema and was never once written — the codes lived only in
        # Redis, which here is an evictable cache with no persistence
        # guarantee. Redis stays the fast path; this is what survives it.
        await self._session.execute(
            _text(
                "UPDATE staff_users SET mfa_backup_codes = :c "
                " WHERE user_id = :u AND tenant_id = :t"
            ).bindparams(bindparam("c", type_=ARRAY(Text))),
            {"c": hashed, "u": user_id, "t": str(user.tenant_id)},
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
