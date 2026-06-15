"""Pricing domain Pydantic v2 schemas."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator


# ── Enums ────────────────────────────────────────────────────────────────────


class RateType(str, Enum):
    RACK = "RACK"
    CORPORATE = "CORPORATE"
    GOVERNMENT = "GOVERNMENT"
    INSURANCE_REPLACEMENT = "INSURANCE_REPLACEMENT"
    PROMOTIONAL = "PROMOTIONAL"
    OTA_NET = "OTA_NET"
    WHOLESALE = "WHOLESALE"
    MEMBERSHIP = "MEMBERSHIP"
    TOUR_OPERATOR = "TOUR_OPERATOR"
    LOYALTY_REDEMPTION = "LOYALTY_REDEMPTION"
    WEEKEND_SPECIAL = "WEEKEND_SPECIAL"


class RateCodeStatus(str, Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class ExtraPricingType(str, Enum):
    PER_DAY = "PER_DAY"
    PER_RENTAL = "PER_RENTAL"
    FLAT = "FLAT"


class TaxTreatment(str, Enum):
    TAXABLE = "TAXABLE"
    EXEMPT = "EXEMPT"


class LineItemType(str, Enum):
    BASE = "BASE"
    EXTRA = "EXTRA"
    FEE = "FEE"
    TAX = "TAX"
    DISCOUNT = "DISCOUNT"


# ── Rate Code Schemas ─────────────────────────────────────────────────────────


class RateCodeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    description: str = Field(min_length=1, max_length=500)
    rate_type: RateType
    market_segment: Optional[str] = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    valid_from: datetime
    valid_until: datetime
    blackout_dates: list[str] = Field(default_factory=list)
    day_of_week_modifiers: dict[str, float] = Field(
        default_factory=dict,
        description='e.g. {"MON": 0.95, "FRI": 1.15}',
    )
    location_scope: Literal["ALL", "SPECIFIC"] = "ALL"
    location_ids: list[UUID] = Field(default_factory=list)
    vehicle_class_scope: Literal["ALL", "SPECIFIC"] = "ALL"
    vehicle_class_ids: list[UUID] = Field(default_factory=list)
    min_rental_days: int = Field(default=1, ge=1)
    max_rental_days: Optional[int] = Field(default=None, ge=1)
    advance_booking_hours_min: Optional[int] = Field(default=None, ge=0)
    advance_booking_hours_max: Optional[int] = Field(default=None, ge=0)
    min_driver_age: Optional[int] = Field(default=None, ge=16, le=100)
    prepay_required: bool = False
    refundable: bool = True
    is_combinable: bool = False
    max_uses_total: Optional[int] = Field(default=None, ge=1)
    max_uses_per_customer: Optional[int] = Field(default=None, ge=1)
    cdp_code: Optional[str] = Field(default=None, max_length=50)
    gds_eligible: bool = False
    gds_description: Optional[str] = Field(default=None, max_length=24)

    @model_validator(mode="after")
    def validate_date_range(self) -> "RateCodeCreate":
        if self.valid_until <= self.valid_from:
            raise ValueError("valid_until must be after valid_from")
        return self


class RateCodeUpdate(BaseModel):
    description: Optional[str] = Field(default=None, max_length=500)
    blackout_dates: Optional[list[str]] = None
    day_of_week_modifiers: Optional[dict[str, float]] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    min_rental_days: Optional[int] = Field(default=None, ge=1)
    max_rental_days: Optional[int] = Field(default=None, ge=1)
    advance_booking_hours_min: Optional[int] = Field(default=None, ge=0)
    advance_booking_hours_max: Optional[int] = Field(default=None, ge=0)
    gds_eligible: Optional[bool] = None
    gds_description: Optional[str] = Field(default=None, max_length=24)


class RateCodeActivate(BaseModel):
    """Request body for activating a DRAFT rate code."""
    confirmed: bool = Field(
        default=True,
        description="Must be true — operator acknowledges all validations passed",
    )


class RateCodeResponse(BaseModel):
    model_config = {"from_attributes": True}

    rate_code_id: str
    tenant_id: str
    code: str
    description: str
    rate_type: str
    market_segment: Optional[str]
    currency: str
    status: str
    valid_from: datetime
    valid_until: datetime
    blackout_dates: list
    day_of_week_modifiers: dict
    min_rental_days: int
    max_rental_days: Optional[int]
    advance_booking_hours_min: Optional[int]
    advance_booking_hours_max: Optional[int]
    gds_eligible: bool
    gds_description: Optional[str]
    cdp_code: Optional[str]
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime]

    schedule_items: list["RateScheduleItemResponse"] = Field(default_factory=list)


# ── Rate Schedule Item Schemas ────────────────────────────────────────────────


class RateScheduleItemCreate(BaseModel):
    vehicle_class_id: UUID
    location_id: Optional[UUID] = None
    days_min: int = Field(default=1, ge=1)
    days_max: Optional[int] = Field(default=None, ge=1)
    price_per_day: Decimal = Field(gt=Decimal("0"), decimal_places=2)
    price_per_week: Optional[Decimal] = Field(default=None, gt=Decimal("0"))
    price_per_month: Optional[Decimal] = Field(default=None, gt=Decimal("0"))
    extra_day_rate: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    free_miles_per_day: Optional[int] = Field(default=None, ge=0)
    overage_rate_per_mile: Optional[Decimal] = Field(default=None, ge=Decimal("0"))


class RateScheduleItemResponse(BaseModel):
    model_config = {"from_attributes": True}

    item_id: str
    rate_code_id: str
    vehicle_class_id: str
    location_id: Optional[str]
    days_min: int
    days_max: Optional[int]
    price_per_day: Decimal
    price_per_week: Optional[Decimal]
    price_per_month: Optional[Decimal]
    extra_day_rate: Optional[Decimal]
    free_miles_per_day: Optional[int]
    overage_rate_per_mile: Optional[Decimal]


# ── Extras Schemas ────────────────────────────────────────────────────────────


class ExtrasCatalogCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=100)
    extra_type: Literal["INSURANCE", "EQUIPMENT", "FUEL", "TOLL", "SERVICE"]
    pricing_type: ExtraPricingType
    default_price: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    tax_treatment: TaxTreatment = TaxTreatment.TAXABLE
    is_active: bool = True


class ExtrasCatalogUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    default_price: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    tax_treatment: Optional[TaxTreatment] = None
    is_active: Optional[bool] = None


class ExtrasCatalogItem(BaseModel):
    model_config = {"from_attributes": True}

    extra_id: str
    code: str
    name: str
    extra_type: str
    pricing_type: str
    default_price: Optional[Decimal]
    tax_treatment: str
    is_active: bool


class ExtrasResponse(BaseModel):
    """Paginated list of extras catalog entries."""
    items: list[ExtrasCatalogItem]
    total: int


# ── Rate Quote Schemas ────────────────────────────────────────────────────────


class ExtraQuoteRequest(BaseModel):
    """A single extra with quantity requested in a rate quote."""
    extra_id: UUID
    quantity: int = Field(default=1, ge=1)


class RateQuoteRequest(BaseModel):
    location_id: UUID
    vehicle_class_id: UUID
    pickup_dt: datetime
    dropoff_dt: datetime
    extras: list[ExtraQuoteRequest] = Field(default_factory=list)
    promo_code: Optional[str] = Field(default=None, max_length=50)
    cdp_code: Optional[str] = Field(default=None, max_length=50)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @model_validator(mode="after")
    def validate_dates(self) -> "RateQuoteRequest":
        if self.dropoff_dt <= self.pickup_dt:
            raise ValueError("dropoff_dt must be after pickup_dt")
        return self

    def cache_key_input(self, tenant_id: str) -> str:
        """Deterministic string for SHA-256 cache key generation."""
        extras_json = json.dumps(
            sorted(
                [{"extra_id": str(e.extra_id), "quantity": e.quantity} for e in self.extras],
                key=lambda x: x["extra_id"],
            )
        )
        return "|".join(
            [
                tenant_id,
                str(self.location_id),
                str(self.vehicle_class_id),
                self.pickup_dt.isoformat(),
                self.dropoff_dt.isoformat(),
                extras_json,
                self.promo_code or "",
                self.cdp_code or "",
                self.currency,
            ]
        )

    def compute_quote_token(self, tenant_id: str) -> str:
        """SHA-256 hash used as quote_token and Redis cache key."""
        return hashlib.sha256(self.cache_key_input(tenant_id).encode()).hexdigest()


class RateQuoteLineItem(BaseModel):
    """One line item in the rate quote breakdown."""
    description: str
    quantity: Decimal = Field(decimal_places=6)
    unit_price: Decimal = Field(decimal_places=6)
    amount: Decimal = Field(decimal_places=6)
    type: LineItemType


class RateQuoteResponse(BaseModel):
    """
    Full rate quote.

    All monetary amounts use ISO 4217 ROUND_HALF_UP to 2dp.
    Intermediate values are kept at 6dp inside calculation but
    stored at 6dp in line items; final totals rounded to 2dp.
    """
    quote_token: str = Field(description="SHA-256 hash; Redis key; booking idempotency token")
    rate_code_id: Optional[str] = None
    location_id: str
    vehicle_class_id: str
    pickup_dt: datetime
    dropoff_dt: datetime
    currency: str
    rental_days: Decimal = Field(description="Exact day fraction, 6 decimal precision")

    line_items: list[RateQuoteLineItem]

    # Summary amounts — all ROUND_HALF_UP 2dp
    subtotal: Decimal
    taxes: Decimal
    total: Decimal

    promo_applied: bool = False
    cdp_applied: bool = False
    expires_at: datetime = Field(description="now() + 30s — matches Redis TTL")
    cache_hit: bool = False


# ── Promo Code Schemas ────────────────────────────────────────────────────────


class PromoCodeValidation(BaseModel):
    code: str
    is_valid: bool
    discount_type: Optional[Literal["PERCENT", "FIXED"]] = None
    discount_value: Optional[Decimal] = None
    error_reason: Optional[str] = None


# ── Update forward refs ───────────────────────────────────────────────────────

RateCodeResponse.model_rebuild()
