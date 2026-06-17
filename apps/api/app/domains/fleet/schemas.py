"""Pydantic v2 schemas for the Fleet domain."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Enums ─────────────────────────────────────────────────────────────────────


class VehicleStatus(str, Enum):
    """
    13 statuses (GAP-003: CHARGING is a block type, not a vehicle status).
    """

    STAGING = "STAGING"
    AVAILABLE = "AVAILABLE"
    ON_RENT = "ON_RENT"
    RETURNING = "RETURNING"
    READY_FOR_INSPECTION = "READY_FOR_INSPECTION"
    CLEANING = "CLEANING"
    MAINTENANCE = "MAINTENANCE"
    IN_REPAIR = "IN_REPAIR"
    DAMAGE_HOLD = "DAMAGE_HOLD"
    ADMIN_HOLD = "ADMIN_HOLD"
    PENDING_DISPOSAL = "PENDING_DISPOSAL"
    DISPOSED = "DISPOSED"
    PENDING_DELIVERY = "PENDING_DELIVERY"


assert len(VehicleStatus) == 13, "Must have exactly 13 vehicle statuses (GAP-003)"


class VehicleBlockType(str, Enum):
    """Block types for vehicle_blocks table (CHARGING is here, not in VehicleStatus)."""

    RESERVATION = "RESERVATION"
    TURNAROUND = "TURNAROUND"
    MAINTENANCE = "MAINTENANCE"
    RECALL_HOLD = "RECALL_HOLD"
    IN_TRANSIT = "IN_TRANSIT"
    HOLD = "HOLD"
    INSPECTION = "INSPECTION"
    STAGING = "STAGING"
    CHARGING = "CHARGING"  # EV charging block — not a vehicle status (GAP-003)


# ── Vehicle class schemas ────────────────────────────────────────────────────


class VehicleClassCreate(BaseModel):
    """Create a custom (tenant-scoped) vehicle class."""

    sipp_prefix: str = Field(min_length=1, max_length=1)
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None
    sort_order: int = Field(default=0, ge=0)


class VehicleClassResponse(BaseModel):
    model_config = {"from_attributes": True}

    class_id: str
    tenant_id: Optional[str] = None
    sipp_prefix: str
    name: str
    description: Optional[str] = None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ── Vehicle schemas ──────────────────────────────────────────────────────────


class VehicleCreate(BaseModel):
    """POST /fleet/vehicles payload."""

    vin: str = Field(min_length=17, max_length=17)
    make: str = Field(min_length=1, max_length=60)
    model: str = Field(min_length=1, max_length=60)
    model_year: int = Field(ge=1900, le=2100)
    trim: Optional[str] = Field(default=None, max_length=60)
    body_style: Optional[str] = None
    exterior_color: Optional[str] = Field(default=None, max_length=40)
    transmission: str = Field(default="AUTOMATIC")
    fuel_type: str = Field(default="GASOLINE")
    seats: Optional[int] = Field(default=None, ge=1, le=20)
    doors: Optional[int] = Field(default=None, ge=2, le=6)
    luggage_large_bags: Optional[int] = None
    luggage_small_bags: Optional[int] = None

    sipp_code: Optional[str] = Field(
        default=None, min_length=4, max_length=4, description="SIPP/ACRISS 4-char code"
    )
    vehicle_class_id: str

    home_location_id: str
    current_location_id: Optional[str] = None

    plate_number: Optional[str] = Field(default=None, max_length=20)
    plate_jurisdiction: Optional[str] = Field(default=None, max_length=10)

    odometer_current: int = Field(default=0, ge=0)
    odometer_unit: str = Field(default="MILES")
    fuel_level_pct: Optional[int] = Field(default=None, ge=0, le=100)

    # Financial fields (all optional)
    acquisition_cost: Optional[Decimal] = Field(default=None, ge=0)
    residual_value: Optional[Decimal] = Field(default=None, ge=0)
    book_value: Optional[Decimal] = Field(default=None, ge=0)
    depreciation_method: str = Field(default="STRAIGHT_LINE")
    fleet_type: str = Field(default="OWNED")
    useful_life_months: Optional[int] = None
    estimated_life_miles: Optional[int] = None

    # Photos (S3 keys)
    photos: list[str] = Field(default_factory=list)

    @field_validator("transmission")
    @classmethod
    def validate_transmission(cls, v: str) -> str:
        allowed = {"AUTOMATIC", "MANUAL", "CVT", "DCT"}
        if v not in allowed:
            raise ValueError(f"transmission must be one of {allowed}")
        return v

    @field_validator("fuel_type")
    @classmethod
    def validate_fuel_type(cls, v: str) -> str:
        allowed = {"GASOLINE", "DIESEL", "HYBRID", "PHEV", "BEV", "HYDROGEN", "LPG"}
        if v not in allowed:
            raise ValueError(f"fuel_type must be one of {allowed}")
        return v


class VehicleUpdate(BaseModel):
    """PATCH /fleet/vehicles/{id} — all fields optional."""

    status: Optional[VehicleStatus] = None
    make: Optional[str] = None
    model: Optional[str] = None
    model_year: Optional[int] = Field(default=None, ge=1900, le=2100)
    trim: Optional[str] = None
    exterior_color: Optional[str] = None
    transmission: Optional[str] = None
    fuel_type: Optional[str] = None
    seats: Optional[int] = None
    doors: Optional[int] = None
    sipp_code: Optional[str] = Field(default=None, min_length=4, max_length=4)
    vehicle_class_id: Optional[str] = None
    home_location_id: Optional[str] = None
    current_location_id: Optional[str] = None
    plate_number: Optional[str] = None
    plate_jurisdiction: Optional[str] = None
    odometer_current: Optional[int] = None
    fuel_level_pct: Optional[int] = Field(default=None, ge=0, le=100)
    acquisition_cost: Optional[Decimal] = None
    residual_value: Optional[Decimal] = None
    book_value: Optional[Decimal] = None
    photos: Optional[list[str]] = None


class VehicleResponse(BaseModel):
    model_config = {"from_attributes": True}

    vehicle_id: str
    tenant_id: str
    vin: str
    make: str
    model: str
    model_year: int
    trim: Optional[str] = None
    body_style: Optional[str] = None
    exterior_color: Optional[str] = None
    transmission: str
    fuel_type: str
    seats: Optional[int] = None
    doors: Optional[int] = None
    luggage_large_bags: Optional[int] = None
    luggage_small_bags: Optional[int] = None

    sipp_code: Optional[str] = None
    vehicle_class_id: str

    home_location_id: str
    current_location_id: Optional[str] = None
    status: VehicleStatus

    plate_number: Optional[str] = None
    plate_jurisdiction: Optional[str] = None
    odometer_current: int
    odometer_unit: str
    fuel_level_pct: Optional[int] = None
    soc_pct: Optional[int] = None

    acquisition_cost: Optional[Decimal] = None
    residual_value: Optional[Decimal] = None
    book_value: Optional[Decimal] = None
    depreciation_method: str
    fleet_type: str

    photos: list
    telematics_device_id: Optional[str] = None

    created_at: datetime
    updated_at: datetime
    is_active: bool


# ── Status transition ────────────────────────────────────────────────────────


class VehicleStatusTransitionRequest(BaseModel):
    """POST /fleet/vehicles/{id}/status."""

    new_status: VehicleStatus
    reason: str = Field(min_length=1, max_length=500)


# ── Vehicle block schemas ────────────────────────────────────────────────────


class VehicleBlockCreate(BaseModel):
    """POST /fleet/blocks."""

    vehicle_id: str
    block_type: VehicleBlockType
    start_dt: datetime
    end_dt: datetime
    reason: Optional[str] = Field(default=None, max_length=500)
    reservation_id: Optional[str] = None
    work_order_id: Optional[str] = None
    is_hard_block: bool = False

    @model_validator(mode="after")
    def end_after_start(self) -> "VehicleBlockCreate":
        if self.end_dt <= self.start_dt:
            raise ValueError("end_dt must be after start_dt")
        return self


class VehicleBlockUpdate(BaseModel):
    """PATCH /fleet/blocks/{block_id}."""
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class VehicleBlockResponse(BaseModel):
    model_config = {"from_attributes": True}

    block_id: str
    vehicle_id: str
    tenant_id: str
    block_type: str
    start_time: datetime
    end_time: datetime
    reservation_id: Optional[str] = None
    work_order_id: Optional[str] = None
    is_hard_block: bool
    notes: Optional[str] = None
    created_by: str
    created_at: datetime


# ── Availability schemas ──────────────────────────────────────────────────────


class AvailabilityQuery(BaseModel):
    """Query params for GET /fleet/availability."""

    location_id: str
    vehicle_class_id: str
    pickup_dt: datetime
    dropoff_dt: datetime

    @model_validator(mode="after")
    def dropoff_after_pickup(self) -> "AvailabilityQuery":
        if self.dropoff_dt <= self.pickup_dt:
            raise ValueError("dropoff_dt must be after pickup_dt")
        return self


class AvailabilityResponse(BaseModel):
    """Availability result — vehicle list only included for manager roles."""

    class_id: str
    location_id: str
    pickup_dt: datetime
    dropoff_dt: datetime
    available_count: int
    is_available: bool
    cache_hit: bool = False
    vehicles: Optional[list[VehicleResponse]] = None  # Manager-only


# ── Bulk import ───────────────────────────────────────────────────────────────


class BulkImportResult(BaseModel):
    """Result of POST /fleet/vehicles/bulk-import."""

    total_rows: int
    created: int
    skipped: int
    errors: list[dict]  # Each: {"row": int, "vin": str, "reason": str}
