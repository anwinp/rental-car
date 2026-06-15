"""Checkout / Counter Operations ORM models — SQLAlchemy 2.0 mapped classes."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, Numeric, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class RentalAgreement(Base):
    """
    Maps to public.rental_agreements.

    Tracks the full lifecycle of a vehicle checkout/check-in.
    swap_pair_id is a self-referential FK linking two RAs in a vehicle swap.
    """

    __tablename__ = "rental_agreements"

    # ── Primary key ───────────────────────────────────────────────────────────
    ra_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    ra_number: Mapped[str] = mapped_column(Text, nullable=False, unique=True)

    # ── Reservation link (nullable for walk-ups) ──────────────────────────────
    reservation_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True, index=True
    )

    # ── Parties ───────────────────────────────────────────────────────────────
    customer_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    checking_out_agent_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    checking_in_agent_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    # ── Vehicle ────────────────────────────────────────────────────────────────
    vehicle_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    vin_at_checkout: Mapped[str] = mapped_column(String(17), nullable=False)
    plate_at_checkout: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Odometer & fuel at checkout ───────────────────────────────────────────
    odometer_out: Mapped[int] = mapped_column(Integer, nullable=False)
    fuel_level_out_pct: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    soc_pct_out: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)

    # ── Odometer & fuel at check-in (populated on return) ─────────────────────
    odometer_in: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fuel_level_in_pct: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    soc_pct_in: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    actual_return_datetime: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    return_location_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    # ── Rate & extras snapshots ────────────────────────────────────────────────
    rate_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    extras_snapshot: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    mileage_plan: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    fuel_policy: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    additional_drivers: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")

    # ── Signature ─────────────────────────────────────────────────────────────
    customer_signature_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    customer_signed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    esignature_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    declination_signature_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Payment ────────────────────────────────────────────────────────────────
    preauth_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    preauth_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    # ── Vehicle swap linkage ──────────────────────────────────────────────────
    swapped_from_ra_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    swapped_to_ra_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    # ── Status ────────────────────────────────────────────────────────────────
    # Values: ACTIVE, EXTENDED, RETURNED, CLOSED, DISPUTED
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="ACTIVE")

    # Training/demo mode — charges not captured
    is_training: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # Agent notes
    agent_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.ra_id

    # No deleted_at on rental_agreements per DDL — use status transitions
    @property
    def deleted_at(self) -> None:
        """Rental agreements are never soft-deleted; satisfy BaseRepository interface."""
        return None


class ShiftLog(Base):
    """
    Maps to a shift_logs table for counter cash and fleet reconciliation.

    One record per shift open or close event. Paired by agent+location+date.
    """

    __tablename__ = "shift_logs"

    shift_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    location_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    agent_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)

    # OPEN or CLOSE
    shift_type: Mapped[str] = mapped_column(Text, nullable=False)

    # Cash reconciliation (cents stored as Decimal)
    opening_cash: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    closing_cash: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    expected_cash: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    cash_variance: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)

    # Fleet snapshot at shift boundary
    fleet_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    pending_pickups_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.shift_id

    @property
    def deleted_at(self) -> None:
        return None

    @property
    def updated_at(self) -> datetime:
        return self.created_at
