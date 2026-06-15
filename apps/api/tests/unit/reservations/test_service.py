"""
Unit tests for ReservationService.

Tests are fully isolated — no DB, no real Redis.
All external dependencies are mocked with unittest.mock.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from app.core.exceptions import BusinessRuleError, ForbiddenError, ConflictError
from app.domains.reservations.models import Reservation
from app.domains.reservations.schemas import (
    BookingChannel,
    CancellationRequest,
    GuestInfo,
    ReservationCreate,
    ReservationModify,
)
from app.domains.reservations.service import (
    ReservationService,
    _calculate_cancellation,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

TENANT_ID = UUID("00000000-0000-0000-0000-000000000001")
ACTOR_ID = UUID("00000000-0000-0000-0000-000000000002")
CUSTOMER_ID = UUID("00000000-0000-0000-0000-000000000003")
LOCATION_ID = UUID("00000000-0000-0000-0000-000000000004")
CLASS_ID = UUID("00000000-0000-0000-0000-000000000005")


def _make_reservation(
    reservation_id: str | None = None,
    status: str = "CONFIRMED",
    pickup_dt: datetime | None = None,
    deposit_amount: Decimal = Decimal("100.00"),
    version: int = 1,
) -> Reservation:
    """Create an in-memory Reservation ORM object (no DB)."""
    res = Reservation()
    res.reservation_id = reservation_id or str(uuid4())
    res.tenant_id = str(TENANT_ID)
    res.confirmation_number = "RCM-20260801-ABC123"
    res.status = status
    res.customer_id = str(CUSTOMER_ID)
    res.corporate_account_id = None
    res.pickup_location_id = str(LOCATION_ID)
    res.dropoff_location_id = str(LOCATION_ID)
    res.pickup_datetime = pickup_dt or datetime(2026, 8, 10, 10, 0, tzinfo=timezone.utc)
    res.return_datetime = datetime(2026, 8, 12, 10, 0, tzinfo=timezone.utc)
    res.actual_return_datetime = None
    res.vehicle_class_id = str(CLASS_ID)
    res.assigned_vehicle_id = None
    res.rate_code_id = None
    res.cdp_code = None
    res.promo_code = None
    res.currency = "USD"
    res.base_rate_daily = Decimal("50.00")
    res.base_total = Decimal("100.00")
    res.extras_total = Decimal("0.00")
    res.discount_total = Decimal("0.00")
    res.location_fees_total = Decimal("0.00")
    res.taxes_total = Decimal("0.00")
    res.grand_total = Decimal("100.00")
    res.deposit_amount = deposit_amount
    res.extras_snapshot = []
    res.taxes_snapshot = []
    res.channel = "DIRECT_WEB"
    res.ota_booking_ref = None
    res.insurance_replacement_flag = False
    res.flight_number = None
    res.special_instructions = None
    res.cancellation_policy_id = None
    res.no_show_fee_charged = None
    res.no_show_at = None
    res.loyalty_points_earned = 0
    res.loyalty_points_redeemed = 0
    res.is_training = False
    res.booking_agent_id = None
    res.rate_quote_token = None
    res.version = version
    res.created_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
    res.updated_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
    res.deleted_at = None
    return res


def _make_service(
    reservation: Reservation | None = None,
    cache_hit: bool = True,
    available_count: int = 1,
) -> tuple[ReservationService, MagicMock, MagicMock]:
    """Build a ReservationService with fully mocked dependencies."""
    repo = MagicMock()

    # Default: get_by_id_or_raise returns the provided reservation
    if reservation is not None:
        repo.get_by_id_or_raise = AsyncMock(return_value=reservation)
        repo.get_by_id = AsyncMock(return_value=reservation)
    else:
        from app.core.exceptions import ResourceNotFoundError
        repo.get_by_id_or_raise = AsyncMock(
            side_effect=ResourceNotFoundError("reservation", "not-found")
        )
        repo.get_by_id = AsyncMock(return_value=None)

    repo.get_by_confirmation_number = AsyncMock(return_value=None)
    repo.acquire_advisory_lock = AsyncMock(return_value=None)
    repo.check_availability_db = AsyncMock(return_value=available_count)
    repo.update_status = AsyncMock(return_value=None)
    repo.update_reservation = AsyncMock(return_value=reservation)
    repo.create_version_snapshot = AsyncMock(return_value=MagicMock())
    repo.create_reservation = AsyncMock(return_value=reservation or _make_reservation())
    repo.list_reservations = AsyncMock(return_value=[])

    redis = MagicMock()
    # Simulate cached quote token
    if cache_hit:
        _cached_quote = json.dumps(
            {
                "rate_code_id": str(uuid4()),
                "currency": "USD",
                "total": "100.00",
                "line_items": [],
            }
        )
        redis.get = AsyncMock(return_value=_cached_quote)
    else:
        redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock(return_value=True)

    svc = ReservationService(repo=repo, redis=redis, tenant_id=TENANT_ID)
    return svc, repo, redis


def _make_create_request(
    pickup_dt: datetime | None = None,
    dropoff_dt: datetime | None = None,
) -> ReservationCreate:
    return ReservationCreate(
        customer_id=CUSTOMER_ID,
        location_id=LOCATION_ID,
        vehicle_class_id=CLASS_ID,
        pickup_dt=pickup_dt or datetime(2026, 8, 10, 10, 0, tzinfo=timezone.utc),
        dropoff_dt=dropoff_dt or datetime(2026, 8, 12, 10, 0, tzinfo=timezone.utc),
        rate_quote_token="a" * 64,  # 64-char SHA-256 hex string
        source=BookingChannel.DIRECT_WEB,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestCreateReservationExpiredQuoteToken:
    """test_create_reservation_expired_quote_token — raises BusinessRuleError."""

    @pytest.mark.asyncio
    async def test_expired_token_raises_business_rule_error(self):
        """
        When Redis does NOT have the quote token (it has expired or never existed),
        create_reservation must raise BusinessRuleError.
        """
        svc, repo, redis = _make_service(cache_hit=False)
        redis.get = AsyncMock(return_value=None)  # Expired / missing

        req = _make_create_request()

        with pytest.raises(BusinessRuleError) as exc_info:
            await svc.create_reservation(data=req, actor_id=ACTOR_ID)

        assert "expired" in str(exc_info.value).lower() or "invalid" in str(exc_info.value).lower()

        # Repository must NOT have been called (fail-fast before DB access)
        repo.check_availability_db.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_valid_token_proceeds_to_availability_check(self):
        """When the token is valid (Redis hit), the service proceeds to check availability."""
        reservation = _make_reservation()
        svc, repo, redis = _make_service(reservation=reservation, cache_hit=True)

        req = _make_create_request()
        result = await svc.create_reservation(data=req, actor_id=ACTOR_ID)

        # Availability was checked
        repo.check_availability_db.assert_awaited()
        assert result is not None


class TestCreateReservationRaceCondition:
    """test_create_reservation_race_condition — exclusion constraint → VehicleNotAvailableError."""

    @pytest.mark.asyncio
    async def test_race_condition_no_availability_after_lock(self):
        """
        Simulates a race condition: availability count drops to 0 after
        acquiring the advisory lock (second check under lock).

        The service should raise ConflictError.
        """
        reservation = _make_reservation()
        svc, repo, redis = _make_service(reservation=reservation, cache_hit=True)

        # First check passes (1 available), second check (under lock) returns 0
        call_count = 0

        async def _availability(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 1:
                return 1  # First check passes
            return 0  # Under lock: now gone

        repo.check_availability_db = AsyncMock(side_effect=_availability)

        req = _make_create_request()

        with pytest.raises(ConflictError):
            await svc.create_reservation(data=req, actor_id=ACTOR_ID)

        # Advisory lock must have been acquired
        repo.acquire_advisory_lock.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_advisory_lock_acquired_before_second_check(self):
        """Advisory lock is always acquired before the second availability check."""
        reservation = _make_reservation()
        svc, repo, redis = _make_service(reservation=reservation, cache_hit=True)

        lock_acquired_before_second_check = False
        lock_acquired = False

        async def _mock_lock(*args, **kwargs):
            nonlocal lock_acquired
            lock_acquired = True

        async def _availability(*args, **kwargs):
            nonlocal lock_acquired_before_second_check
            # If lock is acquired, this is the second check
            if lock_acquired:
                lock_acquired_before_second_check = True
            return 1

        repo.acquire_advisory_lock = AsyncMock(side_effect=_mock_lock)
        repo.check_availability_db = AsyncMock(side_effect=_availability)

        req = _make_create_request()
        await svc.create_reservation(data=req, actor_id=ACTOR_ID)

        assert lock_acquired_before_second_check, (
            "Lock must be acquired before the second availability check"
        )


class TestCancelReservationWithFee:
    """test_cancel_reservation_with_fee — fee calculated correctly."""

    @pytest.mark.asyncio
    async def test_cancellation_free_before_72h(self):
        """
        Cancel 73 hours before pickup → full refund, zero fee.
        From ARCH_DOMAINS §3.7: ≥72h → 100% refund.
        """
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=73)  # 73h from now → FREE_CANCELLATION

        reservation = _make_reservation(
            pickup_dt=pickup_at,
            deposit_amount=Decimal("200.00"),
        )
        svc, repo, _ = _make_service(reservation=reservation)

        result = await svc.cancel_reservation(
            reservation_id=UUID(reservation.reservation_id),
            data=CancellationRequest(reason="Changed plans", waive_fee=False),
            actor_id=ACTOR_ID,
            actor_roles=["COUNTER_AGENT"],
        )

        assert result.refund_amount == Decimal("200.00")
        assert result.cancellation_fee == Decimal("0.00")
        assert result.policy_tier == "FREE_CANCELLATION"

    @pytest.mark.asyncio
    async def test_cancellation_partial_24_to_72h(self):
        """
        Cancel 48 hours before pickup → 50% refund, 50% fee.
        From ARCH_DOMAINS §3.7: 24h–72h → 50% refund.
        """
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=48)

        reservation = _make_reservation(
            pickup_dt=pickup_at,
            deposit_amount=Decimal("200.00"),
        )
        svc, repo, _ = _make_service(reservation=reservation)

        result = await svc.cancel_reservation(
            reservation_id=UUID(reservation.reservation_id),
            data=CancellationRequest(reason="Changed plans", waive_fee=False),
            actor_id=ACTOR_ID,
            actor_roles=["COUNTER_AGENT"],
        )

        assert result.refund_amount == Decimal("100.00")
        assert result.cancellation_fee == Decimal("100.00")
        assert result.policy_tier == "PARTIAL_REFUND"

    @pytest.mark.asyncio
    async def test_cancellation_no_refund_within_24h(self):
        """
        Cancel 6 hours before pickup → 0% refund, 100% fee.
        From ARCH_DOMAINS §3.7: <24h → 0% refund.
        """
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=6)

        reservation = _make_reservation(
            pickup_dt=pickup_at,
            deposit_amount=Decimal("200.00"),
        )
        svc, repo, _ = _make_service(reservation=reservation)

        result = await svc.cancel_reservation(
            reservation_id=UUID(reservation.reservation_id),
            data=CancellationRequest(reason="Last minute", waive_fee=False),
            actor_id=ACTOR_ID,
            actor_roles=["COUNTER_AGENT"],
        )

        assert result.refund_amount == Decimal("0.00")
        assert result.cancellation_fee == Decimal("200.00")
        assert result.policy_tier == "NO_REFUND"

    @pytest.mark.asyncio
    async def test_non_confirmed_reservation_cannot_be_cancelled(self):
        """Only CONFIRMED reservations can be cancelled."""
        reservation = _make_reservation(status="CHECKED_OUT")
        svc, repo, _ = _make_service(reservation=reservation)

        with pytest.raises(BusinessRuleError):
            await svc.cancel_reservation(
                reservation_id=UUID(reservation.reservation_id),
                data=CancellationRequest(reason="Test", waive_fee=False),
                actor_id=ACTOR_ID,
                actor_roles=["COUNTER_AGENT"],
            )


class TestCancelWaiveFeeUnauthorized:
    """test_cancel_waive_fee_unauthorized — agent cannot waive fee, raises ForbiddenError."""

    @pytest.mark.asyncio
    async def test_counter_agent_cannot_waive_fee(self):
        """
        A COUNTER_AGENT requesting waive_fee=True must receive ForbiddenError.
        Only BRANCH_MANAGER / REGIONAL_MANAGER / SYSTEM_ADMIN / SUPER_ADMIN may waive.
        """
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=6)  # Within no-refund window

        reservation = _make_reservation(
            pickup_dt=pickup_at,
            deposit_amount=Decimal("200.00"),
        )
        svc, _, _ = _make_service(reservation=reservation)

        with pytest.raises(ForbiddenError) as exc_info:
            await svc.cancel_reservation(
                reservation_id=UUID(reservation.reservation_id),
                data=CancellationRequest(reason="Customer request", waive_fee=True),
                actor_id=ACTOR_ID,
                actor_roles=["COUNTER_AGENT"],  # ← insufficient role
            )

        assert "manager" in str(exc_info.value).lower() or "fee" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_branch_manager_can_waive_fee(self):
        """A BRANCH_MANAGER with waive_fee=True should get a full refund."""
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=6)

        reservation = _make_reservation(
            pickup_dt=pickup_at,
            deposit_amount=Decimal("200.00"),
        )
        svc, _, _ = _make_service(reservation=reservation)

        result = await svc.cancel_reservation(
            reservation_id=UUID(reservation.reservation_id),
            data=CancellationRequest(reason="Manager override", waive_fee=True),
            actor_id=ACTOR_ID,
            actor_roles=["BRANCH_MANAGER"],  # ← has permission
        )

        assert result.refund_amount == Decimal("200.00")
        assert result.cancellation_fee == Decimal("0.00")
        assert "AGENT_WAIVED" in result.policy_tier

    @pytest.mark.asyncio
    async def test_system_admin_can_waive_fee(self):
        """SYSTEM_ADMIN can waive fees."""
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=1)

        reservation = _make_reservation(
            pickup_dt=pickup_at,
            deposit_amount=Decimal("150.00"),
        )
        svc, _, _ = _make_service(reservation=reservation)

        result = await svc.cancel_reservation(
            reservation_id=UUID(reservation.reservation_id),
            data=CancellationRequest(reason="Admin override", waive_fee=True),
            actor_id=ACTOR_ID,
            actor_roles=["SYSTEM_ADMIN"],
        )

        assert result.refund_amount == Decimal("150.00")
        assert result.cancellation_fee == Decimal("0.00")


class TestNoShowIdempotent:
    """test_no_show_idempotent — running twice on same reservation is safe."""

    @pytest.mark.asyncio
    async def test_no_show_twice_is_safe(self):
        """
        Running handle_no_show() twice on the same reservation is idempotent.

        On the second call, the SELECT FOR UPDATE SKIP LOCKED returns no rows
        (status is already NO_SHOW, not CONFIRMED), so the service exits early.
        This is simulated by having the first call succeed and the second
        return None from the SKIP LOCKED query.
        """
        reservation_id = uuid4()
        call_count = 0

        # Simulate the DB SELECT FOR UPDATE SKIP LOCKED behaviour
        # First call: returns a row (lock acquired, process the no-show)
        # Second call: returns None (already processed by first call)
        mock_session = MagicMock()
        mock_result = MagicMock()

        async def _execute(stmt, params):
            nonlocal call_count
            call_count += 1
            row_mock = MagicMock()
            row_mock.__bool__ = lambda self: True
            if call_count == 1:
                mock_result.fetchone = MagicMock(return_value=(str(reservation_id),))
            else:
                mock_result.fetchone = MagicMock(return_value=None)  # Already processed
            return mock_result

        mock_session.execute = AsyncMock(side_effect=_execute)

        repo = MagicMock()
        repo.session = mock_session
        repo.update_status = AsyncMock(return_value=None)

        redis = MagicMock()
        svc = ReservationService(repo=repo, redis=redis, tenant_id=TENANT_ID)

        # First call: marks as NO_SHOW
        await svc.handle_no_show(reservation_id)
        # Second call: exits early (idempotent)
        await svc.handle_no_show(reservation_id)

        # update_status should only be called once
        assert repo.update_status.await_count == 1, (
            f"update_status should be called exactly once but was called "
            f"{repo.update_status.await_count} times"
        )

    @pytest.mark.asyncio
    async def test_no_show_status_not_confirmed_is_skipped(self):
        """
        If the reservation is already NO_SHOW or CANCELLED (not CONFIRMED),
        the SELECT FOR UPDATE SKIP LOCKED returns no rows and no action is taken.
        """
        reservation_id = uuid4()

        mock_session = MagicMock()
        mock_result = MagicMock()
        mock_result.fetchone = MagicMock(return_value=None)  # Nothing locked
        mock_session.execute = AsyncMock(return_value=mock_result)

        repo = MagicMock()
        repo.session = mock_session
        repo.update_status = AsyncMock()

        redis = MagicMock()
        svc = ReservationService(repo=repo, redis=redis, tenant_id=TENANT_ID)

        await svc.handle_no_show(reservation_id)

        # No status update should happen
        repo.update_status.assert_not_awaited()


# ── Unit tests for cancellation policy engine ────────────────────────────────


class TestCancellationPolicyEngine:
    """Direct unit tests for the _calculate_cancellation helper."""

    def test_free_cancellation_at_73h(self):
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=73)
        refund, fee, label = _calculate_cancellation(
            deposit_paid=Decimal("100.00"),
            pickup_at=pickup_at,
            cancelled_at=now,
        )
        assert refund == Decimal("100.00")
        assert fee == Decimal("0.00")
        assert label == "FREE_CANCELLATION"

    def test_partial_refund_at_48h(self):
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=48)
        refund, fee, label = _calculate_cancellation(
            deposit_paid=Decimal("100.00"),
            pickup_at=pickup_at,
            cancelled_at=now,
        )
        assert refund == Decimal("50.00")
        assert fee == Decimal("50.00")
        assert label == "PARTIAL_REFUND"

    def test_no_refund_at_6h(self):
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=6)
        refund, fee, label = _calculate_cancellation(
            deposit_paid=Decimal("100.00"),
            pickup_at=pickup_at,
            cancelled_at=now,
        )
        assert refund == Decimal("0.00")
        assert fee == Decimal("100.00")
        assert label == "NO_REFUND"

    def test_waive_fee_overrides_to_full_refund(self):
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=6)  # Would normally be NO_REFUND
        refund, fee, label = _calculate_cancellation(
            deposit_paid=Decimal("100.00"),
            pickup_at=pickup_at,
            cancelled_at=now,
            waive_fee=True,
        )
        assert refund == Decimal("100.00")
        assert fee == Decimal("0.00")
        assert "AGENT_WAIVED" in label

    def test_half_up_rounding_on_partial_refund(self):
        """Partial refund: 50% of $1.005 → $0.51 (ROUND_HALF_UP)."""
        now = datetime.now(timezone.utc)
        pickup_at = now + timedelta(hours=48)
        refund, fee, label = _calculate_cancellation(
            deposit_paid=Decimal("1.01"),
            pickup_at=pickup_at,
            cancelled_at=now,
        )
        # 50% of 1.01 = 0.505 → ROUND_HALF_UP → 0.51
        assert refund == Decimal("0.51")
        assert fee == Decimal("0.50")
        assert label == "PARTIAL_REFUND"


# ── Confirmation number format tests ─────────────────────────────────────────


class TestConfirmationNumberFormat:
    """Verify the confirmation number format matches the spec."""

    def test_format_matches_pattern(self):
        """Format: RCM-{YYYYMMDD}-{6 uppercase alphanumeric}."""
        import re
        from app.domains.reservations.service import _generate_confirmation_number

        pattern = re.compile(r"^RCM-\d{8}-[0-9A-Z]{6}$")
        for _ in range(20):
            number = _generate_confirmation_number()
            assert pattern.match(number), (
                f"Confirmation number '{number}' does not match expected format"
            )

    def test_numbers_are_unique(self):
        """Generated numbers should be statistically unique."""
        from app.domains.reservations.service import _generate_confirmation_number

        numbers = {_generate_confirmation_number() for _ in range(1000)}
        # With 36^6 = ~2.1B combinations, collisions in 1000 samples are astronomically unlikely
        assert len(numbers) == 1000, (
            "Collision detected in 1000 confirmation number generations"
        )
