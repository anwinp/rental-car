"""Auth domain FastAPI router."""
from __future__ import annotations

import secrets
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.ratelimit import enforce_limit
from app.core.redis import get_session_redis, SESSION_KEY
from app.core.security import UserClaims, get_current_user
from app.domains.auth.schemas import (
    LoginRequest,
    MFAEnrollResponse,
    MFAVerifyRequest,
    PasswordChange,
    PasswordResetComplete,
    PasswordResetRequest,
    TokenResponse,
    UserProfile,
)
from app.domains.auth.service import AuthService

router = APIRouter()

_OAUTH_STATE_TTL = 600  # 10 minutes


class GoogleExchangeRequest(BaseModel):
    code: str
    state: str
    redirect_uri: str


class GoogleExchangeResponse(BaseModel):
    access_token: str
    refresh_token: str
    access_ttl: int
    refresh_ttl: int


def _get_auth_service(db: AsyncSession = Depends(get_session)) -> AuthService:
    return AuthService(db)


# ── Login / Logout ────────────────────────────────────────────────────────────

@router.post("/login", response_model=UserProfile)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    service: AuthService = Depends(_get_auth_service),
) -> UserProfile:
    """
    Authenticate with email + password.
    Sets httpOnly cookies (access_token + refresh_token).
    Returns UserProfile for immediate display — NOT used for subsequent auth.
    """
    client_ip = request.headers.get("X-Forwarded-For", request.client.host or "").split(",")[0].strip()
    # tenant_id resolved from header or request.state (set by middleware)
    # Per (address, account). The 5-strike lockout in the service is
    # per-account, so it does not meter one password sprayed across many
    # accounts; this does.
    await enforce_limit(
        request, bucket="login", limit=10, window_seconds=300,
        subject=payload.email,
        message="Too many sign-in attempts. Try again in a few minutes.",
    )
    tenant_id = request.headers.get("X-Tenant-ID") or getattr(request.state, "tenant_id", "")
    if not tenant_id:
        from app.core.exceptions import AuthenticationError
        raise AuthenticationError("X-Tenant-ID header is required.")

    access_token, _ = await service.login(
        email=payload.email,
        password=payload.password,
        tenant_id=tenant_id,
        ip=client_ip,
        app_context=payload.app_context,
        response=response,
    )

    # Decode profile from token (avoid another DB hit)
    from app.core.security import decode_token
    claims = decode_token(access_token)
    return await service.get_me(str(claims.user_id), str(claims.tenant_id))


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Request,
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None, alias="rcm_refresh"),
    service: AuthService = Depends(_get_auth_service),
) -> TokenResponse:
    """Rotate both access and refresh tokens.  Reads refresh_token cookie."""
    if not refresh_token:
        # Try legacy cookie name
        refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        from app.core.exceptions import AuthenticationError
        raise AuthenticationError("No refresh token cookie present.")

    app_context = request.headers.get("X-App-Context", "web")
    await service.refresh(refresh_token, app_context, response)
    return TokenResponse(message="Token refreshed", app_context=app_context)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def logout(
    request: Request,
    response: Response,
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> None:
    """Revoke tokens and clear auth cookies."""
    refresh_jti: Optional[str] = None
    refresh_cookie = request.cookies.get("rcm_refresh") or request.cookies.get("refresh_token")
    if refresh_cookie:
        try:
            from jose import jwt as _jwt
            from app.core.config import settings
            payload = _jwt.decode(
                refresh_cookie,
                settings.jwt_secret_key.get_secret_value(),
                algorithms=[settings.jwt_algorithm],
            )
            refresh_jti = payload.get("jti")
        except Exception:
            pass

    await service.logout(claims.jti, refresh_jti, response)


# ── Profile ───────────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserProfile)
async def get_me(
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> UserProfile:
    """Return the current user's profile.  Read-only — no GUC injection needed."""
    is_customer = "CUSTOMER" in claims.roles
    return await service.get_me(str(claims.user_id), str(claims.tenant_id), is_customer=is_customer)


# ── Google OAuth ───────────────────────────────────────────────────────────────

@router.get("/google")
async def google_auth_redirect(request: Request) -> RedirectResponse:
    """
    Step 1 — redirect the browser to Google's OAuth consent screen.
    The tenant_id is encoded in the state so the callback can resolve it.
    """
    if not settings.google_client_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=501, detail="Google OAuth is not configured on this server.")

    tenant_id = request.query_params.get(
        "tenant_id", "00000000-0000-0000-0000-000000000001"
    )
    state = secrets.token_urlsafe(32)
    redis = get_session_redis()
    # Store tenant_id under the state key; 10-minute window
    await redis.setex(f"oauth_state:{state}", _OAUTH_STATE_TTL, tenant_id)

    params = {
        "client_id":     settings.google_client_id,
        "redirect_uri":  settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope":         "openid email profile",
        "state":         state,
        "access_type":   "online",
        "prompt":        "select_account",
    }
    return RedirectResponse(
        url="https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params),
        status_code=302,
    )


@router.post("/google/exchange", response_model=GoogleExchangeResponse)
async def google_exchange(
    payload: GoogleExchangeRequest,
    request: Request,
    service: AuthService = Depends(_get_auth_service),
) -> GoogleExchangeResponse:
    """
    Step 2 — server-to-server code exchange (called by the Next.js route handler,
    NOT by the browser directly).  Returns tokens as JSON; caller sets cookies.
    """
    if not settings.google_client_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=501, detail="Google OAuth is not configured.")

    redis = get_session_redis()
    tenant_id_bytes = await redis.get(f"oauth_state:{payload.state}")
    if not tenant_id_bytes:
        from app.core.exceptions import AuthenticationError
        raise AuthenticationError("OAuth state is invalid or has expired.")
    tenant_id = tenant_id_bytes if isinstance(tenant_id_bytes, str) else tenant_id_bytes.decode()
    await redis.delete(f"oauth_state:{payload.state}")

    access_token, refresh_token = await service.oauth_google_exchange(
        code=payload.code,
        redirect_uri=payload.redirect_uri,
        tenant_id=tenant_id,
    )
    return GoogleExchangeResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        access_ttl=settings.jwt_access_token_ttl_web_seconds,
        refresh_ttl=settings.jwt_refresh_token_ttl_seconds,
    )


# ── Password Management ───────────────────────────────────────────────────────

@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def change_password(
    payload: PasswordChange,
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> None:
    """Change the current user's password."""
    await service.change_password(str(claims.user_id), payload)


@router.post("/request-password-reset", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    service: AuthService = Depends(_get_auth_service),
) -> dict:
    """
    Initiate password reset flow.
    Always returns 202 regardless of whether the email is registered
    (prevents email enumeration).
    """
    # This endpoint sends real email, so an unmetered one is a mail-bombing
    # tool aimed at any address someone can guess.
    await enforce_limit(
        request, bucket="pwreset", limit=5, window_seconds=900,
        subject=payload.email,
        message="Too many reset requests. Try again shortly.",
    )

    # The tenant comes from the resolved host and nowhere else. It used to be
    # read from the request body, which let the caller choose whose account to
    # reset; the link's host used to come from the Origin header, unvalidated,
    # which let the caller choose where the token was delivered. Together those
    # made this endpoint an account-takeover primitive rather than a recovery
    # flow. Both are now derived server-side.
    #
    # None is the normal case on the platform host, and means "every workspace
    # this address can sign in to" — see the service docstring.
    host_tenant = getattr(request.state, "tenant_id", None)
    await service.request_password_reset(payload.email, host_tenant)
    return {"message": "If the email exists, a reset link has been sent."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def reset_password(
    payload: PasswordResetComplete,
    request: Request,
    service: AuthService = Depends(_get_auth_service),
) -> None:
    """Complete password reset using the token from the reset email."""
    # Bounds brute-forcing of the token itself. 256 bits is not guessable, but
    # an unmetered redemption endpoint is still free compute for an attacker.
    await enforce_limit(
        request, bucket="pwreset_redeem", limit=10, window_seconds=900,
        message="Too many attempts. Request a new reset link.",
    )
    await service.reset_password(payload.token, payload.new_password)


# ── MFA ───────────────────────────────────────────────────────────────────────

class MFAEnrollRequest(BaseModel):
    """Optional body for POST /auth/mfa/enroll.

    The password is only required when the account ALREADY has MFA armed —
    re-enrolling replaces the secret and the backup codes, which is a downgrade
    until the new authenticator is confirmed. First-time enrolment needs
    nothing beyond a session.
    """
    current_password: str | None = None


@router.post("/mfa/enroll", response_model=MFAEnrollResponse)
async def mfa_enroll(
    payload: MFAEnrollRequest | None = None,
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> MFAEnrollResponse:
    """
    Begin TOTP enrollment.
    Returns secret + QR URI + 10 backup codes.
    MFA is NOT active until verify_mfa succeeds.
    """
    return await service.enroll_mfa(
        str(claims.user_id),
        current_password=payload.current_password if payload else None,
    )


@router.post("/mfa/verify", response_model=dict)
async def mfa_verify(
    payload: MFAVerifyRequest,
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> dict:
    """Confirm enrollment by proving the authenticator works.

    This requires an existing session, so it can only ever finish enrollment —
    it is not the sign-in second factor. That is /mfa/challenge below.
    """
    valid = await service.verify_mfa(str(claims.user_id), payload.totp_code)
    return {"verified": valid}


class MFAChallengeRequest(BaseModel):
    challenge_id: str
    code: str


@router.post("/mfa/challenge", response_model=UserProfile)
async def mfa_challenge(
    payload: MFAChallengeRequest,
    response: Response,
    request: Request,
    service: AuthService = Depends(_get_auth_service),
) -> UserProfile:
    """Second stage of sign-in for accounts with MFA enabled.

    Unauthenticated by design: the caller has passed the password check but
    holds no session yet. Authority comes from the challenge id, which is
    single-use, expires in five minutes, and is destroyed after five wrong
    codes. Accepts a TOTP code or a single-use backup code.
    """
    # The per-challenge counter caps guesses against ONE challenge; nothing
    # stopped an attacker cycling fresh challenges to keep guessing.
    await enforce_limit(
        request, bucket="mfa_challenge", limit=20, window_seconds=900,
        message="Too many verification attempts. Sign in again to restart.",
    )
    access_token, _ = await service.complete_mfa_login(
        challenge_id=payload.challenge_id,
        code=payload.code,
        response=response,
    )
    from app.core.security import decode_token

    claims = decode_token(access_token)
    return await service.get_me(str(claims.user_id), str(claims.tenant_id))


# ── OTP Authentication ────────────────────────────────────────────────────────

class OTPSendRequest(BaseModel):
    phone_number: str
    tenant_id: str


class OTPVerifyRequest(BaseModel):
    phone_number: str
    code: str
    tenant_id: str


@router.post("/otp/send", status_code=202)
async def send_otp(
    body: OTPSendRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Send OTP to phone number. Phone must be registered on a staff account."""
    from sqlalchemy import text
    from fastapi import HTTPException
    result = await session.execute(
        text("SELECT user_id FROM staff_users WHERE phone_number = :phone AND tenant_id = CAST(:tid AS uuid) AND deleted_at IS NULL LIMIT 1"),
        {"phone": body.phone_number, "tid": body.tenant_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=400, detail="PHONE_NOT_REGISTERED")

    redis = get_session_redis()
    rate_key = f"otp_rate:{body.phone_number.replace('+', '')}"
    if await redis.get(rate_key):
        raise HTTPException(status_code=429, detail="RATE_LIMITED")
    await redis.setex(rate_key, 60, "1")

    if settings.twilio_account_sid and settings.twilio_verify_service_sid:
        try:
            from twilio.rest import Client as TwilioClient
            client = TwilioClient(settings.twilio_account_sid, settings.twilio_auth_token.get_secret_value())
            client.verify.v2.services(settings.twilio_verify_service_sid).verifications.create(
                to=body.phone_number, channel="sms"
            )
        except Exception as e:
            import structlog
            structlog.get_logger().warning("otp_send_failed", error=str(e))
    else:
        import structlog
        structlog.get_logger().info("otp_send_dev_mode", phone=body.phone_number)

    return {"expires_in": 600}


@router.post("/otp/verify")
async def verify_otp(
    body: OTPVerifyRequest,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Verify OTP code and issue auth cookies if valid."""
    from sqlalchemy import text
    from fastapi import HTTPException
    import uuid as _uuid
    user_result = await session.execute(
        text("""
            SELECT u.user_id, u.email, u.first_name, u.last_name, u.role, u.tenant_id,
                   ARRAY_AGG(DISTINCT ul.location_id::text) FILTER (WHERE ul.location_id IS NOT NULL) AS location_ids
            FROM staff_users u
            LEFT JOIN user_locations ul ON ul.user_id = u.user_id
            WHERE u.phone_number = :phone AND u.tenant_id = CAST(:tid AS uuid)
              AND u.deleted_at IS NULL
            GROUP BY u.user_id, u.email, u.first_name, u.last_name, u.role, u.tenant_id
            LIMIT 1
        """),
        {"phone": body.phone_number, "tid": body.tenant_id},
    )
    user_row = user_result.mappings().first()
    if not user_row:
        raise HTTPException(status_code=401, detail="INVALID_CODE")

    verified = False
    if settings.twilio_account_sid and settings.twilio_verify_service_sid:
        try:
            from twilio.rest import Client as TwilioClient
            client = TwilioClient(settings.twilio_account_sid, settings.twilio_auth_token.get_secret_value())
            check = client.verify.v2.services(settings.twilio_verify_service_sid).verification_checks.create(
                to=body.phone_number, code=body.code
            )
            verified = check.status == "approved"
        except Exception:
            verified = False
    else:
        verified = len(body.code) == 6 and body.code.isdigit()

    if not verified:
        raise HTTPException(status_code=401, detail="INVALID_CODE")

    from app.core.security import (
        create_access_token,
        create_refresh_token,
        set_auth_cookies,
    )
    from app.core.redis import (
        SESSION_KEY,
        REFRESH_TOKEN_KEY,
        get_session_redis as _get_redis,
    )

    user_id = str(user_row["user_id"])
    tenant_id = str(user_row["tenant_id"])
    role = str(user_row["role"])
    location_ids_raw = list(user_row["location_ids"] or [])

    access_jti = str(_uuid.uuid4())
    refresh_jti = str(_uuid.uuid4())
    location_uuids = [_uuid.UUID(lid) for lid in location_ids_raw]

    access_token = create_access_token(
        user_id=_uuid.UUID(user_id),
        tenant_id=_uuid.UUID(tenant_id),
        roles=[role],
        primary_role=role,
        location_ids=location_uuids,
        jti=access_jti,
        app_context="web",
    )
    refresh_token = create_refresh_token(
        user_id=user_id,
        jti=refresh_jti,
        access_jti=access_jti,
        tenant_id=tenant_id,
    )

    redis = _get_redis()
    await redis.setex(SESSION_KEY.format(jti=access_jti), settings.jwt_access_token_ttl_web_seconds, user_id)
    await redis.setex(REFRESH_TOKEN_KEY.format(jti=refresh_jti), settings.jwt_refresh_token_ttl_seconds, user_id)

    set_auth_cookies(response, access_token, refresh_token, "web")

    first_name = str(user_row["first_name"] or "")
    last_name = str(user_row["last_name"] or "")
    return {
        "user_id": user_id,
        "email": str(user_row["email"] or ""),
        "first_name": first_name,
        "last_name": last_name,
        "display_name": f"{first_name} {last_name}".strip(),
        "role": role,
        "tenant_id": tenant_id,
        "location_ids": location_ids_raw,
    }


# ── Agent Service Token ───────────────────────────────────────────────────────

class AgentTokenRequest(BaseModel):
    agent_name: str
    tenant_id: str


class AgentTokenResponse(BaseModel):
    access_token: str
    agent_name: str
    expires_in: int


@router.post("/agent-token", response_model=AgentTokenResponse)
async def issue_agent_token(
    payload: AgentTokenRequest,
    claims: UserClaims = Depends(get_current_user),
) -> AgentTokenResponse:
    """
    Issues a long-lived Bearer token for an AI agent service account.
    Restricted to SUPER_ADMIN role.
    """
    if "SUPER_ADMIN" not in claims.roles:
        raise HTTPException(status_code=403, detail="SUPER_ADMIN required")

    import uuid as _uuid
    from app.core.security import create_access_token

    agent_user_id = _uuid.uuid5(_uuid.UUID(payload.tenant_id), f"agent:{payload.agent_name}")
    jti = str(_uuid.uuid4())

    token = create_access_token(
        user_id=agent_user_id,
        tenant_id=_uuid.UUID(payload.tenant_id),
        roles=["AGENT_SERVICE"],
        primary_role="AGENT_SERVICE",
        location_ids=[],
        jti=jti,
        app_context=payload.agent_name,
    )
    # Register in session store so revocation checks work
    redis = get_session_redis()
    await redis.setex(SESSION_KEY.format(jti=jti), settings.agent_token_ttl_seconds, str(agent_user_id))

    return AgentTokenResponse(
        access_token=token,
        agent_name=payload.agent_name,
        expires_in=settings.agent_token_ttl_seconds,
    )


# ── Session Management ────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list)
async def list_sessions(
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> list:
    """List all active sessions for the current user."""
    return await service.list_sessions(str(claims.user_id))


@router.delete("/sessions/{jti}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def revoke_session(
    jti: str,
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> None:
    """Force-terminate a specific session by JTI (admin or self only)."""
    await service.revoke_session(jti, str(claims.user_id))
