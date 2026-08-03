"""Customer ORM model — SQLAlchemy 2.0 mapped classes."""
from __future__ import annotations

from datetime import datetime, date
from typing import Optional

from sqlalchemy import Boolean, DateTime, Date, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.pg_types import pg_enum


class Base(DeclarativeBase):
    pass


class Customer(Base):
    """
    Maps to public.customers.

    Column naming matches the DDL exactly.
    DNR scope uses REGIONAL (not BRAND) per GAP-002.
    """

    __tablename__ = "customers"

    # ── Identity ─────────────────────────────────────────────────────────────
    customer_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)

    # ── PII ──────────────────────────────────────────────────────────────────
    first_name: Mapped[str] = mapped_column(Text, nullable=False)
    last_name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    mobile_phone: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    alt_phone: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    nationality: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    mailing_address: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    billing_address: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # ── Driver's License ─────────────────────────────────────────────────────
    license_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    license_country: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    license_state: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    license_class: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    license_issued_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    license_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    license_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    idp_required: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # ── Account status ────────────────────────────────────────────────────────
    account_status: Mapped[str] = mapped_column(Text, nullable=False, server_default="ACTIVE")
    account_type: Mapped[str] = mapped_column(Text, nullable=False, server_default="INDIVIDUAL")
    kyc_status: Mapped[str] = mapped_column(pg_enum("kyc_status"), nullable=False, server_default="UNVERIFIED")
    corporate_account_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    # ── Loyalty ──────────────────────────────────────────────────────────────
    loyalty_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True, unique=True)
    loyalty_tier: Mapped[Optional[str]] = mapped_column(Text, nullable=True, server_default="MEMBER")
    loyalty_points: Mapped[int] = mapped_column(nullable=False, server_default="0")
    loyalty_tier_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # ── DNR (Do Not Rent) — GAP-002: REGIONAL replaces BRAND ─────────────────
    dnr_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    dnr_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dnr_scope: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dnr_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    dnr_added_by: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    dnr_incident_ref: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # ── Preferences ──────────────────────────────────────────────────────────
    preferred_class_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    preferred_transmission: Mapped[Optional[str]] = mapped_column(
        pg_enum("transmission_type"), nullable=True)
    comm_opt_email: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    comm_opt_sms: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    comm_opt_marketing: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    language_code: Mapped[str] = mapped_column(
        String(5), nullable=False, server_default="en-US"
    )

    # ── OAuth identity ────────────────────────────────────────────────────────
    oauth_google_sub: Mapped[Optional[str]] = mapped_column(Text, nullable=True, unique=False)

    # ── GDPR ──────────────────────────────────────────────────────────────────
    anonymized_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.customer_id
