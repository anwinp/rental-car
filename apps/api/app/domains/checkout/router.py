"""Checkout / Counter Operations router — FastAPI endpoints."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.checkout.schemas import (
    ActiveRentalItem,
    CheckInRequest,
    CheckInResponse,
    CheckoutRequest,
    CheckoutResponse,
    RentalAgreementResponse,
    ShiftCloseRequest,
    ShiftOpenRequest,
    ShiftReport,
    VehicleSwapRequest,
)
from app.domains.checkout.service import CheckoutService

router = APIRouter()


# ── Counter checkout ──────────────────────────────────────────────────────────

@router.post("/checkout", response_model=CheckoutResponse, status_code=status.HTTP_201_CREATED)
async def checkout(
    body: CheckoutRequest,
    claims: UserClaims = Depends(require_permission("reservations", "update")),
    session: AsyncSession = Depends(get_session),
) -> CheckoutResponse:
    """
    Perform vehicle checkout for a confirmed reservation or walk-up.
    Checks customer DNR, verifies pre-auth, creates rental agreement.
    """
    svc = CheckoutService(session, claims.tenant_id)
    return await svc.checkout(body, claims.user_id, claims.tenant_id)


@router.post("/check-in", response_model=CheckInResponse)
async def check_in(
    body: CheckInRequest,
    claims: UserClaims = Depends(require_permission("reservations", "update")),
    session: AsyncSession = Depends(get_session),
) -> CheckInResponse:
    """
    Perform vehicle check-in for an active rental.
    Calculates time extension, fuel penalty, and mileage overage charges.
    """
    svc = CheckoutService(session, claims.tenant_id)
    return await svc.check_in(body, claims.user_id, claims.tenant_id)


@router.get("/agreements", response_model=list[RentalAgreementResponse])
async def list_agreements(
    reservation_id: Optional[uuid.UUID] = Query(default=None),
    customer_id: Optional[uuid.UUID] = Query(default=None),
    status: Optional[str] = Query(default=None),
    claims: UserClaims = Depends(require_permission("reservations", "read")),
    session: AsyncSession = Depends(get_session),
) -> list[RentalAgreementResponse]:
    """List rental agreements, optionally filtered by reservation_id, customer_id, or status."""
    from sqlalchemy import text
    filters = ["tenant_id = :tid"]
    params: dict = {"tid": str(claims.tenant_id)}
    if reservation_id:
        filters.append("reservation_id = :rid")
        params["rid"] = str(reservation_id)
    if customer_id:
        filters.append("customer_id = :cid")
        params["cid"] = str(customer_id)
    if status:
        filters.append("status = :status")
        params["status"] = status
    where = " AND ".join(filters)
    result = await session.execute(
        text(f"SELECT * FROM rental_agreements WHERE {where} ORDER BY created_at DESC LIMIT 50"),
        params,
    )
    rows = result.mappings().all()
    return [
        RentalAgreementResponse.model_validate(
            {k: str(v) if hasattr(v, "hex") else v for k, v in row.items()},
        )
        for row in rows
    ]


@router.get("/agreements/{ra_id}", response_model=RentalAgreementResponse)
async def get_agreement(
    ra_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("reservations", "read")),
    session: AsyncSession = Depends(get_session),
) -> RentalAgreementResponse:
    """Fetch a rental agreement by ID."""
    svc = CheckoutService(session, claims.tenant_id)
    ra = await svc.get_rental_agreement(ra_id, claims.tenant_id)
    return RentalAgreementResponse.model_validate(ra, from_attributes=True)


# ── Active rentals (enriched, for return processing) ─────────────────────────

@router.get("/active-rentals", response_model=list[ActiveRentalItem])
async def list_active_rentals(
    claims: UserClaims = Depends(require_permission("reservations", "read")),
    session: AsyncSession = Depends(get_session),
) -> list[ActiveRentalItem]:
    """
    Return all ACTIVE/EXTENDED rental agreements enriched with customer and vehicle info.
    Used by the Return Processing page to show all current rentals (walk-up + reservation).
    """
    from sqlalchemy import text
    result = await session.execute(
        text("""
            SELECT
              ra.ra_id::text,
              ra.ra_number,
              ra.reservation_id::text,
              r.confirmation_number,
              ra.customer_id::text,
              COALESCE(c.first_name || ' ' || c.last_name, 'Unknown') AS customer_name,
              COALESCE(c.email, '') AS customer_email,
              ra.vehicle_id::text,
              COALESCE(v.make, '') AS vehicle_make,
              COALESCE(v.model, '') AS vehicle_model,
              COALESCE(v.model_year, 0) AS model_year,
              v.plate_number,
              ra.status,
              ra.odometer_out,
              ra.fuel_level_out_pct,
              ra.created_at,
              r.return_datetime AS scheduled_return_date,
              r.grand_total AS reservation_total
            FROM rental_agreements ra
            LEFT JOIN customers c
              ON ra.customer_id = c.customer_id AND c.tenant_id = ra.tenant_id
            LEFT JOIN vehicles v
              ON ra.vehicle_id = v.vehicle_id AND v.tenant_id = ra.tenant_id
            LEFT JOIN reservations r
              ON ra.reservation_id = r.reservation_id
            WHERE ra.tenant_id = :tid
              AND ra.status IN ('ACTIVE', 'EXTENDED')
            ORDER BY ra.created_at DESC
            LIMIT 100
        """),
        {"tid": str(claims.tenant_id)},
    )
    rows = result.mappings().all()
    return [ActiveRentalItem.model_validate(dict(row)) for row in rows]


# ── Shift management ──────────────────────────────────────────────────────────

@router.post("/shift/open", status_code=status.HTTP_201_CREATED)
async def open_shift(
    body: ShiftOpenRequest,
    location_id: uuid.UUID = Query(..., description="Location UUID"),
    claims: UserClaims = Depends(require_permission("reservations", "create")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Open a counter shift for cash and fleet reconciliation."""
    svc = CheckoutService(session, claims.tenant_id)
    shift = await svc.open_shift(body, claims.user_id, location_id, claims.tenant_id)
    return {"shift_id": shift.shift_id, "status": "OPEN", "opened_at": shift.created_at}


@router.post("/shift/close", response_model=ShiftReport)
async def close_shift(
    body: ShiftCloseRequest,
    location_id: uuid.UUID = Query(..., description="Location UUID"),
    claims: UserClaims = Depends(require_permission("reservations", "update")),
    session: AsyncSession = Depends(get_session),
) -> ShiftReport:
    """Close the current counter shift and reconcile cash."""
    svc = CheckoutService(session, claims.tenant_id)
    return await svc.close_shift(body, claims.user_id, location_id, claims.tenant_id)


@router.get("/shift/current")
async def get_current_shift(
    location_id: uuid.UUID = Query(...),
    claims: UserClaims = Depends(require_permission("reservations", "read")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Get the current open shift for the agent."""
    svc = CheckoutService(session, claims.tenant_id)
    shift = await svc._get_open_shift(claims.user_id, location_id, claims.tenant_id)
    if shift is None:
        return {"shift": None, "status": "NO_OPEN_SHIFT"}
    return {
        "shift_id": shift.shift_id,
        "status": "OPEN",
        "opened_at": shift.created_at,
        "opening_cash": float(shift.opening_cash or 0),
    }


# ── Overdue rentals ───────────────────────────────────────────────────────────

@router.get("/overdue", response_model=list[RentalAgreementResponse])
async def list_overdue_rentals(
    claims: UserClaims = Depends(require_permission("reservations", "read")),
    session: AsyncSession = Depends(get_session),
) -> list[RentalAgreementResponse]:
    """List overdue rentals for this tenant/location."""
    svc = CheckoutService(session, claims.tenant_id)
    ras = await svc.list_overdue_rentals(claims.tenant_id)
    return [RentalAgreementResponse.model_validate(ra, from_attributes=True) for ra in ras]


# ── Vehicle swap ──────────────────────────────────────────────────────────────

@router.post("/swap", response_model=RentalAgreementResponse, status_code=status.HTTP_201_CREATED)
async def swap_vehicle(
    body: VehicleSwapRequest,
    claims: UserClaims = Depends(require_permission("reservations", "update")),
    session: AsyncSession = Depends(get_session),
) -> RentalAgreementResponse:
    """Perform a mid-rental vehicle swap. Creates a new RA linked to the original."""
    svc = CheckoutService(session, claims.tenant_id)
    new_ra = await svc.swap_vehicle(body, claims.user_id, claims.tenant_id)
    return RentalAgreementResponse.model_validate(new_ra, from_attributes=True)
