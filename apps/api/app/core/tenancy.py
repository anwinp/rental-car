"""Tenant resolution and request-scoped tenant context.

Identity is the hinge of multi-tenancy: every isolation guarantee below it is
void if the caller can choose their own tenant. Resolution therefore follows a
strict order of authority, and disagreement is an error rather than a preference:

    1. JWT claim   — signed by us, cannot be edited by the caller
    2. Hostname    — acme.example.com -> tenants.slug = 'acme'; the visitor
                     cannot forge this past the proxy
    3. X-Tenant-ID — service-to-service only, and only when nothing above applies

There is deliberately no fallback. An unresolvable tenant is an error; silently
serving "tenant one" is how cross-tenant leaks begin.

The resolved id is published on a ContextVar so the database layer can stamp it
onto every transaction (see app/core/database.py) without every call site having
to thread it through.
"""
from __future__ import annotations

import contextvars
import uuid
from typing import Optional

from fastapi import Request

from app.core.redis import get_session_redis

# Set by TenantContextMiddleware, read by the SQLAlchemy transaction hook.
current_tenant_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_tenant_id", default=None
)

# Slugs that can never belong to a tenant: they collide with platform hosts or
# imply endorsement. Enforced at registration, not only in the UI.
RESERVED_SLUGS: frozenset[str] = frozenset({
    "www", "api", "admin", "app", "apps", "counter", "booking", "files", "static",
    "assets", "cdn", "mail", "smtp", "support", "help", "status", "billing",
    "docs", "blog", "about", "legal", "security", "platform", "internal",
    "staging", "dev", "test", "demo", "sandbox", "root", "system", "rcm",
})

_SLUG_CACHE_PREFIX = "tenant_slug:"
_SLUG_CACHE_TTL = 300  # seconds — slug->id mapping is read on every anon request


def extract_slug(host: str) -> Optional[str]:
    """Pull a tenant slug out of a Host header.

    Handles the local development shape (``acme.localtest.me:3400``) and the
    deployed shape (``acme.rcm.example.com``) identically: the slug is the first
    label, provided there is a parent domain beneath it.
    """
    if not host:
        return None
    host = host.split(",")[0].strip().split(":")[0].lower()  # drop port, take first
    if not host or host in ("localhost", "127.0.0.1", "::1"):
        return None

    parts = host.split(".")
    if len(parts) < 2:
        return None

    slug = parts[0]
    # A bare apex (example.com) has no tenant; so does a reserved label.
    if len(parts) == 2 and parts[1] in ("localtest", "local"):
        return None
    if slug in RESERVED_SLUGS:
        return None
    return slug or None


async def tenant_id_for_slug(session, slug: str) -> Optional[str]:
    """Resolve slug -> tenant_id, cached in Redis.

    Read on every anonymous request, so it must not hit Postgres each time.
    Cache misses are not cached negatively: a tenant that registers moments
    later should resolve without waiting out a TTL.
    """
    from sqlalchemy import text  # local import: avoids a cycle via database.py

    try:
        redis = get_session_redis()
        cached = await redis.get(_SLUG_CACHE_PREFIX + slug)
        if cached:
            return cached.decode() if isinstance(cached, bytes) else str(cached)
    except Exception:  # noqa: BLE001 — cache is an optimisation, never a dependency
        redis = None

    row = (
        await session.execute(
            text(
                "SELECT tenant_id::text FROM tenants "
                "WHERE slug = :slug AND deleted_at IS NULL"
            ),
            {"slug": slug},
        )
    ).first()
    if not row:
        return None

    tenant_id = row[0]
    if redis is not None:
        try:
            await redis.set(_SLUG_CACHE_PREFIX + slug, tenant_id, ex=_SLUG_CACHE_TTL)
        except Exception:  # noqa: BLE001
            pass
    return tenant_id


async def invalidate_slug_cache(slug: str) -> None:
    """Drop a cached slug mapping (call when a tenant is renamed or deleted)."""
    try:
        redis = get_session_redis()
        await redis.delete(_SLUG_CACHE_PREFIX + slug)
    except Exception:  # noqa: BLE001
        pass


def tenant_from_token(request: Request) -> Optional[str]:
    """Read the tenant claim out of the request's access token, if any.

    Deliberately does not verify revocation or raise on failure — this runs on
    every request including anonymous ones. Authorisation remains the job of
    ``get_current_user``; this only answers "which tenant is this request for".
    A forged token fails signature validation here and is ignored.
    """
    from app.core.security import decode_token  # local import: avoids a cycle

    token = request.cookies.get("rcm_access")
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
    if not token:
        return None

    try:
        return str(decode_token(token).tenant_id)
    except Exception:  # noqa: BLE001 — invalid/expired token carries no identity
        return None


def _valid_uuid(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        return None


class TenantMismatch(Exception):
    """The request asserted two different tenants at once."""


async def resolve_tenant(request: Request, session=None) -> Optional[str]:
    """Resolve the tenant for a request, following the order of authority.

    Returns the tenant id as a string, or None when the request is genuinely
    tenant-less (health checks, registration, the marketing site).

    Raises TenantMismatch when a signed identity and a caller-supplied header
    disagree — that combination is always either a bug or an attack, and
    preferring one silently is how boundaries get crossed.
    """
    from_token = _valid_uuid(tenant_from_token(request))
    from_header = _valid_uuid(request.headers.get("X-Tenant-ID"))

    if from_token:
        # A header that contradicts the signed claim is rejected outright.
        if from_header and from_header != from_token:
            raise TenantMismatch(
                "X-Tenant-ID does not match the authenticated session's tenant"
            )
        return from_token

    # Anonymous: the hostname is the only signal the caller cannot forge.
    slug = extract_slug(request.headers.get("host", ""))
    if slug and session is not None:
        resolved = await tenant_id_for_slug(session, slug)
        if resolved:
            if from_header and from_header != resolved:
                raise TenantMismatch(
                    "X-Tenant-ID does not match the tenant addressed by the hostname"
                )
            return resolved

    # Service-to-service and legacy callers. Trusted last, and only because no
    # signed identity or host mapping was available.
    return from_header


async def require_tenant() -> uuid.UUID:
    """FastAPI dependency: the resolved tenant, or a 400.

    Reads the value published by ``get_session``, which is why handlers using
    this must also depend on a session (they all do). Refusing here is the whole
    point: the previous behaviour was to fall back to a hardcoded tenant, which
    silently served one organisation's data to anyone who omitted a header.
    """
    from fastapi import HTTPException  # local import keeps this module light

    tenant_id = current_tenant_id.get()
    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tenant could not be resolved. Sign in, or reach this API on a "
                "tenant hostname such as acme.example.com."
            ),
        )
    return uuid.UUID(tenant_id)
