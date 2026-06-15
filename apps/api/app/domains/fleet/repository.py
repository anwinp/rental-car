"""Fleet repository — extends BaseRepository with domain-specific availability queries."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import exists, func, not_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.core.repository import BaseRepository
from app.domains.fleet.models import Vehicle, VehicleBlock, VehicleClass, VehicleStatusLog
from app.domains.fleet.schemas import VehicleStatus


class FleetRepository(BaseRepository[Vehicle]):
    """
    Vehicle repository.

    Inherits create/update/soft_delete from BaseRepository.
    Adds domain-specific availability count and join queries.
    """

    model = Vehicle

    # ── Read helpers ─────────────────────────────────────────────────────────

    async def get_by_vin(self, vin: str) -> Optional[Vehicle]:
        """Find a vehicle by VIN within the current tenant."""
        result = await self.session.execute(
            select(Vehicle).where(
                Vehicle.vin == vin,
                self._tenant_filter(),
            )
        )
        return result.scalar_one_or_none()

    async def get_vehicle_by_id(self, vehicle_id: str) -> Optional[Vehicle]:
        """Fetch by vehicle_id (UUID string)."""
        result = await self.session.execute(
            select(Vehicle).where(
                Vehicle.vehicle_id == vehicle_id,
                self._tenant_filter(),
            )
        )
        return result.scalar_one_or_none()

    async def get_with_class(self, vehicle_id: str) -> Optional[Vehicle]:
        """
        Fetch vehicle joined with VehicleClass to avoid N+1.
        The vehicle's vehicle_class_id is loaded eagerly.
        """
        result = await self.session.execute(
            select(Vehicle).where(
                Vehicle.vehicle_id == vehicle_id,
                self._tenant_filter(),
            )
        )
        return result.scalar_one_or_none()

    async def list_by_location(
        self,
        location_id: str,
        status_filter: Optional[str] = None,
    ) -> list[Vehicle]:
        """All vehicles at a location, optionally filtered by status."""
        filters = [Vehicle.home_location_id == location_id]
        if status_filter:
            filters.append(Vehicle.status == status_filter)
        return await self.list(filters=filters)

    # ── Availability count ────────────────────────────────────────────────────

    async def get_available_count(
        self,
        location_id: str,
        class_id: str,
        period_start: datetime,
        period_end: datetime,
    ) -> int:
        """
        Count AVAILABLE vehicles of the given class at the location that have
        no active overlapping blocks in the requested period.

        Uses a GiST half-open interval overlap [) check, matching the exclusion
        constraint: tstzrange(start_time, end_time, '[)') && tstzrange(:start, :end, '[)').
        """
        from sqlalchemy import func as sqlfunc

        stmt = (
            select(func.count(Vehicle.vehicle_id))
            .where(
                Vehicle.tenant_id == str(self.tenant_id),
                Vehicle.home_location_id == location_id,
                Vehicle.vehicle_class_id == class_id,
                Vehicle.status == VehicleStatus.AVAILABLE.value,
                Vehicle.deleted_at.is_(None),
                not_(
                    exists(
                        select(VehicleBlock.block_id).where(
                            VehicleBlock.vehicle_id == Vehicle.vehicle_id,
                            VehicleBlock.deleted_at.is_(None),
                            sqlfunc.tstzrange(
                                VehicleBlock.start_time,
                                VehicleBlock.end_time,
                                "[)",
                            ).op("&&")(
                                sqlfunc.tstzrange(period_start, period_end, "[)")
                            ),
                        )
                    )
                ),
            )
        )

        result = await self.session.execute(stmt)
        return result.scalar_one() or 0

    # ── Status log ────────────────────────────────────────────────────────────

    async def create_status_log(
        self,
        vehicle_id: str,
        previous_status: str,
        new_status: str,
        changed_by: str,
        reason_code: str,
        reason_detail: Optional[str] = None,
    ) -> VehicleStatusLog:
        log = VehicleStatusLog(
            log_id=str(uuid.uuid4()),
            tenant_id=str(self.tenant_id),
            vehicle_id=vehicle_id,
            previous_status=previous_status,
            new_status=new_status,
            reason_code=reason_code,
            reason_detail=reason_detail,
            changed_by=changed_by,
        )
        self.session.add(log)
        await self.session.flush()
        return log

    # ── Vehicle create (overrides base — different PK column name) ────────────

    async def create_vehicle(self, **kwargs) -> Vehicle:
        """Create vehicle with explicit vehicle_id (not 'id')."""
        vehicle_id = str(uuid.uuid4())
        obj = Vehicle(
            vehicle_id=vehicle_id,
            tenant_id=str(self.tenant_id),
            status=VehicleStatus.STAGING.value,
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    # ── Vehicle update ───────────────────────────────────────────────────────

    async def update_vehicle(self, vehicle_id: str, **kwargs) -> Vehicle:
        await self.session.execute(
            update(Vehicle)
            .where(
                Vehicle.vehicle_id == vehicle_id,
                Vehicle.tenant_id == str(self.tenant_id),
                Vehicle.deleted_at.is_(None),
            )
            .values(**kwargs, updated_at=datetime.now(timezone.utc))
        )
        await self.session.flush()
        vehicle = await self.get_vehicle_by_id(vehicle_id)
        if vehicle is None:
            raise ResourceNotFoundError(resource="vehicles", resource_id=vehicle_id)
        return vehicle

    async def soft_delete_vehicle(self, vehicle_id: str) -> None:
        await self.session.execute(
            update(Vehicle)
            .where(
                Vehicle.vehicle_id == vehicle_id,
                Vehicle.tenant_id == str(self.tenant_id),
                Vehicle.deleted_at.is_(None),
            )
            .values(deleted_at=datetime.now(timezone.utc))
        )
        await self.session.flush()


class VehicleBlockRepository(BaseRepository[VehicleBlock]):
    model = VehicleBlock

    async def create_block(
        self,
        vehicle_id: str,
        block_type: str,
        start_time: datetime,
        end_time: datetime,
        created_by: str,
        notes: Optional[str] = None,
        reservation_id: Optional[str] = None,
        work_order_id: Optional[str] = None,
        is_hard_block: bool = False,
    ) -> VehicleBlock:
        """
        Insert a VehicleBlock.
        The DB exclusion constraint is the final guard against overlaps.
        asyncpg.ExclusionViolationError (23P01) propagates up to the service.
        """
        block_id = str(uuid.uuid4())
        block = VehicleBlock(
            block_id=block_id,
            tenant_id=str(self.tenant_id),
            vehicle_id=vehicle_id,
            block_type=block_type,
            start_time=start_time,
            end_time=end_time,
            notes=notes,
            reservation_id=reservation_id,
            work_order_id=work_order_id,
            is_hard_block=is_hard_block,
            created_by=created_by,
        )
        self.session.add(block)
        await self.session.flush()
        await self.session.refresh(block)
        return block

    async def get_block_by_id(self, block_id: str) -> Optional[VehicleBlock]:
        result = await self.session.execute(
            select(VehicleBlock).where(
                VehicleBlock.block_id == block_id,
                VehicleBlock.tenant_id == str(self.tenant_id),
                VehicleBlock.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def soft_delete_block(self, block_id: str) -> None:
        await self.session.execute(
            update(VehicleBlock)
            .where(
                VehicleBlock.block_id == block_id,
                VehicleBlock.tenant_id == str(self.tenant_id),
                VehicleBlock.deleted_at.is_(None),
            )
            .values(deleted_at=datetime.now(timezone.utc))
        )
        await self.session.flush()


class VehicleClassRepository(BaseRepository[VehicleClass]):
    model = VehicleClass

    def _tenant_filter(self):
        """Vehicle classes include system-wide (tenant_id=NULL) rows."""
        from sqlalchemy import or_

        return or_(
            VehicleClass.tenant_id == str(self.tenant_id),
            VehicleClass.tenant_id.is_(None),
        )

    async def create_class(self, **kwargs) -> VehicleClass:
        class_id = str(uuid.uuid4())
        obj = VehicleClass(
            class_id=class_id,
            tenant_id=str(self.tenant_id),
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def list_classes(self) -> list[VehicleClass]:
        from sqlalchemy import or_

        result = await self.session.execute(
            select(VehicleClass)
            .where(
                VehicleClass.is_active == True,  # noqa: E712
                or_(
                    VehicleClass.tenant_id == str(self.tenant_id),
                    VehicleClass.tenant_id.is_(None),
                ),
            )
            .order_by(VehicleClass.sort_order, VehicleClass.name)
        )
        return list(result.scalars().all())
