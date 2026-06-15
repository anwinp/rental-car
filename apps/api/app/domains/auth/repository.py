"""Auth domain repository — data access for StaffUser."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.auth.models import StaffUser


class AuthRepository:
    """
    Thin data-access wrapper around staff_users.
    Intentionally NOT a generic BaseRepository subclass — auth queries
    require cross-tenant lookups (system-level email dedup) not covered
    by the tenant-scoped base.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Read ─────────────────────────────────────────────────────────────────

    async def get_by_email_and_tenant(
        self, email: str, tenant_id: str
    ) -> Optional[StaffUser]:
        result = await self._session.execute(
            select(StaffUser).where(
                and_(
                    StaffUser.email == email,
                    StaffUser.tenant_id == tenant_id,
                    StaffUser.deleted_at.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: str) -> Optional[StaffUser]:
        result = await self._session.execute(
            select(StaffUser).where(
                and_(StaffUser.user_id == user_id, StaffUser.deleted_at.is_(None))
            )
        )
        return result.scalar_one_or_none()

    # ── Write ─────────────────────────────────────────────────────────────────

    async def increment_failed_login(self, user_id: str) -> None:
        await self._session.execute(
            update(StaffUser)
            .where(StaffUser.user_id == user_id)
            .values(
                failed_login_count=StaffUser.failed_login_count + 1,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self._session.flush()

    async def lock_account(self, user_id: str, locked_until: datetime) -> None:
        await self._session.execute(
            update(StaffUser)
            .where(StaffUser.user_id == user_id)
            .values(
                locked_until=locked_until,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self._session.flush()

    async def reset_login_failures(self, user_id: str) -> None:
        await self._session.execute(
            update(StaffUser)
            .where(StaffUser.user_id == user_id)
            .values(
                failed_login_count=0,
                locked_until=None,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self._session.flush()

    async def update_last_login(self, user_id: str) -> None:
        await self._session.execute(
            update(StaffUser)
            .where(StaffUser.user_id == user_id)
            .values(
                last_login_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self._session.flush()

    async def update_password(self, user_id: str, hashed_password: str) -> None:
        await self._session.execute(
            update(StaffUser)
            .where(StaffUser.user_id == user_id)
            .values(
                hashed_password=hashed_password,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self._session.flush()

    async def update_mfa(
        self, user_id: str, mfa_secret: str, is_mfa_enabled: bool
    ) -> None:
        await self._session.execute(
            update(StaffUser)
            .where(StaffUser.user_id == user_id)
            .values(
                mfa_secret=mfa_secret,
                is_mfa_enabled=is_mfa_enabled,
                updated_at=datetime.now(timezone.utc),
            )
        )
        await self._session.flush()
