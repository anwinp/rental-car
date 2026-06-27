"""Checkout / Counter Operations Pydantic v2 schemas."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Enumerations ──────────────────────────────────────────────────────────────

class RentalAgreementStatus(str, Enum):
    ACTIVE = "ACTIVE"
    EXTENDED = "EXTENDED"
    RETURNED = "RETURNED"
    CLOSED = "CLOSED"
    DISPUTED = "DISPUTED"


class ShiftType(str, Enum):
    OPEN = "OPEN"
    CLOSE = "CLOSE"


# ── Checkout ──────────────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    """
    Counter agent checkout request.

    Either reservation_id (for a pre-booked customer) or walk_up=True
    plus vehicle_class_id must be provided.
    """
    reservation_id: Optional[UUID] = None
    walk_up: bool = False
    vehicle_class_id: Optional[UUID] = Field(
        default=None,
        description="Required when walk_up=True"
    )
    # For walk-up: pre-created customer_id to use instead of generating a random UUID
    customer_id: Optional[UUID] = None
    # Agent may specify a vehicle; if None, service auto-assigns
    vehicle_id: Optional[UUID] = None

    # Checkout readings
    odometer_out: int = Field(ge=0)
    fuel_level_out: int = Field(
        ge=0, le=8, description="Fuel level 0-8 (0=empty, 8=full)"
    )

    # Extras selected at counter
    extras: list[UUID] = Field(default_factory=list)

    # Signature metadata (hash of signature image, not raw bytes)
    customer_signature_hash: Optional[str] = None
    agent_notes: Optional[str] = Field(default=None, max_length=2000)

    # Admin-only: bypass Stripe pre-auth check (e.g. corporate/net-30 accounts)
    admin_bypass_preauth: bool = False


class CheckoutResponse(BaseModel):
    """Response after successful checkout."""
    rental_agreement_id: UUID
    ra_number: str
    vehicle_id: UUID
    vin: str
    customer_id: UUID
    extras_snapshot: list
    pre_auth_status: str
    status: str
    checked_out_at: datetime


# ── Check-In ──────────────────────────────────────────────────────────────────

class CheckInRequest(BaseModel):
    """Counter agent check-in request."""
    rental_agreement_id: UUID
    odometer_in: int = Field(ge=0)
    fuel_level_in: int = Field(ge=0, le=8)
    agent_notes: Optional[str] = Field(default=None, max_length=2000)
    return_condition: str = Field(
        default="NO_DAMAGE",
        description="NO_DAMAGE | DAMAGE_FOUND | PENDING_INSPECTION"
    )
    damage_charge_amount: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0"))


class CheckInResponse(BaseModel):
    """Response with estimated charges after check-in."""
    rental_agreement_id: UUID
    returned_at: datetime
    time_extension_charge: Decimal = Decimal("0.00")
    fuel_charge: Decimal = Decimal("0.00")
    mileage_overage_charge: Decimal = Decimal("0.00")
    final_total_estimate: Decimal = Decimal("0.00")
    vehicle_status: str


# ── Shift Management ──────────────────────────────────────────────────────────

class ShiftOpenRequest(BaseModel):
    """Open a counter shift."""
    opening_cash: Decimal = Field(ge=0, description="Cash on hand at shift start (dollars)")
    fleet_count_actual: int = Field(ge=0, description="Physical vehicle count at lot")
    notes: Optional[str] = Field(default=None, max_length=1000)


class ShiftCloseRequest(BaseModel):
    """Close a counter shift."""
    closing_cash: Decimal = Field(ge=0, description="Cash on hand at shift end (dollars)")
    credit_card_total: Decimal = Field(
        default=Decimal("0.00"),
        description="Total card payments collected this shift"
    )
    notes: Optional[str] = Field(default=None, max_length=1000)


class ShiftReport(BaseModel):
    """Summary report returned when closing a shift."""
    shift_id: UUID
    location_id: UUID
    agent_id: UUID
    shift_opened_at: datetime
    shift_closed_at: datetime
    opening_cash: Decimal
    closing_cash: Decimal
    expected_cash: Decimal
    cash_variance: Decimal
    rentals_out: int = 0
    rentals_in: int = 0
    variance_note_required: bool = False


# ── Vehicle Swap ──────────────────────────────────────────────────────────────

class VehicleSwapRequest(BaseModel):
    """Request a vehicle swap for an active rental."""
    rental_agreement_id: UUID
    new_vehicle_id: UUID
    reason: str = Field(min_length=5, max_length=500)


# ── Rental Agreement Read ─────────────────────────────────────────────────────

class ActiveRentalItem(BaseModel):
    """Enriched active rental — RA joined with customer, vehicle, and reservation."""
    model_config = {"from_attributes": True}

    ra_id: str
    ra_number: str
    reservation_id: Optional[str] = None
    confirmation_number: Optional[str] = None
    customer_id: str
    customer_name: str
    customer_email: str
    vehicle_id: str
    vehicle_make: str
    vehicle_model: str
    model_year: int
    plate_number: Optional[str] = None
    status: str
    odometer_out: int
    fuel_level_out_pct: Optional[int] = None
    created_at: Optional[datetime] = None
    scheduled_return_date: Optional[datetime] = None
    reservation_total: Optional[Decimal] = None


class RentalAgreementResponse(BaseModel):
    """Full RA read model."""
    model_config = {"from_attributes": True}

    ra_id: str
    tenant_id: str
    ra_number: str
    reservation_id: Optional[str] = None
    customer_id: str
    vehicle_id: str
    vin_at_checkout: str
    odometer_out: int
    fuel_level_out_pct: Optional[int] = None
    odometer_in: Optional[int] = None
    fuel_level_in_pct: Optional[int] = None
    actual_return_datetime: Optional[datetime] = None
    extras_snapshot: list = Field(default_factory=list)
    status: str
    preauth_id: Optional[str] = None
    preauth_amount: Optional[Decimal] = None
    swapped_from_ra_id: Optional[str] = None
    swapped_to_ra_id: Optional[str] = None
    is_training: bool = False
    agent_notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
