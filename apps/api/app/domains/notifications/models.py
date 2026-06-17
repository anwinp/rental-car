"""Notifications domain ORM models — notification_templates, notification_log."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class NotificationTemplate(Base):
    """
    Maps to public.notification_templates.
    tenant_id is nullable — NULL rows are system-wide defaults.
    Tenants may override system defaults by inserting rows with their tenant_id
    for the same (event_code, channel) combination.
    """

    __tablename__ = "notification_templates"

    template_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    # NULL = system-wide template; non-NULL = tenant override
    tenant_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    # Event code — e.g. RESERVATION_CONFIRMED, PAYMENT_AUTHORIZED
    event_code: Mapped[str] = mapped_column(Text, nullable=False)

    # Channel — EMAIL | SMS | PUSH
    channel: Mapped[str] = mapped_column(Text, nullable=False)

    # Subject is used for EMAIL only (NULL for SMS/PUSH)
    subject: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Jinja2 template body — HTML for EMAIL, plain text for SMS/PUSH
    body_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Merge variable names declared by this template for validation
    merge_variables: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class NotificationLog(Base):
    """
    Maps to public.notification_log (partitioned by created_at).

    GDPR compliance:
      * body_hash stores SHA-256 of the rendered body — NOT the body itself.
      * recipient stores only the delivery address (email or phone), never full PII.
    """

    __tablename__ = "notification_log"

    # Composite PK required by pg_partman: (log_id, created_at)
    log_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, server_default=func.now()
    )

    __table_args__ = ({"schema": None},)

    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    customer_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    staff_user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)

    event_code: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    recipient: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # SHA-256 of rendered body only — GDPR compliance (body never stored)
    body_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="QUEUED")
    # Canonical values: QUEUED | SENT | DELIVERED | FAILED | BOUNCED

    # External message ID from SendGrid (sgXxx) or Twilio (SMxxx)
    gateway_msg_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
