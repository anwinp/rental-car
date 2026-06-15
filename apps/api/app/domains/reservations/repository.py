"""Reservations domain repository — extends BaseRepository."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, func, select, text, update

from app.core.repository import BaseRepository
from app.domains.reservations.models import Reservation, ReservationVersion


class ReservationRepository(BaseRepository[Reservation]):
    """
    Reservation and version-history queries.

    All public methods scope to self.tenant_id.
    """

    model = Reservation

    # ── Read operations ───────────────────────────────────────────────────────

    async def get_by_id(self, reservation_id: uuid.UUID) -> Optional[Reservation]:
        """Fetch a reservation by PK (tenant-scoped, soft-delete filtered)."""
        result = await self.session.execute(
            select(Reservation).where(
                Reservation.reservation_id == str(reservation_id),
                Reservation.tenant_id == str(self.tenant_id),
                Reservation.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id_or_raise(self, reservation_id: uuid.UUID) -> Reservation:
        from app.core.exceptions import ResourceNotFoundError
        obj = await self.get_by_id(reservation_id)
        if obj is None:
            raise ResourceNotFoundError(
                resource="reservation", resource_id=str(reservation_id)
            )
        return obj

    async def get_by_confirmation_number(
        self, confirmation_number: str
    ) -> Optional[Reservation]:
        """
        Look up a reservation by confirmation number.

        The confirmation number UNIQUE constraint is system-wide (no tenant filter),
        but we still scope to tenant_id for security.
        """
        result = await self.session.execute(
            select(Reservation).where(
                Reservation.confirmation_number == confirmation_number,
                Reservation.tenant_id == str(self.tenant_id),
                Reservation.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_confirmation_number_any_tenant(
        self, confirmation_number: str
    ) -> Optional[Reservation]:
        """
        Public 'manage my booking' lookup — no tenant scope.
        Used for the public confirmation lookup endpoint.
        """
        result = await self.session.execute(
            select(Reservation).where(
                Reservation.confirmation_number == confirmation_number,
                Reservation.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def list_reservations(
        self,
        status: Optional[str] = None,
        location_id: Optional[uuid.UUID] = None,
        customer_id: Optional[uuid.UUID] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        source: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Reservation]:
        """Paginated list with optional filters."""
        conditions = [
            Reservation.tenant_id == str(self.tenant_id),
            Reservation.deleted_at.is_(None),
        ]
        if status:
            conditions.append(Reservation.status == status)
        if location_id:
            conditions.append(
                Reservation.pickup_location_id == str(location_id)
            )
        if customer_id:
            conditions.append(Reservation.customer_id == str(customer_id))
        if date_from:
            conditions.append(Reservation.pickup_datetime >= date_from)
        if date_to:
            conditions.append(Reservation.pickup_datetime <= date_to)
        if source:
            conditions.append(Reservation.channel == source)

        stmt = (
            select(Reservation)
            .where(*conditions)
            .order_by(Reservation.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_overdue_pending(self, cutoff: datetime) -> list[Reservation]:
        """
        Find CONFIRMED reservations whose pickup was before cutoff
        (used by the no-show Celery task).
        """
        result = await self.session.execute(
            select(Reservation).where(
                Reservation.status == "CONFIRMED",
                Reservation.pickup_datetime < cutoff,
                Reservation.deleted_at.is_(None),
            )
        )
        return list(result.scalars().all())

    # ── Write operations ──────────────────────────────────────────────────────

    async def create_reservation(
        self,
        confirmation_number: str,
        **kwargs,
    ) -> Reservation:
        """Insert a new reservation (status=PENDING by default)."""
        reservation_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        obj = Reservation(
            reservation_id=reservation_id,
            tenant_id=str(self.tenant_id),
            confirmation_number=confirmation_number,
            created_at=now,
            updated_at=now,
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def update_status(
        self,
        reservation_id: uuid.UUID,
        status: str,
        **extra_fields,
    ) -> None:
        """Update reservation status and any additional fields atomically."""
        now = datetime.now(timezone.utc)
        await self.session.execute(
            update(Reservation)
            .where(
                Reservation.reservation_id == str(reservation_id),
                Reservation.tenant_id == str(self.tenant_id),
            )
            .values(
                status=status,
                updated_at=now,
                **extra_fields,
            )
        )
        await self.session.flush()

    async def update_reservation(
        self,
        reservation_id: uuid.UUID,
        **kwargs,
    ) -> Optional[Reservation]:
        """Generic field update for modify_reservation flow."""
        now = datetime.now(timezone.utc)
        obj = await self.get_by_id(reservation_id)
        if obj is None:
            return None
        for key, value in kwargs.items():
            setattr(obj, key, value)
        obj.updated_at = now
        await self.session.flush()
        await self.session.refresh(obj)
        return obj

    async def soft_delete_reservation(self, reservation_id: uuid.UUID) -> None:
        """Soft-delete a reservation."""
        now = datetime.now(timezone.utc)
        await self.session.execute(
            update(Reservation)
            .where(
                Reservation.reservation_id == str(reservation_id),
                Reservation.tenant_id == str(self.tenant_id),
            )
            .values(deleted_at=now, updated_at=now)
        )
        await self.session.flush()

    # ── Advisory Lock ─────────────────────────────────────────────────────────

    async def acquire_advisory_lock(self, lock_key: int) -> None:
        """
        Acquire a PostgreSQL advisory transaction lock.

        The lock is held for the duration of the current transaction and
        automatically released on COMMIT or ROLLBACK.
        This serialises concurrent reservation creation for the same
        vehicle class / location combination.
        """
        await self.session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": lock_key},
        )

    # ── Availability re-check ─────────────────────────────────────────────────

    async def check_availability_db(
        self,
        location_id: uuid.UUID,
        vehicle_class_id: uuid.UUID,
        pickup_dt: datetime,
        dropoff_dt: datetime,
    ) -> int:
        """
        Re-check DB availability using the GiST index on vehicle_blocks.

        Returns count of available vehicles. Called under advisory lock as the
        second guard against race conditions.

        Uses the same overlap query pattern as §2.6 of ARCH_DOMAINS.md.
        """
        from sqlalchemy import exists

        # Import lazily to avoid circular imports
        from sqlalchemy import text as raw_sql

        result = await self.session.execute(
            raw_sql(
                """
                SELECT COUNT(v.vehicle_id)
                FROM vehicles v
                WHERE v.tenant_id = :tenant_id
                  AND v.current_location_id = :location_id
                  AND v.vehicle_class_id = :class_id
                  AND v.status = 'AVAILABLE'
                  AND v.deleted_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM vehicle_blocks vb
                    WHERE vb.vehicle_id = v.vehicle_id
                      AND vb.deleted_at IS NULL
                      AND tstzrange(vb.start_time, vb.end_time, '[)') &&
                          tstzrange(:pickup, :dropoff, '[)')
                  )
                """
            ),
            {
                "tenant_id": str(self.tenant_id),
                "location_id": str(location_id),
                "class_id": str(vehicle_class_id),
                "pickup": pickup_dt,
                "dropoff": dropoff_dt,
            },
        )
        row = result.fetchone()
        return int(row[0]) if row else 0

    # ── Version History ───────────────────────────────────────────────────────

    async def create_version_snapshot(
        self,
        reservation: Reservation,
        change_reason: Optional[str],
        changed_by: uuid.UUID,
        changed_by_type: str = "STAFF",
    ) -> ReservationVersion:
        """
        Capture the current state of a reservation as a version snapshot.

        Called before modifying a CONFIRMED reservation.
        """
        version_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        obj = ReservationVersion(
            version_id=version_id,
            tenant_id=str(self.tenant_id),
            reservation_id=reservation.reservation_id,
            version_number=reservation.version,
            status_at_version=reservation.status,
            pickup_location_id=reservation.pickup_location_id,
            dropoff_location_id=reservation.dropoff_location_id,
            pickup_datetime=reservation.pickup_datetime,
            return_datetime=reservation.return_datetime,
            vehicle_class_id=reservation.vehicle_class_id,
            rate_code_id=reservation.rate_code_id,
            grand_total=reservation.grand_total,
            extras_snapshot=reservation.extras_snapshot,
            change_reason=change_reason,
            changed_by=str(changed_by),
            changed_by_type=changed_by_type,
            changed_at=now,
        )
        self.session.add(obj)
        await self.session.flush()
        return obj
