"""Location service — business logic for location management."""
from __future__ import annotations

from datetime import datetime, time
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.domains.locations.models import Location
from app.domains.tenants.limits import assert_within_limit
from app.domains.locations.repository import LocationRepository
from app.domains.locations.schemas import (
    HoursComplianceResult,
    LocationCreate,
    LocationUpdate,
)

# Day abbreviation → key in hours_of_operation JSON
_WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _parse_hhmm(t: str) -> time:
    """Parse 'HH:MM' string to time object."""
    h, m = t.split(":")
    return time(int(h), int(m))


class LocationService:
    """Stateless service — session is passed into each method."""

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def create_location(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        data: LocationCreate,
    ) -> Location:
        """
        Create a location.
        Validates short_code uniqueness within the tenant.
        Airport type requires airport_code (enforced in schema too, but validated here for clarity).
        """
        # max_locations was decorative in the same way max_vehicles was.
        await assert_within_limit(session, tenant_id, "locations")

        repo = LocationRepository(session, tenant_id)

        if await repo.short_code_exists(data.short_code):
            raise ConflictError(
                f"Short code '{data.short_code}' is already in use at another location "
                "for this tenant.",
                extra={"short_code": data.short_code, "error_code": "SHORT_CODE_TAKEN"},
            )

        location = await repo.create_location(
            name=data.name,
            short_code=data.short_code,
            location_type=data.location_type,
            address_line1=data.address_line1,
            address_line2=data.address_line2,
            city=data.city,
            state_province=data.state_province,
            country_code=data.country_code,
            postal_code=data.postal_code,
            latitude=data.latitude,
            longitude=data.longitude,
            airport_code=data.airport_code,
            phone=data.phone,
            email=data.email,
            timezone=data.timezone,
            currency=data.currency,
            hours_of_operation=data.hours_of_operation or {},
            tax_template_id=data.tax_template_id,
            no_show_grace_minutes=data.no_show_grace_minutes,
            is_active=data.is_active,
        )
        return location

    async def update_location(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        location_id: str,
        data: LocationUpdate,
    ) -> Location:
        repo = LocationRepository(session, tenant_id)
        updates = data.model_dump(exclude_none=True)
        if not updates:
            result = await repo.get_by_short_code(location_id)
            if result is None:
                # Try by ID
                from sqlalchemy import select
                from app.domains.locations.models import Location as Loc
                r = await session.execute(
                    select(Loc).where(Loc.location_id == location_id)
                )
                loc = r.scalar_one_or_none()
                if loc is None:
                    raise ResourceNotFoundError(resource="locations", resource_id=location_id)
                return loc
        return await repo.update_location(location_id, **updates)

    async def get_location(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        location_id: str,
    ) -> Location:
        repo = LocationRepository(session, tenant_id)
        from sqlalchemy import select
        result = await session.execute(
            select(Location).where(
                Location.location_id == location_id,
                Location.tenant_id == str(tenant_id),
                Location.deleted_at.is_(None),
            )
        )
        loc = result.scalar_one_or_none()
        if loc is None:
            raise ResourceNotFoundError(resource="locations", resource_id=location_id)
        return loc

    async def get_by_short_code(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        short_code: str,
    ) -> Location:
        repo = LocationRepository(session, tenant_id)
        loc = await repo.get_by_short_code(short_code)
        if loc is None:
            raise ResourceNotFoundError(resource="locations", resource_id=short_code)
        return loc

    async def list_locations(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        is_active: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Location]:
        repo = LocationRepository(session, tenant_id)
        filters = []
        if is_active is not None:
            filters.append(Location.is_active == is_active)
        return await repo.list(limit=limit, offset=offset, filters=filters or None)

    async def deactivate_location(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        location_id: str,
    ) -> Location:
        """
        Deactivate a location.
        Blocks if there are active reservations at the location.
        """
        repo = LocationRepository(session, tenant_id)

        if await repo.has_active_reservations(location_id):
            raise ConflictError(
                "Cannot deactivate a location with active reservations. "
                "Cancel or reassign all reservations first.",
                extra={
                    "location_id": location_id,
                    "error_code": "LOCATION_HAS_ACTIVE_RESERVATIONS",
                },
            )
        return await repo.deactivate(location_id)

    # ── Hours compliance ──────────────────────────────────────────────────────

    async def check_hours_compliance(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        location_id: str,
        pickup_dt: datetime,
        dropoff_dt: datetime,
    ) -> HoursComplianceResult:
        """
        Check whether pickup and dropoff datetimes fall within operating hours.
        Returns is_compliant, warning_message, is_hard_block per BACKLOG LOC-002.
        """
        location = await self.get_location(session, tenant_id, location_id)
        hours = location.hours_of_operation or {}

        def _is_within_hours(dt: datetime) -> tuple[bool, str | None]:
            """Return (is_ok, reason) for a single datetime."""
            if not hours:
                return True, None  # No hours configured → always open

            day_key = _WEEKDAY_KEYS[dt.weekday()]
            day_cfg = hours.get(day_key)

            if day_cfg is None:
                return True, None  # Not configured for this day → assume open

            if isinstance(day_cfg, dict) and day_cfg.get("is_closed"):
                return False, f"Location is closed on {day_key.capitalize()}"

            open_str = day_cfg.get("open") if isinstance(day_cfg, dict) else None
            close_str = day_cfg.get("close") if isinstance(day_cfg, dict) else None

            if not open_str or not close_str:
                return True, None  # No specific times → assume open all day

            open_time = _parse_hhmm(open_str)
            close_time = _parse_hhmm(close_str)
            request_time = dt.time().replace(second=0, microsecond=0)

            if open_time <= request_time <= close_time:
                return True, None

            return (
                False,
                f"Requested time {request_time.strftime('%H:%M')} is outside "
                f"operating hours ({open_str}–{close_str}) on {day_key.capitalize()}",
            )

        pickup_ok, pickup_msg = _is_within_hours(pickup_dt)
        dropoff_ok, dropoff_msg = _is_within_hours(dropoff_dt)

        if pickup_ok and dropoff_ok:
            return HoursComplianceResult(is_compliant=True)

        messages = [m for m in [pickup_msg, dropoff_msg] if m]
        warning_message = "; ".join(messages)

        # A pickup outside hours is a hard block (cannot proceed).
        # A dropoff-only violation is a soft warning.
        is_hard_block = not pickup_ok

        return HoursComplianceResult(
            is_compliant=False,
            warning_message=warning_message,
            is_hard_block=is_hard_block,
            detail=warning_message,
        )
