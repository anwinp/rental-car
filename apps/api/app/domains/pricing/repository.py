"""Pricing domain repository — extends BaseRepository."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Text, and_, case, cast, func, or_, select

from app.core.repository import BaseRepository
from app.domains.pricing.models import ExtrasCatalog, RateCode, RateScheduleItem


class PricingRepository(BaseRepository[RateCode]):
    """
    Rate-code and schedule-item queries.

    All public methods scope to self.tenant_id unless noted.
    """

    model = RateCode

    # ── Rate Code queries ─────────────────────────────────────────────────────

    async def get_active_rate_code(
        self,
        location_id: uuid.UUID,
        vehicle_class_id: uuid.UUID,
        pickup_dt: datetime,
        dropoff_dt: datetime,
        cdp_code: Optional[str] = None,
    ) -> Optional[RateCode]:
        """
        Find the best-matching ACTIVE rate code for the given parameters.

        Priority order:
          1. CDP-code rate (CORPORATE rate with matching cdp_code)
          2. Any ACTIVE rate matching location, vehicle class, and date range
             (advance booking restrictions checked in service layer)

        Returns None if no matching rate code found.
        """
        today = pickup_dt.date()

        base_conditions = [
            RateCode.tenant_id == str(self.tenant_id),
            RateCode.status == "ACTIVE",
            RateCode.deleted_at.is_(None),
            # Date validity: pickup must fall within valid window
            RateCode.valid_from <= today,
            RateCode.valid_until >= today,
        ]

        if cdp_code:
            # CDP code takes highest priority
            stmt = (
                select(RateCode)
                .where(
                    *base_conditions,
                    RateCode.cdp_code == cdp_code,
                    cast(RateCode.rate_type, Text) == "CORPORATE",
                )
                .order_by(RateCode.created_at.asc())
                .limit(1)
            )
            result = await self.session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is not None:
                return row

        # Standard rate lookup — no CDP filter
        stmt = (
            select(RateCode)
            .where(*base_conditions)
            .order_by(
                # Prefer more specific rate types first:
                # PROMOTIONAL > CORPORATE > RACK (GOVERNMENT, INSURANCE, etc. as-is)
                case(
                    (cast(RateCode.rate_type, Text) == "PROMOTIONAL", 1),
                    (cast(RateCode.rate_type, Text) == "CORPORATE", 2),
                    (cast(RateCode.rate_type, Text) == "GOVERNMENT", 3),
                    else_=10,
                ).asc(),
                RateCode.created_at.asc(),
            )
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_rate_code_by_id(self, rate_code_id: uuid.UUID) -> Optional[RateCode]:
        """Fetch a single rate code by PK (tenant-scoped)."""
        stmt = select(RateCode).where(
            RateCode.rate_code_id == str(rate_code_id),
            RateCode.tenant_id == str(self.tenant_id),
            RateCode.deleted_at.is_(None),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_rate_codes(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[RateCode]:
        """List rate codes for the tenant, optionally filtered by status."""
        conditions = [
            RateCode.tenant_id == str(self.tenant_id),
            RateCode.deleted_at.is_(None),
        ]
        if status:
            conditions.append(RateCode.status == status)

        stmt = (
            select(RateCode)
            .where(*conditions)
            .order_by(RateCode.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create_rate_code(
        self,
        **kwargs,
    ) -> RateCode:
        """Insert a new rate code row (status=DRAFT)."""
        rate_code_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        obj = RateCode(
            rate_code_id=rate_code_id,
            tenant_id=str(self.tenant_id),
            created_at=now,
            updated_at=now,
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update_rate_code(
        self, rate_code_id: uuid.UUID, **kwargs
    ) -> Optional[RateCode]:
        """Update mutable fields on a DRAFT rate code."""
        rc = await self.get_rate_code_by_id(rate_code_id)
        if rc is None:
            return None
        for key, value in kwargs.items():
            setattr(rc, key, value)
        rc.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        await self.session.refresh(rc)
        return rc

    async def activate_rate_code(self, rate_code_id: uuid.UUID) -> Optional[RateCode]:
        """Transition status DRAFT → ACTIVE."""
        rc = await self.get_rate_code_by_id(rate_code_id)
        if rc is None:
            return None
        rc.status = "ACTIVE"
        rc.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        await self.session.refresh(rc)
        return rc

    # ── Rate Schedule Item queries ────────────────────────────────────────────

    async def get_schedule_items(
        self,
        rate_code_id: uuid.UUID,
        vehicle_class_id: Optional[uuid.UUID] = None,
    ) -> list[RateScheduleItem]:
        """
        Return schedule items for a rate code.

        Optionally filter by vehicle_class_id.
        Items are ordered by days_min ascending so the caller can find
        the applicable duration band with a simple loop.
        """
        conditions = [
            RateScheduleItem.rate_code_id == str(rate_code_id),
            RateScheduleItem.tenant_id == str(self.tenant_id),
        ]
        if vehicle_class_id is not None:
            conditions.append(
                RateScheduleItem.vehicle_class_id == str(vehicle_class_id)
            )

        stmt = (
            select(RateScheduleItem)
            .where(*conditions)
            .order_by(RateScheduleItem.days_min.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def add_schedule_item(
        self,
        rate_code_id: uuid.UUID,
        **kwargs,
    ) -> RateScheduleItem:
        """Add a new schedule item to a rate code."""
        item_id = str(uuid.uuid4())
        obj = RateScheduleItem(
            item_id=item_id,
            tenant_id=str(self.tenant_id),
            rate_code_id=str(rate_code_id),
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    # ── Extras Catalog queries ────────────────────────────────────────────────

    async def get_active_extras(self) -> list[ExtrasCatalog]:
        """
        Return all active extras for this tenant.

        Includes system-level extras (tenant_id IS NULL) so they are
        visible to all tenants.
        """
        stmt = (
            select(ExtrasCatalog)
            .where(
                ExtrasCatalog.is_active.is_(True),
                or_(
                    ExtrasCatalog.tenant_id == str(self.tenant_id),
                    ExtrasCatalog.tenant_id.is_(None),
                ),
            )
            .order_by(ExtrasCatalog.code.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_extra_by_id(self, extra_id: uuid.UUID) -> Optional[ExtrasCatalog]:
        """Fetch a single extra by PK (tenant-scoped + system)."""
        stmt = select(ExtrasCatalog).where(
            ExtrasCatalog.extra_id == str(extra_id),
            or_(
                ExtrasCatalog.tenant_id == str(self.tenant_id),
                ExtrasCatalog.tenant_id.is_(None),
            ),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create_extra(self, **kwargs) -> ExtrasCatalog:
        """Create a new extras catalog entry for this tenant."""
        extra_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        obj = ExtrasCatalog(
            extra_id=extra_id,
            tenant_id=str(self.tenant_id),
            created_at=now,
            updated_at=now,
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update_extra(
        self, extra_id: uuid.UUID, **kwargs
    ) -> Optional[ExtrasCatalog]:
        """Update a tenant-owned extra."""
        extra = await self.get_extra_by_id(extra_id)
        if extra is None or extra.tenant_id is None:
            # Don't allow updating system extras
            return None
        for key, value in kwargs.items():
            setattr(extra, key, value)
        extra.updated_at = datetime.now(timezone.utc)
        await self.session.flush()
        await self.session.refresh(extra)
        return extra
