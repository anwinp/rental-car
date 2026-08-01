"""Location repository — extends BaseRepository with domain-specific queries."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ResourceNotFoundError
from app.core.repository import BaseRepository
from app.domains.locations.models import Location


class LocationRepository(BaseRepository[Location]):
    model = Location

    # ── Domain-specific queries ──────────────────────────────────────────────

    async def get_by_short_code(
        self, short_code: str
    ) -> Optional[Location]:
        """Retrieve a location by its short_code (scoped to tenant)."""
        result = await self.session.execute(
            select(Location).where(
                Location.short_code == short_code,
                self._tenant_filter(),
            )
        )
        return result.scalar_one_or_none()

    async def short_code_exists(
        self, short_code: str, exclude_id: Optional[str] = None
    ) -> bool:
        """Check short_code uniqueness within the tenant (exclude current record on update)."""
        stmt = select(
            exists().where(
                Location.short_code == short_code,
                self._tenant_filter(),
            )
        )
        if exclude_id:
            stmt = select(
                exists().where(
                    Location.short_code == short_code,
                    Location.tenant_id == self.tenant_id,
                    Location.deleted_at.is_(None),
                    Location.location_id != exclude_id,
                )
            )
        result = await self.session.execute(stmt)
        return bool(result.scalar())

    async def has_active_reservations(self, location_id: str) -> bool:
        """Check whether any PENDING/CONFIRMED/CHECKED_OUT reservations exist for this location."""
        from sqlalchemy import text

        result = await self.session.execute(
            text(
                # MT-02: explicit tenant predicate. RLS also constrains this,
                # but a destructive/gating check should not depend on a single
                # layer — a location is only "in use" by its OWN tenant.
                "SELECT EXISTS ("
                "  SELECT 1 FROM reservations"
                "  WHERE pickup_location_id = :lid"
                "    AND tenant_id = :tid"
                "    AND status IN ('PENDING','CONFIRMED','CHECKED_OUT','EXTENDING')"
                "    AND deleted_at IS NULL"
                ")"
            ),
            {"lid": location_id, "tid": str(self.tenant_id)},
        )
        return bool(result.scalar())

    # ── Create / update ──────────────────────────────────────────────────────

    async def create_location(self, **kwargs) -> Location:
        """Create a new location — BaseRepository.create() handles tenant_id injection."""
        # The base create() sets id=uuid.uuid4() but Location uses location_id as PK.
        # We bypass the generic create() and build the object directly.
        location_id = str(uuid.uuid4())
        obj = Location(
            location_id=location_id,
            tenant_id=str(self.tenant_id),
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update_location(
        self, location_id: str, **kwargs
    ) -> Location:
        await self.session.execute(
            update(Location)
            .where(
                Location.location_id == location_id,
                Location.tenant_id == str(self.tenant_id),
                Location.deleted_at.is_(None),
            )
            .values(**kwargs, updated_at=func.now())
        )
        await self.session.flush()
        result = await self.session.execute(
            select(Location).where(Location.location_id == location_id)
        )
        loc = result.scalar_one_or_none()
        if loc is None:
            raise ResourceNotFoundError(resource="locations", resource_id=location_id)
        return loc

    async def deactivate(self, location_id: str) -> Location:
        return await self.update_location(location_id, is_active=False)
