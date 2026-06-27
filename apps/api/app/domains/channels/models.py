from __future__ import annotations
from datetime import datetime, date
from typing import Optional
from sqlalchemy import Text, Boolean, JSON, Date
from sqlalchemy.dialects.postgresql import UUID as SAUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
import uuid


class Base(DeclarativeBase):
    pass


class OTAChannel(Base):
    __tablename__ = "ota_channels"
    channel_id: Mapped[uuid.UUID] = mapped_column(SAUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(SAUUID(as_uuid=True), nullable=False)
    channel_name: Mapped[str] = mapped_column(Text, nullable=False)
    api_key: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    api_secret: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    property_id: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    last_polled_at: Mapped[Optional[datetime]]
    webhook_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)


class OTALead(Base):
    __tablename__ = "ota_leads"
    lead_id: Mapped[uuid.UUID] = mapped_column(SAUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(SAUUID(as_uuid=True), nullable=False)
    channel_name: Mapped[str] = mapped_column(Text, nullable=False)
    ota_booking_ref: Mapped[str] = mapped_column(Text, nullable=False)
    customer_name: Mapped[str] = mapped_column(Text, nullable=False)
    customer_email: Mapped[Optional[str]] = mapped_column(Text)
    customer_phone: Mapped[Optional[str]] = mapped_column(Text)
    pickup_date: Mapped[Optional[date]] = mapped_column(Date)
    return_date: Mapped[Optional[date]] = mapped_column(Date)
    vehicle_class_requested: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="PENDING")
    internal_reservation_id: Mapped[Optional[uuid.UUID]] = mapped_column(SAUUID(as_uuid=True))
    raw_payload: Mapped[dict] = mapped_column(JSON, nullable=False, server_default="{}")
    received_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    actioned_at: Mapped[Optional[datetime]]
    actioned_by: Mapped[Optional[uuid.UUID]] = mapped_column(SAUUID(as_uuid=True))
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
