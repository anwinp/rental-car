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

from app.core.config import settings
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


def platform_labels() -> tuple[str, ...]:
    """The first label of each configured platform host, longest first.

    For ``rcm.ceez.ai`` and ``rcm-admin.ceez.ai`` this yields
    ``("rcm-admin", "rcm")``. Order matters: ``acme-rcm-admin`` must be tested
    against ``rcm-admin`` before ``rcm``, or it would strip to ``acme-rcm``.
    """
    labels = set()
    # The counter host must be here too. It was omitted, so acme-rcm-counter
    # stripped nothing and resolved as a slug literally named
    # "acme-rcm-counter" — no workspace matched, and the counter app was the one
    # tenant surface that could not be reached on its own hostname.
    for host in (
        settings.public_booking_host,
        settings.public_admin_host,
        settings.public_counter_host,
    ):
        first = (host or "").split(":")[0].split(".")[0].strip().lower()
        if first:
            labels.add(first)
    return tuple(sorted(labels, key=len, reverse=True))


def extract_slug(host: str) -> Optional[str]:
    """Pull a tenant slug out of a Host header.

    Two shapes are supported, because the deployment uses hyphenated hosts while
    local development uses plain subdomains:

        acme-rcm.ceez.ai        -> "acme"   (deployed; platform label suffixed)
        acme-rcm-admin.ceez.ai  -> "acme"
        acme.localtest.me       -> "acme"   (development; plain subdomain)

    The hyphenated form exists so every tenant host sits directly under the
    registered domain rather than a level deeper, which is what lets Caddy issue
    one certificate per hostname on demand instead of requiring a wildcard.

    A platform host on its own (``rcm.ceez.ai``, ``rcm-admin.ceez.ai``) is not a
    tenant and returns None — otherwise the marketing site would resolve to a
    workspace named after the platform.
    """
    if not host:
        return None
    host = host.split(",")[0].strip().split(":")[0].lower()  # drop port, take first
    if not host or host in ("localhost", "127.0.0.1", "::1"):
        return None

    parts = host.split(".")
    # A bare apex has no tenant — ceez.ai, example.com, localtest.me. A tenant
    # always sits one label below the registered domain, so three labels is the
    # minimum for both supported shapes.
    if len(parts) < 3:
        return None

    label = parts[0]

    for platform in platform_labels():
        if label == platform:
            return None                      # the platform host itself
        suffix = f"-{platform}"
        if label.endswith(suffix):
            label = label[: -len(suffix)]
            break

    if not label or label in RESERVED_SLUGS:
        return None
    return label


def tenant_host(slug: str, platform_host: str) -> str:
    """Build the hostname a workspace is actually reachable at.

    The inverse of extract_slug, and it must stay that way. Registration used to
    compose these by hand as f"{slug}.{host}", which is right for development
    (acme.localtest.me) and wrong everywhere it matters: against a deployed host
    like rcm.ceez.ai it produces acme.rcm.ceez.ai — two labels below the
    registered domain. A DNS wildcard matches exactly ONE label, so *.ceez.ai
    does not cover it and the name does not resolve at all.

    Every workspace that signed up was therefore handed a dead URL, in the
    success screen and in its verification email.

        tenant_host("acme", "rcm.ceez.ai")       -> "acme-rcm.ceez.ai"
        tenant_host("acme", "rcm-admin.ceez.ai") -> "acme-rcm-admin.ceez.ai"
        tenant_host("acme", "localtest.me:3400") -> "acme.localtest.me:3400"

    Hyphenate when the platform host carries its own label below the registered
    domain; fall back to a plain subdomain when it is a bare apex, which is the
    development shape extract_slug also accepts.
    """
    host = (platform_host or "").strip().lower()
    if not host:
        return slug

    name, _, port = host.partition(":")
    suffix = f":{port}" if port else ""
    parts = [p for p in name.split(".") if p]

    # Three or more labels means the first one is the platform label (the "rcm"
    # in rcm.ceez.ai), and tenants sit alongside it: <slug>-rcm.ceez.ai.
    if len(parts) >= 3:
        return f"{slug}-{parts[0]}." + ".".join(parts[1:]) + suffix
    return f"{slug}.{name}{suffix}"


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


# Statuses in which a workspace may serve CUSTOMERS. Deliberately narrower than
# the set in which staff may sign in, and checked separately from it.
#
# Tenant status gated staff login and nothing else. The public booking path
# never read it: tenant_id_for_slug filters deleted_at only, and neither
# tenant-config nor workspace-open looked at status at all. So suspending a
# workspace for non-payment locked the operator out of their own back office
# and counter while the storefront carried on taking reservations and charging
# cards — bookings no employee could see, for cars nobody could check out.
#
# PENDING_VERIFICATION is excluded too: a workspace whose email was never
# confirmed should not be selling to the public.
_TRADING_STATUSES: frozenset[str] = frozenset({"ACTIVE", "TRIAL"})


async def assert_tenant_trading(session, tenant_id) -> None:
    """Refuse a public, customer-facing request for a workspace not trading.

    Raises 403 rather than 404: the workspace exists, and saying so is not a
    disclosure — the storefront hostname already reveals it. A 404 would send
    an operator hunting for a broken link instead of an unpaid invoice.
    """
    from fastapi import HTTPException
    from sqlalchemy import text

    row = (
        await session.execute(
            text(
                "SELECT status FROM tenants "
                " WHERE tenant_id = :t AND deleted_at IS NULL"
            ),
            {"t": str(tenant_id)},
        )
    ).first()

    if row is None:
        raise HTTPException(status_code=404, detail="No such workspace.")

    if row[0] not in _TRADING_STATUSES:
        raise HTTPException(
            status_code=403,
            detail="This rental company is not currently taking bookings.",
        )


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
