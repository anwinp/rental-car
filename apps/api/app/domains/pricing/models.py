"""Pricing domain ORM models — rate_codes, rate_schedule_items, extras_catalog."""
from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class RateCode(Base):
    """
    Maps to public.rate_codes.

    Represents a pricing programme (RACK, CORPORATE, PROMOTIONAL, etc.).
    Holds validity dates, blackout dates, advance booking windows,
    GDS metadata, and cancellation policy reference.
    """

    __tablename__ = "rate_codes"

    rate_code_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("tenants.tenant_id"), nullable=False
    )
    code: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # rate_type uses DB enum rate_type — stored as text for ORM compatibility
    rate_type: Mapped[str] = mapped_column(Text, nullable=False)

    market_segment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="USD")

    # DRAFT / ACTIVE / ARCHIVED
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="DRAFT")

    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date] = mapped_column(Date, nullable=False)

    # JSONB: list of ISO date strings that are blocked
    blackout_dates: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    # JSONB: {"MON": 0.95, "FRI": 1.15, ...}
    day_of_week_modifiers: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )

    location_scope: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="ALL"
    )
    location_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    vehicle_class_scope: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="ALL"
    )
    vehicle_class_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )

    min_rental_days: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    max_rental_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Hours before pickup: minimum advance booking
    advance_booking_hours_min: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    # Hours before pickup: maximum advance booking window
    advance_booking_hours_max: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    min_driver_age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    prepay_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    refundable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    cancellation_policy_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    is_combinable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )

    max_uses_total: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_uses_per_customer: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    uses_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    corporate_account_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    # Corporate Discount Program code
    cdp_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    gds_eligible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    acriss_rate_category: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Max 24 chars per GDS spec
    gds_description: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    schedule_items: Mapped[list["RateScheduleItem"]] = relationship(
        "RateScheduleItem",
        back_populates="rate_code",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_rate_code_tenant"),
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.rate_code_id


class RateScheduleItem(Base):
    """
    Maps to public.rate_schedule_items.

    Holds per-class, per-duration pricing for a rate code.
    ON DELETE CASCADE from rate_codes.
    """

    __tablename__ = "rate_schedule_items"

    item_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False
    )
    rate_code_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("rate_codes.rate_code_id", ondelete="CASCADE"),
        nullable=False,
    )
    # Same cross-registry problem as location_id below — vehicle_classes is
    # mapped under another domain's DeclarativeBase, so SQLAlchemy cannot
    # resolve this reference and raised NoReferencedTableError on flush.
    # Postgres still enforces rate_schedule_items_vehicle_class_id_fkey.
    vehicle_class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        nullable=False,
    )
    # No ORM-level ForeignKey here, deliberately.
    #
    # Every domain in this codebase declares its own DeclarativeBase, so
    # `locations` lives in a different metadata registry than this model.
    # SQLAlchemy cannot resolve a ForeignKey across registries and raised
    # NoReferencedTableError on every insert — which meant POST
    # /pricing/rate-codes/{id}/schedule had never once succeeded, despite the
    # endpoint, service and repository all being written. The API looked
    # complete and was unusable.
    #
    # The constraint still exists and is still enforced in Postgres
    # (rate_schedule_items_location_id_fkey); dropping it from the ORM only
    # stops SQLAlchemy trying to resolve a table it cannot see. Nothing
    # navigates this as a relationship, so there is nothing else to lose.
    #
    # The real fix is one shared Base across domains. That is a wide change and
    # does not belong in the same commit as making pricing work.
    location_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False),
        nullable=True,
    )

    # Rental duration band
    days_min: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    days_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Pricing (Numeric 10,2 per DDL; we use 10,6 precision internally before rounding)
    price_per_day: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    price_per_week: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    price_per_month: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    extra_day_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    free_miles_per_day: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    overage_rate_per_mile: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 4), nullable=True
    )

    # Relationship back to rate code
    rate_code: Mapped["RateCode"] = relationship(
        "RateCode", back_populates="schedule_items"
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.item_id

    # RateScheduleItem rows don't carry deleted_at — use rate_code cascade.
    # Provide stub so _tenant_filter() doesn't crash if called on this model.
    @property
    def deleted_at(self) -> None:  # type: ignore[override]
        return None


class ExtrasCatalog(Base):
    """
    Maps to public.extras_catalog.

    Represents an add-on product (CDW, GPS, child seat, toll pass, etc.).
    tenant_id is nullable — NULL = system-level reference extra visible to all tenants.
    """

    __tablename__ = "extras_catalog"

    extra_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    # NULL = system reference extra
    tenant_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), ForeignKey("tenants.tenant_id"), nullable=True
    )
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)

    # INSURANCE / EQUIPMENT / FUEL / TOLL / SERVICE
    extra_type: Mapped[str] = mapped_column(Text, nullable=False)

    # PER_DAY / PER_RENTAL / FLAT
    pricing_type: Mapped[str] = mapped_column(Text, nullable=False)

    default_price: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    # TAXABLE / EXEMPT
    tax_treatment: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="TAXABLE"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_extra_code"),
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.extra_id

    # extras_catalog has no deleted_at column — provide stub.
    @property
    def deleted_at(self) -> None:  # type: ignore[override]
        return None
