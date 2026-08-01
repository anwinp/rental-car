"""Location domain router — CRUD + hours-compliance check."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.tenancy import require_tenant
from app.core.rbac import require_permission
from app.core.security import UserClaims, get_current_user
from app.domains.locations.schemas import (
    HoursComplianceResult,
    LocationCreate,
    LocationResponse,
    LocationUpdate,
)
from app.domains.locations.service import LocationService

router = APIRouter()
_svc = LocationService()


class PublicLocation(BaseModel):
    """Minimal location record for public booking widget — no auth required."""
    location_id: str
    name: str
    short_code: str
    city: str
    state_province: Optional[str] = None
    country_code: str
    airport_code: Optional[str] = None
    location_type: str


@router.get(
    "/public",
    response_model=list[PublicLocation],
    summary="List active locations (public — no auth, for booking widget)",
)
async def list_locations_public(
    request: Request,
    session: AsyncSession = Depends(get_session),
    tenant_id: UUID = Depends(require_tenant),
) -> list[PublicLocation]:
    """Active locations for the public booking site — no authentication required.

    The tenant comes from the hostname (or a signed session). There is no
    fallback: an unresolvable tenant is a 400, not somebody else's catalogue.
    """

    locations = await _svc.list_locations(session, tenant_id, is_active=True, limit=200, offset=0)
    return [
        PublicLocation(
            location_id=str(loc.location_id),
            name=loc.name,
            short_code=loc.short_code,
            city=loc.city,
            state_province=loc.state_province,
            country_code=loc.country_code,
            airport_code=loc.airport_code,
            location_type=loc.location_type,
        )
        for loc in locations
    ]


# ── POST /locations ──────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=LocationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a location",
)
async def create_location(
    body: LocationCreate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> LocationResponse:
    location = await _svc.create_location(session, claims.tenant_id, body)
    return LocationResponse.model_validate(location)


# ── GET /locations ────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[LocationResponse],
    summary="List locations",
)
async def list_locations(
    is_active: Optional[bool] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> list[LocationResponse]:
    locations = await _svc.list_locations(
        session, claims.tenant_id, is_active=is_active, limit=limit, offset=offset
    )
    return [LocationResponse.model_validate(loc) for loc in locations]


# ── GET /locations/{location_id} ─────────────────────────────────────────────


@router.get(
    "/{location_id}",
    response_model=LocationResponse,
    summary="Get location details",
)
async def get_location(
    location_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> LocationResponse:
    location = await _svc.get_location(session, claims.tenant_id, location_id)
    return LocationResponse.model_validate(location)


# ── PATCH /locations/{location_id} ───────────────────────────────────────────


@router.patch(
    "/{location_id}",
    response_model=LocationResponse,
    summary="Update location",
)
async def update_location(
    location_id: str,
    body: LocationUpdate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> LocationResponse:
    location = await _svc.update_location(
        session, claims.tenant_id, location_id, body
    )
    return LocationResponse.model_validate(location)


# ── DELETE /locations/{location_id} ─────────────────────────────────────────


@router.delete(
    "/{location_id}",
    response_model=LocationResponse,
    summary="Deactivate a location",
)
async def deactivate_location(
    location_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> LocationResponse:
    """
    Soft-deactivates the location (sets is_active=False).
    Returns HTTP 409 if there are active reservations at this location.
    """
    location = await _svc.deactivate_location(
        session, claims.tenant_id, location_id
    )
    return LocationResponse.model_validate(location)


# ── GET /locations/{location_id}/hours-check ─────────────────────────────────


@router.get(
    "/{location_id}/hours-check",
    response_model=HoursComplianceResult,
    summary="Check pickup/dropoff times against location operating hours",
)
async def check_hours(
    location_id: str,
    pickup: datetime = Query(..., description="Pickup datetime (ISO 8601)"),
    dropoff: datetime = Query(..., description="Dropoff datetime (ISO 8601)"),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> HoursComplianceResult:
    """
    Returns is_compliant, warning_message, and is_hard_block.
    A hard block means pickup is outside operating hours (prevents checkout).
    A soft warning means dropoff falls outside hours (allowed but flagged).
    """
    return await _svc.check_hours_compliance(
        session, claims.tenant_id, location_id, pickup, dropoff
    )
