"""Payments domain ORM models — payments, processed_webhooks tables."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Payment(Base):
    """
    Maps to public.payments.

    IMPORTANT — PCI-DSS constraints:
      * card_last4 / card_brand / card_expiry_* are populated from Stripe response only
      * No raw PAN, CVV, or full card number is ever stored
    """

    __tablename__ = "payments"

    # ── Primary key ────────────────────────────────────────────────────────
    payment_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)

    # ── Relationships ───────────────────────────────────────────────────────
    rental_agreement_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    reservation_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    invoice_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # ── Payment classification ──────────────────────────────────────────────
    payment_type: Mapped[str] = mapped_column(Text, nullable=False)
    # Canonical values: PREAUTH | CAPTURE | INCREMENTAL_AUTH | REFUND | VOID |
    #                   CHARGEBACK | CHARGEBACK_REVERSAL

    payment_method: Mapped[str] = mapped_column(Text, nullable=False)
    # Canonical values: CREDIT_CARD | DEBIT_CARD | DIGITAL_WALLET |
    #                   CASH | DIRECT_BILL | ACH | WIRE | FUEL_CARD

    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="PENDING")
    # Canonical values: PENDING | AUTHORIZED | CAPTURED | REFUNDED |
    #                   PARTIALLY_REFUNDED | VOIDED | DECLINED | EXPIRED

    # ── Amounts (always Decimal — never float) ──────────────────────────────
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="USD")
    refunded_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )

    # ── Gateway / Stripe ────────────────────────────────────────────────────
    gateway: Mapped[str] = mapped_column(Text, nullable=False, server_default="STRIPE")
    gateway_payment_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Maps to: stripe_payment_intent_id for PRE-AUTH, stripe_charge_id for CAPTURE
    gateway_auth_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    network_txn_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Card metadata (from Stripe, no raw PAN) ─────────────────────────────
    card_last4: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)
    card_brand: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    card_expiry_month: Mapped[Optional[int]] = mapped_column(nullable=True)
    card_expiry_year: Mapped[Optional[int]] = mapped_column(nullable=True)
    payment_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Timestamps ──────────────────────────────────────────────────────────
    authorized_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    captured_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refunded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    auth_expiry_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Approval workflow ───────────────────────────────────────────────────
    requires_approval: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    approved_by: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Audit timestamps ────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ProcessedWebhook(Base):
    """
    Maps to public.processed_webhooks.

    Acts as an idempotency guard for Stripe webhook events.
    A unique constraint on event_id prevents double-processing.
    The INSERT and the domain handler MUST run in the SAME transaction.
    """

    __tablename__ = "processed_webhooks"

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    gateway: Mapped[str] = mapped_column(Text, nullable=False, server_default="STRIPE")
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
