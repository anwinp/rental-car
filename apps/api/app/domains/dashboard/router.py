"""Dashboard domain — manager, staff, and back-office summary endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text as sqlt
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import UserClaims, require_permission

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _day_bounds(d: datetime) -> tuple[datetime, datetime]:
    """Return (start_of_day, end_of_day) in UTC for a given datetime."""
    s = d.replace(hour=0, minute=0, second=0, microsecond=0)
    e = d.replace(hour=23, minute=59, second=59, microsecond=999999)
    return s, e


# ── Pydantic models ───────────────────────────────────────────────────────────

class ManagerKPI(BaseModel):
    active_rentals:      int
    pickups_today:       int
    returns_today:       int
    overdue_returns:     int
    confirmed_this_week: int
    fleet_total:         int
    fleet_available:     int
    fleet_on_rent:       int
    fleet_in_maint:      int
    revenue_today:       float
    revenue_this_month:  float

class ForecastDay(BaseModel):
    date:    str
    pickups: int
    returns: int

class PickupRow(BaseModel):
    confirmation_number:  str
    customer_name:        str
    vehicle_class:        str
    vehicle:              Optional[str] = None
    pickup_time:          str
    dropoff_location:     str
    channel:              str

class ReturnRow(BaseModel):
    confirmation_number: str
    customer_name:       str
    vehicle:             Optional[str] = None
    return_time:         str
    is_overdue:          bool
    days_overdue:        int

class ManagerDashboard(BaseModel):
    kpi:      ManagerKPI
    forecast: list[ForecastDay]
    pickups:  list[PickupRow]
    returns:  list[ReturnRow]


class StaffPickup(BaseModel):
    confirmation_number:  str
    customer_name:        str
    vehicle_class:        str
    vehicle:              Optional[str] = None
    plate:                Optional[str] = None
    pickup_time:          str
    special_instructions: Optional[str] = None
    flight_number:        Optional[str] = None
    channel:              str

class StaffReturn(BaseModel):
    confirmation_number: str
    customer_name:       str
    vehicle:             Optional[str] = None
    plate:               Optional[str] = None
    return_time:         str
    is_overdue:          bool
    days_overdue:        int

class ServiceDueVehicle(BaseModel):
    block_id:   str
    vehicle_id: str
    make:       str
    model:      str
    model_year: int
    plate:      Optional[str] = None
    location:   str
    block_type: str
    start_time: str
    end_time:   str
    notes:      Optional[str] = None
    is_overdue: bool

class UpcomingPickup(BaseModel):
    confirmation_number: str
    customer_name:       str
    vehicle_class:       str
    pickup_time:         str

class StaffDashboard(BaseModel):
    pickups_today: list[StaffPickup]
    returns_today: list[StaffReturn]
    service_due:   list[ServiceDueVehicle]
    upcoming_week: list[UpcomingPickup]


class MaintenanceBlock(BaseModel):
    block_id:   str
    vehicle_id: str
    make:       str
    model:      str
    model_year: int
    plate:      Optional[str] = None
    location:   str
    block_type: str
    start_time: str
    end_time:   str
    notes:      Optional[str] = None
    status:     str  # upcoming | active | overdue

class DamageClaim(BaseModel):
    claim_id:        str
    claim_reference: str
    vehicle_id:      str
    make:            str
    model:           str
    damage_zone:     Optional[str] = None
    damage_type:     Optional[str] = None
    severity:        str
    description:     Optional[str] = None
    claim_status:    str
    discovered_at:   str

class BlockedVehicle(BaseModel):
    block_id:   str
    vehicle_id: str
    make:       str
    model:      str
    plate:      Optional[str] = None
    location:   str
    block_type: str
    reason:     Optional[str] = None
    since:      str
    until:      str

class NoteEntry(BaseModel):
    block_id:   str
    vehicle:    str
    location:   str
    block_type: str
    notes:      str
    created_at: str

class BackOfficeDashboard(BaseModel):
    maintenance:      list[MaintenanceBlock]
    damage_claims:    list[DamageClaim]
    blocked_vehicles: list[BlockedVehicle]
    notes_feed:       list[NoteEntry]


class TaskCard(BaseModel):
    task_id:    str
    category:   str
    title:      str
    subtitle:   Optional[str] = None
    location:   str
    vehicle_id: str
    status:     str  # todo | in_progress | done
    priority:   str  # high | medium | low
    start_time: str
    end_time:   str
    plate:      Optional[str] = None

class TaskBoard(BaseModel):
    todo:        list[TaskCard]
    in_progress: list[TaskCard]
    done:        list[TaskCard]


# ── Manager dashboard ─────────────────────────────────────────────────────────

@router.get("/manager", response_model=ManagerDashboard)
async def get_manager_dashboard(
    session: AsyncSession = Depends(get_session),
    claims:  UserClaims   = Depends(require_permission("reservations", "read")),
) -> ManagerDashboard:
    tid = str(claims.tenant_id)
    now = _now()
    today_s, today_e = _day_bounds(now)
    week_end    = now + timedelta(days=7)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    kpi_row = await session.execute(sqlt("""
        SELECT
          (SELECT COUNT(*) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text)='CHECKED_OUT') AS active_rentals,

          (SELECT COUNT(*) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text) IN ('CONFIRMED','MODIFIED')
           AND pickup_datetime BETWEEN :ts AND :te) AS pickups_today,

          (SELECT COUNT(*) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text)='CHECKED_OUT'
           AND return_datetime BETWEEN :ts AND :te) AS returns_today,

          (SELECT COUNT(*) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text)='CHECKED_OUT'
           AND return_datetime < :now) AS overdue_returns,

          (SELECT COUNT(*) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text) IN ('CONFIRMED','MODIFIED')
           AND pickup_datetime BETWEEN :now AND :we) AS confirmed_this_week,

          (SELECT COUNT(*) FROM vehicles WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text)!='RETIRED') AS fleet_total,

          (SELECT COUNT(*) FROM vehicles WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text)='AVAILABLE') AS fleet_available,

          (SELECT COUNT(*) FROM vehicles WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text)='ON_RENT') AS fleet_on_rent,

          (SELECT COUNT(*) FROM vehicles WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text) IN ('MAINTENANCE','IN_SERVICE')) AS fleet_in_maint,

          COALESCE((SELECT SUM(grand_total) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL
           AND pickup_datetime BETWEEN :ts AND :te), 0) AS revenue_today,

          COALESCE((SELECT SUM(grand_total) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
           AND deleted_at IS NULL AND CAST(status AS text) NOT IN ('CANCELLED','QUOTE')
           AND pickup_datetime >= :ms), 0) AS revenue_this_month
    """), {"tid": tid, "ts": today_s, "te": today_e, "now": now,
           "we": week_end, "ms": month_start})

    r = kpi_row.mappings().one()
    kpi = ManagerKPI(
        active_rentals      = int(r["active_rentals"]),
        pickups_today       = int(r["pickups_today"]),
        returns_today       = int(r["returns_today"]),
        overdue_returns     = int(r["overdue_returns"]),
        confirmed_this_week = int(r["confirmed_this_week"]),
        fleet_total         = int(r["fleet_total"]),
        fleet_available     = int(r["fleet_available"]),
        fleet_on_rent       = int(r["fleet_on_rent"]),
        fleet_in_maint      = int(r["fleet_in_maint"]),
        revenue_today       = float(r["revenue_today"]),
        revenue_this_month  = float(r["revenue_this_month"]),
    )

    # 7-day forecast
    forecast: list[ForecastDay] = []
    for i in range(7):
        day = now + timedelta(days=i)
        ds, de = _day_bounds(day)
        frow = await session.execute(sqlt("""
            SELECT
              (SELECT COUNT(*) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
               AND deleted_at IS NULL AND CAST(status AS text) IN ('CONFIRMED','MODIFIED','CHECKED_OUT')
               AND pickup_datetime BETWEEN :ds AND :de) AS pickups,
              (SELECT COUNT(*) FROM reservations WHERE tenant_id=CAST(:tid AS uuid)
               AND deleted_at IS NULL AND CAST(status AS text) IN ('CHECKED_OUT','RETURNED')
               AND return_datetime BETWEEN :ds AND :de) AS returns
        """), {"tid": tid, "ds": ds, "de": de})
        fr = frow.mappings().one()
        forecast.append(ForecastDay(
            date    = day.strftime("%Y-%m-%d"),
            pickups = int(fr["pickups"]),
            returns = int(fr["returns"]),
        ))

    # Today's pickups
    pick_rows = await session.execute(sqlt("""
        SELECT r.confirmation_number,
               COALESCE(c.first_name||' '||c.last_name,'Guest') AS customer_name,
               COALESCE(vc.name,'Unknown') AS vehicle_class,
               CASE WHEN v.vehicle_id IS NOT NULL THEN v.make||' '||v.model ELSE NULL END AS vehicle,
               r.pickup_datetime,
               COALESCE(dl.short_code, pl.short_code,'') AS dropoff_location,
               r.channel
        FROM reservations r
        LEFT JOIN customers c ON c.customer_id=r.customer_id
        LEFT JOIN vehicle_classes vc ON vc.class_id=r.vehicle_class_id
        LEFT JOIN vehicles v ON v.vehicle_id=r.assigned_vehicle_id
        LEFT JOIN locations pl ON pl.location_id=r.pickup_location_id
        LEFT JOIN locations dl ON dl.location_id=r.dropoff_location_id
        WHERE r.tenant_id=CAST(:tid AS uuid) AND r.deleted_at IS NULL
          AND CAST(r.status AS text) IN ('CONFIRMED','MODIFIED')
          AND r.pickup_datetime BETWEEN :ts AND :te
        ORDER BY r.pickup_datetime
    """), {"tid": tid, "ts": today_s, "te": today_e})
    pickups = [
        PickupRow(
            confirmation_number = row.confirmation_number,
            customer_name       = row.customer_name,
            vehicle_class       = row.vehicle_class,
            vehicle             = row.vehicle,
            pickup_time         = row.pickup_datetime.isoformat(),
            dropoff_location    = row.dropoff_location,
            channel             = row.channel,
        )
        for row in pick_rows.all()
    ]

    # Today's returns + overdue
    ret_rows = await session.execute(sqlt("""
        SELECT r.confirmation_number,
               COALESCE(c.first_name||' '||c.last_name,'Guest') AS customer_name,
               CASE WHEN v.vehicle_id IS NOT NULL THEN v.make||' '||v.model ELSE NULL END AS vehicle,
               r.return_datetime,
               r.return_datetime < :now AS is_overdue
        FROM reservations r
        LEFT JOIN customers c ON c.customer_id=r.customer_id
        LEFT JOIN vehicles v ON v.vehicle_id=r.assigned_vehicle_id
        WHERE r.tenant_id=CAST(:tid AS uuid) AND r.deleted_at IS NULL
          AND CAST(r.status AS text)='CHECKED_OUT'
          AND (r.return_datetime BETWEEN :ts AND :te OR r.return_datetime < :now)
        ORDER BY r.return_datetime
    """), {"tid": tid, "ts": today_s, "te": today_e, "now": now})

    returns = []
    for row in ret_rows.all():
        is_overdue = bool(row.is_overdue)
        days_over  = 0
        if is_overdue:
            rt = row.return_datetime
            if rt.tzinfo is None:
                rt = rt.replace(tzinfo=timezone.utc)
            days_over = max(0, (now - rt).days)
        returns.append(ReturnRow(
            confirmation_number = row.confirmation_number,
            customer_name       = row.customer_name,
            vehicle             = row.vehicle,
            return_time         = row.return_datetime.isoformat(),
            is_overdue          = is_overdue,
            days_overdue        = days_over,
        ))

    return ManagerDashboard(kpi=kpi, forecast=forecast, pickups=pickups, returns=returns)


# ── Staff dashboard ───────────────────────────────────────────────────────────

@router.get("/staff", response_model=StaffDashboard)
async def get_staff_dashboard(
    session: AsyncSession = Depends(get_session),
    claims:  UserClaims   = Depends(require_permission("reservations", "read")),
) -> StaffDashboard:
    tid = str(claims.tenant_id)
    now = _now()
    today_s, today_e = _day_bounds(now)
    week_end   = now + timedelta(days=7)
    svc_window = now + timedelta(hours=48)

    pick_rows = await session.execute(sqlt("""
        SELECT r.confirmation_number,
               COALESCE(c.first_name||' '||c.last_name,'Guest') AS customer_name,
               COALESCE(vc.name,'Unknown') AS vehicle_class,
               CASE WHEN v.vehicle_id IS NOT NULL THEN v.make||' '||v.model ELSE NULL END AS vehicle,
               NULLIF(TRIM(COALESCE(v.plate_number,'')),'') AS plate,
               r.pickup_datetime, r.special_instructions, r.flight_number, r.channel
        FROM reservations r
        LEFT JOIN customers c ON c.customer_id=r.customer_id
        LEFT JOIN vehicle_classes vc ON vc.class_id=r.vehicle_class_id
        LEFT JOIN vehicles v ON v.vehicle_id=r.assigned_vehicle_id
        WHERE r.tenant_id=CAST(:tid AS uuid) AND r.deleted_at IS NULL
          AND CAST(r.status AS text) IN ('CONFIRMED','MODIFIED')
          AND r.pickup_datetime BETWEEN :ts AND :te
        ORDER BY r.pickup_datetime
    """), {"tid": tid, "ts": today_s, "te": today_e})
    pickups_today = [
        StaffPickup(
            confirmation_number  = row.confirmation_number,
            customer_name        = row.customer_name,
            vehicle_class        = row.vehicle_class,
            vehicle              = row.vehicle,
            plate                = row.plate,
            pickup_time          = row.pickup_datetime.isoformat(),
            special_instructions = row.special_instructions,
            flight_number        = row.flight_number,
            channel              = row.channel,
        )
        for row in pick_rows.all()
    ]

    ret_rows = await session.execute(sqlt("""
        SELECT r.confirmation_number,
               COALESCE(c.first_name||' '||c.last_name,'Guest') AS customer_name,
               CASE WHEN v.vehicle_id IS NOT NULL THEN v.make||' '||v.model ELSE NULL END AS vehicle,
               NULLIF(TRIM(COALESCE(v.plate_number,'')),'') AS plate,
               r.return_datetime,
               r.return_datetime < :now AS is_overdue
        FROM reservations r
        LEFT JOIN customers c ON c.customer_id=r.customer_id
        LEFT JOIN vehicles v ON v.vehicle_id=r.assigned_vehicle_id
        WHERE r.tenant_id=CAST(:tid AS uuid) AND r.deleted_at IS NULL
          AND CAST(r.status AS text)='CHECKED_OUT'
          AND (r.return_datetime BETWEEN :ts AND :te OR r.return_datetime < :now)
        ORDER BY (r.return_datetime < :now) DESC NULLS LAST, r.return_datetime
    """), {"tid": tid, "ts": today_s, "te": today_e, "now": now})
    returns_today = []
    for row in ret_rows.all():
        is_overdue = bool(row.is_overdue)
        days_over  = 0
        if is_overdue:
            rt = row.return_datetime
            if rt.tzinfo is None:
                rt = rt.replace(tzinfo=timezone.utc)
            days_over = max(0, (now - rt).days)
        returns_today.append(StaffReturn(
            confirmation_number = row.confirmation_number,
            customer_name       = row.customer_name,
            vehicle             = row.vehicle,
            plate               = row.plate,
            return_time         = row.return_datetime.isoformat(),
            is_overdue          = is_overdue,
            days_overdue        = days_over,
        ))

    svc_rows = await session.execute(sqlt("""
        SELECT CAST(vb.block_id AS text) AS block_id,
               CAST(v.vehicle_id AS text) AS vehicle_id,
               v.make, v.model, v.model_year,
               NULLIF(TRIM(COALESCE(v.plate_number,'')),'') AS plate,
               COALESCE(l.short_code,'') AS location,
               CAST(vb.block_type AS text) AS block_type,
               vb.start_time, vb.end_time, vb.notes,
               vb.start_time < :now AS is_overdue
        FROM vehicle_blocks vb
        JOIN vehicles v ON v.vehicle_id=vb.vehicle_id
        LEFT JOIN locations l ON l.location_id=v.home_location_id
        WHERE vb.tenant_id=CAST(:tid AS uuid) AND vb.deleted_at IS NULL
          AND CAST(vb.block_type AS text) IN ('MAINTENANCE','INSPECTION','RECALL_HOLD')
          AND vb.start_time <= :svc_win AND vb.end_time > :now
        ORDER BY vb.start_time
    """), {"tid": tid, "now": now, "svc_win": svc_window})
    service_due = [
        ServiceDueVehicle(
            block_id   = row.block_id,
            vehicle_id = row.vehicle_id,
            make       = row.make,
            model      = row.model,
            model_year = int(row.model_year),
            plate      = row.plate,
            location   = row.location,
            block_type = row.block_type,
            start_time = row.start_time.isoformat(),
            end_time   = row.end_time.isoformat(),
            notes      = row.notes,
            is_overdue = bool(row.is_overdue),
        )
        for row in svc_rows.all()
    ]

    up_rows = await session.execute(sqlt("""
        SELECT r.confirmation_number,
               COALESCE(c.first_name||' '||c.last_name,'Guest') AS customer_name,
               COALESCE(vc.name,'Unknown') AS vehicle_class,
               r.pickup_datetime
        FROM reservations r
        LEFT JOIN customers c ON c.customer_id=r.customer_id
        LEFT JOIN vehicle_classes vc ON vc.class_id=r.vehicle_class_id
        WHERE r.tenant_id=CAST(:tid AS uuid) AND r.deleted_at IS NULL
          AND CAST(r.status AS text) IN ('CONFIRMED','MODIFIED')
          AND r.pickup_datetime > :te AND r.pickup_datetime <= :we
        ORDER BY r.pickup_datetime LIMIT 20
    """), {"tid": tid, "te": today_e, "we": week_end})
    upcoming_week = [
        UpcomingPickup(
            confirmation_number = row.confirmation_number,
            customer_name       = row.customer_name,
            vehicle_class       = row.vehicle_class,
            pickup_time         = row.pickup_datetime.isoformat(),
        )
        for row in up_rows.all()
    ]

    return StaffDashboard(
        pickups_today  = pickups_today,
        returns_today  = returns_today,
        service_due    = service_due,
        upcoming_week  = upcoming_week,
    )


# ── Back-office dashboard ─────────────────────────────────────────────────────

@router.get("/back-office", response_model=BackOfficeDashboard)
async def get_back_office_dashboard(
    session: AsyncSession = Depends(get_session),
    claims:  UserClaims   = Depends(require_permission("vehicles", "read")),
) -> BackOfficeDashboard:
    tid = str(claims.tenant_id)
    now = _now()
    win_start = now - timedelta(days=3)
    win_end   = now + timedelta(days=14)

    maint_rows = await session.execute(sqlt("""
        SELECT CAST(vb.block_id AS text) AS block_id,
               CAST(v.vehicle_id AS text) AS vehicle_id,
               v.make, v.model, v.model_year,
               NULLIF(TRIM(COALESCE(v.plate_number,'')),'') AS plate,
               COALESCE(l.short_code,'') AS location,
               CAST(vb.block_type AS text) AS block_type,
               vb.start_time, vb.end_time, vb.notes,
               CASE WHEN vb.end_time < :now THEN 'overdue'
                    WHEN vb.start_time <= :now THEN 'active'
                    ELSE 'upcoming' END AS status
        FROM vehicle_blocks vb
        JOIN vehicles v ON v.vehicle_id=vb.vehicle_id
        LEFT JOIN locations l ON l.location_id=v.home_location_id
        WHERE vb.tenant_id=CAST(:tid AS uuid) AND vb.deleted_at IS NULL
          AND CAST(vb.block_type AS text) IN ('MAINTENANCE','INSPECTION','RECALL_HOLD','IN_TRANSIT','CHARGING')
          AND vb.start_time <= :win_end AND vb.end_time >= :win_start
        ORDER BY vb.start_time
    """), {"tid": tid, "now": now, "win_start": win_start, "win_end": win_end})
    maintenance = [
        MaintenanceBlock(
            block_id   = row.block_id,
            vehicle_id = row.vehicle_id,
            make       = row.make,
            model      = row.model,
            model_year = int(row.model_year),
            plate      = row.plate,
            location   = row.location,
            block_type = row.block_type,
            start_time = row.start_time.isoformat(),
            end_time   = row.end_time.isoformat(),
            notes      = row.notes,
            status     = row.status,
        )
        for row in maint_rows.all()
    ]

    dmg_rows = await session.execute(sqlt("""
        SELECT CAST(dc.claim_id AS text) AS claim_id,
               dc.claim_reference, CAST(dc.vehicle_id AS text) AS vehicle_id,
               v.make, v.model, dc.damage_zone, dc.damage_type,
               CAST(dc.severity AS text) AS severity,
               dc.damage_description, CAST(dc.status AS text) AS claim_status,
               dc.discovered_at
        FROM damage_claims dc
        JOIN vehicles v ON v.vehicle_id=dc.vehicle_id
        WHERE dc.tenant_id=CAST(:tid AS uuid)
        ORDER BY dc.discovered_at DESC LIMIT 50
    """), {"tid": tid})
    damage_claims = [
        DamageClaim(
            claim_id        = row.claim_id,
            claim_reference = row.claim_reference,
            vehicle_id      = row.vehicle_id,
            make            = row.make,
            model           = row.model,
            damage_zone     = row.damage_zone,
            damage_type     = row.damage_type,
            severity        = row.severity,
            description     = row.damage_description,
            claim_status    = row.claim_status,
            discovered_at   = row.discovered_at.isoformat(),
        )
        for row in dmg_rows.all()
    ]

    blk_rows = await session.execute(sqlt("""
        SELECT CAST(vb.block_id AS text) AS block_id,
               CAST(v.vehicle_id AS text) AS vehicle_id,
               v.make, v.model,
               NULLIF(TRIM(COALESCE(v.plate_number,'')),'') AS plate,
               COALESCE(l.short_code,'') AS location,
               CAST(vb.block_type AS text) AS block_type,
               vb.notes, vb.start_time, vb.end_time
        FROM vehicle_blocks vb
        JOIN vehicles v ON v.vehicle_id=vb.vehicle_id
        LEFT JOIN locations l ON l.location_id=v.home_location_id
        WHERE vb.tenant_id=CAST(:tid AS uuid) AND vb.deleted_at IS NULL
          AND CAST(vb.block_type AS text) IN ('HOLD','STAGING')
          AND vb.end_time > :now
        ORDER BY vb.start_time
    """), {"tid": tid, "now": now})
    blocked_vehicles = [
        BlockedVehicle(
            block_id   = row.block_id,
            vehicle_id = row.vehicle_id,
            make       = row.make,
            model      = row.model,
            plate      = row.plate,
            location   = row.location,
            block_type = row.block_type,
            reason     = row.notes,
            since      = row.start_time.isoformat(),
            until      = row.end_time.isoformat(),
        )
        for row in blk_rows.all()
    ]

    notes_rows = await session.execute(sqlt("""
        SELECT CAST(vb.block_id AS text) AS block_id,
               v.make||' '||v.model AS vehicle,
               COALESCE(l.short_code,'') AS location,
               CAST(vb.block_type AS text) AS block_type,
               vb.notes, vb.created_at
        FROM vehicle_blocks vb
        JOIN vehicles v ON v.vehicle_id=vb.vehicle_id
        LEFT JOIN locations l ON l.location_id=v.home_location_id
        WHERE vb.tenant_id=CAST(:tid AS uuid) AND vb.deleted_at IS NULL
          AND vb.notes IS NOT NULL AND TRIM(vb.notes)!=''
        ORDER BY vb.created_at DESC LIMIT 20
    """), {"tid": tid})
    notes_feed = [
        NoteEntry(
            block_id   = row.block_id,
            vehicle    = row.vehicle,
            location   = row.location,
            block_type = row.block_type,
            notes      = row.notes,
            created_at = row.created_at.isoformat(),
        )
        for row in notes_rows.all()
    ]

    return BackOfficeDashboard(
        maintenance      = maintenance,
        damage_claims    = damage_claims,
        blocked_vehicles = blocked_vehicles,
        notes_feed       = notes_feed,
    )


# ── Task board ────────────────────────────────────────────────────────────────

_PRIORITY: dict[str, str] = {
    "MAINTENANCE": "high",
    "RECALL_HOLD": "high",
    "INSPECTION":  "medium",
    "IN_TRANSIT":  "medium",
    "HOLD":        "medium",
    "STAGING":     "low",
    "CHARGING":    "low",
    "TURNAROUND":  "low",
}


@router.get("/tasks", response_model=TaskBoard)
async def get_task_board(
    session: AsyncSession = Depends(get_session),
    claims:  UserClaims   = Depends(require_permission("vehicles", "read")),
) -> TaskBoard:
    tid = str(claims.tenant_id)
    now = _now()
    win_start = now - timedelta(days=7)
    win_end   = now + timedelta(days=14)

    rows = await session.execute(sqlt("""
        SELECT CAST(vb.block_id AS text) AS task_id,
               CAST(vb.block_type AS text) AS category,
               v.make||' '||v.model AS title,
               vb.notes AS subtitle,
               COALESCE(l.short_code,'') AS location,
               CAST(v.vehicle_id AS text) AS vehicle_id,
               NULLIF(TRIM(COALESCE(v.plate_number,'')),'') AS plate,
               vb.start_time, vb.end_time
        FROM vehicle_blocks vb
        JOIN vehicles v ON v.vehicle_id=vb.vehicle_id
        LEFT JOIN locations l ON l.location_id=v.home_location_id
        WHERE vb.tenant_id=CAST(:tid AS uuid) AND vb.deleted_at IS NULL
          AND CAST(vb.block_type AS text) IN (
            'MAINTENANCE','INSPECTION','RECALL_HOLD','HOLD','STAGING',
            'IN_TRANSIT','CHARGING','TURNAROUND'
          )
          AND vb.start_time <= :win_end AND vb.end_time >= :win_start
        ORDER BY vb.start_time
    """), {"tid": tid, "win_start": win_start, "win_end": win_end})

    todo: list[TaskCard] = []
    in_progress: list[TaskCard] = []
    done: list[TaskCard] = []

    for row in rows.all():
        start = row.start_time
        end   = row.end_time
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)

        status = "done" if end <= now else ("in_progress" if start <= now else "todo")

        card = TaskCard(
            task_id    = row.task_id,
            category   = row.category,
            title      = row.title,
            subtitle   = row.subtitle,
            location   = row.location,
            vehicle_id = row.vehicle_id,
            status     = status,
            priority   = _PRIORITY.get(row.category, "low"),
            start_time = start.isoformat(),
            end_time   = end.isoformat(),
            plate      = row.plate,
        )
        {"todo": todo, "in_progress": in_progress, "done": done}[status].append(card)

    return TaskBoard(todo=todo, in_progress=in_progress, done=done)
