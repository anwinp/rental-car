"""Reservations domain router."""
from __future__ import annotations

import uuid as _uuid_module
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text as sqlt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.redis import get_avail_redis
from app.core.security import UserClaims, get_current_user
from app.domains.pricing.repository import PricingRepository
from app.domains.pricing.schemas import ExtraQuoteRequest, RateQuoteRequest
from app.domains.pricing.service import PricingService
from app.domains.reservations.repository import ReservationRepository
from app.domains.reservations.schemas import (
    BookingChannel,
    CancellationPreview,
    CancellationRequest,
    CancellationResult,
    ExtraSelection,
    GuestInfo,
    ReservationCreate,
    ReservationModify,
    ReservationResponse,
)
from app.domains.reservations.service import ReservationService

router = APIRouter()


# ── Dependency helpers ────────────────────────────────────────────────────────


def _get_service(
    request: Request,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> ReservationService:
    repo = ReservationRepository(session=session, tenant_id=claims.tenant_id)
    redis = get_avail_redis()
    return ReservationService(repo=repo, redis=redis, tenant_id=claims.tenant_id)


def _get_claims(
    claims: UserClaims = Depends(get_current_user),
) -> UserClaims:
    return claims


# ── Guest booking schemas ─────────────────────────────────────────────────────


class GuestBookingRequest(BaseModel):
    """Public booking — no auth required."""
    pickup_location: str  # city name, airport code, short code, or UUID
    vehicle_class_id: UUID
    pickup_date: str   # YYYY-MM-DD
    dropoff_date: str  # YYYY-MM-DD
    guest_info: GuestInfo
    extras: list[str] = []  # extra codes, e.g. ["CDW", "GPS"]
    promo_code: Optional[str] = None


class GuestBookingResponse(BaseModel):
    confirmation_number: str
    reservation_id: str
    pickup_dt: datetime
    dropoff_dt: datetime
    total: Optional[str] = None


class CrmReservationRow(BaseModel):
    """Enriched reservation row for the CRM admin view — includes customer + class name."""
    reservation_id: str
    confirmation_number: str
    customer_name: str
    customer_email: str
    pickup_date: str   # YYYY-MM-DD
    return_date: str   # YYYY-MM-DD
    class_name: str
    status: str
    channel: str
    total: float
    assigned_vehicle: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post(
    "/guest",
    response_model=GuestBookingResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create guest reservation (no auth — web booking funnel)",
    tags=["reservations"],
)
async def create_guest_reservation(
    payload: GuestBookingRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> GuestBookingResponse:
    """One-shot guest booking: resolves location, generates quote token, creates reservation."""
    tenant_id_str = request.headers.get("X-Tenant-ID", "00000000-0000-0000-0000-000000000000")
    try:
        tenant_id = UUID(tenant_id_str)
    except ValueError:
        tenant_id = UUID("00000000-0000-0000-0000-000000000000")

    # ── 1. Resolve location string → UUID ─────────────────────────────────
    try:
        location_uuid = UUID(payload.pickup_location)
    except ValueError:
        loc_result = await session.execute(
            sqlt("""
                SELECT location_id FROM locations
                WHERE tenant_id = :tid AND deleted_at IS NULL
                  AND (
                    LOWER(short_code) = LOWER(:q)
                    OR LOWER(city) = LOWER(:q)
                    OR LOWER(airport_code) = LOWER(:q)
                    OR LOWER(name) ILIKE '%' || LOWER(:q) || '%'
                  )
                LIMIT 1
            """),
            {"tid": str(tenant_id), "q": payload.pickup_location},
        )
        loc_row = loc_result.first()
        if not loc_row:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Location not found: {payload.pickup_location}",
            )
        location_uuid = UUID(str(loc_row[0]))

    # ── 2. Parse dates → UTC datetimes at 10:00 ───────────────────────────
    try:
        pickup_dt = datetime.fromisoformat(f"{payload.pickup_date}T10:00:00+00:00")
        dropoff_dt = datetime.fromisoformat(f"{payload.dropoff_date}T10:00:00+00:00")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid date format (expected YYYY-MM-DD): {exc}",
        ) from exc

    if dropoff_dt <= pickup_dt:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="dropoff_date must be after pickup_date",
        )

    # ── 3. Resolve extra codes → UUIDs ────────────────────────────────────
    extra_quote_items: list[ExtraQuoteRequest] = []
    for code in payload.extras:
        ext_result = await session.execute(
            sqlt("""
                SELECT extra_id FROM extras_catalog
                WHERE (tenant_id IS NULL OR tenant_id = :tid)
                  AND UPPER(code) = UPPER(:code)
                  AND is_active = true
                LIMIT 1
            """),
            {"tid": str(tenant_id), "code": code},
        )
        ext_row = ext_result.first()
        if ext_row:
            extra_quote_items.append(
                ExtraQuoteRequest(extra_id=UUID(str(ext_row[0])), quantity=1)
            )

    # ── 4. Find or create guest customer ──────────────────────────────────
    cust_result = await session.execute(
        sqlt("""
            SELECT customer_id FROM customers
            WHERE tenant_id = :tid
              AND LOWER(email) = LOWER(:email)
              AND deleted_at IS NULL
            LIMIT 1
        """),
        {"tid": str(tenant_id), "email": payload.guest_info.email},
    )
    cust_row = cust_result.first()

    if cust_row:
        customer_id = UUID(str(cust_row[0]))
    else:
        customer_id = _uuid_module.uuid4()
        await session.execute(
            sqlt("""
                INSERT INTO customers (customer_id, tenant_id, first_name, last_name, email, mobile_phone)
                VALUES (:cid, :tid, :fn, :ln, :email, :phone)
            """),
            {
                "cid": str(customer_id),
                "tid": str(tenant_id),
                "fn": payload.guest_info.first_name,
                "ln": payload.guest_info.last_name,
                "email": payload.guest_info.email,
                "phone": payload.guest_info.phone,
            },
        )

    # ── 5. Generate rate quote (stores token in Redis for 30s) ────────────
    redis = get_avail_redis()
    pricing_svc = PricingService(
        repo=PricingRepository(session=session, tenant_id=tenant_id),
        redis=redis,
        tenant_id=tenant_id,
    )
    quote = await pricing_svc.calculate_quote(
        RateQuoteRequest(
            location_id=location_uuid,
            vehicle_class_id=payload.vehicle_class_id,
            pickup_dt=pickup_dt,
            dropoff_dt=dropoff_dt,
            extras=extra_quote_items,
            promo_code=payload.promo_code,
        )
    )

    # ── 6. Create reservation with the fresh token ────────────────────────
    res_svc = ReservationService(
        repo=ReservationRepository(session=session, tenant_id=tenant_id),
        redis=redis,
        tenant_id=tenant_id,
    )
    reservation = await res_svc.create_reservation(
        data=ReservationCreate(
            customer_id=customer_id,
            location_id=location_uuid,
            vehicle_class_id=payload.vehicle_class_id,
            pickup_dt=pickup_dt,
            dropoff_dt=dropoff_dt,
            rate_quote_token=quote.quote_token,
            extras=[
                ExtraSelection(extra_id=e.extra_id, quantity=e.quantity)
                for e in extra_quote_items
            ],
            promo_code=payload.promo_code,
            source=BookingChannel.DIRECT_WEB,
        ),
        actor_id=None,  # guest booking — no staff agent
    )

    return GuestBookingResponse(
        confirmation_number=reservation.confirmation_number,
        reservation_id=reservation.reservation_id,
        pickup_dt=pickup_dt,
        dropoff_dt=dropoff_dt,
        total=str(quote.total),
    )


@router.post(
    "/",
    response_model=ReservationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create reservation",
    tags=["reservations"],
)
async def create_reservation(
    payload: ReservationCreate,
    svc: ReservationService = Depends(_get_service),
    claims: UserClaims = Depends(_get_claims),
) -> ReservationResponse:
    reservation = await svc.create_reservation(
        data=payload,
        actor_id=claims.user_id,
    )
    return ReservationResponse.model_validate(reservation)


@router.get(
    "/crm-list",
    response_model=list[CrmReservationRow],
    summary="CRM enriched reservation list with customer name and vehicle class",
    tags=["reservations"],
)
async def list_reservations_crm(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    search: Optional[str] = Query(default=None, description="Search confirmation, customer name, or email"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    claims: UserClaims = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CrmReservationRow]:
    """Returns reservations with customer name/email and vehicle class name joined in — for the CRM admin table."""
    tenant_id = str(claims.tenant_id)

    where_clauses = ["r.tenant_id = :tid", "r.deleted_at IS NULL"]
    params: dict = {"tid": tenant_id, "limit": limit, "offset": offset}

    if status_filter:
        where_clauses.append("r.status = :status")
        params["status"] = status_filter

    if search:
        where_clauses.append(
            "(r.confirmation_number ILIKE :search"
            " OR (c.first_name || ' ' || c.last_name) ILIKE :search"
            " OR c.email ILIKE :search)"
        )
        params["search"] = f"%{search}%"

    where_sql = " AND ".join(where_clauses)

    rows = await session.execute(
        sqlt(f"""
            SELECT
                r.reservation_id,
                r.confirmation_number,
                COALESCE(c.first_name || ' ' || c.last_name, 'Unknown') AS customer_name,
                COALESCE(c.email, '') AS customer_email,
                DATE(r.pickup_datetime AT TIME ZONE 'UTC')::text AS pickup_date,
                DATE(r.return_datetime AT TIME ZONE 'UTC')::text AS return_date,
                COALESCE(vc.name, r.vehicle_class_id::text) AS class_name,
                r.status,
                r.channel,
                COALESCE(r.grand_total, 0)::float AS total,
                v.plate_number AS assigned_vehicle
            FROM reservations r
            LEFT JOIN customers c
                ON c.customer_id = r.customer_id AND c.tenant_id = r.tenant_id
            LEFT JOIN vehicle_classes vc
                ON vc.class_id = r.vehicle_class_id
                AND (vc.tenant_id IS NULL OR vc.tenant_id = r.tenant_id)
            LEFT JOIN vehicles v
                ON v.vehicle_id = r.assigned_vehicle_id
            WHERE {where_sql}
            ORDER BY r.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )

    return [
        CrmReservationRow(
            reservation_id=str(row[0]),
            confirmation_number=row[1],
            customer_name=row[2],
            customer_email=row[3],
            pickup_date=row[4],
            return_date=row[5],
            class_name=row[6],
            status=row[7],
            channel=row[8],
            total=float(row[9]),
            assigned_vehicle=row[10],
        )
        for row in rows.all()
    ]


@router.get(
    "/",
    response_model=list[ReservationResponse],
    summary="List reservations with filters",
    tags=["reservations"],
)
async def list_reservations(
    status: Optional[str] = Query(default=None, description="Filter by status"),
    location_id: Optional[UUID] = Query(default=None),
    customer_id: Optional[UUID] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    source: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    svc: ReservationService = Depends(_get_service),
) -> list[ReservationResponse]:
    reservations = await svc.list_reservations(
        status=status,
        location_id=location_id,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
        source=source,
        limit=limit,
        offset=offset,
    )
    return [ReservationResponse.model_validate(r) for r in reservations]


@router.get(
    "/confirmation/{confirmation_number}",
    response_model=ReservationResponse,
    summary="Lookup by confirmation number (public — manage my booking)",
    tags=["reservations"],
)
async def get_by_confirmation_number(
    confirmation_number: str,
    svc: ReservationService = Depends(_get_service),
) -> ReservationResponse:
    reservation = await svc.get_by_confirmation_number(confirmation_number)
    return ReservationResponse.model_validate(reservation)


@router.get(
    "/{reservation_id}",
    response_model=ReservationResponse,
    summary="Get reservation",
    tags=["reservations"],
)
async def get_reservation(
    reservation_id: UUID,
    svc: ReservationService = Depends(_get_service),
) -> ReservationResponse:
    reservation = await svc.get_reservation(reservation_id)
    return ReservationResponse.model_validate(reservation)


@router.patch(
    "/{reservation_id}",
    response_model=ReservationResponse,
    summary="Modify reservation (CONFIRMED only)",
    tags=["reservations"],
)
async def modify_reservation(
    reservation_id: UUID,
    payload: ReservationModify,
    svc: ReservationService = Depends(_get_service),
    claims: UserClaims = Depends(_get_claims),
) -> ReservationResponse:
    reservation = await svc.modify_reservation(
        reservation_id=reservation_id,
        data=payload,
        actor_id=claims.user_id,
    )
    return ReservationResponse.model_validate(reservation)


@router.post(
    "/{reservation_id}/cancel",
    response_model=CancellationResult,
    summary="Cancel reservation",
    tags=["reservations"],
)
async def cancel_reservation(
    reservation_id: UUID,
    payload: CancellationRequest,
    svc: ReservationService = Depends(_get_service),
    claims: UserClaims = Depends(_get_claims),
) -> CancellationResult:
    return await svc.cancel_reservation(
        reservation_id=reservation_id,
        data=payload,
        actor_id=claims.user_id,
        actor_roles=claims.roles,
    )


@router.get(
    "/{reservation_id}/cancellation-preview",
    response_model=CancellationPreview,
    summary="Preview cancellation fee without cancelling",
    tags=["reservations"],
)
async def cancellation_preview(
    reservation_id: UUID,
    svc: ReservationService = Depends(_get_service),
) -> CancellationPreview:
    return await svc.preview_cancellation(reservation_id)
