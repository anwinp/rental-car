"""Pydantic v2 schemas for the Location domain."""
from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


# ── Operating hours ──────────────────────────────────────────────────────────


class DayHours(BaseModel):
    """Open/close times for a single day."""

    open: Optional[str] = Field(
        default=None,
        description="HH:MM in 24-hour format. None means closed.",
        pattern=r"^\d{2}:\d{2}$",
    )
    close: Optional[str] = Field(
        default=None,
        description="HH:MM in 24-hour format.",
        pattern=r"^\d{2}:\d{2}$",
    )
    is_closed: bool = Field(default=False)


class HoursSchedule(BaseModel):
    """Weekly operating hours schedule keyed by abbreviated day name."""

    mon: Optional[DayHours] = None
    tue: Optional[DayHours] = None
    wed: Optional[DayHours] = None
    thu: Optional[DayHours] = None
    fri: Optional[DayHours] = None
    sat: Optional[DayHours] = None
    sun: Optional[DayHours] = None


# ── Hours compliance result ───────────────────────────────────────────────────


class HoursComplianceResult(BaseModel):
    """Result of checking pickup/dropoff times against location operating hours."""

    is_compliant: bool
    warning_message: Optional[str] = None
    is_hard_block: bool = False
    detail: Optional[str] = None


# ── Request schemas ──────────────────────────────────────────────────────────


# Valid location_type values from DDL
_LOCATION_TYPES = frozenset(
    {"AIRPORT", "DOWNTOWN", "NEIGHBORHOOD", "HOTEL", "DEALER", "DROP_HUB", "DELIVERY_ONLY"}
)


class LocationCreate(BaseModel):
    """POST /locations payload."""

    name: str = Field(min_length=1, max_length=120)
    short_code: str = Field(
        min_length=2,
        max_length=10,
        description="Unique per tenant (e.g. LAX, DFW-1)",
    )
    location_type: str = Field(description="AIRPORT | DOWNTOWN | NEIGHBORHOOD | HOTEL | DEALER | DROP_HUB | DELIVERY_ONLY")
    address_line1: str = Field(min_length=1, max_length=200)
    address_line2: Optional[str] = None
    city: str = Field(min_length=1, max_length=100)
    state_province: Optional[str] = None
    country_code: str = Field(min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")
    postal_code: Optional[str] = None
    latitude: Optional[Decimal] = Field(default=None, ge=-90, le=90)
    longitude: Optional[Decimal] = Field(default=None, ge=-180, le=180)
    airport_code: Optional[str] = Field(
        default=None,
        min_length=3,
        max_length=3,
        description="IATA airport code — required when location_type=AIRPORT",
    )
    phone: Optional[str] = None
    email: Optional[str] = None
    timezone: str = Field(default="America/New_York")
    currency: str = Field(default="USD", min_length=3, max_length=3)
    hours_of_operation: Optional[dict] = Field(default_factory=dict)
    tax_template_id: Optional[str] = None
    no_show_grace_minutes: int = Field(default=120, ge=0)
    is_active: bool = Field(default=True)

    @model_validator(mode="after")
    def airport_code_required_for_airport_type(self) -> "LocationCreate":
        if self.location_type == "AIRPORT" and not self.airport_code:
            raise ValueError("airport_code is required when location_type is AIRPORT")
        if self.location_type not in _LOCATION_TYPES:
            raise ValueError(
                f"location_type must be one of {sorted(_LOCATION_TYPES)}"
            )
        return self


class LocationUpdate(BaseModel):
    """PATCH /locations/{id} — all fields optional."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state_province: Optional[str] = None
    country_code: Optional[str] = Field(
        default=None, min_length=2, max_length=2
    )
    postal_code: Optional[str] = None
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None
    airport_code: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    timezone: Optional[str] = None
    currency: Optional[str] = None
    hours_of_operation: Optional[dict] = None
    tax_template_id: Optional[str] = None
    no_show_grace_minutes: Optional[int] = None
    is_active: Optional[bool] = None


# ── Response schemas ─────────────────────────────────────────────────────────


class LocationResponse(BaseModel):
    """Full location record returned from API."""

    model_config = {"from_attributes": True}

    location_id: str
    tenant_id: str
    short_code: str
    name: str
    location_type: str
    address_line1: str
    address_line2: Optional[str] = None
    city: str
    state_province: Optional[str] = None
    country_code: str
    postal_code: Optional[str] = None
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None
    airport_code: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    timezone: str
    currency: str
    hours_of_operation: dict
    tax_template_id: Optional[str] = None
    no_show_grace_minutes: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
