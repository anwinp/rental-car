"""Fleet ORM models — 4 mapped classes (SQLAlchemy 2.0)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, Numeric, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.pg_types import pg_enum


class Base(DeclarativeBase):
    pass


# ── VehicleClass ─────────────────────────────────────────────────────────────


class VehicleClass(Base):
    """
    Maps to public.vehicle_classes.

    tenant_id is nullable — NULL rows are system-wide reference classes
    seeded in migration 032.
    """

    __tablename__ = "vehicle_classes"

    class_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    # NULL = system-wide class visible to all tenants
    tenant_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    sipp_prefix: Mapped[str] = mapped_column(String(1), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    @property
    def id(self) -> str:
        return self.class_id


# ── Vehicle ──────────────────────────────────────────────────────────────────


class Vehicle(Base):
    """
    Maps to public.vehicles.

    All 50+ columns from ARCH_DATABASE.md DDL. Column names match exactly
    so Alembic autogenerate produces no spurious diffs.
    """

    __tablename__ = "vehicles"

    vehicle_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)

    # ── Identification ───────────────────────────────────────────────────────
    vin: Mapped[str] = mapped_column(String(17), nullable=False)
    plate_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    plate_jurisdiction: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    plate_expiry: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True
    )
    title_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fleet_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    unit_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Descriptive attributes ───────────────────────────────────────────────
    make: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    trim: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    model_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    body_style: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exterior_color: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exterior_color_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    interior_color: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Powertrain ───────────────────────────────────────────────────────────
    # Using Text instead of enum types so we avoid SQLAlchemy enum migration issues;
    # DB CHECK constraints enforce valid values.
    transmission: Mapped[str] = mapped_column(pg_enum("transmission_type"), nullable=False, server_default="AUTOMATIC")
    drive_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    engine_displacement_l: Mapped[Optional[Decimal]] = mapped_column(Numeric(4, 2), nullable=True)
    cylinder_count: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    fuel_type: Mapped[str] = mapped_column(pg_enum("fuel_type"), nullable=False, server_default="GASOLINE")
    fuel_tank_capacity_gal: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    battery_capacity_kwh: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 2), nullable=True)
    epa_range_miles: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    charge_port_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Passenger / cargo ────────────────────────────────────────────────────
    doors: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    seats: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    luggage_large_bags: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    luggage_small_bags: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)

    # ── Classification ───────────────────────────────────────────────────────
    sipp_code: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    vehicle_class_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    pool_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # ── Location & operational status ─────────────────────────────────────────
    home_location_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    current_location_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    # status stores vehicle_status enum values (13 values, GAP-003)
    status: Mapped[str] = mapped_column(pg_enum("vehicle_status"), nullable=False, server_default="STAGING")
    odometer_current: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    odometer_unit: Mapped[str] = mapped_column(Text, nullable=False, server_default="MILES")
    fuel_level_pct: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    soc_pct: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    in_service_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=False), nullable=True
    )

    # ── Financial / acquisition ──────────────────────────────────────────────
    acquisition_cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    residual_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    book_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    depreciation_method: Mapped[str] = mapped_column(
        pg_enum("depreciation_method"), nullable=False, server_default="STRAIGHT_LINE"
    )
    useful_life_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    estimated_life_miles: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fleet_type: Mapped[str] = mapped_column(pg_enum("fleet_type"), nullable=False, server_default="OWNED")
    lease_reference: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    target_disposal_miles: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_disposal_months: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # ── Extras / telematics ──────────────────────────────────────────────────
    options_packages: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    photos: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    telematics_device_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    telematics_provider: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Promotional display ───────────────────────────────────────────────────
    is_promo: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    promo_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    promo_label: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Timestamps / soft delete ──────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def id(self) -> str:
        return self.vehicle_id

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None


# ── VehicleStatusLog ─────────────────────────────────────────────────────────


class VehicleStatusLog(Base):
    """
    Maps to public.vehicle_status_log.
    Immutable audit trail — one row per status transition.
    """

    __tablename__ = "vehicle_status_log"

    log_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    vehicle_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    previous_status: Mapped[str] = mapped_column(pg_enum("vehicle_status"), nullable=False)
    new_status: Mapped[str] = mapped_column(pg_enum("vehicle_status"), nullable=False)
    reason_code: Mapped[str] = mapped_column(Text, nullable=False)
    reason_detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    linked_record_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    linked_record_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    changed_by: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


# ── VehicleBlock ─────────────────────────────────────────────────────────────


class VehicleBlock(Base):
    """
    Maps to public.vehicle_blocks.

    The exclusion constraint (no_overlapping_vehicle_blocks) is enforced
    at the DB layer via GiST on tstzrange(start_time, end_time, '[)').
    Application code catches asyncpg.ExclusionViolationError (23P01) and
    re-raises ExclusionConstraintError → HTTP 409.
    """

    __tablename__ = "vehicle_blocks"

    block_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    vehicle_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    # block_type stores vehicle_block_type enum values
    block_type: Mapped[str] = mapped_column(pg_enum("vehicle_block_type"), nullable=False)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reservation_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    work_order_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    is_hard_block: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def id(self) -> str:
        return self.block_id
