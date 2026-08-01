"""Reservations domain router."""
from __future__ import annotations

import logging
import uuid as _uuid_module
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text as sqlt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, get_session
from app.core.tenancy import require_tenant
from app.core.redis import get_avail_redis

log = logging.getLogger(__name__)
from app.core.rbac import require_permission
from app.core.security import UserClaims, get_current_user, get_current_user_or_bearer
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
    claims: UserClaims = Depends(get_current_user_or_bearer),
) -> ReservationService:
    repo = ReservationRepository(session=session, tenant_id=claims.tenant_id)
    redis = get_avail_redis()
    return ReservationService(repo=repo, redis=redis, tenant_id=claims.tenant_id)


def _get_claims(
    claims: UserClaims = Depends(get_current_user_or_bearer),
) -> UserClaims:
    return claims


# ── Guest booking schemas ─────────────────────────────────────────────────────


class GuestBookingRequest(BaseModel):
    """Public booking — no auth required."""
    pickup_location: str  # city name, airport code, short code, or UUID
    # Optional one-way drop-off location. Defaults to pickup_location (round-trip).
    dropoff_location: Optional[str] = None
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


# ── Email helper (background task) ───────────────────────────────────────────

async def _send_booking_confirmation_email(
    tenant_id: UUID,
    customer_email: str,
    merge_vars: dict[str, Any],
) -> None:
    """Fire-and-forget: render the booking.confirmed template and email the customer."""
    from app.domains.notifications.service import NotificationService
    try:
        async with AsyncSessionLocal() as session:
            svc = NotificationService(session)
            await svc.render_and_send(
                event_code="booking.confirmed",
                recipient_id="",
                merge_vars=merge_vars,
                tenant_id=str(tenant_id),
                channel="EMAIL",
                recipient_address=customer_email,
            )
    except Exception as exc:
        log.warning("booking_confirmation_email_failed email=%s error=%s", customer_email, exc)


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
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    tenant_id: UUID = Depends(require_tenant),
) -> GuestBookingResponse:
    """One-shot guest booking: resolves location, generates quote token, creates reservation."""

    # ── 1. Resolve location string(s) → UUID ──────────────────────────────
    async def _resolve_location(value: str) -> UUID:
        try:
            return UUID(value)
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
                {"tid": str(tenant_id), "q": value},
            )
            loc_row = loc_result.first()
            if not loc_row:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Location not found: {value}",
                )
            return UUID(str(loc_row[0]))

    location_uuid = await _resolve_location(payload.pickup_location)
    dropoff_location_uuid = (
        await _resolve_location(payload.dropoff_location)
        if payload.dropoff_location and payload.dropoff_location != payload.pickup_location
        else location_uuid
    )

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
            dropoff_location_id=dropoff_location_uuid,
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

    # ── Confirmation email (fire-and-forget) ──────────────────────────────
    loc_row = (await session.execute(
        sqlt("SELECT name FROM locations WHERE location_id = :lid"),
        {"lid": str(location_uuid)},
    )).first()
    location_name = loc_row[0] if loc_row else payload.pickup_location

    background_tasks.add_task(
        _send_booking_confirmation_email,
        tenant_id=tenant_id,
        customer_email=payload.guest_info.email,
        merge_vars={
            "first_name": payload.guest_info.first_name,
            "confirmation_number": reservation.confirmation_number,
            "pickup_datetime": pickup_dt.strftime("%b %d, %Y at %I:%M %p UTC"),
            "dropoff_datetime": dropoff_dt.strftime("%b %d, %Y at %I:%M %p UTC"),
            "pickup_location": location_name,
            "grand_total": str(quote.total),
            "currency": quote.currency,
        },
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
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    svc: ReservationService = Depends(_get_service),
    claims: UserClaims = Depends(require_permission("reservations", "create")),
) -> ReservationResponse:
    reservation = await svc.create_reservation(
        data=payload,
        actor_id=claims.user_id,
    )

    # ── Confirmation email (fire-and-forget) ──────────────────────────────
    cust_row = (await session.execute(
        sqlt("SELECT email, first_name FROM customers WHERE customer_id = :cid AND deleted_at IS NULL"),
        {"cid": reservation.customer_id},
    )).first()
    if cust_row:
        background_tasks.add_task(
            _send_booking_confirmation_email,
            tenant_id=claims.tenant_id,
            customer_email=cust_row[0],
            merge_vars={
                "first_name": cust_row[1],
                "confirmation_number": reservation.confirmation_number,
                "pickup_datetime": reservation.pickup_datetime.strftime("%b %d, %Y at %I:%M %p UTC"),
                "dropoff_datetime": reservation.return_datetime.strftime("%b %d, %Y at %I:%M %p UTC"),
                "pickup_location": str(reservation.pickup_location_id),
                "grand_total": str(reservation.grand_total or ""),
                "currency": reservation.currency or "USD",
            },
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
    location_id: Optional[str] = Query(default=None, description="Filter by pickup location UUID"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    claims: UserClaims = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CrmReservationRow]:
    """Returns reservations with customer name/email and vehicle class name joined in — for the CRM admin table."""
    tenant_id = str(claims.tenant_id)

    where_clauses = ["r.tenant_id = :tid", "r.deleted_at IS NULL"]
    params: dict = {"tid": tenant_id, "limit": limit, "offset": offset}

    if location_id:
        where_clauses.append("CAST(r.pickup_location_id AS text) = :location_id")
        params["location_id"] = location_id

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
    "",
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


# ── Public confirmation lookup (no auth required) ─────────────────────────────

class _PublicCustomer(BaseModel):
    first_name: str
    last_name: str
    email: str

class _PublicRateSummary(BaseModel):
    total: float
    currency_code: str

class PublicConfirmationResponse(BaseModel):
    reservation_id: str
    confirmation_number: str
    status: str
    pickup_date: str
    dropoff_date: str
    class_name: str
    customer: _PublicCustomer
    rate_summary: _PublicRateSummary


_PUBLIC_LOOKUP_LIMIT = 20      # per address
_PUBLIC_LOOKUP_WINDOW = 300    # seconds


async def _enforce_public_lookup_limit(request: Request) -> None:
    """Cap confirmation lookups per source address.

    Generous enough that a customer refreshing their booking never notices, low
    enough that walking the confirmation-number space is not practical.

    Fails OPEN if Redis is down: a cache outage must not stop customers seeing
    their own bookings. That is acceptable only because this is a rate limit on
    an already tenant-scoped read, not the isolation control itself.
    """
    client_ip = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()

    try:
        from app.core.redis import get_session_redis

        redis = get_session_redis()
        key = f"pubconf_rate:{client_ip}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _PUBLIC_LOOKUP_WINDOW)
        if count > _PUBLIC_LOOKUP_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Too many lookups from this address. Try again shortly.",
            )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — see docstring: fail open
        return


@router.get(
    "/public/{confirmation_number}",
    response_model=PublicConfirmationResponse,
    summary="Public confirmation lookup — no auth required",
    tags=["reservations"],
)
async def get_public_confirmation(
    confirmation_number: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> PublicConfirmationResponse:
    # Cross-tenant isolation on this route holds: the tenant is resolved before
    # the query and RLS filters `reservations`, so a caller naming another
    # tenant gets a 404 (verified against every tenant in the local stack).
    #
    # What it does NOT have is a second factor. A confirmation number is the
    # only thing needed to read a customer's name, email and total, and the
    # format is RCM-YYYYMMDD-XXXXXX under a globally unique index — enumerable
    # within a tenant given enough attempts. Both callers of this endpoint (the
    # post-booking confirmation page and the manage-booking link) pass only the
    # number, so requiring a surname here would break a live flow; the control
    # that fits without that change is to make enumeration expensive.
    await _enforce_public_lookup_limit(request)

    row = await session.execute(
        sqlt("""
            SELECT
                r.reservation_id,
                r.confirmation_number,
                r.status,
                r.pickup_datetime,
                r.return_datetime,
                COALESCE(vc.name, 'Vehicle') AS class_name,
                c.first_name,
                c.last_name,
                c.email,
                COALESCE(r.grand_total, r.base_total, 0)::float AS total,
                r.currency
            FROM reservations r
            LEFT JOIN vehicle_classes vc ON vc.class_id = r.vehicle_class_id
            LEFT JOIN customers c ON c.customer_id = r.customer_id
            WHERE r.confirmation_number = :cn
              AND r.deleted_at IS NULL
              -- Explicit, in addition to RLS. Defence in depth: if this route is
              -- ever reached on a session without the tenant GUC bound, the
              -- predicate is false rather than unconstrained.
              AND r.tenant_id = NULLIF(
                    current_setting('app.current_tenant_id', true), ''
                  )::uuid
            LIMIT 1
        """),
        {"cn": confirmation_number},
    )
    res = row.mappings().first()
    if not res:
        raise HTTPException(status_code=404, detail="Reservation not found")

    return PublicConfirmationResponse(
        reservation_id=str(res["reservation_id"]),
        confirmation_number=res["confirmation_number"],
        status=res["status"],
        pickup_date=res["pickup_datetime"].date().isoformat(),
        dropoff_date=res["return_datetime"].date().isoformat(),
        class_name=res["class_name"],
        customer=_PublicCustomer(
            first_name=res["first_name"] or "Guest",
            last_name=res["last_name"] or "",
            email=res["email"] or "",
        ),
        rate_summary=_PublicRateSummary(
            total=float(res["total"] or 0),
            currency_code=res["currency"] or "USD",
        ),
    )


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
    claims: UserClaims = Depends(require_permission("reservations", "update", accept_bearer=True)),
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
    claims: UserClaims = Depends(require_permission("reservations", "update", accept_bearer=True)),
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
