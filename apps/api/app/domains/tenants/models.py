"""Tenant ORM model — SQLAlchemy 2.0 mapped classes."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Tenant(Base):
    """
    Maps to public.tenants.

    Column naming matches the DDL exactly so Alembic autogenerate produces
    no spurious diffs.
    """

    __tablename__ = "tenants"

    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    legal_name: Mapped[str] = mapped_column(Text, nullable=False)
    trading_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    company_reg_no: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vat_tax_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    primary_email: Mapped[str] = mapped_column(Text, nullable=False)
    primary_phone: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    billing_address: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    logo_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="USD")
    default_timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="America/New_York"
    )
    subscription_tier: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="STARTER"
    )
    trial_ends_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    subscription_ends_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tos_accepted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tos_version: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # IP address stored as text — inet type in DB but plain string in app
    tos_ip: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dpa_accepted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="ACTIVE")
    # Stripe customer id for SaaS billing integration
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Stripe account id for payment gateway (Connect or direct)
    stripe_account_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stripe_test_charge_succeeded: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, server_default="false"
    )
    # Notification credentials (readiness gate check #9)
    smtp_host: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sendgrid_api_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Rental agreement template
    ra_template_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Convenience property ────────────────────────────────────────────────
    @property
    def id(self) -> str:
        """Alias so BaseRepository.get() (which uses model.id) works."""
        return self.tenant_id

    @property
    def company_name(self) -> str:
        """Alias — ARCH_DOMAINS uses 'company_name'; DB column is 'legal_name'."""
        return self.legal_name

    @property
    def address(self) -> dict:
        """Alias for readiness-gate check 1."""
        return self.billing_address
