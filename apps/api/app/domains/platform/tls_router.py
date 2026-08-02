"""On-demand TLS gate for Caddy.

Caddy is configured with `on_demand_tls { ask <this endpoint> }`, so before it
requests a certificate for a hostname it has never seen, it asks here whether
that hostname is one we actually serve.

Without this gate the deployment is an open certificate-issuance relay: anyone
who points a DNS record at the server's IP causes a real Let's Encrypt order.
Those count against the rate limit for the whole registered domain (50 certs per
week, and failed orders count too), so a stranger could exhaust the quota for
ceez.ai and block certificate renewal for every unrelated app on the host.

The endpoint is deliberately tiny and unauthenticated — Caddy calls it from the
same host before any TLS handshake exists, so there is no session to present. It
discloses only whether a workspace exists at a given hostname, which the
storefront itself already reveals to anyone who visits it.
"""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Query, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.core.database import get_session_untenanted
from app.core.tenancy import extract_slug

log = structlog.get_logger()

router = APIRouter()


def _served_suffix() -> str:
    """The domain tenant hostnames must sit under, e.g. ".ceez.ai".

    Derived from the configured booking host by dropping its first label:
    rcm.ceez.ai -> .ceez.ai, and tenant hosts are <slug>-rcm.ceez.ai. Returns ""
    when the host is not configured deeply enough to infer one, in which case
    the caller skips the check rather than refusing everything.
    """
    from app.core.config import settings

    host = (settings.public_booking_host or "").split(":")[0].strip().lower()
    parts = [p for p in host.split(".") if p]
    if len(parts) < 3:
        return ""
    return "." + ".".join(parts[1:])


@router.get(
    "/tls-allowed",
    include_in_schema=False,
    summary="Caddy on-demand TLS check — may we issue a certificate for this host?",
)
async def tls_allowed(
    domain: str = Query(..., description="Hostname Caddy is about to request a cert for"),
    session: AsyncSession = Depends(get_session_untenanted),
) -> Response:
    """200 to permit issuance, 404 to refuse.

    Caddy treats any non-2xx as a refusal and does not attempt the order, which
    is what keeps the rate limit safe.
    """
    host = (domain or "").strip().lower()
    if not host:
        return Response(status_code=status.HTTP_404_NOT_FOUND)

    # The hostname must sit under the domain we actually operate. Without this
    # the gate answered on shape alone: "evil.example.com" yields the slug
    # "evil", so the moment any workspace registered that slug we would approve
    # a certificate order for a domain we do not own. Caddy would then fail
    # validation and burn Let's Encrypt rate limit against ceez.ai — precisely
    # the exhaustion this endpoint exists to prevent.
    suffix = _served_suffix()
    if suffix and not host.endswith(suffix):
        log.info("tls_refused", host=host, reason="foreign_domain", expected=suffix)
        return Response(status_code=status.HTTP_404_NOT_FOUND)

    slug = extract_slug(host)
    if not slug:
        # Not a tenant-shaped hostname. Platform hosts are declared explicitly in
        # the Caddyfile and never reach the on-demand path.
        log.info("tls_refused", host=host, reason="no_slug")
        return Response(status_code=status.HTTP_404_NOT_FOUND)

    row = (
        await session.execute(
            text(
                "SELECT 1 FROM tenants "
                "WHERE slug = :slug AND deleted_at IS NULL "
                "  AND status NOT IN ('CANCELLED', 'DELETED')"
            ),
            {"slug": slug},
        )
    ).first()

    if row is None:
        log.info("tls_refused", host=host, slug=slug, reason="no_tenant")
        return Response(status_code=status.HTTP_404_NOT_FOUND)

    log.info("tls_allowed", host=host, slug=slug)
    return Response(status_code=status.HTTP_200_OK)
