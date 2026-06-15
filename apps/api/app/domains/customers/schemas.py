"""Customer domain Pydantic v2 schemas."""
from __future__ import annotations

from datetime import datetime, date
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── Enumerations ──────────────────────────────────────────────────────────────

class DNRScope(str, Enum):
    """GAP-002: REGIONAL replaces BRAND."""
    LOCATION = "LOCATION"
    REGIONAL = "REGIONAL"
    NETWORK = "NETWORK"


class AccountType(str, Enum):
    INDIVIDUAL = "INDIVIDUAL"
    CORPORATE_EMPLOYEE = "CORPORATE_EMPLOYEE"
    TRAVEL_AGENT = "TRAVEL_AGENT"
    INSURANCE_CLAIMANT = "INSURANCE_CLAIMANT"
    LOYALTY_MEMBER = "LOYALTY_MEMBER"


class AccountStatus(str, Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    BLACKLISTED = "BLACKLISTED"
    ANONYMIZED = "ANONYMIZED"


class KYCStatus(str, Enum):
    UNVERIFIED = "UNVERIFIED"
    TIER_1_PENDING = "TIER_1_PENDING"
    TIER_1_COMPLETE = "TIER_1_COMPLETE"
    TIER_2_PENDING = "TIER_2_PENDING"
    TIER_2_COMPLETE = "TIER_2_COMPLETE"
    FAILED = "FAILED"
    FLAGGED = "FLAGGED"


# ── Request Schemas ───────────────────────────────────────────────────────────

class CustomerCreate(BaseModel):
    """Required fields for new customer creation."""
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: str = Field(pattern=r"^[^@]+@[^@]+\.[^@]+$")
    phone: str = Field(max_length=30)

    # Optional PII
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = Field(default=None, max_length=2)

    # Optional driver's license
    dl_number: Optional[str] = Field(default=None, max_length=30)
    dl_state: Optional[str] = Field(default=None, max_length=10)
    dl_country: Optional[str] = Field(default=None, max_length=2)
    dl_expiry: Optional[date] = None
    dl_dob: Optional[date] = None

    # Account defaults
    account_type: AccountType = AccountType.INDIVIDUAL
    language_code: str = Field(default="en-US", max_length=5)
    marketing_opt_in: bool = False


class CustomerUpdate(BaseModel):
    """All fields optional for partial update (PATCH semantics)."""
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    email: Optional[str] = Field(default=None, pattern=r"^[^@]+@[^@]+\.[^@]+$")
    phone: Optional[str] = Field(default=None, max_length=30)
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = Field(default=None, max_length=2)
    dl_number: Optional[str] = Field(default=None, max_length=30)
    dl_state: Optional[str] = Field(default=None, max_length=10)
    dl_country: Optional[str] = Field(default=None, max_length=2)
    dl_expiry: Optional[date] = None
    dl_dob: Optional[date] = None
    account_type: Optional[AccountType] = None
    language_code: Optional[str] = Field(default=None, max_length=5)
    comm_opt_email: Optional[bool] = None
    comm_opt_sms: Optional[bool] = None
    comm_opt_marketing: Optional[bool] = None


class DNRCreate(BaseModel):
    """Request body for adding a DNR flag."""
    reason_code: str = Field(min_length=1, max_length=100)
    scope: DNRScope
    expires_at: Optional[date] = None
    notes: str = Field(min_length=5, max_length=500)
    documentation_url: Optional[str] = Field(default=None, max_length=500)
    # Required when scope=LOCATION
    location_id: Optional[UUID] = None

    @field_validator("location_id")
    @classmethod
    def location_required_for_location_scope(
        cls, v: Optional[UUID], info
    ) -> Optional[UUID]:
        data = info.data
        if data.get("scope") == DNRScope.LOCATION and v is None:
            raise ValueError("location_id is required when scope=LOCATION")
        return v


class GDPRErasureRequest(BaseModel):
    """GDPR Article 17 right-to-erasure request."""
    reason: str = Field(min_length=5, max_length=500)
    verified_identity: bool = Field(
        description="Agent must confirm customer identity was verified"
    )


class CustomerMergeRequest(BaseModel):
    """Merge two duplicate customer records."""
    source_id: UUID = Field(description="Customer to anonymize after merge")
    target_id: UUID = Field(description="Customer that absorbs all records")
    merge_reason: str = Field(min_length=5, max_length=500)


class CustomerSearchQuery(BaseModel):
    """Fulltext search query for customer lookup at counter."""
    q: Optional[str] = Field(default=None, description="Fulltext: name/email/phone/DL")
    dnr_only: bool = False
    limit: int = Field(default=20, le=50)
    offset: int = Field(default=0, ge=0)


# ── Response Schemas ──────────────────────────────────────────────────────────

class DNRResponse(BaseModel):
    """DNR status — only visible to counter agents, never the customer."""
    model_config = {"from_attributes": True}

    dnr_flag: bool
    scope: Optional[DNRScope] = None
    reason: Optional[str] = None
    added_by: Optional[str] = None
    added_at: Optional[datetime] = None
    expires_at: Optional[date] = None


class DNRCheckResult(BaseModel):
    """Result of a DNR check at checkout/reservation time."""
    customer_id: UUID
    is_blocked: bool
    # reason is visible to counter agents only — never exposed to customer
    scope: Optional[DNRScope] = None
    reason: Optional[str] = None
    set_at: Optional[datetime] = None
    set_by_location_id: Optional[UUID] = None


class CustomerResponse(BaseModel):
    """
    Full customer record.

    DL fields (dl_number, dl_state, dl_country) are masked to last-4 for
    non-manager roles. Masking is applied in the router/service layer, not here.
    """
    model_config = {"from_attributes": True}

    customer_id: str
    tenant_id: str
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None
    account_type: Optional[str] = None
    account_status: Optional[str] = None
    kyc_status: Optional[str] = None

    # DL fields — may be masked at API layer
    dl_number: Optional[str] = None
    dl_state: Optional[str] = None
    dl_country: Optional[str] = None
    dl_expiry: Optional[date] = None
    dl_dob: Optional[date] = None

    # Loyalty
    loyalty_number: Optional[str] = None
    loyalty_tier: Optional[str] = None
    loyalty_points: int = 0

    # DNR — only included when role has permission
    dnr_flag: bool = False
    dnr_scope: Optional[str] = None

    # GDPR
    anonymized_at: Optional[datetime] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
