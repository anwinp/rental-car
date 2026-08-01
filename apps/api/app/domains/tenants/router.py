"""Tenant domain router — CRUD + readiness gate + ToS acceptance."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
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


# ── POST /tenants ────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=TenantResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Provision a new tenant",
)
async def create_tenant(
    body: TenantProvisionRequest,
    session: AsyncSession = Depends(get_session),
) -> TenantResponse:
    """
    Create a new tenant and its first SUPER_ADMIN user atomically.
    This endpoint does not require authentication (it is the bootstrap step).
    """
    tenant = await _svc.create_tenant(session, body.tenant, body.first_admin)
    return TenantResponse.model_validate(tenant)


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
