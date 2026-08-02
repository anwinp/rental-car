"""Checkout / Counter Operations router — FastAPI endpoints."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
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


# ── E-Signature ───────────────────────────────────────────────────────────────

class SignatureUploadRequest(BaseModel):
    ra_id: str


class SignaturePatchRequest(BaseModel):
    s3_key: str
    signature_hash: str


@router.post("/signature-upload-url")
async def get_signature_upload_url(
    body: SignatureUploadRequest,
    claims: UserClaims = Depends(require_permission("reservations", "update")),
) -> dict:
    """Generate S3 presigned URL for signature upload."""
    import uuid as _uuid
    from app.core.config import settings
    s3_key = f"signatures/{claims.tenant_id}/{body.ra_id}/{_uuid.uuid4()}.png"
    try:
        from app.core.s3 import get_presign_client
        s3 = get_presign_client()
        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": getattr(settings, "s3_photos_bucket", "rcm-photos"),
                "Key": s3_key,
                "ContentType": "image/png",
            },
            ExpiresIn=300,
        )
    except Exception:
        url = f"https://s3-placeholder.local/{s3_key}"
    return {"upload_url": url, "s3_key": s3_key, "expires_in": 300}


@router.patch("/agreements/{ra_id}/signature")
async def save_signature(
    ra_id: uuid.UUID,
    body: SignaturePatchRequest,
    claims: UserClaims = Depends(require_permission("reservations", "update")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Store signature S3 key and hash on rental agreement."""
    from sqlalchemy import text
    await session.execute(
        text("""
            UPDATE rental_agreements
            SET customer_signature_url = :key, esignature_hash = :hash, updated_at = NOW()
            WHERE ra_id = CAST(:ra_id AS uuid) AND tenant_id = CAST(:tid AS uuid)
        """),
        {
            "key": body.s3_key,
            "hash": body.signature_hash,
            "ra_id": str(ra_id),
            "tid": str(claims.tenant_id),
        },
    )
    await session.commit()
    return {"ra_id": str(ra_id), "signed": True}


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


@router.get(
    "/agreements/{ra_id}/document",
    summary="The signed rental agreement as a PDF",
    response_class=Response,
)
async def get_agreement_document(
    ra_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("reservations", "read")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Stream the agreement PDF, rendering it on first request.

    Returned inline so it opens in a browser tab at the counter rather than
    landing in a downloads folder while a customer waits.
    """
    from app.domains.checkout.agreement_document import (
        AgreementRenderError,
        get_or_create_pdf,
    )

    try:
        pdf, _key = await get_or_create_pdf(session, ra_id)
    except AgreementRenderError as exc:
        # Deliberately not a placeholder document — see the module docstring.
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="agreement-{ra_id}.pdf"'},
    )


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


# ── Receipt breakdown (for ReturnAdvisor) ────────────────────────────────────

class ReceiptLineItem(BaseModel):
    label: str
    amount: float
    is_charge: bool = True


class ReceiptBreakdownResponse(BaseModel):
    ra_id: str
    miles_driven: float
    free_miles_included: float
    overage_miles: float
    overage_rate: float
    mileage_charge: float
    fuel_level_out_pct: float
    fuel_level_in_pct: float
    contracted_fuel_level_pct: float
    fuel_steps_below_contract: int
    fuel_charge_per_step: float
    fuel_surcharge: float
    late_return_minutes: int
    late_fee_rate: float
    late_return_charge: float
    subtotal: float
    line_items: list[ReceiptLineItem]


@router.get(
    "/agreements/{ra_id}/receipt-breakdown",
    response_model=ReceiptBreakdownResponse,
    summary="Arithmetic receipt breakdown for ReturnAdvisor",
)
async def get_receipt_breakdown(
    ra_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("reservations", "read", accept_bearer=True)),
    session: AsyncSession = Depends(get_session),
) -> ReceiptBreakdownResponse:
    """
    Returns arithmetic breakdown of charges so the ReturnAdvisor can explain them.
    Does not create or modify any records.
    """
    from sqlalchemy import text as sqlt
    result = await session.execute(
        sqlt("""
            SELECT
                ra.ra_id,
                ra.odometer_out, ra.odometer_in,
                ra.fuel_level_out, ra.fuel_level_in,
                ra.actual_return_datetime,
                r.return_datetime,
                vc.free_miles_per_day, vc.overage_rate_per_mile,
                EXTRACT(EPOCH FROM (r.return_datetime - ra.created_at)) / 86400.0 AS rental_days
            FROM rental_agreements ra
            JOIN reservations r ON r.reservation_id = ra.reservation_id
            LEFT JOIN vehicle_classes vc ON vc.class_id = r.vehicle_class_id
            WHERE ra.ra_id = :ra_id AND ra.tenant_id = :tid
        """),
        {"ra_id": str(ra_id), "tid": str(claims.tenant_id)},
    )
    row = result.mappings().first()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Rental agreement not found")

    od_out = float(row["odometer_out"] or 0)
    od_in = float(row["odometer_in"] or od_out)
    miles_driven = max(0.0, od_in - od_out)

    rental_days = max(1.0, float(row["rental_days"] or 1))
    free_miles = float(row["free_miles_per_day"] or 0) * rental_days
    overage_miles = max(0.0, miles_driven - free_miles)
    overage_rate = float(row["overage_rate_per_mile"] or 0.25)
    mileage_charge = round(overage_miles * overage_rate, 2)

    fuel_out = float(row["fuel_level_out"] or 1.0)
    fuel_in = float(row["fuel_level_in"] or fuel_out)
    contracted_pct = fuel_out
    steps_below = max(0, round((contracted_pct - fuel_in) / 0.125))
    fuel_charge_step = 15.0
    fuel_surcharge = round(steps_below * fuel_charge_step, 2)

    late_minutes = 0
    late_charge = 0.0
    if row["actual_return_datetime"] and row["return_datetime"]:
        from datetime import timezone as _tz
        actual = row["actual_return_datetime"]
        scheduled = row["return_datetime"]
        delta_s = (actual - scheduled).total_seconds()
        late_minutes = max(0, int(delta_s / 60))
        late_rate = 35.0
        late_hours = late_minutes // 60
        late_charge = round(late_hours * late_rate, 2)
    else:
        late_rate = 35.0

    subtotal = round(mileage_charge + fuel_surcharge + late_charge, 2)

    items: list[ReceiptLineItem] = []
    if mileage_charge > 0:
        items.append(ReceiptLineItem(label=f"Mileage overage ({overage_miles:.0f} mi × ${overage_rate}/mi)", amount=mileage_charge))
    if fuel_surcharge > 0:
        items.append(ReceiptLineItem(label=f"Fuel surcharge ({steps_below} step{'s' if steps_below != 1 else ''} × ${fuel_charge_step})", amount=fuel_surcharge))
    if late_charge > 0:
        items.append(ReceiptLineItem(label=f"Late return ({late_minutes} min)", amount=late_charge))

    return ReceiptBreakdownResponse(
        ra_id=str(ra_id),
        miles_driven=miles_driven,
        free_miles_included=free_miles,
        overage_miles=overage_miles,
        overage_rate=overage_rate,
        mileage_charge=mileage_charge,
        fuel_level_out_pct=fuel_out,
        fuel_level_in_pct=fuel_in,
        contracted_fuel_level_pct=contracted_pct,
        fuel_steps_below_contract=steps_below,
        fuel_charge_per_step=fuel_charge_step,
        fuel_surcharge=fuel_surcharge,
        late_return_minutes=late_minutes,
        late_fee_rate=late_rate,
        late_return_charge=late_charge,
        subtotal=subtotal,
        line_items=items,
    )
