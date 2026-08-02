from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Cookie, Header, HTTPException, Query, status
from fastapi.responses import Response
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.redis import get_session_redis, REVOKED_TOKENS_SET, USER_EPOCH_KEY

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
    epoch: int = 0         # credential epoch this token was minted under


def _build_access_token_claims(
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    roles: list[str],
    primary_role: str,
    location_ids: list[uuid.UUID],
    jti: str,
    app_context: str,
    epoch: int = 0,
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
        # Credential epoch this token was minted under. Raising the user's
        # epoch invalidates every token bearing a lower one, which is how a
        # password change ends sessions it has no way to enumerate.
        "epoch":        epoch,
    }


def create_access_token(
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    roles: list[str],
    primary_role: str,
    location_ids: list[uuid.UUID],
    jti: str,
    app_context: str = "web",
    epoch: int = 0,
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
        epoch=epoch,
    )
    return jwt.encode(
        claims,
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def create_refresh_token(
    user_id: str, jti: str, access_jti: str, tenant_id: str, epoch: int = 0
) -> str:
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
        # A refresh token outlives its access token by 30 days, so this is the
        # claim that actually matters — see create_access_token.
        "epoch":      epoch,
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

    # A platform token is signed with the same key but means something else
    # entirely: it has no tenant and answers to no tenant's row policies. It
    # would already fail below on the missing tenant_id claim; rejecting it by
    # name keeps that from becoming an accident if the claim set ever changes.
    if payload.get("typ") == "platform":
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
            # Tokens minted before migration 061 carry no epoch. Treating that
            # as 0 keeps them valid until they expire naturally, which is the
            # right trade: bumping everyone to 1 would log out every existing
            # session on deploy.
            epoch=int(payload.get("epoch", 0)),
        )
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )


async def current_epoch(user_id: str, tenant_id: str) -> int:
    """The credential epoch a user's tokens must match to still be valid.

    Postgres holds the durable value; Redis caches it for 5 minutes so the hot
    auth path stays a single round trip. A cache miss falls back to the row
    rather than failing open — losing the session cluster must not silently
    re-validate tokens a password change was meant to kill.

    The tenant must be bound before reading: staff_users is under FORCE ROW
    LEVEL SECURITY, so an unscoped read returns no row and would report epoch 0
    for everyone — locking out exactly the users who had just changed their
    password, and only them. It comes from the token's own claim, which the
    signature already vouches for.
    """
    redis = get_session_redis()
    key = USER_EPOCH_KEY.format(user_id=user_id)
    try:
        cached = await redis.get(key)
        if cached is not None:
            return int(cached)
    except Exception:  # noqa: BLE001 — cache unavailable, fall through to the row
        pass

    from sqlalchemy import text as _text

    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        await session.execute(
            _text("SELECT set_config('app.current_tenant_id', :t, true)"),
            {"t": str(tenant_id)},
        )
        row = await session.execute(
            _text(
                "SELECT token_epoch FROM staff_users WHERE user_id = :uid "
                "UNION ALL "
                "SELECT token_epoch FROM customers WHERE customer_id = :uid "
                "LIMIT 1"
            ),
            {"uid": user_id},
        )
        value = row.scalar()

    epoch = int(value or 0)
    try:
        await redis.setex(key, 300, epoch)
    except Exception:  # noqa: BLE001
        pass
    return epoch


async def bump_epoch(session, user_id: str, table: str = "staff_users") -> int:
    """Invalidate every token this user holds, of any kind, in one write.

    Called on password change, password reset, and refresh-token reuse. Returns
    the new epoch so the caller can mint a replacement session without a
    second read.
    """
    from sqlalchemy import text as _text

    pk = "user_id" if table == "staff_users" else "customer_id"
    result = await session.execute(
        _text(
            f"UPDATE {table} SET token_epoch = token_epoch + 1 "  # noqa: S608
            f"WHERE {pk} = :uid RETURNING token_epoch"
        ),
        {"uid": user_id},
    )
    new_epoch = int(result.scalar() or 0)

    # Write through rather than deleting, so a concurrent request cannot repopulate
    # the cache from a row this transaction has not committed yet.
    try:
        redis = get_session_redis()
        await redis.setex(USER_EPOCH_KEY.format(user_id=user_id), 300, new_epoch)
    except Exception:  # noqa: BLE001
        pass
    return new_epoch


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
    secure = settings.env != "development"
    response.set_cookie(
        key="rcm_access",
        value=access_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/api",
        max_age=access_ttl,
    )
    response.set_cookie(
        key="rcm_refresh",
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/api/v1/auth/refresh",
        max_age=settings.jwt_refresh_token_ttl_seconds,
    )


async def get_current_user(
    access_token: Optional[str] = Cookie(default=None, alias="rcm_access"),
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

    # A token whose epoch is behind the user's current one was minted before a
    # password change, reset, or reuse-detection event. Reject it whatever its
    # jti says — this is what makes those actions actually end a session.
    if claims.epoch < await current_epoch(str(claims.user_id), str(claims.tenant_id)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    return claims


async def get_optional_current_user(
    access_token: Optional[str] = Cookie(default=None, alias="rcm_access"),
) -> Optional[UserClaims]:
    """Like get_current_user but returns None instead of raising 401 when unauthenticated."""
    if not access_token:
        return None
    try:
        claims = decode_token(access_token)
        redis = get_session_redis()
        if await redis.sismember(REVOKED_TOKENS_SET, claims.jti):
            return None
        if claims.epoch < await current_epoch(str(claims.user_id), str(claims.tenant_id)):
            return None
        return claims
    except HTTPException:
        return None


async def get_current_user_or_bearer(
    cookie_token: Optional[str] = Cookie(default=None, alias="rcm_access"),
    authorization: Optional[str] = Header(default=None),
) -> UserClaims:
    """
    Accepts either httpOnly cookie (browser users) or Authorization: Bearer (agent service accounts).
    Cookie takes priority when both are present.
    """
    token = cookie_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    claims = decode_token(token)
    redis = get_session_redis()
    if await redis.sismember(REVOKED_TOKENS_SET, claims.jti):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if claims.epoch < await current_epoch(str(claims.user_id), str(claims.tenant_id)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return claims


async def get_optional_current_user_or_bearer(
    cookie_token: Optional[str] = Cookie(default=None, alias="rcm_access"),
    authorization: Optional[str] = Header(default=None),
) -> Optional[UserClaims]:
    """Bearer-aware optional auth — returns None for unauthenticated guests."""
    try:
        return await get_current_user_or_bearer(cookie_token, authorization)
    except HTTPException:
        return None


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
