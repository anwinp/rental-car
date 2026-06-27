"""Reservations domain Pydantic v2 schemas."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ── Enums ─────────────────────────────────────────────────────────────────────


class ReservationStatus(str, Enum):
    """
    Canonical reservation lifecycle statuses.
    GAP-004: CHECKED_OUT (not ACTIVE).
    """
    QUOTE = "QUOTE"
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    CHECKED_OUT = "CHECKED_OUT"    # GAP-004: canonical value
    RETURNING = "RETURNING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"
    MODIFIED = "MODIFIED"
    EXTENDED = "EXTENDED"
    ON_HOLD = "ON_HOLD"
    DISPUTED = "DISPUTED"


class BookingChannel(str, Enum):
    DIRECT_WEB = "DIRECT_WEB"
    MOBILE_APP = "MOBILE_APP"
    CALL_CENTER = "CALL_CENTER"
    COUNTER = "COUNTER"
    WALK_UP = "WALK_UP"
    OTA = "OTA"
    GDS = "GDS"
    KIOSK = "KIOSK"
    API = "API"


# ── Sub-schemas ───────────────────────────────────────────────────────────────


class GuestInfo(BaseModel):
    """Guest (unauthenticated) customer info for booking without an account."""
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: str = Field(pattern=r"^[^@]+@[^@]+\.[^@]+$")
    phone: Optional[str] = Field(default=None, max_length=30)


class ExtraSelection(BaseModel):
    """Selected extra in a reservation."""
    extra_id: UUID
    quantity: int = Field(default=1, ge=1)


# ── Request Schemas ───────────────────────────────────────────────────────────


class ReservationCreate(BaseModel):
    """
    Create a new reservation.

    rate_quote_token is mandatory — validated against Redis (30s TTL).
    Either customer_id or guest_info must be provided.
    """
    customer_id: Optional[UUID] = None
    guest_info: Optional[GuestInfo] = None

    location_id: UUID
    # Optional one-way drop-off location. Defaults to location_id (round-trip).
    dropoff_location_id: Optional[UUID] = None
    vehicle_class_id: UUID

    pickup_dt: datetime
    dropoff_dt: datetime

    # The rate quote token from POST /pricing/quote — expires in 30s
    rate_quote_token: str = Field(
        min_length=64,
        max_length=64,
        description="SHA-256 hex token from rate quote; must be < 30s old",
    )

    extras: list[ExtraSelection] = Field(default_factory=list)

    promo_code: Optional[str] = Field(default=None, max_length=50)
    cdp_code: Optional[str] = Field(default=None, max_length=50)
    source: BookingChannel = BookingChannel.DIRECT_WEB
    notes: Optional[str] = Field(default=None, max_length=2000)
    flight_number: Optional[str] = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def validate_customer_or_guest(self) -> "ReservationCreate":
        if self.customer_id is None and self.guest_info is None:
            raise ValueError("Either customer_id or guest_info must be provided")
        return self

    @model_validator(mode="after")
    def validate_dates(self) -> "ReservationCreate":
        if self.dropoff_dt <= self.pickup_dt:
            raise ValueError("dropoff_dt must be strictly after pickup_dt")
        max_days = 365
        duration_days = (self.dropoff_dt - self.pickup_dt).days
        if duration_days > max_days:
            raise ValueError(
                f"Rental duration cannot exceed {max_days} days (got {duration_days})."
            )
        return self


class ReservationModify(BaseModel):
    """
    Modify an existing CONFIRMED reservation.

    At least one field must be set. A re-quote is triggered automatically
    when dates or vehicle class change.
    """
    pickup_dt: Optional[datetime] = None
    dropoff_dt: Optional[datetime] = None
    vehicle_class_id: Optional[UUID] = None
    extras: Optional[list[ExtraSelection]] = None
    notes: Optional[str] = Field(default=None, max_length=2000)
    change_reason: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def at_least_one_field(self) -> "ReservationModify":
        if all(
            v is None
            for v in (
                self.pickup_dt,
                self.dropoff_dt,
                self.vehicle_class_id,
                self.extras,
            )
        ):
            raise ValueError(
                "At least one of pickup_dt, dropoff_dt, vehicle_class_id, or extras must be set."
            )
        return self


class CancellationRequest(BaseModel):
    """Cancel a reservation."""
    reason: str = Field(min_length=5, max_length=500)
    waive_fee: bool = Field(
        default=False,
        description="Agent override to waive cancellation fee. Requires MANAGER role.",
    )


# ── Response Schemas ──────────────────────────────────────────────────────────


class ReservationResponse(BaseModel):
    """Full reservation read response."""
    model_config = {"from_attributes": True}

    reservation_id: str
    tenant_id: str
    confirmation_number: str
    status: str

    customer_id: str
    corporate_account_id: Optional[str]

    pickup_location_id: str
    dropoff_location_id: str
    pickup_datetime: datetime
    return_datetime: datetime
    actual_return_datetime: Optional[datetime]

    vehicle_class_id: str
    assigned_vehicle_id: Optional[str]

    rate_code_id: Optional[str]
    cdp_code: Optional[str]
    promo_code: Optional[str]
    currency: str

    base_rate_daily: Optional[Decimal]
    base_total: Optional[Decimal]
    extras_total: Decimal
    discount_total: Decimal
    taxes_total: Decimal
    grand_total: Optional[Decimal]
    deposit_amount: Decimal

    extras_snapshot: list
    taxes_snapshot: list

    channel: str
    special_instructions: Optional[str]
    flight_number: Optional[str]

    no_show_fee_charged: Optional[Decimal]
    no_show_at: Optional[datetime]

    loyalty_points_earned: int
    loyalty_points_redeemed: int

    rate_quote_token: Optional[str]
    version: int

    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime]


class CancellationResult(BaseModel):
    """Result of a reservation cancellation."""
    reservation_id: str
    confirmation_number: str
    refund_amount: Decimal
    cancellation_fee: Decimal
    policy_tier: str
    refund_payment_id: Optional[str] = None


class CancellationPreview(BaseModel):
    """Fee preview without actually cancelling."""
    reservation_id: str
    hours_until_pickup: Decimal
    refund_amount: Decimal
    cancellation_fee: Decimal
    policy_tier: str
    deposit_paid: Decimal


# ── List / Filter Schemas ─────────────────────────────────────────────────────


class ReservationListFilter(BaseModel):
    """Query parameters for listing reservations."""
    status: Optional[ReservationStatus] = None
    location_id: Optional[UUID] = None
    customer_id: Optional[UUID] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    source: Optional[BookingChannel] = None
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
