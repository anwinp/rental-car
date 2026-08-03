"""Damage & Inspections ORM model — SQLAlchemy 2.0 mapped classes."""
from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Date, Integer, Numeric, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.pg_types import pg_enum


class Base(DeclarativeBase):
    pass


class DamageClaim(Base):
    """
    Maps to public.damage_claims.

    Lifecycle status values per DDL enum claim_status:
      OPEN → ESTIMATE_SENT → CUSTOMER_ACKNOWLEDGED → REPAIR_IN_PROGRESS
           → REPAIR_COMPLETE → INVOICED → PAID
      DISPUTED → IN_LITIGATION → PAID or WRITTEN_OFF

    Zone data stored as JSONB list of:
      {zone: str, type: str, severity: str, photo_urls: list[str]}

    Pre/post inspection snapshots stored as JSONB (zone-keyed dicts).
    """

    __tablename__ = "damage_claims"

    # ── Primary key ───────────────────────────────────────────────────────────
    claim_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)

    # CLM-YYYYMMDD-XXXXX — unique per tenant (per DDL constraint)
    claim_reference: Mapped[str] = mapped_column(Text, nullable=False)

    # ── Foreign keys ──────────────────────────────────────────────────────────
    rental_agreement_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    vehicle_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    customer_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)

    # ── Discovery ─────────────────────────────────────────────────────────────
    discovered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    discovered_by: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    discovery_type: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="RETURN_INSPECTION"
    )

    # ── Damage details ────────────────────────────────────────────────────────
    damage_zone: Mapped[str] = mapped_column(Text, nullable=False)
    damage_type: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(pg_enum("damage_severity"), nullable=False, server_default="GRADE_2_MINOR")
    damage_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # JSONB arrays of photo records: [{zone, type, severity, photo_urls}]
    photos: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")

    # Inspection snapshots for pre/post comparison
    pre_rental_inspection_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    pre_inspection_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    post_inspection_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Zone-level damage data: [{zone, type, severity, photo_urls}]
    zone_data: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    customer_acknowledged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    customer_ack_signature_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── CDW / insurance ───────────────────────────────────────────────────────
    cdw_on_agreement: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    cdw_voided: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    cdw_void_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Alias: cdw_covered = cdw_on_agreement AND NOT cdw_voided
    claim_type: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Financials ────────────────────────────────────────────────────────────
    repair_estimate: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    repair_actual: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    loss_of_use_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    loss_of_use_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    loss_of_use_total: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    admin_fee: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )
    diminished_value: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    total_claim_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    amount_collected: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="0"
    )
    amount_written_off: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    # ── Third-party ───────────────────────────────────────────────────────────
    third_party_carrier: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    third_party_policy_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    subrogation_claim_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    subrogation_recovery: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)

    # ── Status & assignment ───────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(pg_enum("claim_status"), nullable=False, server_default="OPEN")
    assigned_to: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # Inspector / adjuster
    inspector_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    adjuster_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # ── Repair ────────────────────────────────────────────────────────────────
    repair_facility: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    repair_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    repair_end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    work_order_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # ── Chargeback ────────────────────────────────────────────────────────────
    chargeback_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    chargeback_response_due: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # ── BaseRepository compatibility ──────────────────────────────────────────
    @property
    def id(self) -> str:
        return self.claim_id

    @property
    def deleted_at(self) -> None:
        """Damage claims are never soft-deleted; satisfy BaseRepository interface."""
        return None

    @property
    def cdw_covered(self) -> bool:
        """Computed: CDW applies iff CDW was on the agreement and has NOT been voided."""
        return self.cdw_on_agreement and not self.cdw_voided

    @property
    def estimated_repair_cost(self) -> Optional[Decimal]:
        """Alias for repair_estimate (used in service layer)."""
        return self.repair_estimate

    @property
    def approved_repair_cost(self) -> Optional[Decimal]:
        """Alias for repair_actual (approved repair cost)."""
        return self.repair_actual
