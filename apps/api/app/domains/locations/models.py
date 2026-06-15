"""Location ORM model — SQLAlchemy 2.0 mapped classes."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Location(Base):
    """
    Maps to public.locations.

    location_type values from DDL:
      AIRPORT, DOWNTOWN, NEIGHBORHOOD, HOTEL, DEALER, DROP_HUB, DELIVERY_ONLY
    (The task spec uses a simpler set; we store whatever the DB accepts.)
    """

    __tablename__ = "locations"

    location_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    short_code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    location_type: Mapped[str] = mapped_column(Text, nullable=False)

    # Address fields
    address_line1: Mapped[str] = mapped_column(Text, nullable=False)
    address_line2: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[str] = mapped_column(Text, nullable=False)
    state_province: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)
    postal_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # GPS coordinates
    latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6), nullable=True)

    # Airport-specific
    airport_code: Mapped[Optional[str]] = mapped_column(String(3), nullable=True)

    # Contact
    phone: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Configuration
    timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="America/New_York"
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="USD")

    # Operating hours: JSONB e.g. {"mon": {"open": "08:00", "close": "20:00"}, ...}
    hours_of_operation: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    holiday_schedule: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )

    # Tax & booking rules
    tax_template_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )
    no_show_grace_minutes: Mapped[int] = mapped_column(nullable=False, server_default="120")
    turnaround_minutes_by_class: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    overbooking_buffer_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="0"
    )

    # Region / hierarchy
    region_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), nullable=True)
    parent_location_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), nullable=True
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ── Convenience aliases for BaseRepository compatibility ─────────────────

    @property
    def id(self) -> str:
        return self.location_id
