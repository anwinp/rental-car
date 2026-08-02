"""Pricing domain repository — extends BaseRepository."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Text, and_, case, cast, func, or_, select

from app.core.repository import BaseRepository
from app.domains.pricing.models import ExtrasCatalog, RateCode, RateScheduleItem


# Rate types that represent an entitlement rather than a price the public may
# book. A caller reaches these only by presenting the matching CDP code; they
# are never candidates for an anonymous quote.
#
# Enumerated against the rate_type enum in the database rather than guessed —
# an omission here is a silent discount, and the two most costly members are the
# least obvious: OTA_NET and WHOLESALE are below-retail distributor rates, so
# leaving them public would sell every walk-up booking at a wholesaler's margin.
#
# Public by deliberate decision: RACK (the baseline), PROMOTIONAL (a genuine
# public discount, auto-applied), WEEKEND_SPECIAL.
_NEGOTIATED_RATE_TYPES = (
    "CORPORATE",              # requires a corporate account / CDP code
    "GOVERNMENT",             # requires proof of government employment
    "INSURANCE_REPLACEMENT",  # booked by an insurer against a claim
    "OTA_NET",                # net rate sold on by an OTA — below retail
    "WHOLESALE",              # tour/wholesale allocation — below retail
    "MEMBERSHIP",             # requires an eligible membership
    "TOUR_OPERATOR",          # contracted operator allocation
    "LOYALTY_REDEMPTION",     # paid in points, not currency
)


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

        # Public rate lookup — the caller presented no entitlement.
        #
        # This previously ranked CORPORATE second and RACK last (else_=10), so a
        # visitor with no corporate account was quoted the negotiated corporate
        # price. On the seeded tenant that meant 28.16 instead of 39.99 — a 30%
        # discount handed to the public, on every anonymous booking, invisibly.
        #
        # Negotiated rates are not "more specific" versions of the public rate;
        # they are a different entitlement. Without proof of it they must not be
        # reachable at all, so they are excluded here rather than merely ranked
        # lower. The CDP branch above is the only way to reach them.
        stmt = (
            select(RateCode)
            .where(
                *base_conditions,
                cast(RateCode.rate_type, Text).notin_(_NEGOTIATED_RATE_TYPES),
                # Belt and braces: a rate carrying a CDP code or an account link
                # is gated regardless of how its type is spelled.
                RateCode.cdp_code.is_(None),
                RateCode.corporate_account_id.is_(None),
            )
            .order_by(
                # Among rates the public may actually have:
                #   PROMOTIONAL — a real public discount, applied automatically
                #   RACK        — the operator's baseline walk-up price
                #   anything else public, only when there is no rack rate
                #
                # WEEKEND_SPECIAL and similar sit in the last group on purpose.
                # Nothing in the engine evaluates whether the rental actually
                # falls on a weekend, so promoting it above RACK would make it
                # apply to every booking — silently discounting midweek hires.
                # Ranking it below RACK leaves it inert until that date logic
                # exists, which is the safer of the two wrong behaviours.
                case(
                    (cast(RateCode.rate_type, Text) == "PROMOTIONAL", 1),
                    (cast(RateCode.rate_type, Text) == "RACK", 2),
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
        """Set the price for a (rate code, class, duration band, location).

        Upserts rather than always inserting. A price band is identified by
        (rate_code, vehicle_class, days_min, location) — saving the same band
        twice means "change this price", not "add a second price for it".

        This previously always INSERTed, which is why seeded rate codes carry
        duplicate rows for the same band (Economy 1-7 days appears twice at
        49.99). With two rows for one band, which one applies to a quote is
        decided by row order — so the same search could be priced differently
        depending on how Postgres happened to return them.
        """
        existing = (
            await self.session.execute(
                select(RateScheduleItem).where(
                    RateScheduleItem.tenant_id == str(self.tenant_id),
                    RateScheduleItem.rate_code_id == str(rate_code_id),
                    RateScheduleItem.vehicle_class_id == str(kwargs.get("vehicle_class_id")),
                    RateScheduleItem.days_min == kwargs.get("days_min", 1),
                    RateScheduleItem.location_id.is_(None)
                    if kwargs.get("location_id") is None
                    else RateScheduleItem.location_id == str(kwargs.get("location_id")),
                )
            )
        ).scalars().first()

        if existing is not None:
            for field, value in kwargs.items():
                setattr(existing, field, value)
            await self.session.flush()
            await self.session.refresh(existing)
            return existing

        obj = RateScheduleItem(
            item_id=str(uuid.uuid4()),
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
