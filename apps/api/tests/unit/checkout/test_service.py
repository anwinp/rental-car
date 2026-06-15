"""
Unit tests for CheckoutService.

All external dependencies (DB session, raw SQL calls) are mocked.
Tests verify counter operations business logic in isolation.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import BusinessRuleError, ResourceNotFoundError
from app.domains.checkout.schemas import (
    CheckInRequest,
    CheckoutRequest,
    ShiftCloseRequest,
    ShiftOpenRequest,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_reservation(
    reservation_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    status: str = "CONFIRMED",
    vehicle_class_id: Optional[str] = None,
    return_datetime: Optional[datetime] = None,
) -> MagicMock:
    res = MagicMock()
    res.reservation_id = reservation_id or str(uuid.uuid4())
    res.customer_id = customer_id or str(uuid.uuid4())
    res.status = status
    res.vehicle_class_id = vehicle_class_id or str(uuid.uuid4())
    res.return_datetime = return_datetime or (datetime.now(timezone.utc) + timedelta(days=1))
    return res


def _make_ra(
    ra_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    vehicle_id: Optional[str] = None,
    status: str = "ACTIVE",
    odometer_out: int = 10000,
    fuel_level_out_pct: int = 100,
    mileage_plan: Optional[dict] = None,
) -> MagicMock:
    ra = MagicMock()
    ra.ra_id = ra_id or str(uuid.uuid4())
    ra.customer_id = customer_id or str(uuid.uuid4())
    ra.vehicle_id = vehicle_id or str(uuid.uuid4())
    ra.status = status
    ra.odometer_out = odometer_out
    ra.fuel_level_out_pct = fuel_level_out_pct
    ra.fuel_level_in_pct = None
    ra.odometer_in = None
    ra.mileage_plan = mileage_plan or {}
    ra.agent_notes = None
    ra.extras_snapshot = []
    return ra


def _make_service():
    """Create a CheckoutService with all external calls mocked."""
    from app.domains.checkout.service import CheckoutService

    mock_session = AsyncMock()
    tenant_id = uuid.uuid4()

    svc = CheckoutService.__new__(CheckoutService)
    svc._session = mock_session
    svc._tenant_id = tenant_id

    return svc, mock_session, tenant_id


# ── test_checkout_requires_confirmed_reservation ──────────────────────────────

@pytest.mark.asyncio
async def test_checkout_requires_confirmed_reservation():
    """
    Checkout must fail if the reservation is not in CONFIRMED status.

    GAP-004: Canonical reservation status is CHECKED_OUT (not ACTIVE).
    A reservation in PENDING or CHECKED_OUT must be rejected.
    """
    svc, mock_session, tenant_id = _make_service()

    # Reservation is PENDING, not CONFIRMED
    pending_reservation = _make_reservation(status="PENDING")

    with patch.object(svc, "_get_reservation", AsyncMock(return_value=pending_reservation)):
        data = CheckoutRequest(
            reservation_id=uuid.UUID(pending_reservation.reservation_id),
            odometer_out=12000,
            fuel_level_out=8,
        )
        with pytest.raises(BusinessRuleError) as exc_info:
            await svc.checkout(data, uuid.uuid4(), tenant_id)

    assert "CONFIRMED" in str(exc_info.value)


@pytest.mark.asyncio
async def test_checkout_requires_confirmed_not_checked_out():
    """An already-checked-out reservation cannot be used for another checkout."""
    svc, mock_session, tenant_id = _make_service()

    already_checked_out = _make_reservation(status="CHECKED_OUT")

    with patch.object(svc, "_get_reservation", AsyncMock(return_value=already_checked_out)):
        data = CheckoutRequest(
            reservation_id=uuid.UUID(already_checked_out.reservation_id),
            odometer_out=12000,
            fuel_level_out=8,
        )
        with pytest.raises(BusinessRuleError) as exc_info:
            await svc.checkout(data, uuid.uuid4(), tenant_id)

    assert "CONFIRMED" in str(exc_info.value)


# ── test_checkout_blocks_on_dnr ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_checkout_blocks_on_dnr():
    """
    Checkout must fail if the customer has an active DNR flag.

    Security invariant: Counter agents see the DNR reason.
    The checkout process is the enforcement gate.
    """
    svc, mock_session, tenant_id = _make_service()

    customer_id = uuid.uuid4()
    confirmed_res = _make_reservation(
        status="CONFIRMED", customer_id=str(customer_id)
    )

    # DNR check returns blocked
    dnr_blocked = MagicMock()
    dnr_blocked.is_blocked = True
    dnr_blocked.reason = "FRAUD: Credit card theft"

    with patch.object(svc, "_get_reservation", AsyncMock(return_value=confirmed_res)):
        with patch.object(svc, "_check_customer_dnr", AsyncMock(side_effect=BusinessRuleError("Customer is on the Do Not Rent list: FRAUD"))):
            data = CheckoutRequest(
                reservation_id=uuid.UUID(confirmed_res.reservation_id),
                odometer_out=12000,
                fuel_level_out=8,
            )
            with pytest.raises(BusinessRuleError) as exc_info:
                await svc.checkout(data, uuid.uuid4(), tenant_id)

    assert "Rent" in str(exc_info.value) or "FRAUD" in str(exc_info.value) or "DNR" in str(exc_info.value).upper() or "Do Not" in str(exc_info.value)


# ── test_checkout_requires_pre_auth ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_checkout_requires_pre_auth():
    """
    Checkout must fail clearly if no AUTHORIZED pre-auth payment exists.

    Security invariant: 'Checkout must fail clearly if pre-auth is not AUTHORIZED'
    """
    svc, mock_session, tenant_id = _make_service()

    res = _make_reservation(status="CONFIRMED")
    vehicle_id = str(uuid.uuid4())

    with patch.object(svc, "_get_reservation", AsyncMock(return_value=res)):
        with patch.object(svc, "_check_customer_dnr", AsyncMock(return_value=None)):
            with patch.object(svc, "_resolve_vehicle", AsyncMock(return_value=vehicle_id)):
                with patch.object(
                    svc,
                    "_verify_pre_auth",
                    AsyncMock(side_effect=BusinessRuleError("No AUTHORIZED pre-authorization found")),
                ):
                    data = CheckoutRequest(
                        reservation_id=uuid.UUID(res.reservation_id),
                        odometer_out=12000,
                        fuel_level_out=8,
                    )
                    with pytest.raises(BusinessRuleError) as exc_info:
                        await svc.checkout(data, uuid.uuid4(), tenant_id)

    assert "pre" in str(exc_info.value).lower() or "auth" in str(exc_info.value).lower()


# ── test_check_in_calculates_time_extension ────────────────────────────────────

@pytest.mark.asyncio
async def test_check_in_calculates_time_extension():
    """
    Check-in must calculate a time extension charge when the vehicle is
    returned after the agreed return time.
    """
    svc, mock_session, tenant_id = _make_service()

    ra = _make_ra(status="ACTIVE", odometer_out=10000, fuel_level_out_pct=96)

    # Simulate return datetime 2 hours in the past (so customer is late)
    overdue_return = datetime.now(timezone.utc) - timedelta(hours=2)
    time_ext_charge = Decimal("25.00")

    with patch.object(svc, "_get_rental_agreement", AsyncMock(return_value=ra)):
        with patch.object(
            svc,
            "_calculate_time_extension",
            AsyncMock(return_value=time_ext_charge),
        ):
            with patch.object(svc, "_transition_vehicle_status", AsyncMock()):
                data = CheckInRequest(
                    rental_agreement_id=uuid.UUID(ra.ra_id),
                    odometer_in=10500,
                    fuel_level_in=8,
                )
                result = await svc.check_in(data, uuid.uuid4(), tenant_id)

    assert result.time_extension_charge == Decimal("25.00")


@pytest.mark.asyncio
async def test_check_in_requires_active_or_extended_ra():
    """Check-in must be rejected if the RA is already RETURNED."""
    svc, mock_session, tenant_id = _make_service()

    returned_ra = _make_ra(status="RETURNED")

    with patch.object(svc, "_get_rental_agreement", AsyncMock(return_value=returned_ra)):
        data = CheckInRequest(
            rental_agreement_id=uuid.UUID(returned_ra.ra_id),
            odometer_in=10500,
            fuel_level_in=8,
        )
        with pytest.raises(BusinessRuleError) as exc_info:
            await svc.check_in(data, uuid.uuid4(), tenant_id)

    assert "ACTIVE" in str(exc_info.value) or "EXTENDED" in str(exc_info.value)


# ── test_check_in_calculates_fuel_penalty ─────────────────────────────────────

@pytest.mark.asyncio
async def test_check_in_calculates_fuel_penalty_for_missing_fuel():
    """
    Check-in must calculate a fuel penalty proportional to fuel missing.

    Fuel scale: 0-8 (API) maps to 0-96% in DB.
    Penalty: $5 per 1/8 step missing (approx $5 per 12% of tank).
    """
    svc, mock_session, tenant_id = _make_service()

    # Vehicle was checked out full (fuel_level_out_pct=96 ≈ 8/8)
    ra = _make_ra(status="ACTIVE", odometer_out=10000, fuel_level_out_pct=96)

    with patch.object(svc, "_get_rental_agreement", AsyncMock(return_value=ra)):
        with patch.object(
            svc, "_calculate_time_extension", AsyncMock(return_value=Decimal("0.00"))
        ):
            with patch.object(svc, "_transition_vehicle_status", AsyncMock()):
                # Return with half tank (fuel_level_in=4 → 48%)
                data = CheckInRequest(
                    rental_agreement_id=uuid.UUID(ra.ra_id),
                    odometer_in=10500,
                    fuel_level_in=4,
                )
                result = await svc.check_in(data, uuid.uuid4(), tenant_id)

    # fuel_out=96, fuel_in=48 → (96-48)/12.5 = 3.84 steps × $5 = $19.20
    assert result.fuel_charge > Decimal("0.00")
    assert result.fuel_charge == Decimal("19.20")


@pytest.mark.asyncio
async def test_check_in_no_fuel_penalty_when_full():
    """No fuel penalty when vehicle is returned full."""
    svc, mock_session, tenant_id = _make_service()

    ra = _make_ra(status="ACTIVE", odometer_out=10000, fuel_level_out_pct=96)

    with patch.object(svc, "_get_rental_agreement", AsyncMock(return_value=ra)):
        with patch.object(
            svc, "_calculate_time_extension", AsyncMock(return_value=Decimal("0.00"))
        ):
            with patch.object(svc, "_transition_vehicle_status", AsyncMock()):
                data = CheckInRequest(
                    rental_agreement_id=uuid.UUID(ra.ra_id),
                    odometer_in=10500,
                    fuel_level_in=8,  # Returned full
                )
                result = await svc.check_in(data, uuid.uuid4(), tenant_id)

    assert result.fuel_charge == Decimal("0.00")


# ── test_walk_up_requires_vehicle_class ───────────────────────────────────────

@pytest.mark.asyncio
async def test_walk_up_without_reservation_or_vehicle_class_raises():
    """
    Walk-up checkout without reservation_id AND without walk_up=True must fail.
    """
    svc, mock_session, tenant_id = _make_service()

    with pytest.raises((BusinessRuleError, Exception)):
        data = CheckoutRequest(
            # No reservation_id and walk_up defaults to False
            reservation_id=None,
            odometer_out=12000,
            fuel_level_out=8,
        )
        await svc.checkout(data, uuid.uuid4(), tenant_id)
