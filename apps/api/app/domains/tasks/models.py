from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlalchemy import Text, UUID as SAUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
import uuid


class Base(DeclarativeBase):
    pass

class Task(Base):
    __tablename__ = "tasks"
    task_id: Mapped[uuid.UUID] = mapped_column(SAUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(SAUUID(as_uuid=True), nullable=False)
    task_type: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="TODO")
    priority: Mapped[str] = mapped_column(Text, nullable=False, server_default="MEDIUM")
    due_datetime: Mapped[Optional[datetime]]
    assignee_id: Mapped[Optional[uuid.UUID]] = mapped_column(SAUUID(as_uuid=True))
    reservation_id: Mapped[Optional[uuid.UUID]] = mapped_column(SAUUID(as_uuid=True))
    vehicle_id: Mapped[Optional[uuid.UUID]] = mapped_column(SAUUID(as_uuid=True))
    location_id: Mapped[Optional[uuid.UUID]] = mapped_column(SAUUID(as_uuid=True))
    created_by: Mapped[uuid.UUID] = mapped_column(SAUUID(as_uuid=True), nullable=False)
    blocked_reason: Mapped[Optional[str]] = mapped_column(Text)
    reminded_at: Mapped[Optional[datetime]]
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at: Mapped[Optional[datetime]]
