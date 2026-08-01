"""Auth domain ORM models — staff_users table."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class StaffUser(Base):
    """
    Maps to public.staff_users.

    Column naming matches the DDL exactly so Alembic autogenerate produces
    no spurious diffs.  MFA secret is encrypted at rest via pgcrypto in the
    DB tier; the application stores/retrieves the ciphertext as TEXT.
    """

    __tablename__ = "staff_users"

    # ── Identity ─────────────────────────────────────────────────────────────
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.uuid_generate_v4()
    )
    tenant_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(Text, nullable=False)

    # ── Credentials ───────────────────────────────────────────────────────────
    hashed_password: Mapped[str] = mapped_column(
        "password_hash", Text, nullable=False
    )

    # ── Profile ───────────────────────────────────────────────────────────────
    first_name: Mapped[str] = mapped_column(Text, nullable=False)
    last_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)  # user_role enum stored as TEXT

    # ── Status ────────────────────────────────────────────────────────────────
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    # ── MFA ──────────────────────────────────────────────────────────────────
    is_mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    mfa_secret: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Location scope (stored as JSONB list of UUID strings) ─────────────────
    location_ids: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True, default=list)

    # ── Security ──────────────────────────────────────────────────────────────
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Raised whenever the credential changes hands: password change, password
    # reset, or detected refresh-token reuse. Every token carries the epoch it
    # was minted under and stops validating once this moves past it.
    token_epoch: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
