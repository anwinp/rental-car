"""Fixed-window rate limiting for unauthenticated endpoints.

Registration was the only endpoint in the product with any limit at all. Login,
password reset, reset redemption and the MFA challenge had none, which left:

  - unlimited password spraying. The 5-strike lockout in AuthService is
    per-account, so one password tried against ten thousand addresses is not
    metered by anything.
  - unlimited mail-bombing of any address someone can guess, since a reset
    request sends real email.
  - unlimited guessing against a reset token or an MFA code beyond the
    per-challenge counter.

Limits are keyed on the caller's address AND, where there is one, the subject
they are acting on — so one noisy office NAT cannot lock out an entire
building's worth of legitimate users by exhausting a shared counter.

Fails OPEN when Redis is unavailable. A cache outage must not take sign-in
down; this is one control among several, not the only one.
"""
from __future__ import annotations

import hashlib

import structlog
from fastapi import HTTPException, Request, status

from app.core.redis import get_session_redis

log = structlog.get_logger()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def enforce_limit(
    request: Request,
    *,
    bucket: str,
    limit: int,
    window_seconds: int,
    subject: str | None = None,
    message: str = "Too many attempts. Try again shortly.",
) -> None:
    """Count one attempt; raise 429 once the window's allowance is spent.

    `subject` scopes the counter to what is being acted on — an email address,
    say — so that limiting is per (caller, target) rather than per caller. It is
    hashed, because these keys end up in a shared Redis and an address is
    personal data.
    """
    ip = client_ip(request)
    key = f"rl:{bucket}:{ip}"
    if subject:
        digest = hashlib.sha256(subject.strip().lower().encode()).hexdigest()[:16]
        key = f"{key}:{digest}"

    try:
        redis = get_session_redis()
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds)
    except Exception:  # noqa: BLE001 — see module docstring: fail open
        return

    if count > limit:
        log.warning("rate_limited", bucket=bucket, ip=ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=message,
        )
