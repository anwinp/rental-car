"""Tokens for the platform operator, who belongs to no tenant.

Kept apart from core.security on purpose. A tenant session and a platform
session are different kinds of thing, and the moment they share a
representation somebody eventually passes one where the other is expected.

Two properties are enforced here and worth stating plainly:

  * A platform token carries NO tenant_id. There is nothing to inject into
    app.current_tenant_id, so a platform session cannot accidentally inherit a
    customer's row visibility.

  * The two token families cannot be swapped. Platform tokens carry
    typ="platform" and ride a different cookie on a different path;
    decode_token() rejects them, and decode_platform_token() rejects a tenant
    token. Confusion here would be a privilege escalation in one direction and
    a tenant-isolation break in the other, so neither decoder is willing to
    guess.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, HTTPException, Response, status
from jose import JWTError, jwt

from app.core.config import settings

# Distinct from "rcm_access". A platform session must never be presented to a
# tenant endpoint, and the surest way to guarantee that is for the browser not
# to send it there.
PLATFORM_COOKIE = "rcm_platform"
PLATFORM_TOKEN_TYPE = "platform"

# Shorter than a tenant web session. This credential can suspend or delete any
# customer; an unattended browser should not hold it all afternoon.
PLATFORM_TTL_SECONDS = 8 * 3600


@dataclass(frozen=True)
class PlatformClaims:
    """Parsed platform access token. Deliberately has no tenant_id."""
    sub: str            # admin_id as string
    jti: str
    admin_id: uuid.UUID
    email: str
    exp: int
    iat: int
    epoch: int = 0


def create_platform_token(
    admin_id: uuid.UUID, email: str, jti: str, epoch: int = 0
) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": str(admin_id),
        "jti": jti,
        "admin_id": str(admin_id),
        "email": email,
        "typ": PLATFORM_TOKEN_TYPE,
        "epoch": epoch,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=PLATFORM_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(
        claims,
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def decode_platform_token(token: str) -> PlatformClaims:
    """Decode a platform token. Raises 401 for anything else, including a
    perfectly valid tenant token."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated")

    if payload.get("typ") != PLATFORM_TOKEN_TYPE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated")

    try:
        return PlatformClaims(
            sub=payload["sub"],
            jti=payload["jti"],
            admin_id=uuid.UUID(payload["admin_id"]),
            email=payload["email"],
            exp=payload["exp"],
            iat=payload["iat"],
            epoch=int(payload.get("epoch", 0)),
        )
    except (KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated")


def set_platform_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=PLATFORM_COOKIE,
        value=token,
        httponly=True,
        secure=settings.env != "development",
        samesite="strict",
        # Scoped to the console. Tenant endpoints never receive it.
        path="/api/v1/platform",
        max_age=PLATFORM_TTL_SECONDS,
    )


def clear_platform_cookie(response: Response) -> None:
    response.delete_cookie(key=PLATFORM_COOKIE, path="/api/v1/platform")


async def get_current_platform_admin(
    platform_token: Optional[str] = Cookie(default=None, alias=PLATFORM_COOKIE),
) -> PlatformClaims:
    """FastAPI dependency: a valid, unrevoked platform session.

    Returns claims only. Whether the account still exists and is still active is
    re-read from the database by require_platform_admin — a token is evidence of
    a past sign-in, never of present standing.
    """
    if not platform_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated")

    claims = decode_platform_token(platform_token)

    from app.core.redis import get_session_redis
    from app.domains.auth.service import REVOKED_TOKENS_SET

    redis = get_session_redis()
    if await redis.sismember(REVOKED_TOKENS_SET, claims.jti):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated")

    return claims
