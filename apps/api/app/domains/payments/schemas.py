"""Payments domain Pydantic v2 schemas."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class PaymentMethod(str, Enum):
    CREDIT_CARD = "CREDIT_CARD"
    DEBIT_CARD = "DEBIT_CARD"
    DIGITAL_WALLET = "DIGITAL_WALLET"
    CASH = "CASH"
    DIRECT_BILL = "DIRECT_BILL"
    ACH = "ACH"
    WIRE = "WIRE"
    FUEL_CARD = "FUEL_CARD"


class PaymentStatus(str, Enum):
    PENDING = "PENDING"
    AUTHORIZED = "AUTHORIZED"
    CAPTURED = "CAPTURED"
    PARTIALLY_CAPTURED = "PARTIALLY_CAPTURED"
    REFUNDED = "REFUNDED"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"
    FAILED = "FAILED"
    VOIDED = "VOIDED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"
    DISPUTED = "DISPUTED"
    CANCELLED = "CANCELLED"


class PaymentType(str, Enum):
    PREAUTH = "PREAUTH"
    CAPTURE = "CAPTURE"
    INCREMENTAL_AUTH = "INCREMENTAL_AUTH"
    REFUND = "REFUND"
    VOID = "VOID"
    CHARGEBACK = "CHARGEBACK"
    CHARGEBACK_REVERSAL = "CHARGEBACK_REVERSAL"


# ── Request schemas ───────────────────────────────────────────────────────────

class InitiatePreAuthRequest(BaseModel):
    """Body for POST /payments/pre-auth."""
    reservation_id: UUID
    customer_id: UUID
    payment_method_id: str = Field(description="Stripe pm_xxx token")
    deposit_amount: Decimal = Field(gt=Decimal("0"))
    currency: str = Field(default="USD", min_length=3, max_length=3)
    statement_descriptor: Optional[str] = Field(default=None, max_length=22)
    metadata: dict = Field(default_factory=dict)


class CaptureRequest(BaseModel):
    """Body for POST /payments/capture."""
    payment_id: UUID
    rental_agreement_id: UUID
    # Capture formula inputs (all Decimal — never float)
    base_rental_amount: Decimal = Field(ge=Decimal("0"))
    extras_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    time_extension_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    fuel_charge_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    mileage_overage_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    damage_charge_amount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    deposit_already_paid: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    line_items: list[dict] = Field(default_factory=list)


class VoidRequest(BaseModel):
    """Body for POST /payments/void."""
    payment_id: UUID
    reason: Optional[str] = Field(default=None, max_length=500)


class RefundRequest(BaseModel):
    """Body for POST /payments/refund."""
    payment_id: UUID
    amount: Decimal = Field(gt=Decimal("0"))
    reason: str = Field(max_length=500)
    initiated_by: UUID
    # Goodwill refund path (agent-issued, bypasses manager approval)
    is_goodwill: bool = False
    goodwill_under: Optional[Decimal] = None   # agent authority ceiling
    goodwill_session_id: Optional[str] = None  # agent session for ledger
    goodwill_customer_id: Optional[UUID] = None
    goodwill_ra_id: Optional[UUID] = None


class WebhookEvent(BaseModel):
    """Internal representation of a parsed Stripe webhook event."""
    event_id: str
    event_type: str
    payload: dict[str, Any]
    stripe_signature: str


# ── Response schemas ──────────────────────────────────────────────────────────

class PreAuthResponse(BaseModel):
    """Returned from POST /payments/pre-auth."""
    payment_id: UUID
    stripe_payment_intent_id: str
    client_secret: Optional[str] = None  # Present if 3DS required
    status: PaymentStatus
    amount_authorized: Decimal
    currency: str
    auth_expiry_at: Optional[datetime] = None
    gateway_session_token: Optional[str] = None   # Tyro iClient session token (None for Stripe)
    iclient_sdk_url: Optional[str] = None         # Set from settings when gateway=TYRO


class CaptureResponse(BaseModel):
    """Returned from POST /payments/capture."""
    payment_id: UUID
    captured_amount: Decimal
    stripe_charge_id: str
    captured_at: datetime
    receipt_url: Optional[str] = None


class PaymentResponse(BaseModel):
    """Full payment record — returned from GET /payments/{id}."""
    model_config = {"from_attributes": True}

    payment_id: UUID
    tenant_id: UUID
    rental_agreement_id: Optional[UUID] = None
    reservation_id: Optional[UUID] = None
    payment_type: PaymentType
    payment_method: PaymentMethod
    status: PaymentStatus
    amount: Decimal
    currency: str
    refunded_amount: Decimal
    gateway: str
    gateway_payment_id: Optional[str] = None
    network_txn_id: Optional[str] = None
    card_last4: Optional[str] = None
    card_brand: Optional[str] = None
    card_expiry_month: Optional[int] = None
    card_expiry_year: Optional[int] = None
    authorized_at: Optional[datetime] = None
    captured_at: Optional[datetime] = None
    refunded_at: Optional[datetime] = None
    auth_expiry_at: Optional[datetime] = None
    requires_approval: bool = False
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class GLJournalEntry(BaseModel):
    """General Ledger journal entry produced at capture time."""
    entry_type: str
    debit_account: str
    credit_account: str
    amount: Decimal
    description: str
    reference_id: str
