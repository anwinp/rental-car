"""The partner API — read access for integrations a workspace builds itself.

A separate, deliberately small surface rather than letting API keys in through
the staff routes. Those routes assume a UserClaims with roles, a location
scope and a permissions matrix; making them accept a machine as well would mean
auditing every one of them for what it assumes about the caller, and getting
that wrong once is a cross-tenant read.

Read-only to start. That covers the integrations people actually ask for —
"show our availability on our own website", "pull last night's rentals into the
finance system" — and keeps the damage from a leaked key to disclosure rather
than to somebody's fleet.

Every query carries an explicit tenant predicate AND runs with the tenant
bound by api_session, so RLS applies too. That is deliberate belt and braces:
this codebase has found real cross-tenant leaks in code that relied on one of
the two, and tenant_sql_lint.py fails the build on any query here that drops
the predicate. Being the newest surface is not a reason to hold it to a lower
standard than the rest.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.api_key_auth import ApiCaller, api_session, get_api_caller

router = APIRouter()

# A hard ceiling regardless of what is asked for. An unpaged partner endpoint
# is how one integration's retry loop becomes everybody's outage.
_MAX_LIMIT = 200


class KeyInfo(BaseModel):
    label: str
    tenant_id: uuid.UUID
    scopes: list[str]


class Vehicle(BaseModel):
    vehicle_id: uuid.UUID
    vin: str
    make: str
    model: str
    model_year: int | None = None
    status: str
    vehicle_class: str | None = None
    location: str | None = None


class Location(BaseModel):
    location_id: uuid.UUID
    name: str
    short_code: str
    city: str | None = None
    country_code: str | None = None


class Reservation(BaseModel):
    reservation_id: uuid.UUID
    confirmation_code: str | None = None
    status: str
    pickup_at: datetime | None = None
    dropoff_at: datetime | None = None
    vehicle_class: str | None = None
    total_amount: float | None = None
    currency: str | None = None


class ClassAvailability(BaseModel):
    vehicle_class: str
    sipp: str | None = None
    available: int


@router.get("/me", response_model=KeyInfo, summary="Which key is calling")
async def whoami(caller: ApiCaller = Depends(get_api_caller)) -> KeyInfo:
    """Confirms a key works and says what it can do.

    The first thing anyone integrating needs, and the endpoint that turns "it
    returns 401" into a five-second diagnosis.
    """
    return KeyInfo(
        label=caller.label,
        tenant_id=caller.tenant_id,
        scopes=sorted(caller.scopes),
    )


@router.get("/locations", response_model=list[Location])
async def list_locations(
    caller: ApiCaller = Depends(get_api_caller),
    session: AsyncSession = Depends(api_session),
) -> list[Location]:
    rows = (
        await session.execute(
            text(
                "SELECT location_id, name, short_code, city, country_code "
                "  FROM locations WHERE tenant_id = :t AND deleted_at IS NULL "
                "ORDER BY name"
            ),
            {"t": str(caller.tenant_id)},
        )
    ).mappings().all()
    return [Location(**r) for r in rows]


@router.get("/vehicles", response_model=list[Vehicle])
async def list_vehicles(
    status: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    caller: ApiCaller = Depends(get_api_caller),
    session: AsyncSession = Depends(api_session),
) -> list[Vehicle]:
    rows = (
        await session.execute(
            text(
                "SELECT v.vehicle_id, v.vin, v.make, v.model, v.model_year, "
                "       v.status::text AS status, vc.name AS vehicle_class, "
                "       l.name AS location "
                "  FROM vehicles v "
                "  LEFT JOIN vehicle_classes vc ON vc.class_id = v.vehicle_class_id "
                "  LEFT JOIN locations l ON l.location_id = v.home_location_id "
                " WHERE v.tenant_id = :t AND v.deleted_at IS NULL "
                "   AND (:st IS NULL OR v.status::text = :st) "
                " ORDER BY v.created_at DESC LIMIT :lim OFFSET :off"
            ),
            {"t": str(caller.tenant_id), "st": status, "lim": limit, "off": offset},
        )
    ).mappings().all()
    return [Vehicle(**r) for r in rows]


@router.get("/availability", response_model=list[ClassAvailability])
async def availability(
    caller: ApiCaller = Depends(get_api_caller),
    session: AsyncSession = Depends(api_session),
) -> list[ClassAvailability]:
    """How many vehicles of each class are free right now.

    A point-in-time count, not a bookable quote. Quoting needs dates, rates,
    tax and eligibility rules, and answering "can I book this?" from a number
    that ignores all four would be worse than not answering.
    """
    rows = (
        await session.execute(
            text(
                "SELECT vc.name AS vehicle_class, vc.sipp_prefix AS sipp, "
                "       count(v.vehicle_id) FILTER "
                "         (WHERE v.status::text = 'AVAILABLE') AS available "
                "  FROM vehicle_classes vc "
                "  LEFT JOIN vehicles v ON v.vehicle_class_id = vc.class_id "
                "       AND v.deleted_at IS NULL AND v.tenant_id = :t "
                " WHERE vc.is_active AND vc.tenant_id = :t "
                " GROUP BY vc.name, vc.sipp_prefix, vc.sort_order "
                " ORDER BY vc.sort_order, vc.name"
            ),
            {"t": str(caller.tenant_id)},
        )
    ).mappings().all()
    return [ClassAvailability(**r) for r in rows]


@router.get("/reservations", response_model=list[Reservation])
async def list_reservations(
    since: date | None = Query(default=None, description="Created on or after"),
    status: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    caller: ApiCaller = Depends(get_api_caller),
    session: AsyncSession = Depends(api_session),
) -> list[Reservation]:
    rows = (
        await session.execute(
            text(
                "SELECT r.reservation_id, r.confirmation_code, r.status::text AS status, "
                "       r.pickup_datetime AS pickup_at, r.dropoff_datetime AS dropoff_at, "
                "       COALESCE(vc.name, r.vehicle_class_name) AS vehicle_class, "
                "       r.total_amount, r.currency "
                "  FROM reservations r "
                "  LEFT JOIN vehicle_classes vc ON vc.class_id = r.vehicle_class_id "
                " WHERE r.tenant_id = :t AND r.deleted_at IS NULL "
                "   AND (:since IS NULL OR r.created_at >= :since) "
                "   AND (:st IS NULL OR r.status::text = :st) "
                " ORDER BY r.created_at DESC LIMIT :lim OFFSET :off"
            ),
            {"t": str(caller.tenant_id), "since": since, "st": status, "lim": limit, "off": offset},
        )
    ).mappings().all()
    return [Reservation(**r) for r in rows]
