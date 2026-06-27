"""Fleet domain router — vehicles, blocks, classes, availability, WebSocket."""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.redis import WS_TOKEN_KEY, get_session_redis
from app.core.security import UserClaims, get_current_user, get_optional_current_user, verify_ws_token
from app.domains.fleet.schemas import (
    AvailabilityQuery,
    AvailabilityResponse,
    BulkImportResult,
    ReallocateBlockRequest,
    VehicleBlockCreate,
    VehicleBlockResponse,
    VehicleBlockUpdate,
    VehicleClassCreate,
    VehicleClassResponse,
    VehicleCreate,
    VehicleResponse,
    VehicleStatus,
    VehicleStatusTransitionRequest,
    VehicleUpdate,
)
from app.domains.fleet.service import FleetService

router = APIRouter()
_svc = FleetService()

# ── Helper: is the user a fleet manager or above? ────────────────────────────

_MANAGER_ROLES = frozenset(
    {"FLEET_MANAGER", "BRANCH_MANAGER", "REGIONAL_MANAGER", "SYSTEM_ADMIN", "SUPER_ADMIN"}
)


def _is_manager(claims: UserClaims) -> bool:
    return bool(set(claims.roles) & _MANAGER_ROLES)


# ── Vehicle class endpoints ───────────────────────────────────────────────────


@router.get(
    "/classes",
    response_model=list[VehicleClassResponse],
    summary="List vehicle classes (system + tenant-custom)",
)
async def list_classes(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> list[VehicleClassResponse]:
    classes = await _svc.list_classes(session, claims.tenant_id)
    return [VehicleClassResponse.model_validate(c) for c in classes]


@router.post(
    "/classes",
    response_model=VehicleClassResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom vehicle class",
)
async def create_class(
    body: VehicleClassCreate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleClassResponse:
    cls = await _svc.create_class(session, claims.tenant_id, body)
    return VehicleClassResponse.model_validate(cls)


# ── Vehicle CRUD endpoints ────────────────────────────────────────────────────


@router.post(
    "/vehicles",
    response_model=VehicleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a vehicle to the fleet",
)
async def create_vehicle(
    body: VehicleCreate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleResponse:
    vehicle = await _svc.create_vehicle(
        session, claims.tenant_id, body, created_by=str(claims.user_id)
    )
    return VehicleResponse.model_validate(vehicle)


@router.get(
    "/vehicles",
    response_model=list[VehicleResponse],
    summary="List vehicles with optional filters",
)
async def list_vehicles(
    location_id: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    class_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
) -> list[VehicleResponse]:
    vehicles = await _svc.list_vehicles(
        session,
        claims.tenant_id,
        location_id=location_id,
        status=status_filter,
        class_id=class_id,
        limit=limit,
        offset=offset,
    )
    return [VehicleResponse.model_validate(v) for v in vehicles]


@router.get(
    "/vehicles/{vehicle_id}",
    response_model=VehicleResponse,
    summary="Get vehicle details",
)
async def get_vehicle(
    vehicle_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
) -> VehicleResponse:
    vehicle = await _svc.get_vehicle(session, claims.tenant_id, vehicle_id)
    return VehicleResponse.model_validate(vehicle)


@router.patch(
    "/vehicles/{vehicle_id}",
    response_model=VehicleResponse,
    summary="Update vehicle attributes",
)
async def update_vehicle(
    vehicle_id: str,
    body: VehicleUpdate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleResponse:
    vehicle = await _svc.update_vehicle(session, claims.tenant_id, vehicle_id, body)
    return VehicleResponse.model_validate(vehicle)


@router.post(
    "/vehicles/{vehicle_id}/status",
    response_model=VehicleResponse,
    summary="Transition vehicle status",
)
async def transition_status(
    vehicle_id: str,
    body: VehicleStatusTransitionRequest,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleResponse:
    """
    Enforces the state machine. Returns HTTP 422 with INVALID_STATUS_TRANSITION
    if the requested transition is not allowed from the current status.
    """
    vehicle = await _svc.transition_status(
        session,
        claims.tenant_id,
        vehicle_id,
        new_status=body.new_status.value,
        actor_id=str(claims.user_id),
        reason=body.reason,
    )
    return VehicleResponse.model_validate(vehicle)


@router.delete(
    "/vehicles/{vehicle_id}",
    status_code=status.HTTP_204_NO_CONTENT, response_model=None,
    summary="Soft-delete a vehicle",
)
async def delete_vehicle(
    vehicle_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> None:
    await _svc.soft_delete_vehicle(session, claims.tenant_id, vehicle_id)


# ── Bulk import ───────────────────────────────────────────────────────────────


@router.post(
    "/vehicles/bulk-import",
    response_model=BulkImportResult,
    summary="Bulk import vehicles from CSV",
)
async def bulk_import_vehicles(
    file: UploadFile = File(..., description="CSV file with vehicle records"),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> BulkImportResult:
    """
    Validates ALL rows before importing any.
    Returns created/skipped/error counts.
    Partial imports never occur — the service validates first, then imports atomically.
    """
    content = await file.read()
    text_content = content.decode("utf-8-sig")  # Handle BOM

    reader = csv.DictReader(io.StringIO(text_content))
    rows = [dict(row) for row in reader]

    return await _svc.bulk_import_vehicles(
        session,
        claims.tenant_id,
        rows,
        created_by=str(claims.user_id),
    )


# ── Public search ────────────────────────────────────────────────────────────


def _derive_class_code(name: str, sipp_prefix: str) -> str:
    n = name.upper()
    if "ECON" in n:        return "ECON"
    if "COMP" in n:        return "COMP"
    if "MID" in n:         return "MIDZ"
    if "FULL" in n or "STANDARD" in n: return "FULL"
    if "SUV" in n:         return "SUVR"
    if "PREM" in n or "LUX" in n: return "PREM"
    if "MINI" in n:        return "MINI"
    return (sipp_prefix + "XXX")[:4].upper()


def _default_features(name: str) -> list[str]:
    n = name.upper()
    base = ["Air Conditioning", "Automatic Transmission", "Bluetooth"]
    if "PREM" in n or "LUX" in n:
        return base + ["Leather Seats", "Heated Seats", "Navigation"]
    if "SUV" in n:
        return base + ["All-Wheel Drive", "Third Row Seating", "Roof Rack"]
    if "ECON" in n or "COMP" in n:
        return base + ["Fuel Efficient", "USB Charging"]
    return base + ["Backup Camera", "USB Charging"]


async def _resolve_location_id(
    session: AsyncSession,
    tenant_id: UUID,
    raw: str,
) -> Optional[str]:
    """
    Resolve a pickup/dropoff value to a location UUID string.
    Accepts: UUID string, short_code (exact, case-insensitive), city name (ILIKE), airport_code.
    Returns None if no match found.
    """
    from sqlalchemy import text as sqlt
    # Fast path: already a UUID
    try:
        return str(UUID(raw))
    except ValueError:
        pass
    result = await session.execute(
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
        {"tid": str(tenant_id), "q": raw},
    )
    row = result.first()
    return str(row[0]) if row else None


@router.get(
    "/promo",
    summary="Public: list vehicles marked as promotional",
)
async def list_promo_vehicles(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    """Returns vehicles with is_promo=true, ordered by make/model. No auth required."""
    from sqlalchemy import select, cast, Text as SAText
    from app.domains.fleet.models import Vehicle

    tenant_id: str = request.headers.get("X-Tenant-ID") or ""

    stmt = (
        select(Vehicle)
        .where(
            cast(Vehicle.tenant_id, SAText) == tenant_id,
            Vehicle.is_promo == True,  # noqa: E712
            Vehicle.deleted_at.is_(None),
        )
        .order_by(Vehicle.make, Vehicle.model)
    )
    result = await session.execute(stmt)
    vehicles = result.scalars().all()
    return [
        {
            "vehicle_id": v.vehicle_id,
            "make": v.make,
            "model": v.model,
            "model_year": v.model_year,
            "trim": v.trim,
            "exterior_color": v.exterior_color,
            "vehicle_class_id": v.vehicle_class_id,
            "promo_image_url": v.promo_image_url,
            "promo_label": v.promo_label,
            "status": v.status,
        }
        for v in vehicles
    ]


@router.get(
    "/search",
    summary="Public: search available vehicle classes for a date range",
)
async def search_fleet(
    request: Request,
    pickup_location_id: str = Query(...),
    dropoff_location_id: Optional[str] = Query(default=None),
    pickup_date: str = Query(...),
    dropoff_date: str = Query(...),
    session: AsyncSession = Depends(get_session),
    claims: Optional[UserClaims] = Depends(get_optional_current_user),
) -> dict[str, Any]:
    """
    Returns all active vehicle classes with availability counts.
    No authentication required — used by the public web booking search.
    Tenant resolved from JWT claims when logged in, else X-Tenant-ID header.
    Location resolved by UUID, short_code, city name, or airport code.
    """
    raw_tenant: Optional[str] = (
        str(claims.tenant_id) if claims else request.headers.get("X-Tenant-ID")
    )
    if not raw_tenant:
        return {"classes": []}
    try:
        tenant_id = UUID(raw_tenant)
    except ValueError:
        return {"classes": []}

    try:
        pickup_dt = datetime.fromisoformat(pickup_date)
        dropoff_dt = datetime.fromisoformat(dropoff_date)
    except ValueError:
        return {"classes": []}

    resolved_location_id = await _resolve_location_id(session, tenant_id, pickup_location_id)
    if not resolved_location_id:
        return {"classes": [], "error": f"Location not found: {pickup_location_id}"}

    try:
        classes = await _svc.list_classes(session, tenant_id)
    except Exception:
        return {"classes": []}

    rental_days = max(1, (dropoff_dt - pickup_dt).days)

    # Fetch daily rates for all classes in one query
    from sqlalchemy import text as sqlt, Numeric
    rate_rows = await session.execute(sqlt("""
        SELECT rsi.vehicle_class_id, MIN(rsi.price_per_day)
        FROM rate_schedule_items rsi
        JOIN rate_codes rc ON rc.rate_code_id = rsi.rate_code_id
        WHERE rsi.tenant_id = :tid
          AND rc.status = 'ACTIVE'
          AND :days >= rsi.days_min
          AND (rsi.days_max IS NULL OR :days <= rsi.days_max)
        GROUP BY rsi.vehicle_class_id
    """), {"tid": str(tenant_id), "days": rental_days})
    rates: dict[str, float] = {str(r[0]): float(r[1]) for r in rate_rows.all()}

    results = []
    for cls in classes:
        if not getattr(cls, "is_active", True):
            continue

        available_count = 0
        try:
            query = AvailabilityQuery(
                location_id=resolved_location_id,
                vehicle_class_id=str(cls.class_id),
                pickup_dt=pickup_dt,
                dropoff_dt=dropoff_dt,
            )
            avail = await _svc.get_availability(session, tenant_id, query)
            available_count = avail.available_count
        except Exception:
            pass

        results.append({
            "classId":        str(cls.class_id),
            "classCode":      _derive_class_code(cls.name, cls.sipp_prefix),
            "className":      cls.name,
            "description":    cls.description or f"A {cls.name.lower()} vehicle.",
            "features":       _default_features(cls.name),
            "imageUrl":       None,
            "availableCount": available_count,
            "baseDailyRate":  rates.get(str(cls.class_id), 0.0),
            "currencyCode":   "USD",
        })

    return {"classes": results, "resolved_location_id": resolved_location_id}


# ── Availability ──────────────────────────────────────────────────────────────


@router.get(
    "/availability",
    response_model=AvailabilityResponse,
    summary="Check vehicle availability for a class/location/period",
)
async def get_availability(
    location_id: str = Query(...),
    vehicle_class_id: str = Query(...),
    pickup_dt: datetime = Query(...),
    dropoff_dt: datetime = Query(...),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> AvailabilityResponse:
    """
    Primary: Redis cache (60s TTL).
    Fallback: DB query counting AVAILABLE vehicles with no overlapping blocks.
    Manager roles additionally receive the vehicle list.
    """
    query = AvailabilityQuery(
        location_id=location_id,
        vehicle_class_id=vehicle_class_id,
        pickup_dt=pickup_dt,
        dropoff_dt=dropoff_dt,
    )
    include_vehicle_list = _is_manager(claims)
    return await _svc.get_availability(
        session, claims.tenant_id, query, include_vehicle_list=include_vehicle_list
    )


# ── Blocks ────────────────────────────────────────────────────────────────────


@router.post(
    "/blocks",
    response_model=VehicleBlockResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a vehicle block",
)
async def create_block(
    body: VehicleBlockCreate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicle_blocks", "create")),
) -> VehicleBlockResponse:
    """
    Creates a VehicleBlock.
    Returns HTTP 409 if the vehicle is already blocked during the requested period
    (DB exclusion constraint violation).
    """
    block = await _svc.create_block(
        session,
        claims.tenant_id,
        body,
        created_by=str(claims.user_id),
    )
    return VehicleBlockResponse.model_validate(block)


@router.patch(
    "/blocks/{block_id}",
    response_model=VehicleBlockResponse,
    summary="Update a vehicle block (dates / notes)",
)
async def update_block(
    block_id: str,
    body: VehicleBlockUpdate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicle_blocks", "create")),
) -> VehicleBlockResponse:
    from sqlalchemy import text as _t
    from datetime import timezone as _tz

    row = await session.execute(
        _t("SELECT * FROM vehicle_blocks WHERE block_id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid) AND deleted_at IS NULL"),
        {"id": block_id, "tid": str(claims.tenant_id)},
    )
    block = row.mappings().first()
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")

    updates: dict = {}
    if body.start_time is not None:
        updates["start_time"] = body.start_time
    if body.end_time is not None:
        updates["end_time"] = body.end_time
    if body.notes is not None:
        updates["notes"] = body.notes

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = block_id
    updates["tid"] = str(claims.tenant_id)
    result = await session.execute(
        _t(f"UPDATE vehicle_blocks SET {set_clause}, updated_at = now() WHERE block_id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid) RETURNING *"),
        updates,
    )
    await session.commit()
    updated = result.mappings().first()
    row = {k: str(v) if hasattr(v, 'hex') else v for k, v in updated.items()}
    return VehicleBlockResponse.model_validate(row)


@router.delete(
    "/blocks/{block_id}",
    status_code=status.HTTP_204_NO_CONTENT, response_model=None,
    summary="Soft-delete a vehicle block",
)
async def delete_block(
    block_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicle_blocks", "create")),
) -> None:
    await _svc.soft_delete_block(
        session, claims.tenant_id, block_id, actor_id=str(claims.user_id)
    )


@router.post("/blocks/{block_id}/reallocate", status_code=200)
async def reallocate_block(
    block_id: uuid.UUID,
    body: ReallocateBlockRequest,
    claims: UserClaims = Depends(require_permission("vehicle_blocks", "create")),
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import text
    import uuid as uuid_mod

    result = await session.execute(
        text("SELECT * FROM vehicle_blocks WHERE block_id = :bid AND tenant_id = :tid AND deleted_at IS NULL"),
        {"bid": str(block_id), "tid": str(claims.tenant_id)},
    )
    block = result.mappings().first()
    if not block:
        raise HTTPException(status_code=404, detail="BLOCK_NOT_FOUND")
    if block["block_type"] != "RESERVATION":
        raise HTTPException(status_code=422, detail="NON_RESERVATION_BLOCK")

    cls_result = await session.execute(
        text("""
            SELECT v1.vehicle_class_id::text AS src_class, v2.vehicle_class_id::text AS tgt_class
            FROM vehicles v1
            JOIN vehicles v2 ON v2.vehicle_id = :tgt AND v2.tenant_id = :tid
            WHERE v1.vehicle_id = :src AND v1.tenant_id = :tid
        """),
        {"src": str(block["vehicle_id"]), "tgt": str(body.target_vehicle_id), "tid": str(claims.tenant_id)},
    )
    cls_row = cls_result.mappings().first()
    if not cls_row or cls_row["src_class"] != cls_row["tgt_class"]:
        raise HTTPException(status_code=422, detail="DIFFERENT_VEHICLE_CLASS")

    new_block_id = uuid_mod.uuid4()
    try:
        await session.execute(
            text("""
                INSERT INTO vehicle_blocks
                  (block_id, tenant_id, vehicle_id, location_id, block_type, label,
                   start_time, end_time, reservation_id, created_by)
                VALUES
                  (:bid, :tid, :vid, :lid, :btype, :label, :start_t, :end_t, :rid, :created_by)
            """),
            {
                "bid": str(new_block_id), "tid": str(claims.tenant_id),
                "vid": str(body.target_vehicle_id),
                "lid": str(block["location_id"]) if block["location_id"] else None,
                "btype": block["block_type"], "label": block["label"],
                "start_t": block["start_time"], "end_t": block["end_time"],
                "rid": str(block["reservation_id"]) if block["reservation_id"] else None,
                "created_by": str(claims.user_id),
            },
        )
    except Exception as exc:
        if "23P01" in str(exc) or "exclusion" in str(exc).lower():
            raise HTTPException(status_code=409, detail="TARGET_VEHICLE_NOT_AVAILABLE")
        raise

    await session.execute(
        text("UPDATE vehicle_blocks SET deleted_at = NOW() WHERE block_id = :bid"),
        {"bid": str(block_id)},
    )
    if block["reservation_id"]:
        await session.execute(
            text("UPDATE reservations SET vehicle_id = :vid WHERE reservation_id = :rid"),
            {"vid": str(body.target_vehicle_id), "rid": str(block["reservation_id"])},
        )
    await session.commit()

    if body.notify_customer and block["reservation_id"]:
        try:
            from app.worker.celery_app import celery_app
            celery_app.send_task(
                "app.worker.tasks.notifications.dispatch_notification",
                kwargs={"tenant_id": str(claims.tenant_id), "event_code": "VEHICLE_SWAP_NOTIFICATION",
                        "recipient_id": "", "context": {"reservation_id": str(block["reservation_id"]),
                        "new_vehicle_id": str(body.target_vehicle_id)}},
                queue="notifications",
            )
        except Exception:
            pass

    return {"new_block_id": str(new_block_id), "from_vehicle_id": str(block["vehicle_id"]),
            "to_vehicle_id": str(body.target_vehicle_id), "status": "REALLOCATED"}


# ── Fleet calendar ────────────────────────────────────────────────────────────


class CalendarEvent(BaseModel):
    event_id: str
    event_type: str   # RESERVATION | BLOCK
    block_type: str
    start_dt: datetime
    end_dt: datetime
    label: str
    sub_label: Optional[str] = None


class CalendarVehicle(BaseModel):
    vehicle_id: str
    make: str
    model: str
    model_year: int
    plate_number: Optional[str] = None
    vin: Optional[str] = None
    status: str
    class_name: str
    vehicle_class_id: Optional[str] = None
    home_location_id: str
    location_name: str
    location_short_code: str
    events: list[CalendarEvent]


class CalendarResponse(BaseModel):
    from_date: str
    to_date: str
    vehicles: list[CalendarVehicle]


@router.get(
    "/calendar",
    response_model=CalendarResponse,
    summary="Fleet calendar — vehicles with reservation and block events for a date range",
)
async def get_fleet_calendar(
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD"),
    location_id: Optional[str] = Query(default=None, description="Filter by home location UUID"),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
) -> CalendarResponse:
    from sqlalchemy import text as sqlt

    tid = str(claims.tenant_id)
    try:
        from_dt = datetime.fromisoformat(f"{from_date}T00:00:00+00:00")
        to_dt   = datetime.fromisoformat(f"{to_date}T23:59:59+00:00")
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail=f"Invalid date format: {exc}") from exc

    # Build location filter clause separately to avoid asyncpg's ambiguous NULL param type.
    # asyncpg cannot infer the type of a parameter used only in IS NULL / = comparisons.
    loc_filter_v  = "AND CAST(v.home_location_id AS text) = :loc_id"  if location_id else ""
    loc_filter_v2 = "AND CAST(v2.home_location_id AS text) = :loc_id" if location_id else ""

    # 1. Vehicles (with class + location names)
    # Note: use CAST(:param AS uuid) — asyncpg/SQLAlchemy text() treats ::uuid in ":p::uuid" as part of param name.
    v_params: dict = {"tid": tid}
    if location_id:
        v_params["loc_id"] = location_id
    vehicle_rows = await session.execute(sqlt(f"""
        SELECT
            CAST(v.vehicle_id AS text),
            v.make, v.model, v.model_year,
            NULLIF(TRIM(COALESCE(v.plate_number, '')), '') AS plate_number,
            NULLIF(TRIM(COALESCE(v.vin, '')), '')          AS vin,
            CAST(v.status AS text) AS status,
            CAST(v.home_location_id AS text),
            CAST(v.vehicle_class_id AS text) AS vehicle_class_id,
            COALESCE(vc.name, 'Unknown')     AS class_name,
            COALESCE(l.name, 'Unknown')      AS location_name,
            COALESCE(l.short_code, '')       AS location_short_code
        FROM vehicles v
        LEFT JOIN vehicle_classes vc
            ON vc.class_id = v.vehicle_class_id
           AND (vc.tenant_id IS NULL OR vc.tenant_id = CAST(:tid AS uuid))
        LEFT JOIN locations l
            ON l.location_id = v.home_location_id
        WHERE v.tenant_id = CAST(:tid AS uuid)
          AND v.deleted_at IS NULL
          AND CAST(v.status AS text) != 'RETIRED'
          {loc_filter_v}
        ORDER BY l.name NULLS LAST, v.make, v.model, v.model_year,
                 v.plate_number NULLS LAST, v.vin NULLS LAST
    """), v_params)
    vehicles = [dict(r._mapping) for r in vehicle_rows.all()]

    if not vehicles:
        return CalendarResponse(from_date=from_date, to_date=to_date, vehicles=[])

    # 2. Events — vehicle_blocks for those vehicles in the date window
    ev_params: dict = {"tid": tid, "from_dt": from_dt, "to_dt": to_dt}
    if location_id:
        ev_params["loc_id"] = location_id
    event_rows = await session.execute(sqlt(f"""
        SELECT
            CAST(vb.block_id AS text)      AS event_id,
            CAST(vb.vehicle_id AS text)    AS vehicle_id,
            CAST(vb.block_type AS text)    AS block_type,
            vb.start_time,
            vb.end_time,
            vb.notes,
            r.confirmation_number,
            COALESCE(c.first_name || ' ' || c.last_name, 'Guest') AS customer_name
        FROM vehicle_blocks vb
        LEFT JOIN reservations r
            ON r.reservation_id = vb.reservation_id
           AND r.deleted_at IS NULL
        LEFT JOIN customers c
            ON c.customer_id = r.customer_id
        WHERE vb.tenant_id = CAST(:tid AS uuid)
          AND vb.deleted_at IS NULL
          AND vb.start_time < :to_dt
          AND vb.end_time   > :from_dt
          AND vb.vehicle_id IN (
              SELECT v2.vehicle_id FROM vehicles v2
              WHERE v2.tenant_id = CAST(:tid AS uuid)
                AND v2.deleted_at IS NULL
                AND CAST(v2.status AS text) != 'RETIRED'
                {loc_filter_v2}
          )
        ORDER BY vb.vehicle_id, vb.start_time
    """), ev_params)

    events_by_vehicle: dict[str, list[CalendarEvent]] = {}
    for row in event_rows.all():
        vid = row.vehicle_id
        bt  = row.block_type
        if bt == "RESERVATION":
            label     = row.confirmation_number or "Reserved"
            sub_label = row.customer_name if row.confirmation_number else row.notes
        else:
            label     = bt.replace("_", " ").title()
            sub_label = row.notes or None

        events_by_vehicle.setdefault(vid, []).append(
            CalendarEvent(
                event_id   = row.event_id,
                event_type = "RESERVATION" if bt == "RESERVATION" else "BLOCK",
                block_type = bt,
                start_dt   = row.start_time,
                end_dt     = row.end_time,
                label      = label,
                sub_label  = sub_label,
            )
        )

    # 3. Merge
    result: list[CalendarVehicle] = []
    for v in vehicles:
        vid = v["vehicle_id"]
        result.append(CalendarVehicle(
            vehicle_id          = vid,
            make                = v["make"],
            model               = v["model"],
            model_year          = int(v["model_year"]),
            plate_number        = v["plate_number"] or None,
            vin                 = v["vin"] or None,
            status              = v["status"],
            class_name          = v["class_name"],
            vehicle_class_id    = v.get("vehicle_class_id") or None,
            home_location_id    = v["home_location_id"],
            location_name       = v["location_name"],
            location_short_code = v["location_short_code"],
            events              = events_by_vehicle.get(vid, []),
        ))

    return CalendarResponse(from_date=from_date, to_date=to_date, vehicles=result)


# ── WebSocket token ───────────────────────────────────────────────────────────


@router.post(
    "/ws-token",
    summary="Obtain a one-time WebSocket token (60s TTL)",
    status_code=status.HTTP_200_OK,
)
async def get_ws_token(
    claims: UserClaims = Depends(get_current_user),
) -> dict:
    """
    Issues a short-lived one-time token for the /ws/fleet/{location_id} WebSocket.
    The counter app fetches this before opening the WS connection.
    """
    token = str(uuid.uuid4())
    redis = get_session_redis()
    key = WS_TOKEN_KEY.format(token=token)
    await redis.set(key, str(claims.user_id), ex=60)
    return {"ws_token": token, "expires_in_seconds": 60}


# ── WebSocket endpoint ────────────────────────────────────────────────────────


@router.websocket("/ws/fleet/{location_id}")
async def fleet_websocket(
    location_id: str,
    websocket: WebSocket,
    claims: UserClaims = Depends(verify_ws_token),
) -> None:
    """
    Real-time availability broadcast for a location.
    Authenticated via one-time token from POST /fleet/ws-token.
    """
    from app.core.redis import FLEET_CHANNEL, get_avail_redis

    await websocket.accept()
    redis = get_avail_redis()
    pubsub = redis.pubsub()
    channel = FLEET_CHANNEL.format(
        tenant_id=str(claims.tenant_id), location_id=location_id
    )
    await pubsub.subscribe(channel)

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
