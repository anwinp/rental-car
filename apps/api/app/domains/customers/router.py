"""Customer domain router — FastAPI endpoints."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.exceptions import PermissionDeniedError
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.customers.schemas import (
    CustomerCreate,
    CustomerMergeRequest,
    CustomerResponse,
    CustomerSearchQuery,
    CustomerUpdate,
    DNRCreate,
    DNRResponse,
    GDPRErasureRequest,
)
from app.domains.customers.service import CustomerService

router = APIRouter()


# ── Private helpers ───────────────────────────────────────────────────────────

def _require_manager_role(claims: UserClaims) -> None:
    """Enforce BRANCH_MANAGER or above for DNR operations."""
    manager_roles = {
        "BRANCH_MANAGER", "REGIONAL_MANAGER", "FLEET_MANAGER",
        "SYSTEM_ADMIN", "SUPER_ADMIN",
    }
    if not any(r in manager_roles for r in claims.roles):
        raise PermissionDeniedError(
            "This action requires BRANCH_MANAGER role or above."
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(
    body: CustomerCreate,
    claims: UserClaims = Depends(require_permission("customers", "create")),
    session: AsyncSession = Depends(get_session),
) -> CustomerResponse:
    """Create a new customer record. Raises 409 on duplicate email."""
    svc = CustomerService(session, claims.tenant_id)
    customer = await svc.create_customer(body, claims.tenant_id)
    return CustomerResponse.model_validate(customer, from_attributes=True)


@router.get("", response_model=list[CustomerResponse])
async def search_customers(
    q: Annotated[str | None, Query(description="Fulltext search: name/email/phone/DL")] = None,
    dnr_only: bool = False,
    limit: int = Query(default=20, le=50),
    offset: int = Query(default=0, ge=0),
    claims: UserClaims = Depends(require_permission("customers", "read")),
    session: AsyncSession = Depends(get_session),
) -> list[CustomerResponse]:
    """Search customers by fulltext query."""
    svc = CustomerService(session, claims.tenant_id)
    query = CustomerSearchQuery(q=q, dnr_only=dnr_only, limit=limit, offset=offset)
    customers = await svc.search_customers(query, claims.tenant_id)
    return [CustomerResponse.model_validate(c, from_attributes=True) for c in customers]


@router.get("/{customer_id}", response_model=CustomerResponse)
async def get_customer(
    customer_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("customers", "read")),
    session: AsyncSession = Depends(get_session),
) -> CustomerResponse:
    """
    Fetch a customer by ID.
    DL fields are masked (last-4 only) for roles below BRANCH_MANAGER.
    """
    svc = CustomerService(session, claims.tenant_id)
    customer = await svc.get_customer(customer_id, claims.tenant_id)
    response = CustomerResponse.model_validate(customer, from_attributes=True)

    # Mask DL number for non-manager roles
    manager_roles = {"BRANCH_MANAGER", "REGIONAL_MANAGER", "SYSTEM_ADMIN", "SUPER_ADMIN"}
    if not any(r in manager_roles for r in claims.roles):
        if response.dl_number and len(response.dl_number) > 4:
            response.dl_number = f"****{response.dl_number[-4:]}"
        response.dl_state = None
        response.dl_country = None

    return response


@router.patch("/{customer_id}", response_model=CustomerResponse)
async def update_customer(
    customer_id: uuid.UUID,
    body: CustomerUpdate,
    claims: UserClaims = Depends(require_permission("customers", "update")),
    session: AsyncSession = Depends(get_session),
) -> CustomerResponse:
    """Partial update of customer fields."""
    svc = CustomerService(session, claims.tenant_id)
    customer = await svc.update_customer(customer_id, body, claims.tenant_id)
    return CustomerResponse.model_validate(customer, from_attributes=True)


@router.get("/{customer_id}/dnr", response_model=DNRResponse)
async def get_dnr_status(
    customer_id: uuid.UUID,
    location_id: uuid.UUID | None = Query(default=None),
    claims: UserClaims = Depends(require_permission("customers", "read")),
    session: AsyncSession = Depends(get_session),
) -> DNRResponse:
    """
    Get DNR status for a customer.
    NOTE: reason field is for counter-agent use only — never expose to customers.
    """
    svc = CustomerService(session, claims.tenant_id)
    customer = await svc.get_customer(customer_id, claims.tenant_id)
    return DNRResponse(
        dnr_flag=customer.dnr_flag,
        scope=customer.dnr_scope,  # type: ignore[arg-type]
        reason=customer.dnr_reason,
        added_by=customer.dnr_added_by,
        expires_at=customer.dnr_expiry,
    )


@router.post("/{customer_id}/dnr", response_model=CustomerResponse)
async def add_dnr(
    customer_id: uuid.UUID,
    body: DNRCreate,
    claims: UserClaims = Depends(require_permission("customers", "update")),
    session: AsyncSession = Depends(get_session),
) -> CustomerResponse:
    """
    Add a DNR flag to a customer.
    Requires BRANCH_MANAGER or above.
    """
    _require_manager_role(claims)
    svc = CustomerService(session, claims.tenant_id)
    customer = await svc.add_dnr(customer_id, body, claims.user_id, claims.tenant_id)
    return CustomerResponse.model_validate(customer, from_attributes=True)


@router.delete("/{customer_id}/dnr", response_model=CustomerResponse)
async def remove_dnr(
    customer_id: uuid.UUID,
    reason: str = Query(min_length=5),
    claims: UserClaims = Depends(require_permission("customers", "update")),
    session: AsyncSession = Depends(get_session),
) -> CustomerResponse:
    """
    Remove a DNR flag from a customer.
    Requires BRANCH_MANAGER or above.
    """
    _require_manager_role(claims)
    svc = CustomerService(session, claims.tenant_id)
    customer = await svc.remove_dnr(customer_id, claims.user_id, reason, claims.tenant_id)
    return CustomerResponse.model_validate(customer, from_attributes=True)


@router.post("/{customer_id}/gdpr-erasure", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def gdpr_erasure(
    customer_id: uuid.UUID,
    body: GDPRErasureRequest,
    claims: UserClaims = Depends(require_permission("customers", "delete")),
    session: AsyncSession = Depends(get_session),
) -> None:
    """
    GDPR Article 17 right to erasure.
    Requires SYSTEM_ADMIN role. Checks for legal holds before anonymizing.
    """
    if "SYSTEM_ADMIN" not in claims.roles and "SUPER_ADMIN" not in claims.roles:
        raise PermissionDeniedError(
            "GDPR erasure requires SYSTEM_ADMIN role.",
        )
    svc = CustomerService(session, claims.tenant_id)
    await svc.gdpr_erasure(customer_id, claims.tenant_id, claims.user_id, body)


@router.post("/merge", response_model=CustomerResponse)
async def merge_customers(
    body: CustomerMergeRequest,
    claims: UserClaims = Depends(require_permission("customers", "update")),
    session: AsyncSession = Depends(get_session),
) -> CustomerResponse:
    """
    Merge duplicate customer records.
    Requires SYSTEM_ADMIN role. Source PII moves to target; source is anonymized.
    """
    if "SYSTEM_ADMIN" not in claims.roles and "SUPER_ADMIN" not in claims.roles:
        raise PermissionDeniedError(
            "Customer merge requires SYSTEM_ADMIN role.",
        )
    svc = CustomerService(session, claims.tenant_id)
    customer = await svc.merge_customers(body, claims.tenant_id, claims.user_id)
    return CustomerResponse.model_validate(customer, from_attributes=True)
