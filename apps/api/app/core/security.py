from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Cookie, HTTPException, Query, status
from fastapi.responses import Response
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.redis import get_session_redis, REVOKED_TOKENS_SET

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


@dataclass(frozen=True)
class UserClaims:
    """
    Parsed JWT access token claims.

    Immutable (frozen=True) — never mutate after construction.
    Created once per request in get_current_user().
    """
    sub: str               # user_id as string (JWT standard claim)
    jti: str               # JWT ID — unique per token; checked against Redis revocation set
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    roles: list[str]       # All roles the user holds
    primary_role: str      # Highest-privilege role for GUC injection and audit
    location_ids: list[uuid.UUID]  # Location scope — empty = global
    exp: int               # Expiry epoch (standard JWT claim)
    iat: int               # Issued-at epoch (standard JWT claim)
    app_context: str       # "counter" | "web" | "admin"


def _build_access_token_claims(
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    roles: list[str],
    primary_role: str,
    location_ids: list[uuid.UUID],
    jti: str,
    app_context: str,
) -> dict:
    """Build the claim dictionary written into a JWT access token."""
    now = datetime.now(timezone.utc)
    if app_context == "counter":
        ttl = timedelta(seconds=settings.jwt_access_token_ttl_counter_seconds)
    else:
        ttl = timedelta(seconds=settings.jwt_access_token_ttl_web_seconds)

    return {
        "sub":          str(user_id),
        "jti":          jti,
        "iat":          int(now.timestamp()),
        "exp":          int((now + ttl).timestamp()),
        "tenant_id":    str(tenant_id),
        "user_id":      str(user_id),
        "roles":        roles,
        "primary_role": primary_role,
        "location_ids": [str(lid) for lid in location_ids],
        "app_context":  app_context,
    }


def create_access_token(
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    roles: list[str],
    primary_role: str,
    location_ids: list[uuid.UUID],
    jti: str,
    app_context: str = "web",
) -> str:
    """Encode and return a signed JWT access token."""
    claims = _build_access_token_claims(
        user_id=user_id,
        tenant_id=tenant_id,
        roles=roles,
        primary_role=primary_role,
        location_ids=location_ids,
        jti=jti,
        app_context=app_context,
    )
    return jwt.encode(
        claims,
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def create_refresh_token(user_id: str, jti: str, access_jti: str, tenant_id: str) -> str:
    """Encode and return a signed JWT refresh token (30-day expiry, minimal claims)."""
    now = datetime.now(timezone.utc)
    claims = {
        "sub":        user_id,
        "jti":        jti,
        "tenant_id":  tenant_id,
        "iat":        int(now.timestamp()),
        "exp":        int(
            (now + timedelta(seconds=settings.jwt_refresh_token_ttl_seconds)).timestamp()
        ),
        "type":       "refresh",
        "access_jti": access_jti,
    }
    return jwt.encode(
        claims,
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> UserClaims:
    """
    Decode and validate a JWT access token.
    Raises HTTPException(401) on invalid or expired token.
    Does NOT check Redis revocation — callers must do that separately.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        return UserClaims(
            sub=payload["sub"],
            jti=payload["jti"],
            tenant_id=uuid.UUID(payload["tenant_id"]),
            user_id=uuid.UUID(payload["user_id"]),
            roles=payload["roles"],
            primary_role=payload["primary_role"],
            location_ids=[uuid.UUID(lid) for lid in payload.get("location_ids", [])],
            exp=payload["exp"],
            iat=payload["iat"],
            app_context=payload.get("app_context", "web"),
        )
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )


def hash_password(password: str) -> str:
    """Hash a plain-text password using bcrypt."""
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    return _pwd_context.verify(plain, hashed)


def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    app_context: str = "web",
) -> None:
    """
    Set httpOnly, Secure, SameSite=Strict auth cookies.
    Access token TTL varies by app_context (counter=8h, web=1h).
    """
    access_ttl = (
        settings.jwt_access_token_ttl_counter_seconds
        if app_context == "counter"
        else settings.jwt_access_token_ttl_web_seconds
    )
    response.set_cookie(
        key="rcm_access",
        value=access_token,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/api",
        max_age=access_ttl,
    )
    response.set_cookie(
        key="rcm_refresh",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/api/v1/auth/refresh",
        max_age=settings.jwt_refresh_token_ttl_seconds,
    )


async def get_current_user(
    access_token: Optional[str] = Cookie(default=None, alias="access_token"),
) -> UserClaims:
    """
    FastAPI dependency. Validates the access token from the httpOnly cookie.
    Also accepts rcm_access cookie name (preferred).
    Raises HTTP 401 on any failure — never leaks which check failed.
    """
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    claims = decode_token(access_token)

    # Revocation check — O(1) Redis SISMEMBER
    redis = get_session_redis()
    if await redis.sismember(REVOKED_TOKENS_SET, claims.jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    return claims


async def verify_ws_token(
    token: Optional[str] = Query(default=None),
) -> UserClaims:
    """
    WebSocket connection dependency. Token passed as ?token=<jwt> query param.
    Uses a short-lived (60s) one-time token from POST /api/v1/fleet/ws-token.
    """
    from fastapi import WebSocketException

    if not token:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)

    try:
        return decode_token(token)
    except HTTPException:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
