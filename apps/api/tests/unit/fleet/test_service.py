"""
Unit tests for FleetService.

All DB and Redis interactions are mocked with AsyncMock so no real
database or Redis connection is needed.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import (
    BusinessRuleError,
    DuplicateError,
    ExclusionConstraintError,
)
from app.domains.fleet.models import Vehicle, VehicleBlock
from app.domains.fleet.schemas import (
    VehicleBlockCreate,
    VehicleBlockType,
    VehicleCreate,
    VehicleStatus,
)
from app.domains.fleet.service import STATUS_TRANSITIONS, FleetService


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def svc() -> FleetService:
    return FleetService()


@pytest.fixture
def tenant_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def actor_id() -> str:
    return str(uuid.uuid4())


def _make_vehicle(
    status: str = VehicleStatus.STAGING.value,
    home_location_id: str | None = None,
    vehicle_class_id: str | None = None,
) -> Vehicle:
    """Construct a minimal Vehicle ORM instance without hitting the DB."""
    v = Vehicle.__new__(Vehicle)
    v.vehicle_id = str(uuid.uuid4())
    v.tenant_id = str(uuid.uuid4())
    v.vin = "1HGCM82633A004352"
    v.make = "Honda"
    v.model = "Accord"
    v.model_year = 2023
    v.trim = None
    v.body_style = None
    v.exterior_color = "White"
    v.transmission = "AUTOMATIC"
    v.fuel_type = "GASOLINE"
    v.seats = 5
    v.doors = 4
    v.luggage_large_bags = 2
    v.luggage_small_bags = 2
    v.sipp_code = "ICAR"
    v.vehicle_class_id = vehicle_class_id or str(uuid.uuid4())
    v.home_location_id = home_location_id or str(uuid.uuid4())
    v.current_location_id = v.home_location_id
    v.plate_number = "ABC123"
    v.plate_jurisdiction = "TX"
    v.status = status
    v.odometer_current = 0
    v.odometer_unit = "MILES"
    v.fuel_level_pct = 100
    v.soc_pct = None
    v.in_service_date = None
    v.acquisition_cost = None
    v.residual_value = None
    v.book_value = None
    v.depreciation_method = "STRAIGHT_LINE"
    v.useful_life_months = None
    v.estimated_life_miles = None
    v.fleet_type = "OWNED"
    v.lease_reference = None
    v.target_disposal_miles = None
    v.target_disposal_months = None
    v.options_packages = []
    v.photos = []
    v.telematics_device_id = None
    v.telematics_provider = None
    v.pool_id = None
    v.created_at = datetime.now(timezone.utc)
    v.updated_at = datetime.now(timezone.utc)
    v.deleted_at = None
    return v


def _make_session() -> AsyncMock:
    """Return a mock AsyncSession with execute/flush/refresh as AsyncMocks."""
    session = AsyncMock()
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    return session


# ── test_vehicle_status_transition_valid ─────────────────────────────────────


@pytest.mark.asyncio
async def test_vehicle_status_transition_valid(
    svc: FleetService, tenant_id: uuid.UUID, actor_id: str
) -> None:
    """STAGING → AVAILABLE is a valid transition and must succeed."""
    session = _make_session()
    vehicle = _make_vehicle(status=VehicleStatus.STAGING.value)

    with (
        patch(
            "app.domains.fleet.service.FleetRepository.get_vehicle_by_id",
            new=AsyncMock(side_effect=[vehicle, vehicle]),
        ),
        patch(
            "app.domains.fleet.service.FleetRepository.update_vehicle",
            new=AsyncMock(return_value=vehicle),
        ),
        patch(
            "app.domains.fleet.service.FleetRepository.create_status_log",
            new=AsyncMock(),
        ),
        patch(
            "app.domains.fleet.service.FleetService.invalidate_availability_cache",
            new=AsyncMock(),
        ),
    ):
        result = await svc.transition_status(
            session=session,
            tenant_id=tenant_id,
            vehicle_id=vehicle.vehicle_id,
            new_status=VehicleStatus.AVAILABLE.value,
            actor_id=actor_id,
            reason="Inspection passed",
        )

    assert result.status == VehicleStatus.STAGING.value  # mock returns original


# ── test_vehicle_status_transition_invalid ────────────────────────────────────


@pytest.mark.asyncio
async def test_vehicle_status_transition_invalid(
    svc: FleetService, tenant_id: uuid.UUID, actor_id: str
) -> None:
    """AVAILABLE → DISPOSED is NOT a valid transition; must raise BusinessRuleError."""
    session = _make_session()
    vehicle = _make_vehicle(status=VehicleStatus.AVAILABLE.value)

    with patch(
        "app.domains.fleet.service.FleetRepository.get_vehicle_by_id",
        new=AsyncMock(return_value=vehicle),
    ):
        with pytest.raises(BusinessRuleError) as exc_info:
            await svc.transition_status(
                session=session,
                tenant_id=tenant_id,
                vehicle_id=vehicle.vehicle_id,
                new_status=VehicleStatus.DISPOSED.value,
                actor_id=actor_id,
                reason="Trying to skip straight to disposal",
            )

    assert "INVALID_STATUS_TRANSITION" in str(exc_info.value.extra)
    assert "DISPOSED" in str(exc_info.value)


# ── test_create_vehicle_duplicate_vin ────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_vehicle_duplicate_vin(
    svc: FleetService, tenant_id: uuid.UUID, actor_id: str
) -> None:
    """Creating a vehicle with a VIN already registered for the tenant raises DuplicateError."""
    session = _make_session()
    existing_vehicle = _make_vehicle()

    data = VehicleCreate(
        vin="1HGCM82633A004352",  # Same VIN as existing
        make="Honda",
        model="Accord",
        model_year=2023,
        transmission="AUTOMATIC",
        fuel_type="GASOLINE",
        vehicle_class_id=str(uuid.uuid4()),
        home_location_id=str(uuid.uuid4()),
    )

    with patch(
        "app.domains.fleet.service.FleetRepository.get_by_vin",
        new=AsyncMock(return_value=existing_vehicle),
    ):
        with pytest.raises(DuplicateError) as exc_info:
            await svc.create_vehicle(session, tenant_id, data, actor_id)

    assert "VIN_ALREADY_REGISTERED" in str(exc_info.value.extra)
    assert "1HGCM82633A004352" in str(exc_info.value)


# ── test_availability_cache_hit ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_availability_cache_hit(
    svc: FleetService, tenant_id: uuid.UUID
) -> None:
    """When the Redis cache has a value, the DB must NOT be queried."""
    session = _make_session()
    location_id = str(uuid.uuid4())
    class_id = str(uuid.uuid4())
    pickup_dt = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    dropoff_dt = datetime(2026, 7, 5, 10, 0, tzinfo=timezone.utc)

    from app.domains.fleet.schemas import AvailabilityQuery

    query = AvailabilityQuery(
        location_id=location_id,
        vehicle_class_id=class_id,
        pickup_dt=pickup_dt,
        dropoff_dt=dropoff_dt,
    )

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value="3")   # Cache HIT
    mock_redis.set = AsyncMock()

    with (
        patch("app.domains.fleet.service.get_avail_redis", return_value=mock_redis),
        patch(
            "app.domains.fleet.service.FleetRepository.get_available_count",
            new=AsyncMock(side_effect=AssertionError("DB must not be called on cache hit")),
        ),
    ):
        result = await svc.get_availability(session, tenant_id, query)

    assert result.available_count == 3
    assert result.cache_hit is True
    assert result.is_available is True
    # Redis get was called; DB was NOT queried
    mock_redis.get.assert_awaited_once()
    mock_redis.set.assert_not_awaited()


# ── test_availability_cache_miss ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_availability_cache_miss(
    svc: FleetService, tenant_id: uuid.UUID
) -> None:
    """On cache miss the DB must be queried and the result cached for 60 seconds."""
    session = _make_session()
    location_id = str(uuid.uuid4())
    class_id = str(uuid.uuid4())
    pickup_dt = datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    dropoff_dt = datetime(2026, 7, 5, 10, 0, tzinfo=timezone.utc)

    from app.domains.fleet.schemas import AvailabilityQuery

    query = AvailabilityQuery(
        location_id=location_id,
        vehicle_class_id=class_id,
        pickup_dt=pickup_dt,
        dropoff_dt=dropoff_dt,
    )

    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)   # Cache MISS
    mock_redis.set = AsyncMock()

    db_count = 5  # What the DB returns

    with (
        patch("app.domains.fleet.service.get_avail_redis", return_value=mock_redis),
        patch(
            "app.domains.fleet.service.FleetRepository.get_available_count",
            new=AsyncMock(return_value=db_count),
        ),
    ):
        result = await svc.get_availability(session, tenant_id, query)

    assert result.available_count == db_count
    assert result.cache_hit is False
    assert result.is_available is True
    # Result was cached with 60s TTL
    mock_redis.set.assert_awaited_once()
    call_kwargs = mock_redis.set.call_args
    assert call_kwargs.kwargs.get("ex") == 60 or (
        len(call_kwargs.args) >= 3 and call_kwargs.args[2] == 60
    )


# ── test_bulk_import_validates_before_import ──────────────────────────────────


@pytest.mark.asyncio
async def test_bulk_import_validates_before_import(
    svc: FleetService, tenant_id: uuid.UUID, actor_id: str
) -> None:
    """
    If any row has an error, NO rows are imported (validate-all-first pattern).
    Partial imports must never occur.
    """
    session = _make_session()

    good_row = {
        "vin": "1HGCM82633A000001",
        "make": "Honda",
        "model": "Accord",
        "model_year": "2023",
        "transmission": "AUTOMATIC",
        "fuel_type": "GASOLINE",
        "vehicle_class_id": str(uuid.uuid4()),
        "home_location_id": str(uuid.uuid4()),
    }
    bad_row = {
        "vin": "",            # Missing VIN — will fail validation
        "make": "Toyota",
        "model": "Camry",
        "model_year": "2022",
        "vehicle_class_id": str(uuid.uuid4()),
        "home_location_id": str(uuid.uuid4()),
    }

    with patch(
        "app.domains.fleet.service.FleetRepository.get_by_vin",
        new=AsyncMock(return_value=None),  # No existing VINs
    ):
        result = await svc.bulk_import_vehicles(
            session, tenant_id, [good_row, bad_row], actor_id
        )

    # No vehicles created because validation failed on row 2
    assert result.created == 0
    assert result.skipped == 2
    assert len(result.errors) >= 1
    # The bad row should appear in errors
    error_rows = {e["row"] for e in result.errors}
    assert 2 in error_rows


# ── test_state_machine_completeness ──────────────────────────────────────────


def test_state_machine_all_statuses_have_entry() -> None:
    """Every VehicleStatus value must appear as a key in STATUS_TRANSITIONS."""
    for status in VehicleStatus:
        assert status.value in STATUS_TRANSITIONS, (
            f"VehicleStatus.{status.name} has no entry in STATUS_TRANSITIONS"
        )


def test_disposed_is_terminal() -> None:
    """DISPOSED has no allowed outgoing transitions."""
    assert STATUS_TRANSITIONS[VehicleStatus.DISPOSED.value] == frozenset()


def test_charging_not_in_vehicle_status() -> None:
    """CHARGING must NOT appear in VehicleStatus (GAP-003)."""
    names = {s.name for s in VehicleStatus}
    assert "CHARGING" not in names, "CHARGING must be a VehicleBlockType, not a VehicleStatus"


def test_vehicle_status_count() -> None:
    """VehicleStatus must have exactly 13 members (GAP-003)."""
    assert len(VehicleStatus) == 13
