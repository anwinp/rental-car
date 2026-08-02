"""Pydantic v2 schemas for the Tenant domain."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{1,31}$")

# ── Subscription tier ────────────────────────────────────────────────────────


class SubscriptionTier(str):
    STARTER = "STARTER"
    PROFESSIONAL = "PROFESSIONAL"
    ENTERPRISE = "ENTERPRISE"


# ── Request schemas ──────────────────────────────────────────────────────────


class TenantCreate(BaseModel):
    """Payload to create a new tenant (POST /tenants)."""

    company_name: str = Field(min_length=2, max_length=120)
    slug: Optional[str] = Field(
        default=None, description="Auto-generated from company_name if omitted"
    )
    primary_email: str = Field(pattern=r"^[^@]+@[^@]+\.[^@]+$")
    primary_phone: Optional[str] = None
    currency: str = Field(
        default="USD",
        min_length=3,
        max_length=3,
        pattern=r"^[A-Z]{3}$",
        description="ISO 4217 currency code",
    )
    timezone: str = Field(
        default="America/Chicago", description="IANA timezone string"
    )
    subscription_tier: str = Field(default="STARTER")
    country_code: str = Field(
        default="US", min_length=2, max_length=2, pattern=r"^[A-Z]{2}$"
    )

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError(
                "Slug must be lowercase alphanumeric with hyphens, 2-32 chars"
            )
        return v

    @field_validator("subscription_tier")
    @classmethod
    def validate_tier(cls, v: str) -> str:
        allowed = {"STARTER", "PROFESSIONAL", "ENTERPRISE"}
        if v not in allowed:
            raise ValueError(f"subscription_tier must be one of {allowed}")
        return v


class StaffUserCreate(BaseModel):
    """First admin user created atomically with the tenant."""

    email: str = Field(pattern=r"^[^@]+@[^@]+\.[^@]+$")
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)


class TenantUpdate(BaseModel):
    """PATCH /tenants/{id} — all fields optional."""

    company_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    primary_email: Optional[str] = Field(
        default=None, pattern=r"^[^@]+@[^@]+\.[^@]+$"
    )
    primary_phone: Optional[str] = None
    currency: Optional[str] = Field(
        default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$"
    )
    timezone: Optional[str] = None
    # subscription_tier is NOT here, deliberately. PATCH /tenants/{id} is gated
    # on admin:config, which a workspace's own SYSTEM_ADMIN holds — and RLS
    # permits a bound tenant to update its own row. So exposing the field let
    # any operator send {"subscription_tier": "ENTERPRISE"}, get 200, and lift
    # their own seat and vehicle caps permanently. Migration 062's docstring
    # names that exact request as the attack it prevents; the policy it ships
    # prevents only the cross-tenant half of it.
    #
    # Plan changes belong to the platform console, which is gated on
    # is_platform_admin — a flag no tenant-facing endpoint can set.
    logo_url: Optional[str] = None
    trading_name: Optional[str] = None
    company_reg_no: Optional[str] = None
    vat_tax_id: Optional[str] = None
    billing_address: Optional[dict] = None


class TenantProvisionRequest(BaseModel):
    """Combined payload for POST /tenants — tenant details + first admin."""

    tenant: TenantCreate
    first_admin: StaffUserCreate


class ToSAcceptRequest(BaseModel):
    """POST /tenants/{id}/accept-tos."""

    tos_version: str = Field(min_length=1, max_length=50)
    ip_address: Optional[str] = None  # Falls back to request IP if omitted


# ── Response schemas ─────────────────────────────────────────────────────────


class TenantResponse(BaseModel):
    """Full tenant record returned from API."""

    model_config = {"from_attributes": True}

    tenant_id: str
    slug: str
    legal_name: str
    trading_name: Optional[str] = None
    primary_email: str
    primary_phone: Optional[str] = None
    default_currency: str
    default_timezone: str
    subscription_tier: str
    status: str
    trial_ends_at: Optional[datetime] = None
    subscription_ends_at: Optional[datetime] = None
    tos_accepted_at: Optional[datetime] = None
    tos_version: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    is_active: bool = True

    @model_validator(mode="after")
    def compute_is_active(self) -> "TenantResponse":
        self.is_active = self.status == "ACTIVE"
        return self


# ── Readiness gate ───────────────────────────────────────────────────────────


class ReadinessCheck(BaseModel):
    """Single item in the day-zero readiness checklist."""

    key: str
    label: str
    is_complete: bool
    action_url: Optional[str] = None
    detail: Optional[str] = None


class ReadinessGateStatus(BaseModel):
    """Aggregated result of all 9 day-zero readiness checks (GAP-001)."""

    tenant_id: str
    all_passed: bool
    checks: list[ReadinessCheck]  # Always exactly 9 items
