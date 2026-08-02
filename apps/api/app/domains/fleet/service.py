"""Fleet service — vehicle lifecycle, availability cache, and bulk import."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import Text, cast
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BusinessRuleError,
    DuplicateError,
    ExclusionConstraintError,
    ResourceNotFoundError,
)
from app.core.redis import AVAIL_KEY, get_avail_redis
from app.domains.fleet.models import Vehicle, VehicleBlock, VehicleClass
from app.domains.tenants.limits import assert_within_limit
from app.domains.fleet.repository import (
    FleetRepository,
    VehicleBlockRepository,
    VehicleClassRepository,
)
from app.domains.fleet.schemas import (
    AvailabilityQuery,
    AvailabilityResponse,
    BulkImportResult,
    VehicleBlockCreate,
    VehicleClassCreate,
    VehicleCreate,
    VehicleResponse,
    VehicleStatus,
    VehicleUpdate,
)

# ── State machine ────────────────────────────────────────────────────────────

# Allowed transitions: FROM → frozenset(allowed TO statuses)
STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    VehicleStatus.STAGING.value: frozenset(
        {VehicleStatus.AVAILABLE.value, VehicleStatus.PENDING_DELIVERY.value}
    ),
    VehicleStatus.AVAILABLE.value: frozenset(
        {
            VehicleStatus.ON_RENT.value,
            VehicleStatus.MAINTENANCE.value,
            VehicleStatus.ADMIN_HOLD.value,
            VehicleStatus.PENDING_DISPOSAL.value,
        }
    ),
    VehicleStatus.ON_RENT.value: frozenset({VehicleStatus.RETURNING.value}),
    VehicleStatus.RETURNING.value: frozenset({VehicleStatus.READY_FOR_INSPECTION.value}),
    VehicleStatus.READY_FOR_INSPECTION.value: frozenset(
        {VehicleStatus.CLEANING.value, VehicleStatus.DAMAGE_HOLD.value, VehicleStatus.MAINTENANCE.value}
    ),
    VehicleStatus.CLEANING.value: frozenset({VehicleStatus.AVAILABLE.value}),
    VehicleStatus.MAINTENANCE.value: frozenset(
        {VehicleStatus.IN_REPAIR.value, VehicleStatus.AVAILABLE.value}
    ),
    VehicleStatus.IN_REPAIR.value: frozenset(
        {
            VehicleStatus.MAINTENANCE.value,
            VehicleStatus.AVAILABLE.value,
            VehicleStatus.DAMAGE_HOLD.value,
        }
    ),
    VehicleStatus.DAMAGE_HOLD.value: frozenset(
        {VehicleStatus.MAINTENANCE.value, VehicleStatus.IN_REPAIR.value}
    ),
    VehicleStatus.ADMIN_HOLD.value: frozenset(
        {VehicleStatus.AVAILABLE.value, VehicleStatus.PENDING_DISPOSAL.value}
    ),
    VehicleStatus.PENDING_DISPOSAL.value: frozenset({VehicleStatus.DISPOSED.value}),
    VehicleStatus.DISPOSED.value: frozenset(),  # terminal
    VehicleStatus.PENDING_DELIVERY.value: frozenset({VehicleStatus.AVAILABLE.value}),
}


class FleetService:
    """
    All methods are stateless — session and tenant_id are passed explicitly.
    Redis client is obtained from the pool on each call.
    """

    # ── Vehicle CRUD ──────────────────────────────────────────────────────────

    async def create_vehicle(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        data: VehicleCreate,
        created_by: str,
    ) -> Vehicle:
        """
        Create vehicle in STAGING status.
        Raises DuplicateError if VIN already exists for this tenant.
        Logs the initial status in vehicle_status_log.
        """
        # max_vehicles existed in the plan table and in the admin UI, and was
        # checked nowhere: a Starter workspace could add ten thousand vehicles
        # against a limit of 25. Checked before the VIN lookup so a workspace at
        # its cap is told about the cap, not about a duplicate.
        await assert_within_limit(session, tenant_id, "vehicles")

        repo = FleetRepository(session, tenant_id)

        existing = await repo.get_by_vin(data.vin)
        if existing is not None:
            raise DuplicateError(
                f"VIN '{data.vin}' is already registered for this tenant.",
                extra={"vin": data.vin, "error_code": "VIN_ALREADY_REGISTERED"},
            )

        vehicle = await repo.create_vehicle(
            vin=data.vin,
            make=data.make,
            model=data.model,
            model_year=data.model_year,
            trim=data.trim,
            body_style=data.body_style,
            exterior_color=data.exterior_color,
            transmission=data.transmission,
            fuel_type=data.fuel_type,
            seats=data.seats,
            doors=data.doors,
            luggage_large_bags=data.luggage_large_bags,
            luggage_small_bags=data.luggage_small_bags,
            sipp_code=data.sipp_code,
            vehicle_class_id=data.vehicle_class_id,
            home_location_id=data.home_location_id,
            current_location_id=data.current_location_id or data.home_location_id,
            plate_number=data.plate_number,
            plate_jurisdiction=data.plate_jurisdiction,
            odometer_current=data.odometer_current,
            odometer_unit=data.odometer_unit,
            fuel_level_pct=data.fuel_level_pct,
            acquisition_cost=data.acquisition_cost,
            residual_value=data.residual_value,
            book_value=data.book_value,
            depreciation_method=data.depreciation_method,
            fleet_type=data.fleet_type,
            useful_life_months=data.useful_life_months,
            estimated_life_miles=data.estimated_life_miles,
            photos=data.photos,
        )

        # Log the initial STAGING status creation
        await repo.create_status_log(
            vehicle_id=vehicle.vehicle_id,
            previous_status="STAGING",  # created in STAGING
            new_status="STAGING",
            changed_by=created_by,
            reason_code="VEHICLE_CREATED",
            reason_detail="Vehicle registered in fleet",
        )

        return vehicle

    async def get_vehicle(
        self, session: AsyncSession, tenant_id: UUID, vehicle_id: str
    ) -> Vehicle:
        repo = FleetRepository(session, tenant_id)
        vehicle = await repo.get_vehicle_by_id(vehicle_id)
        if vehicle is None:
            raise ResourceNotFoundError(resource="vehicles", resource_id=vehicle_id)
        return vehicle

    async def list_vehicles(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        location_id: Optional[str] = None,
        status: Optional[str] = None,
        class_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Vehicle]:
        repo = FleetRepository(session, tenant_id)
        filters = []
        if location_id:
            filters.append(Vehicle.home_location_id == location_id)
        if status:
            filters.append(cast(Vehicle.status, Text) == status)
        if class_id:
            filters.append(Vehicle.vehicle_class_id == class_id)
        return await repo.list(limit=limit, offset=offset, filters=filters or None)

    async def update_vehicle(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        vehicle_id: str,
        data: VehicleUpdate,
    ) -> Vehicle:
        repo = FleetRepository(session, tenant_id)
        updates = data.model_dump(exclude_none=True)
        if not updates:
            return await self.get_vehicle(session, tenant_id, vehicle_id)
        return await repo.update_vehicle(vehicle_id, **updates)

    async def soft_delete_vehicle(
        self, session: AsyncSession, tenant_id: UUID, vehicle_id: str
    ) -> None:
        repo = FleetRepository(session, tenant_id)
        vehicle = await repo.get_vehicle_by_id(vehicle_id)
        if vehicle is None:
            raise ResourceNotFoundError(resource="vehicles", resource_id=vehicle_id)
        await repo.soft_delete_vehicle(vehicle_id)

    # ── Status transitions ────────────────────────────────────────────────────

    async def transition_status(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        vehicle_id: str,
        new_status: str,
        actor_id: str,
        reason: str,
    ) -> Vehicle:
        """
        Validate the status transition against the state machine matrix.
        Raises BusinessRuleError if the transition is invalid.
        Creates a VehicleStatusLog entry on success.
        Busts availability cache when status changes to/from AVAILABLE.
        """
        repo = FleetRepository(session, tenant_id)

        vehicle = await repo.get_vehicle_by_id(vehicle_id)
        if vehicle is None:
            raise ResourceNotFoundError(resource="vehicles", resource_id=vehicle_id)

        current_status = vehicle.status
        allowed = STATUS_TRANSITIONS.get(current_status, frozenset())

        if new_status not in allowed:
            raise BusinessRuleError(
                f"Cannot transition vehicle from {current_status} to {new_status}. "
                f"Allowed transitions: {sorted(allowed) or ['none (terminal state)']}.",
                extra={
                    "from_status": current_status,
                    "to_status": new_status,
                    "error_code": "INVALID_STATUS_TRANSITION",
                },
            )

        vehicle = await repo.update_vehicle(vehicle_id, status=new_status)

        await repo.create_status_log(
            vehicle_id=vehicle_id,
            previous_status=current_status,
            new_status=new_status,
            changed_by=actor_id,
            reason_code="STATUS_TRANSITION",
            reason_detail=reason,
        )

        # Bust availability cache when transitioning to/from AVAILABLE
        if current_status == VehicleStatus.AVAILABLE.value or new_status == VehicleStatus.AVAILABLE.value:
            await self.invalidate_availability_cache(
                tenant_id=str(tenant_id),
                location_id=vehicle.home_location_id,
                class_id=vehicle.vehicle_class_id,
            )

        return vehicle

    # ── Blocks ────────────────────────────────────────────────────────────────

    async def create_block(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        data: VehicleBlockCreate,
        created_by: str,
    ) -> VehicleBlock:
        """
        Create a VehicleBlock.
        On asyncpg ExclusionViolationError (23P01) → raise VehicleNotAvailableError.
        """
        repo = VehicleBlockRepository(session, tenant_id)

        try:
            block = await repo.create_block(
                vehicle_id=data.vehicle_id,
                block_type=data.block_type.value,
                start_time=data.start_dt,
                end_time=data.end_dt,
                created_by=created_by,
                notes=data.reason,
                reservation_id=data.reservation_id,
                work_order_id=data.work_order_id,
                is_hard_block=data.is_hard_block,
            )
        except Exception as exc:
            # Check for asyncpg ExclusionViolationError (23P01)
            cause = getattr(exc, "__cause__", None) or exc
            if hasattr(cause, "pgcode") and cause.pgcode == "23P01":
                raise ExclusionConstraintError() from exc
            # Also check by class name for robustness
            if type(cause).__name__ == "ExclusionViolationError":
                raise ExclusionConstraintError() from exc
            raise

        # Invalidate availability cache for this vehicle's location/class
        vehicle_repo = FleetRepository(session, tenant_id)
        vehicle = await vehicle_repo.get_vehicle_by_id(data.vehicle_id)
        if vehicle:
            await self.invalidate_availability_cache(
                tenant_id=str(tenant_id),
                location_id=vehicle.home_location_id,
                class_id=vehicle.vehicle_class_id,
            )

        return block

    async def soft_delete_block(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        block_id: str,
        actor_id: str,
    ) -> None:
        repo = VehicleBlockRepository(session, tenant_id)
        block = await repo.get_block_by_id(block_id)
        if block is None:
            raise ResourceNotFoundError(resource="vehicle_blocks", resource_id=block_id)
        await repo.soft_delete_block(block_id)

        # Invalidate availability cache
        vehicle_repo = FleetRepository(session, tenant_id)
        vehicle = await vehicle_repo.get_vehicle_by_id(block.vehicle_id)
        if vehicle:
            await self.invalidate_availability_cache(
                tenant_id=str(tenant_id),
                location_id=vehicle.home_location_id,
                class_id=vehicle.vehicle_class_id,
            )

    # ── Availability ──────────────────────────────────────────────────────────

    async def get_availability(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        query: AvailabilityQuery,
        include_vehicle_list: bool = False,
    ) -> AvailabilityResponse:
        """
        Check Redis cache first (60s TTL).
        On miss: query DB and cache the result.
        """
        redis = get_avail_redis()

        # Build ISO-week bucket for cache key
        bucket = query.pickup_dt.strftime("%G-W%V")
        cache_key = AVAIL_KEY.format(
            loc=query.location_id,
            cls=query.vehicle_class_id,
            bucket=bucket,
        )

        cached_val = await redis.get(cache_key)
        cache_hit = False

        if cached_val is not None:
            available_count = int(cached_val)
            cache_hit = True
        else:
            repo = FleetRepository(session, tenant_id)
            available_count = await repo.get_available_count(
                location_id=query.location_id,
                class_id=query.vehicle_class_id,
                period_start=query.pickup_dt,
                period_end=query.dropoff_dt,
            )
            # Cache for 60 seconds
            await redis.set(cache_key, str(available_count), ex=60)

        response = AvailabilityResponse(
            class_id=query.vehicle_class_id,
            location_id=query.location_id,
            pickup_dt=query.pickup_dt,
            dropoff_dt=query.dropoff_dt,
            available_count=available_count,
            is_available=available_count > 0,
            cache_hit=cache_hit,
        )

        if include_vehicle_list and available_count > 0:
            repo = FleetRepository(session, tenant_id)
            vehicles = await repo.list(
                filters=[
                    Vehicle.home_location_id == query.location_id,
                    Vehicle.vehicle_class_id == query.vehicle_class_id,
                    cast(Vehicle.status, Text).in_([VehicleStatus.AVAILABLE.value, "ON_RENT", "RETURNING"]),
                ]
            )
            response.vehicles = [VehicleResponse.model_validate(v) for v in vehicles]

        return response

    async def invalidate_availability_cache(
        self, tenant_id: str, location_id: str, class_id: str
    ) -> None:
        """Delete the Redis availability cache for a location+class combination."""
        redis = get_avail_redis()
        # Delete all bucket keys for this location+class using a pattern scan
        pattern = AVAIL_KEY.format(loc=location_id, cls=class_id, bucket="*")
        keys = await redis.keys(pattern)
        if keys:
            await redis.delete(*keys)

    # ── Bulk import ───────────────────────────────────────────────────────────

    async def bulk_import_vehicles(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        rows: list[dict],
        created_by: str,
    ) -> BulkImportResult:
        """
        Validate ALL rows first; if any have errors, return without importing any.
        On full validation pass, import all atomically.
        """
        REQUIRED_FIELDS = {"vin", "make", "model", "model_year", "vehicle_class_id", "home_location_id"}
        errors: list[dict] = []
        seen_vins: set[str] = set()

        repo = FleetRepository(session, tenant_id)

        # ── Validation pass ──────────────────────────────────────────────────
        for idx, row in enumerate(rows, start=1):
            vin = row.get("vin", "").strip().upper()
            row_errors: list[str] = []

            # Required field check
            for field in REQUIRED_FIELDS:
                if not row.get(field):
                    row_errors.append(f"Missing required field: {field}")

            # VIN deduplication within the batch
            if vin in seen_vins:
                row_errors.append(f"Duplicate VIN in batch: {vin}")
            elif vin:
                seen_vins.add(vin)

                # Check DB for existing VIN
                existing = await repo.get_by_vin(vin)
                if existing is not None:
                    row_errors.append(
                        f"VIN '{vin}' already registered for this tenant"
                    )

            # Year validation
            try:
                year = int(row.get("model_year", 0))
                if not (1900 <= year <= 2100):
                    row_errors.append("model_year must be between 1900 and 2100")
            except (ValueError, TypeError):
                row_errors.append("model_year must be an integer")

            if row_errors:
                errors.append(
                    {
                        "row": idx,
                        "vin": vin or row.get("vin", ""),
                        "reason": "; ".join(row_errors),
                    }
                )

        if errors:
            # Return without importing any rows (validate-all-first pattern)
            return BulkImportResult(
                total_rows=len(rows),
                created=0,
                skipped=len(rows),
                errors=errors,
            )

        # ── Import pass ──────────────────────────────────────────────────────
        created_count = 0
        for row in rows:
            create_data = VehicleCreate(
                vin=row["vin"].strip().upper(),
                make=row["make"],
                model=row["model"],
                model_year=int(row["model_year"]),
                trim=row.get("trim"),
                exterior_color=row.get("exterior_color"),
                transmission=row.get("transmission", "AUTOMATIC"),
                fuel_type=row.get("fuel_type", "GASOLINE"),
                sipp_code=row.get("sipp_code"),
                vehicle_class_id=row["vehicle_class_id"],
                home_location_id=row["home_location_id"],
                plate_number=row.get("plate_number"),
                plate_jurisdiction=row.get("plate_jurisdiction"),
                odometer_current=int(row.get("odometer_current", 0)),
            )
            await self.create_vehicle(session, tenant_id, create_data, created_by)
            created_count += 1

        return BulkImportResult(
            total_rows=len(rows),
            created=created_count,
            skipped=0,
            errors=[],
        )

    # ── Vehicle class CRUD ────────────────────────────────────────────────────

    async def list_classes(
        self, session: AsyncSession, tenant_id: UUID
    ) -> list[VehicleClass]:
        repo = VehicleClassRepository(session, tenant_id)
        return await repo.list_classes()

    async def create_class(
        self,
        session: AsyncSession,
        tenant_id: UUID,
        data: VehicleClassCreate,
    ) -> VehicleClass:
        repo = VehicleClassRepository(session, tenant_id)
        return await repo.create_class(
            sipp_prefix=data.sipp_prefix,
            name=data.name,
            description=data.description,
            sort_order=data.sort_order,
        )
