"""
Unit tests for DamageService.

All external dependencies (DB session, raw SQL calls) are mocked.
Tests verify damage claim business logic in isolation.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from app.core.exceptions import BusinessRuleError, ResourceNotFoundError
from app.domains.damage.schemas import (
    CDW_VOID_CONDITIONS,
    CLAIM_TRANSITIONS,
    VEHICLE_ZONES,
    ClaimStatus,
    DamageClaimCreate,
    InspectionForm,
    InspectionType,
    ZoneCondition,
    ZoneDiff,
    ZoneInspection,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_claim(
    claim_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    status: str = "OPEN",
    cdw_on_agreement: bool = False,
    cdw_voided: bool = False,
    cdw_void_reason: Optional[str] = None,
    vehicle_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    ra_id: Optional[str] = None,
    loss_of_use_days: int = 0,
    repair_start_date: Optional[date] = None,
    repair_end_date: Optional[date] = None,
    notes: Optional[str] = None,
) -> MagicMock:
    claim = MagicMock()
    claim.claim_id = claim_id or str(uuid.uuid4())
    claim.tenant_id = tenant_id or str(uuid.uuid4())
    claim.status = status
    claim.cdw_on_agreement = cdw_on_agreement
    claim.cdw_voided = cdw_voided
    claim.cdw_void_reason = cdw_void_reason
    claim.cdw_covered = cdw_on_agreement and not cdw_voided
    claim.vehicle_id = vehicle_id or str(uuid.uuid4())
    claim.customer_id = customer_id or str(uuid.uuid4())
    claim.rental_agreement_id = ra_id or str(uuid.uuid4())
    claim.loss_of_use_days = loss_of_use_days
    claim.repair_start_date = repair_start_date
    claim.repair_end_date = repair_end_date
    claim.notes = notes
    claim.created_at = datetime.now(timezone.utc)
    claim.updated_at = datetime.now(timezone.utc)
    return claim


def _make_service():
    """Create a DamageService with mocked session."""
    from app.domains.damage.service import DamageService

    mock_session = AsyncMock()
    tenant_id = uuid.uuid4()

    svc = DamageService.__new__(DamageService)
    svc._session = mock_session
    svc._tenant_id = tenant_id

    return svc, mock_session, tenant_id


# ── compare_inspections ────────────────────────────────────────────────────────

def test_compare_inspections_detects_new_damage():
    """
    compare_inspections must return zones where post condition is worse than pre.
    GOOD → SCRATCHED and GOOD → DENTED must both be flagged as new damage.
    """
    from app.domains.damage.service import DamageService
    svc = DamageService.__new__(DamageService)

    pre_data = {
        "FRONT_LEFT": "GOOD",
        "FRONT_CENTER": "GOOD",
        "ROOF_CENTER": "SCRATCHED",  # Pre-existing scratch
    }
    post_data = {
        "FRONT_LEFT": "DENTED",        # New damage
        "FRONT_CENTER": "SCRATCHED",   # New damage (was GOOD)
        "ROOF_CENTER": "SCRATCHED",    # No change (pre-existing)
    }

    new_damages = svc.compare_inspections(pre_data, post_data)

    # Only FRONT_LEFT and FRONT_CENTER should be flagged
    damaged_zones = {d["zone_name"] for d in new_damages}
    assert "FRONT_LEFT" in damaged_zones
    assert "FRONT_CENTER" in damaged_zones
    # Pre-existing scratch should NOT be flagged
    assert "ROOF_CENTER" not in damaged_zones

    # All returned diffs must be marked is_new_damage
    assert all(d["is_new_damage"] for d in new_damages)


def test_compare_inspections_ignores_pre_existing_damage():
    """
    Zones that were already damaged in PRE inspection must NOT appear in the
    diff result even if the same damage type appears in POST.
    """
    from app.domains.damage.service import DamageService
    svc = DamageService.__new__(DamageService)

    # PRE: door dented from before
    pre_data = {
        "DOOR_FRONT_LEFT": "DENTED",
        "FRONT_CENTER": "GOOD",
    }
    # POST: same door dent, no change; new crack on windshield
    post_data = {
        "DOOR_FRONT_LEFT": "DENTED",     # Pre-existing — no delta
        "FRONT_CENTER": "GOOD",          # Still good
        "WINDSHIELD_FRONT": "CRACKED",   # New damage
    }

    new_damages = svc.compare_inspections(pre_data, post_data)

    damaged_zones = {d["zone_name"] for d in new_damages}
    assert "DOOR_FRONT_LEFT" not in damaged_zones    # Pre-existing
    assert "FRONT_CENTER" not in damaged_zones        # No change
    assert "WINDSHIELD_FRONT" in damaged_zones        # New crack


def test_compare_inspections_improved_condition_not_flagged():
    """
    A zone where condition improved (e.g., DENTED → GOOD, after repair)
    must NOT appear in the new damage list.
    """
    from app.domains.damage.service import DamageService
    svc = DamageService.__new__(DamageService)

    pre_data = {"TRUNK": "DENTED"}
    post_data = {"TRUNK": "GOOD"}  # Improved (shouldn't happen, but must not error)

    new_damages = svc.compare_inspections(pre_data, post_data)
    assert len(new_damages) == 0


def test_compare_inspections_uses_all_22_zones():
    """
    The comparison must handle all 22 canonical vehicle zones without error.
    """
    from app.domains.damage.service import DamageService
    svc = DamageService.__new__(DamageService)

    # All zones GOOD in both snapshots
    pre_data = {z: "GOOD" for z in VEHICLE_ZONES}
    post_data = {z: "GOOD" for z in VEHICLE_ZONES}

    new_damages = svc.compare_inspections(pre_data, post_data)
    assert len(new_damages) == 0
    assert len(VEHICLE_ZONES) == 22


# ── create_claim ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_claim_sets_damage_hold():
    """
    Creating a damage claim must trigger a DAMAGE_HOLD on the vehicle.
    The vehicle status must be updated to DAMAGE_HOLD in the same transaction.
    """
    svc, mock_session, tenant_id = _make_service()

    ra_id = uuid.uuid4()
    vehicle_id = uuid.uuid4()
    customer_id = uuid.uuid4()

    # Mock RA lookup
    ra_row_mock = MagicMock()
    ra_row_mock.__getitem__ = lambda self, key: {
        "customer_id": str(customer_id),
        "vehicle_id": str(vehicle_id),
        "extras_snapshot": [],
    }[key]
    ra_row_mock.get = lambda key, default=None: {
        "customer_id": str(customer_id),
        "vehicle_id": str(vehicle_id),
        "extras_snapshot": [],
    }.get(key, default)

    mock_result_ra = MagicMock()
    mock_result_ra.mappings.return_value.first.return_value = ra_row_mock

    mock_session.execute = AsyncMock(return_value=mock_result_ra)

    data = DamageClaimCreate(
        rental_agreement_id=ra_id,
        zone_data_diff=[
            ZoneDiff(
                zone_name="FRONT_LEFT",
                pre_condition=ZoneCondition.GOOD,
                post_condition=ZoneCondition.DENTED,
                is_new_damage=True,
            )
        ],
        severity=2,
        photos=["s3://bucket/photo1.jpg"],
        notes="Customer returned with front dent",
    )

    with patch.object(svc, "_check_cdw_in_extras", AsyncMock(return_value=False)):
        claim = await svc.create_claim(data, tenant_id, uuid.uuid4())

    # Verify DAMAGE_HOLD was applied to vehicle.
    # c.args[0] is the TextClause; str() on it returns the SQL text.
    all_calls = mock_session.execute.call_args_list
    damage_hold_applied = any(
        c.args and "DAMAGE_HOLD" in str(c.args[0])
        for c in all_calls
    )
    assert damage_hold_applied, (
        f"Expected DAMAGE_HOLD update on vehicle but did not find it in calls: {all_calls}"
    )


@pytest.mark.asyncio
async def test_create_claim_no_cdw_when_not_in_extras():
    """CDW is not covered when CDW extra is absent from the RA extras_snapshot."""
    svc, mock_session, tenant_id = _make_service()

    ra_id = uuid.uuid4()

    ra_row_mock = MagicMock()
    ra_row_mock.get = lambda key, default=None: {
        "customer_id": str(uuid.uuid4()),
        "vehicle_id": str(uuid.uuid4()),
        "extras_snapshot": [],  # No CDW
    }.get(key, default)
    ra_row_mock.__getitem__ = lambda self, key: ra_row_mock.get(key)

    mock_result = MagicMock()
    mock_result.mappings.return_value.first.return_value = ra_row_mock

    mock_session.execute = AsyncMock(return_value=mock_result)

    data = DamageClaimCreate(
        rental_agreement_id=ra_id,
        zone_data_diff=[
            ZoneDiff(
                zone_name="ROOF_CENTER",
                pre_condition=ZoneCondition.GOOD,
                post_condition=ZoneCondition.CRACKED,
                is_new_damage=True,
            )
        ],
        severity=3,
        notes="Cracked roof",
    )

    with patch.object(svc, "_check_cdw_in_extras", AsyncMock(return_value=False)):
        claim = await svc.create_claim(data, tenant_id, uuid.uuid4())

    assert claim.cdw_on_agreement is False


# ── CDW void conditions ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cdw_void_on_wrong_fuel():
    """
    CDW must be voided when WRONG_FUEL appears in claim notes.

    Spec invariant: CDW void conditions are DUI, UNAUTHORIZED_DRIVER, OFF_ROAD, WRONG_FUEL.
    """
    svc, mock_session, tenant_id = _make_service()

    ra_id = uuid.uuid4()
    vehicle_id = uuid.uuid4()
    customer_id = uuid.uuid4()

    # RA has CDW extra — would normally be covered
    ra_row_mock = MagicMock()
    ra_row_mock.get = lambda key, default=None: {
        "customer_id": str(customer_id),
        "vehicle_id": str(vehicle_id),
        "extras_snapshot": [{"code": "CDW", "name": "Collision Damage Waiver"}],
    }.get(key, default)
    ra_row_mock.__getitem__ = lambda self, key: ra_row_mock.get(key)

    mock_result = MagicMock()
    mock_result.mappings.return_value.first.return_value = ra_row_mock

    mock_session.execute = AsyncMock(return_value=mock_result)

    data = DamageClaimCreate(
        rental_agreement_id=ra_id,
        zone_data_diff=[
            ZoneDiff(
                zone_name="UNDERBODY_FRONT",
                pre_condition=ZoneCondition.GOOD,
                post_condition=ZoneCondition.BROKEN,
                is_new_damage=True,
            )
        ],
        severity=5,
        notes="Engine damaged due to WRONG_FUEL — diesel used in petrol vehicle",
    )

    # CDW extras present but void condition in notes
    with patch.object(svc, "_check_cdw_in_extras", AsyncMock(return_value=True)):
        claim = await svc.create_claim(data, tenant_id, uuid.uuid4())

    # CDW was present but should be voided due to WRONG_FUEL
    assert claim.cdw_voided is True
    assert claim.cdw_void_reason == "WRONG_FUEL"
    assert claim.cdw_covered is False  # property: cdw_on_agreement AND NOT cdw_voided


@pytest.mark.asyncio
async def test_cdw_void_conditions_include_all_four():
    """Ensure all four CDW void conditions are recognized."""
    expected = {"DUI", "UNAUTHORIZED_DRIVER", "OFF_ROAD", "WRONG_FUEL"}
    assert set(CDW_VOID_CONDITIONS) == expected


# ── transition_claim_status ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_claim_status_valid_transition_open_to_estimate_sent():
    """
    A valid transition OPEN → ESTIMATE_SENT must succeed and update the claim status.
    """
    svc, mock_session, tenant_id = _make_service()
    claim_id = uuid.uuid4()

    claim = _make_claim(status="OPEN")

    with patch.object(svc, "get_claim", AsyncMock(return_value=claim)):
        result = await svc.transition_claim_status(
            claim_id=claim_id,
            new_status=ClaimStatus.ESTIMATE_SENT,
            actor_id=uuid.uuid4(),
            reason="Estimate prepared and sent to customer",
            tenant_id=tenant_id,
        )

    assert result.status == "ESTIMATE_SENT"


@pytest.mark.asyncio
async def test_claim_status_invalid_transition_raises():
    """
    An invalid transition must raise BusinessRuleError.

    OPEN → PAID is not in the valid CLAIM_TRANSITIONS matrix.
    """
    svc, mock_session, tenant_id = _make_service()
    claim_id = uuid.uuid4()

    claim = _make_claim(status="OPEN")

    with patch.object(svc, "get_claim", AsyncMock(return_value=claim)):
        with pytest.raises(BusinessRuleError) as exc_info:
            await svc.transition_claim_status(
                claim_id=claim_id,
                new_status=ClaimStatus.PAID,  # Invalid from OPEN
                actor_id=uuid.uuid4(),
                reason="Trying to skip to paid",
                tenant_id=tenant_id,
            )

    error_msg = str(exc_info.value).lower()
    assert "invalid" in error_msg or "transition" in error_msg or "open" in error_msg


@pytest.mark.asyncio
async def test_claim_status_invalid_transition_paid_is_terminal():
    """PAID is a terminal state — no further transitions are allowed."""
    svc, mock_session, tenant_id = _make_service()
    claim_id = uuid.uuid4()

    claim = _make_claim(status="PAID")

    with patch.object(svc, "get_claim", AsyncMock(return_value=claim)):
        with pytest.raises(BusinessRuleError):
            await svc.transition_claim_status(
                claim_id=claim_id,
                new_status=ClaimStatus.DISPUTED,  # Cannot re-open PAID
                actor_id=uuid.uuid4(),
                reason="Customer disputed after paying",
                tenant_id=tenant_id,
            )


@pytest.mark.asyncio
async def test_claim_status_invalid_transition_written_off_is_terminal():
    """WRITTEN_OFF is a terminal state — no further transitions are allowed."""
    svc, mock_session, tenant_id = _make_service()
    claim_id = uuid.uuid4()

    claim = _make_claim(status="WRITTEN_OFF")

    with patch.object(svc, "get_claim", AsyncMock(return_value=claim)):
        with pytest.raises(BusinessRuleError):
            await svc.transition_claim_status(
                claim_id=claim_id,
                new_status=ClaimStatus.OPEN,  # Cannot reopen a written-off claim
                actor_id=uuid.uuid4(),
                reason="Trying to reopen",
                tenant_id=tenant_id,
            )


# ── calculate_lou ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_lou_calculation_high_utilization():
    """
    When fleet utilization is >= 80%, LOU factor is 1.0 (full daily rate applies).
    lou_amount = daily_rate × lou_days × 1.0
    """
    svc, mock_session, tenant_id = _make_service()

    claim_id = uuid.uuid4()
    claim = _make_claim(
        claim_id=str(claim_id),
        loss_of_use_days=5,
        repair_start_date=date(2026, 1, 1),
        repair_end_date=date(2026, 1, 6),  # 5 days repair
    )

    with patch.object(svc, "get_claim", AsyncMock(return_value=claim)):
        with patch.object(svc, "_get_vehicle_daily_rate", AsyncMock(return_value=Decimal("50.00"))):
            with patch.object(svc, "_get_fleet_utilization", AsyncMock(return_value=Decimal("0.85"))):
                result = await svc.calculate_lou(claim_id, tenant_id)

    # utilization 0.85 >= 0.80 → factor = 1.0
    assert result.utilization_factor == Decimal("1.0")
    # 5 days × $50 × 1.0 = $250
    assert result.lou_amount == Decimal("250.00")


@pytest.mark.asyncio
async def test_lou_calculation_low_utilization():
    """
    When fleet utilization is < 80%, LOU factor is prorated: factor = utilization / 0.80
    """
    svc, mock_session, tenant_id = _make_service()

    claim_id = uuid.uuid4()
    claim = _make_claim(
        claim_id=str(claim_id),
        repair_start_date=date(2026, 1, 1),
        repair_end_date=date(2026, 1, 4),  # 3 days
    )

    with patch.object(svc, "get_claim", AsyncMock(return_value=claim)):
        with patch.object(svc, "_get_vehicle_daily_rate", AsyncMock(return_value=Decimal("60.00"))):
            with patch.object(svc, "_get_fleet_utilization", AsyncMock(return_value=Decimal("0.60"))):
                result = await svc.calculate_lou(claim_id, tenant_id)

    # factor = 0.60 / 0.80 = 0.75
    expected_factor = (Decimal("0.60") / Decimal("0.80"))
    assert result.utilization_factor == expected_factor
    # 3 days × $60 × 0.75 = $135
    assert result.lou_amount == Decimal("135.00")


# ── CLAIM_TRANSITIONS completeness ────────────────────────────────────────────

def test_claim_transitions_all_statuses_present():
    """Every ClaimStatus must appear as a key in CLAIM_TRANSITIONS (even if terminal)."""
    for status in ClaimStatus:
        assert status in CLAIM_TRANSITIONS, (
            f"ClaimStatus.{status.value} is missing from CLAIM_TRANSITIONS"
        )


def test_claim_transitions_terminal_states_have_no_successors():
    """PAID and WRITTEN_OFF must have no allowed transitions."""
    assert CLAIM_TRANSITIONS[ClaimStatus.PAID] == []
    assert CLAIM_TRANSITIONS[ClaimStatus.WRITTEN_OFF] == []
