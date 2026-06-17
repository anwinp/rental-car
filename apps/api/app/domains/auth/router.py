"""Auth domain FastAPI router."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
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
    tenant_id = request.headers.get("X-Tenant-ID") or getattr(request.state, "tenant_id", "")

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
    return await service.get_me(str(claims.user_id), str(claims.tenant_id))


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
    service: AuthService = Depends(_get_auth_service),
) -> dict:
    """
    Initiate password reset flow.
    Always returns 202 regardless of whether the email is registered
    (prevents email enumeration).
    """
    await service.request_password_reset(payload.email, str(payload.tenant_id))
    return {"message": "If the email exists, a reset link has been sent."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def reset_password(
    payload: PasswordResetComplete,
    service: AuthService = Depends(_get_auth_service),
) -> None:
    """Complete password reset using the token from the reset email."""
    await service.reset_password(payload.token, payload.new_password)


# ── MFA ───────────────────────────────────────────────────────────────────────

@router.post("/mfa/enroll", response_model=MFAEnrollResponse)
async def mfa_enroll(
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> MFAEnrollResponse:
    """
    Begin TOTP enrollment.
    Returns secret + QR URI + 10 backup codes.
    MFA is NOT active until verify_mfa succeeds.
    """
    return await service.enroll_mfa(str(claims.user_id))


@router.post("/mfa/verify", response_model=dict)
async def mfa_verify(
    payload: MFAVerifyRequest,
    claims: UserClaims = Depends(get_current_user),
    service: AuthService = Depends(_get_auth_service),
) -> dict:
    """Verify a TOTP code to complete enrollment or validate a second factor."""
    valid = await service.verify_mfa(str(claims.user_id), payload.totp_code)
    return {"verified": valid}


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
