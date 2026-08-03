"""Reservations domain ORM models — reservations and reservation_versions."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
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

from app.core.pg_types import pg_enum


class Base(DeclarativeBase):
    pass


class Reservation(Base):
    """
    Maps to public.reservations.

    Lifecycle: QUOTE → PENDING → CONFIRMED → CHECKED_OUT (GAP-004) → RETURNING
               → COMPLETED | CANCELLED | NO_SHOW | DISPUTED | EXTENDED | ON_HOLD
    """

    __tablename__ = "reservations"

    reservation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    # Cross-domain FKs are enforced at DB level; omit ORM-level ForeignKey()
    # to avoid DeclarativeBase resolution errors across domains.
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    # System-wide unique (GAP-006: no tenant scope on UNIQUE constraint)
    confirmation_number: Mapped[str] = mapped_column(Text, nullable=False, unique=True)

    # reservation_status DB enum stored as text
    status: Mapped[str] = mapped_column(pg_enum("reservation_status"), nullable=False, server_default="QUOTE")

    # Version counter incremented on each modification
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    customer_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    corporate_account_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    pickup_location_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    dropoff_location_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    pickup_datetime: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    return_datetime: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    actual_return_datetime: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    vehicle_class_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    assigned_vehicle_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    rate_code_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    cdp_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    promo_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="USD")

    # Financial snapshot columns
    base_rate_daily: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    base_total: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    extras_total: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )
    discount_total: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )
    location_fees_total: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )
    taxes_total: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )
    grand_total: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    deposit_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )

    # JSONB snapshots — list of {code, qty, price, amount} objects
    extras_snapshot: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    taxes_snapshot: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )

    # Booking channel
    channel: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="DIRECT_WEB"
    )
    ota_booking_ref: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    insurance_replacement_flag: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    flight_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    special_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cancellation_policy_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    # No-show tracking
    no_show_fee_charged: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    no_show_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Loyalty
    loyalty_points_earned: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    loyalty_points_redeemed: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    is_training: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    booking_agent_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # The rate quote token used at booking — validated against Redis
    rate_quote_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # One-to-many: version history
    versions: Mapped[list["ReservationVersion"]] = relationship(
        "ReservationVersion",
        back_populates="reservation",
        order_by="ReservationVersion.version_number.asc()",
        lazy="select",
        foreign_keys="ReservationVersion.reservation_id",
    )

    __table_args__ = (
        UniqueConstraint("confirmation_number", name="uq_confirmation_number"),
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.reservation_id


class ReservationVersion(Base):
    """
    Maps to public.reservation_versions.

    Immutable snapshot of a reservation at each point of change.
    version_number + reservation_id is unique.
    """

    __tablename__ = "reservation_versions"

    version_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    reservation_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("reservations.reservation_id"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)

    status_at_version: Mapped[str] = mapped_column(pg_enum("reservation_status"), nullable=False)
    pickup_location_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    dropoff_location_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    pickup_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    return_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    vehicle_class_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    rate_code_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    grand_total: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    # Full snapshot of extras at this version
    extras_snapshot: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )

    change_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    changed_by: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    changed_by_type: Mapped[str] = mapped_column(Text, nullable=False)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationship back to parent reservation
    reservation: Mapped["Reservation"] = relationship(
        "Reservation",
        back_populates="versions",
        foreign_keys=[reservation_id],
    )

    __table_args__ = (
        UniqueConstraint(
            "reservation_id", "version_number", name="uq_res_version"
        ),
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.version_id

    @property
    def deleted_at(self) -> None:  # type: ignore[override]
        """reservation_versions has no soft-delete column."""
        return None
