"""Tenant domain router — CRUD + readiness gate + ToS acceptance."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims, get_current_user
from app.domains.tenants.schemas import (
    ReadinessGateStatus,
    TenantProvisionRequest,
    TenantResponse,
    TenantUpdate,
    ToSAcceptRequest,
)
from app.domains.tenants.service import TenantService

router = APIRouter()
_svc = TenantService()


# ── POST /tenants — REMOVED ──────────────────────────────────────────────────
#
# This was an UNAUTHENTICATED endpoint that created a workspace with
# status=ACTIVE — bypassing the email verification every real signup requires —
# and minted its first user as SUPER_ADMIN, a role no other code path ever
# grants. No rate limit, no reserved-slug check, no verification. Its docstring
# called it "the bootstrap step".
#
# It was not exploitable only by accident: _create_first_admin never bound the
# tenant GUC, so the staff_users insert violated the RLS WITH CHECK from
# migration 051 and the transaction rolled back. The only thing between the
# open internet and a SUPER_ADMIN account was an RLS clause — and SUPER_ADMIN
# is the role that can mint agent tokens for any tenant it names.
#
# POST /api/v1/public/register supersedes it entirely: rate-limited,
# slug-validated, email-verified, and it creates SYSTEM_ADMIN not SUPER_ADMIN.


# ── GET /tenants/{tenant_id} ─────────────────────────────────────────────────


@router.get(
    "/{tenant_id}",
    response_model=TenantResponse,
    summary="Get tenant details",
)
async def get_tenant(
    tenant_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> TenantResponse:
    tenant = await _svc.get_tenant(session, tenant_id)
    return TenantResponse.model_validate(tenant)


# ── PATCH /tenants/{tenant_id} ───────────────────────────────────────────────


@router.patch(
    "/{tenant_id}",
    response_model=TenantResponse,
    summary="Update tenant details",
)
async def update_tenant(
    tenant_id: str,
    body: TenantUpdate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(
        require_permission("admin", "config")
    ),
) -> TenantResponse:
    tenant = await _svc.update_tenant(session, tenant_id, body)
    return TenantResponse.model_validate(tenant)


# ── GET /tenants/{tenant_id}/readiness-gate ──────────────────────────────────


@router.get(
    "/{tenant_id}/readiness-gate",
    response_model=ReadinessGateStatus,
    summary="Day-zero readiness gate (9 checks)",
)
async def get_readiness_gate(
    tenant_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> ReadinessGateStatus:
    """
    Returns the status of all 9 day-zero readiness checks (GAP-001).
    Returns HTTP 412 if any check fails and the operator attempts to go live.
    """
    return await _svc.get_readiness_gate(session, tenant_id)


# ── POST /tenants/{tenant_id}/accept-tos ────────────────────────────────────


@router.post(
    "/{tenant_id}/accept-tos",
    status_code=status.HTTP_204_NO_CONTENT, response_model=None,
    summary="Record Terms of Service acceptance",
)
async def accept_tos(
    tenant_id: str,
    body: ToSAcceptRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> None:
    """
    Idempotent — re-accepting the same ToS version is a no-op.
    IP address is taken from the request when not supplied in the body.
    """
    ip = body.ip_address or (
        request.headers.get("X-Forwarded-For", request.client.host or "").split(",")[0].strip()
    )
    await _svc.accept_tos(session, tenant_id, ip, body.tos_version)


# ── GET/PUT /tenants/{tenant_id}/llm-settings ───────────────────────────────

from pydantic import BaseModel  # noqa: E402

class LLMSettingsResponse(BaseModel):
    provider: str
    key_configured: bool
    key_preview: str | None  # last 4 chars of key, or None


class LLMSettingsUpdate(BaseModel):
    provider: str = "anthropic"
    api_key: str | None = None  # None = clear key; empty string = no change


@router.get(
    "/{tenant_id}/llm-settings",
    response_model=LLMSettingsResponse,
    summary="Get per-tenant LLM configuration",
)
async def get_llm_settings(
    tenant_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> LLMSettingsResponse:
    tenant = await _svc.get_tenant(session, tenant_id)
    key = tenant.anthropic_api_key or ""
    return LLMSettingsResponse(
        provider=tenant.llm_provider or "anthropic",
        key_configured=bool(key),
        key_preview=f"sk-...{key[-4:]}" if len(key) >= 4 else None,
    )


@router.put(
    "/{tenant_id}/llm-settings",
    response_model=LLMSettingsResponse,
    summary="Save per-tenant LLM API key (BYOK)",
)
async def update_llm_settings(
    tenant_id: str,
    body: LLMSettingsUpdate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> LLMSettingsResponse:
    from sqlalchemy import select, update
    from app.domains.tenants.models import Tenant

    stmt = (
        update(Tenant)
        .where(Tenant.tenant_id == tenant_id)
        .values(
            llm_provider=body.provider,
            **({"anthropic_api_key": body.api_key} if body.api_key is not None else {}),
        )
        .returning(Tenant.anthropic_api_key, Tenant.llm_provider)
    )
    result = await session.execute(stmt)
    await session.commit()
    row = result.mappings().first()
    key = (row["anthropic_api_key"] or "") if row else ""
    return LLMSettingsResponse(
        provider=(row["llm_provider"] or "anthropic") if row else body.provider,
        key_configured=bool(key),
        key_preview=f"sk-...{key[-4:]}" if len(key) >= 4 else None,
    )


# ── GET /tenants/onboarding/checklist ────────────────────────────────────────


@router.get(
    "/onboarding/checklist",
    summary="What still stands between this workspace and its first booking",
)
async def onboarding_checklist(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> dict:
    """Drives the onboarding UI.

    Scoped to the caller's own tenant via the JWT — there is deliberately no
    tenant_id path parameter, so one workspace cannot inspect another's setup
    progress.
    """
    from app.domains.tenants.provisioning import readiness_checklist

    items = await readiness_checklist(session, claims.tenant_id)
    done = sum(1 for i in items if i["done"])
    return {
        "tenant_id": str(claims.tenant_id),
        "items": items,
        "completed": done,
        "total": len(items),
        "ready": done == len(items),
    }


# ── GET /tenants/me/export ───────────────────────────────────────────────────


# Two segments, so this cannot be swallowed by the "/{tenant_id}" GET declared
# above — same reason /me/slug is shaped the way it is.
@router.get(
    "/me/export",
    summary="Download everything this workspace owns",
    response_class=Response,
)
async def export_workspace(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> Response:
    """Every tenant-owned record as a zip of CSVs.

    Deliberately gated on being an administrator of the workspace and nothing
    else — not on the tenant's billing standing. A business that has fallen
    behind on an invoice still needs its bookings for tomorrow morning, and
    holding operating data hostage over a payment dispute is both a bad way to
    treat a customer and, for EU tenants, likely unlawful under GDPR Art. 20.

    Scoped by the caller's JWT, never by a path parameter: there is no shape of
    this request that can name another workspace.
    """
    if claims.primary_role not in ("SYSTEM_ADMIN", "SUPER_ADMIN"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only administrators can export the workspace.",
        )

    from app.domains.tenants.export import build_export

    blob, filename = await build_export(session, str(claims.tenant_id))
    return Response(
        content=blob,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── PATCH /tenants/slug ──────────────────────────────────────────────────────


# Path is /me/slug, not /slug: an earlier @router.patch("/{tenant_id}")
# is declared above and FastAPI matches in order, so a bare /slug was
# swallowed as a tenant id. /me also reads better — it is always the
# caller's own workspace, never one named in the URL.
@router.patch("/me/slug", summary="Change the workspace address")
async def change_slug(
    payload: dict,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> dict:
    """Rename the workspace address.

    The slug is the customer-facing URL, so a typo at signup was previously
    permanent. Renaming breaks existing links by design — there is no alias —
    so the response says so plainly rather than pretending it is free.
    """
    import re
    from sqlalchemy import text as _text

    from app.core.tenancy import RESERVED_SLUGS, invalidate_slug_cache

    if claims.primary_role not in ("SYSTEM_ADMIN", "SUPER_ADMIN"):
        raise HTTPException(403, "Only administrators can change the workspace address.")

    new_slug = str(payload.get("slug", "")).strip().lower()
    # 3-40 chars: the optional middle group in the previous pattern let a
    # single character through, which renamed a workspace to "a".
    if not re.match(r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$", new_slug):
        raise HTTPException(
            400,
            "Use 3-40 characters: lowercase letters, numbers and hyphens.",
        )
    if new_slug in RESERVED_SLUGS:
        raise HTTPException(400, "That workspace address is reserved.")

    current = (
        await session.execute(
            _text("SELECT slug FROM tenants WHERE tenant_id = :t"),
            {"t": str(claims.tenant_id)},
        )
    ).first()
    if current and current[0] == new_slug:
        return {"ok": True, "slug": new_slug, "message": "That is already your address."}

    taken = (
        await session.execute(
            _text("SELECT 1 FROM tenants WHERE slug = :s"), {"s": new_slug}
        )
    ).first()
    if taken:
        raise HTTPException(409, f"The address '{new_slug}' is already taken.")

    await session.execute(
        _text("UPDATE tenants SET slug = :s, updated_at = now() WHERE tenant_id = :t"),
        {"s": new_slug, "t": str(claims.tenant_id)},
    )
    if current:
        await invalidate_slug_cache(current[0])
    await invalidate_slug_cache(new_slug)

    return {
        "ok": True,
        "slug": new_slug,
        "message": (
            f"Your workspace address is now '{new_slug}'. Links using the old "
            "address will stop working — update any bookmarks and shared links."
        ),
    }


# ── What this workspace is on, and how much of it is used ────────────────────

@router.get("/my/plan", summary="This workspace's plan, usage and remaining term")
async def my_plan(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> dict:
    """Everything a customer needs to understand a refusal before they hit one.

    Enforcement a customer cannot see is indistinguishable from a bug. Until
    now the caps existed, were enforced, and appeared nowhere: a workspace
    discovered its 25-vehicle limit by being refused mid-task, with no page
    showing the number and no warning on the way up. The platform console knew
    all of it; the person paying did not.

    Deliberately readable by any signed-in member of the workspace, not just an
    administrator. The counter agent who cannot add a vehicle is the one who
    needs to know why, and telling them "ask your manager" when the answer is a
    number on their own account is not a security boundary, it is a shrug.
    """
    from sqlalchemy import text

    from app.domains.tenants.features import FEATURES, features_for_tenant
    from app.domains.tenants.limits import get_usage

    usage = await get_usage(session, claims.tenant_id)
    granted = await features_for_tenant(session, claims.tenant_id)

    term = (
        await session.execute(
            text(
                "SELECT status, "
                "       COALESCE(subscription_ends_at, trial_ends_at) AS term_end, "
                "       p.display_name, p.price_cents, p.currency, p.billing_period "
                "  FROM tenants t "
                "  LEFT JOIN plans p ON p.code = t.subscription_tier "
                " WHERE t.tenant_id = :t"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).mappings().first() or {}

    def cap(used_key: str, cap_key: str) -> dict:
        used = usage.get(used_key) or 0
        limit = usage.get(cap_key)
        return {
            "used": used,
            "limit": limit,
            # Surfaced rather than left to the browser so every client agrees
            # on where the warning line sits.
            "at_warning": limit is not None and used >= int(limit * 0.8),
            "at_limit": limit is not None and used >= limit,
        }

    days_left = None
    if term.get("term_end"):
        from datetime import datetime, timezone
        days_left = (term["term_end"] - datetime.now(timezone.utc)).days

    return {
        "plan": term.get("display_name") or usage.get("subscription_tier"),
        "plan_code": usage.get("subscription_tier"),
        "price_cents": term.get("price_cents"),
        "currency": term.get("currency"),
        "billing_period": term.get("billing_period"),
        "status": term.get("status"),
        "term_ends_at": term.get("term_end"),
        "days_left": days_left,
        "usage": {
            "staff": cap("staff", "max_staff"),
            "vehicles": cap("vehicles", "max_vehicles"),
            "locations": cap("locations", "max_locations"),
        },
        # Both halves, so the UI can show what an upgrade would add rather than
        # only hiding what is missing.
        "features": [
            {"key": f.key, "label": f.label, "blurb": f.blurb,
             "included": f.key in granted}
            for f in FEATURES
        ],
    }
