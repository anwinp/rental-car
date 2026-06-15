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
    status_code=status.HTTP_204_NO_CONTENT,
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
