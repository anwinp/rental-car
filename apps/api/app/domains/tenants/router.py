"""Tenant domain router — CRUD + readiness gate + ToS acceptance."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
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
