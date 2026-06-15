from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Generic, Optional, Type, TypeVar

from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase

ModelT = TypeVar("ModelT", bound=DeclarativeBase)


class BaseRepository(Generic[ModelT]):
    """
    Generic tenant-isolated repository.

    Subclasses declare the `model` class attribute:

        class FleetRepository(BaseRepository[Vehicle]):
            model = Vehicle

    The application-layer `_tenant_filter()` works alongside PostgreSQL RLS.
    Both filter by tenant_id — RLS as the DB guarantee, application filter
    as defense-in-depth (and to produce cleaner query plans).
    """

    model: Type[ModelT]

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID) -> None:
        self.session = session
        self.tenant_id = tenant_id

    # ── Private helpers ──────────────────────────────────────────────────────

    def _tenant_filter(self):
        """
        Combined tenant isolation + soft-delete filter.
        Applied to every query in this repository.
        """
        return and_(
            self.model.tenant_id == self.tenant_id,
            self.model.deleted_at.is_(None),
        )

    def _tenant_filter_include_deleted(self):
        """Use only for admin endpoints that show deleted records."""
        return self.model.tenant_id == self.tenant_id

    # ── Read operations ──────────────────────────────────────────────────────

    async def get(self, id: uuid.UUID) -> Optional[ModelT]:
        """
        Fetch a single record by primary key.
        Returns None (not 404) — callers raise NotFoundError.
        """
        result = await self.session.execute(
            select(self.model).where(
                self.model.id == id,
                self._tenant_filter(),
            )
        )
        return result.scalar_one_or_none()

    async def get_or_raise(self, id: uuid.UUID) -> ModelT:
        """Convenience: fetch or raise ResourceNotFoundError."""
        from app.core.exceptions import ResourceNotFoundError
        obj = await self.get(id)
        if obj is None:
            raise ResourceNotFoundError(
                resource=self.model.__tablename__,
                resource_id=str(id),
            )
        return obj

    async def list(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        order_by=None,
        filters: Optional[list] = None,
    ) -> list[ModelT]:
        """
        Paginated list of records for the current tenant.

        Args:
            limit:    Page size (max enforced at router level)
            offset:   Pagination offset
            order_by: SQLAlchemy column expression, e.g. Vehicle.created_at.desc()
            filters:  Additional SQLAlchemy WHERE clauses (ANDed with tenant filter)
        """
        stmt = select(self.model).where(self._tenant_filter())
        if filters:
            stmt = stmt.where(*filters)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        else:
            stmt = stmt.order_by(self.model.created_at.desc())
        stmt = stmt.limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count(self, filters: Optional[list] = None) -> int:
        """Total count for pagination metadata."""
        stmt = select(func.count()).select_from(self.model).where(self._tenant_filter())
        if filters:
            stmt = stmt.where(*filters)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    # ── Write operations ─────────────────────────────────────────────────────

    async def create(self, **kwargs: Any) -> ModelT:
        """
        Create a new record.
        tenant_id is always injected from self.tenant_id — callers cannot override it.
        """
        obj = self.model(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update(self, id: uuid.UUID, **kwargs: Any) -> ModelT:
        """
        Update fields on an existing record.
        Always scoped to tenant — cannot update another tenant's record.
        """
        await self.session.execute(
            update(self.model)
            .where(self.model.id == id, self._tenant_filter())
            .values(**kwargs, updated_at=datetime.now(timezone.utc))
        )
        await self.session.flush()
        return await self.get_or_raise(id)

    async def soft_delete(self, id: uuid.UUID) -> None:
        """
        Set deleted_at to now. The exclusion constraint WHERE clause
        (deleted_at IS NULL) immediately releases any VehicleBlock slots.
        Record remains in DB for audit purposes.
        """
        await self.session.execute(
            update(self.model)
            .where(self.model.id == id, self._tenant_filter())
            .values(deleted_at=datetime.now(timezone.utc))
        )
        await self.session.flush()

    async def hard_delete(self, id: uuid.UUID) -> None:
        """
        Permanent deletion. Use ONLY for GDPR erasure flows after legal-hold check.
        Prefer soft_delete in all other cases.
        """
        obj = await self.get_or_raise(id)
        await self.session.delete(obj)
        await self.session.flush()
