"""Checkout / Counter Operations service — primary counter agent workflow."""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BusinessRuleError,
    ConflictError,
    ResourceNotFoundError,
)
from app.domains.checkout.models import RentalAgreement, ShiftLog
from app.domains.checkout.schemas import (
    CheckInRequest,
    CheckInResponse,
    CheckoutRequest,
    CheckoutResponse,
    ShiftCloseRequest,
    ShiftOpenRequest,
    ShiftReport,
    VehicleSwapRequest,
)


# ── RA number generation ──────────────────────────────────────────────────────

_RA_ALPHABET = string.digits + string.ascii_uppercase


def _generate_ra_number() -> str:
    """Generate a unique rental agreement number: RA-YYYYMMDD-XXXXX."""
    date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
    suffix = "".join(secrets.choice(_RA_ALPHABET) for _ in range(5))
    return f"RA-{date_part}-{suffix}"


# ── Service ───────────────────────────────────────────────────────────────────

class CheckoutService:
    """
    Counter agent primary workflow service.

    Orchestrates: checkout, check-in, shift open/close, vehicle swap.
    Delegates vehicle status transitions to the fleet domain (not imported
    directly to avoid circular deps — use raw SQL updates where fleet
    models are unavailable).
    """

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID) -> None:
        self._session = session
        self._tenant_id = tenant_id

    # ── Checkout ──────────────────────────────────────────────────────────────

    async def checkout(
        self,
        data: CheckoutRequest,
        agent_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> CheckoutResponse:
        """
        Full counter checkout sequence:

        1. Load reservation (must be CONFIRMED) or validate walk-up availability
        2. Check customer DNR — raise BusinessRuleError if blocked
        3. Assign vehicle (validate AVAILABLE or auto-assign)
        4. Verify pre-auth payment exists (AUTHORIZED)
        5. Create RentalAgreement (status=ACTIVE)
        6. Update vehicle status → ON_RENT
        7. Update reservation status → CHECKED_OUT
        8. Return CheckoutResponse
        """
        if not data.walk_up and data.reservation_id is None:
            raise BusinessRuleError(
                "Either reservation_id or walk_up=True must be provided."
            )

        reservation = None
        customer_id: Optional[str] = None

        # Step 1: Load and validate reservation
        if data.reservation_id is not None:
            reservation = await self._get_reservation(data.reservation_id, tenant_id)
            if reservation.status != "CONFIRMED":
                raise BusinessRuleError(
                    f"Reservation must be in CONFIRMED status to checkout. "
                    f"Current status: {reservation.status}"
                )
            customer_id = reservation.customer_id

        # Step 2: Check customer DNR
        if customer_id:
            await self._check_customer_dnr(uuid.UUID(customer_id), tenant_id)

        # Step 3: Resolve vehicle
        vehicle_id = await self._resolve_vehicle(data, tenant_id)

        # Step 4: Verify pre-auth exists (AUTHORIZED payment for this reservation)
        if reservation is not None and not data.admin_bypass_preauth:
            await self._verify_pre_auth(reservation.reservation_id, tenant_id)

        # Step 5: Create RentalAgreement
        ra_number = _generate_ra_number()
        now = datetime.now(timezone.utc)

        ra = RentalAgreement(
            ra_id=str(uuid.uuid4()),
            tenant_id=str(tenant_id),
            ra_number=ra_number,
            reservation_id=str(data.reservation_id) if data.reservation_id else None,
            customer_id=customer_id or (str(data.customer_id) if data.customer_id else None),
            checking_out_agent_id=str(agent_id),
            vehicle_id=vehicle_id,
            vin_at_checkout="UNKNOWN",  # populated from vehicle record in production
            odometer_out=data.odometer_out,
            fuel_level_out_pct=data.fuel_level_out * 12,  # 0-8 scale → 0-100%
            extras_snapshot=[str(e) for e in data.extras],
            status="ACTIVE",
            agent_notes=data.agent_notes,
            created_at=now,
            updated_at=now,
        )
        self._session.add(ra)

        # Step 6: Update vehicle status → ON_RENT
        await self._transition_vehicle_status(vehicle_id, "ON_RENT", tenant_id)

        # Step 7: Update reservation → CHECKED_OUT
        if reservation is not None:
            await self._update_reservation_status(
                reservation.reservation_id, "CHECKED_OUT", tenant_id
            )

        await self._session.flush()

        return CheckoutResponse(
            rental_agreement_id=uuid.UUID(ra.ra_id),
            ra_number=ra.ra_number,
            vehicle_id=uuid.UUID(vehicle_id),
            vin=ra.vin_at_checkout,
            customer_id=uuid.UUID(ra.customer_id),
            extras_snapshot=ra.extras_snapshot,
            pre_auth_status="AUTHORIZED",
            status=ra.status,
            checked_out_at=now,
        )

    async def check_in(
        self,
        data: CheckInRequest,
        agent_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> CheckInResponse:
        """
        Counter check-in sequence:

        1. Load RA (must be ACTIVE or EXTENDED → maps to CHECKED_OUT in reservation terms)
        2. Calculate time extension charge
        3. Calculate fuel penalty
        4. Calculate mileage overage
        5. Update RA (odometer_in, fuel_level_in, returned_at)
        6. Transition vehicle: ON_RENT → RETURNING → READY_FOR_INSPECTION
        7. Return CheckInResponse with estimated charges
        """
        ra = await self._get_rental_agreement(data.rental_agreement_id, tenant_id)

        if ra.status not in ("ACTIVE", "EXTENDED"):
            raise BusinessRuleError(
                f"Rental agreement must be ACTIVE or EXTENDED for check-in. "
                f"Current status: {ra.status}"
            )

        now = datetime.now(timezone.utc)

        # Step 2: Time extension charge
        time_extension_charge = await self._calculate_time_extension(ra, now)

        # Step 3: Fuel penalty
        fuel_charge = self._calculate_fuel_penalty(
            fuel_out=ra.fuel_level_out_pct or 100,
            fuel_in=data.fuel_level_in * 12,  # 0-8 scale → 0-100%
        )

        # Step 4: Mileage overage
        mileage_charge = self._calculate_mileage_overage(
            odometer_out=ra.odometer_out,
            odometer_in=data.odometer_in,
            mileage_plan=ra.mileage_plan or {},
        )

        # Step 5: Update RA
        ra.odometer_in = data.odometer_in
        ra.fuel_level_in_pct = data.fuel_level_in * 12
        ra.actual_return_datetime = now
        ra.checking_in_agent_id = str(agent_id)
        ra.agent_notes = data.agent_notes or ra.agent_notes
        ra.status = "RETURNED"
        ra.updated_at = now

        # Step 6: Transition vehicle status
        vehicle_id = ra.vehicle_id
        await self._transition_vehicle_status(vehicle_id, "RETURNING", tenant_id)
        await self._transition_vehicle_status(vehicle_id, "READY_FOR_INSPECTION", tenant_id)

        # Step 7: Mark reservation RETURNED so it leaves the active-rental queue
        if ra.reservation_id:
            await self._update_reservation_status(ra.reservation_id, "RETURNED", tenant_id)

        await self._session.flush()

        try:
            from app.domains.tasks.service import TaskService as _TaskService
            from app.core.database import AsyncSessionLocal
            async with AsyncSessionLocal() as _ts:
                await _TaskService(_ts, tenant_id).auto_create_from_event(
                    "RENTAL_RETURNED",
                    reservation_id=uuid.UUID(ra.reservation_id) if ra.reservation_id else None,
                    vehicle_id=uuid.UUID(ra.vehicle_id) if ra.vehicle_id else None,
                )
                await _ts.commit()
        except Exception:
            pass

        if getattr(ra, 'reservation_id', None):
            try:
                from app.worker.tasks.payment_tasks import process_bond_release
                process_bond_release.delay(
                    reservation_id=str(ra.reservation_id),
                    tenant_id=str(tenant_id),
                    return_condition=getattr(data, 'return_condition', 'NO_DAMAGE'),
                    damage_charge_amount=str(getattr(data, 'damage_charge_amount', '0.00')),
                    agent_id=str(agent_id),
                )
            except Exception:
                pass

        final_total = (
            time_extension_charge + fuel_charge + mileage_charge
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        return CheckInResponse(
            rental_agreement_id=data.rental_agreement_id,
            returned_at=now,
            time_extension_charge=time_extension_charge,
            fuel_charge=fuel_charge,
            mileage_overage_charge=mileage_charge,
            final_total_estimate=final_total,
            vehicle_status="READY_FOR_INSPECTION",
        )

    # ── Shift Management ──────────────────────────────────────────────────────

    async def open_shift(
        self,
        data: ShiftOpenRequest,
        agent_id: uuid.UUID,
        location_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> ShiftLog:
        """
        Open a counter shift.
        Only one open shift per agent per location is allowed.
        """
        # Check for existing open shift
        existing = await self._get_open_shift(agent_id, location_id, tenant_id)
        if existing is not None:
            raise ConflictError(
                f"Agent already has an open shift (shift_id={existing.shift_id}). "
                "Close the current shift before opening a new one."
            )

        # Count today's pending pickups
        pending_pickups = await self._count_pending_pickups(location_id, tenant_id)

        now = datetime.now(timezone.utc)
        shift = ShiftLog(
            shift_id=str(uuid.uuid4()),
            tenant_id=str(tenant_id),
            location_id=str(location_id),
            agent_id=str(agent_id),
            shift_type="OPEN",
            opening_cash=data.opening_cash,
            fleet_count=data.fleet_count_actual,
            pending_pickups_count=pending_pickups,
            notes=data.notes,
            created_at=now,
        )
        self._session.add(shift)
        await self._session.flush()
        return shift

    async def close_shift(
        self,
        data: ShiftCloseRequest,
        agent_id: uuid.UUID,
        location_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> ShiftReport:
        """
        Close a counter shift and calculate cash variance.

        If abs(variance) > $5.00 and no notes → raise BusinessRuleError.
        """
        open_shift = await self._get_open_shift(agent_id, location_id, tenant_id)
        if open_shift is None:
            raise ResourceNotFoundError("shift", f"agent={agent_id}, location={location_id}")

        # Calculate expected cash
        # In production: query payments table for cash payments since shift open
        # Simplified: expected = opening_cash (no cash payment query available here)
        opening_cash = open_shift.opening_cash or Decimal("0.00")
        expected_cash = opening_cash  # simplified; extend with cash payment query
        variance = data.closing_cash - expected_cash

        # Variance threshold: $5.00 = 500 cents
        if abs(variance) > Decimal("5.00") and not data.notes:
            raise BusinessRuleError(
                f"Cash variance of {variance:.2f} exceeds $5.00 threshold. "
                "A variance note is required."
            )

        now = datetime.now(timezone.utc)
        close_log = ShiftLog(
            shift_id=str(uuid.uuid4()),
            tenant_id=str(tenant_id),
            location_id=str(location_id),
            agent_id=str(agent_id),
            shift_type="CLOSE",
            opening_cash=opening_cash,
            closing_cash=data.closing_cash,
            expected_cash=expected_cash,
            cash_variance=variance,
            notes=data.notes,
            created_at=now,
        )
        self._session.add(close_log)
        await self._session.flush()

        return ShiftReport(
            shift_id=uuid.UUID(close_log.shift_id),
            location_id=location_id,
            agent_id=agent_id,
            shift_opened_at=open_shift.created_at,
            shift_closed_at=now,
            opening_cash=opening_cash,
            closing_cash=data.closing_cash,
            expected_cash=expected_cash,
            cash_variance=variance,
            variance_note_required=abs(variance) > Decimal("5.00"),
        )

    # ── Vehicle Swap ──────────────────────────────────────────────────────────

    async def swap_vehicle(
        self,
        data: VehicleSwapRequest,
        agent_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> RentalAgreement:
        """
        Perform a mid-rental vehicle swap.

        1. Verify original RA is ACTIVE or EXTENDED
        2. Verify new vehicle is AVAILABLE
        3. Transition original vehicle → READY_FOR_INSPECTION
        4. Transition new vehicle → ON_RENT
        5. Create new RA linked to original via swap_pair_id
        6. Return new RA
        """
        original_ra = await self._get_rental_agreement(data.rental_agreement_id, tenant_id)

        if original_ra.status not in ("ACTIVE", "EXTENDED"):
            raise BusinessRuleError(
                f"Only ACTIVE or EXTENDED rental agreements can be swapped. "
                f"Current status: {original_ra.status}"
            )

        new_vehicle_id = str(data.new_vehicle_id)
        await self._verify_vehicle_available(new_vehicle_id, tenant_id)

        # Transition original vehicle
        await self._transition_vehicle_status(original_ra.vehicle_id, "READY_FOR_INSPECTION", tenant_id)

        # Transition new vehicle → ON_RENT
        await self._transition_vehicle_status(new_vehicle_id, "ON_RENT", tenant_id)

        now = datetime.now(timezone.utc)

        # Create new RA
        new_ra_number = _generate_ra_number()
        new_ra = RentalAgreement(
            ra_id=str(uuid.uuid4()),
            tenant_id=str(tenant_id),
            ra_number=new_ra_number,
            reservation_id=original_ra.reservation_id,
            customer_id=original_ra.customer_id,
            checking_out_agent_id=str(agent_id),
            vehicle_id=new_vehicle_id,
            vin_at_checkout="UNKNOWN",
            odometer_out=0,  # will be populated by agent
            fuel_level_out_pct=100,
            extras_snapshot=original_ra.extras_snapshot,
            mileage_plan=original_ra.mileage_plan,
            status="ACTIVE",
            swapped_from_ra_id=original_ra.ra_id,
            agent_notes=f"Swap from RA {original_ra.ra_number}. Reason: {data.reason}",
            created_at=now,
            updated_at=now,
        )
        self._session.add(new_ra)

        # Link original RA to new RA
        original_ra.swapped_to_ra_id = new_ra.ra_id
        original_ra.status = "RETURNED"
        original_ra.updated_at = now

        await self._session.flush()
        return new_ra

    async def get_rental_agreement(
        self, ra_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> RentalAgreement:
        """Public accessor for fetching an RA by ID."""
        return await self._get_rental_agreement(ra_id, tenant_id)

    async def list_overdue_rentals(self, tenant_id: uuid.UUID) -> list[RentalAgreement]:
        """Return ACTIVE/EXTENDED RAs whose reservation return_datetime is in the past."""
        from sqlalchemy import text as sqlt
        result = await self._session.execute(
            sqlt("""
                SELECT ra.*
                FROM rental_agreements ra
                JOIN reservations r ON r.reservation_id = ra.reservation_id
                WHERE ra.tenant_id = :tid
                  AND ra.status IN ('ACTIVE', 'EXTENDED')
                  AND r.return_datetime < NOW() AT TIME ZONE 'UTC'
                ORDER BY r.return_datetime ASC
            """),
            {"tid": str(tenant_id)},
        )
        rows = result.mappings().all()
        # Re-load as ORM objects so callers get full RentalAgreement instances
        ids = [str(row["ra_id"]) for row in rows]
        if not ids:
            return []
        orm_result = await self._session.execute(
            select(RentalAgreement).where(
                and_(
                    RentalAgreement.tenant_id == str(tenant_id),
                    RentalAgreement.ra_id.in_(ids),
                )
            )
        )
        return list(orm_result.scalars().all())

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _get_rental_agreement(
        self, ra_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> RentalAgreement:
        result = await self._session.execute(
            select(RentalAgreement).where(
                and_(
                    RentalAgreement.ra_id == str(ra_id),
                    RentalAgreement.tenant_id == str(tenant_id),
                )
            )
        )
        ra = result.scalar_one_or_none()
        if ra is None:
            raise ResourceNotFoundError("rental_agreement", str(ra_id))
        return ra

    async def _get_reservation(self, reservation_id: uuid.UUID, tenant_id: uuid.UUID):
        """Load a reservation from the reservations table."""
        from sqlalchemy import text
        result = await self._session.execute(
            text(
                "SELECT reservation_id, status, customer_id "
                "FROM reservations "
                "WHERE reservation_id = :rid AND tenant_id = :tid AND deleted_at IS NULL"
            ),
            {"rid": str(reservation_id), "tid": str(tenant_id)},
        )
        row = result.mappings().first()
        if row is None:
            raise ResourceNotFoundError("reservation", str(reservation_id))

        # Return a simple namespace object
        class _Res:
            def __init__(self, r):
                self.reservation_id = str(r["reservation_id"])
                self.status = str(r["status"])
                self.customer_id = str(r["customer_id"])

        return _Res(row)

    async def _check_customer_dnr(
        self, customer_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> None:
        """
        Check if customer has an active DNR flag.
        Raises BusinessRuleError with agent-visible reason if blocked.
        SECURITY: The reason must NOT be relayed to the customer.
        """
        from sqlalchemy import text
        result = await self._session.execute(
            text(
                "SELECT dnr_flag, dnr_scope, dnr_reason "
                "FROM customers "
                "WHERE customer_id = :cid AND tenant_id = :tid AND deleted_at IS NULL"
            ),
            {"cid": str(customer_id), "tid": str(tenant_id)},
        )
        row = result.mappings().first()
        if row and row["dnr_flag"]:
            raise BusinessRuleError(
                f"Customer is flagged as Do Not Rent. "
                f"Scope: {row['dnr_scope']}. "
                f"Reason (visible to agents only): {row['dnr_reason']}"
            )

    async def _resolve_vehicle(
        self, data: CheckoutRequest, tenant_id: uuid.UUID
    ) -> str:
        """Return vehicle_id string; validates AVAILABLE status."""
        if data.vehicle_id is not None:
            vehicle_id = str(data.vehicle_id)
            await self._verify_vehicle_available(vehicle_id, tenant_id)
            return vehicle_id

        if data.walk_up and data.vehicle_class_id is not None:
            # Auto-assign first available vehicle in class
            return await self._auto_assign_vehicle(data.vehicle_class_id, tenant_id)

        raise BusinessRuleError(
            "vehicle_id or vehicle_class_id (for walk-ups) must be provided."
        )

    async def _verify_vehicle_available(
        self, vehicle_id: str, tenant_id: uuid.UUID
    ) -> None:
        """Raise BusinessRuleError if vehicle is not AVAILABLE."""
        from sqlalchemy import text
        result = await self._session.execute(
            text(
                "SELECT status FROM vehicles "
                "WHERE vehicle_id = :vid AND tenant_id = :tid AND deleted_at IS NULL"
            ),
            {"vid": vehicle_id, "tid": str(tenant_id)},
        )
        row = result.mappings().first()
        if row is None:
            raise ResourceNotFoundError("vehicle", vehicle_id)
        if row["status"] != "AVAILABLE":
            raise BusinessRuleError(
                f"Vehicle {vehicle_id} is not available for checkout. "
                f"Current status: {row['status']}"
            )

    async def _auto_assign_vehicle(
        self, vehicle_class_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> str:
        """Auto-assign first AVAILABLE vehicle in the specified class."""
        from sqlalchemy import text
        result = await self._session.execute(
            text(
                "SELECT vehicle_id FROM vehicles "
                "WHERE vehicle_class_id = :class_id AND tenant_id = :tid "
                "AND status = 'AVAILABLE' AND deleted_at IS NULL "
                "ORDER BY created_at ASC LIMIT 1"
            ),
            {"class_id": str(vehicle_class_id), "tid": str(tenant_id)},
        )
        row = result.mappings().first()
        if row is None:
            raise BusinessRuleError(
                f"No available vehicles in class {vehicle_class_id}."
            )
        return str(row["vehicle_id"])

    async def _verify_pre_auth(
        self, reservation_id: str, tenant_id: uuid.UUID
    ) -> None:
        """
        Verify that an AUTHORIZED pre-auth payment exists for this reservation.
        Raises BusinessRuleError if not found.
        """
        from sqlalchemy import text
        result = await self._session.execute(
            text(
                "SELECT payment_id FROM payments "
                "WHERE reservation_id = :rid AND tenant_id = :tid "
                "AND status = 'AUTHORIZED' AND payment_type = 'PREAUTH' "
                "LIMIT 1"
            ),
            {"rid": reservation_id, "tid": str(tenant_id)},
        )
        row = result.mappings().first()
        if row is None:
            raise BusinessRuleError(
                "Pre-auth required before checkout. "
                "No AUTHORIZED pre-authorization found for this reservation."
            )

    async def _transition_vehicle_status(
        self, vehicle_id: str, new_status: str, tenant_id: uuid.UUID
    ) -> None:
        """Update vehicle status in the vehicles table."""
        from sqlalchemy import text
        await self._session.execute(
            text(
                "UPDATE vehicles SET status = :status, updated_at = now() "
                "WHERE vehicle_id = :vid AND tenant_id = :tid"
            ),
            {"status": new_status, "vid": vehicle_id, "tid": str(tenant_id)},
        )

    async def _update_reservation_status(
        self, reservation_id: str, new_status: str, tenant_id: uuid.UUID
    ) -> None:
        """Update reservation status in the reservations table."""
        from sqlalchemy import text
        await self._session.execute(
            text(
                "UPDATE reservations SET status = :status, updated_at = now() "
                "WHERE reservation_id = :rid AND tenant_id = :tid"
            ),
            {"status": new_status, "rid": reservation_id, "tid": str(tenant_id)},
        )

    async def _calculate_time_extension(
        self, ra: RentalAgreement, returned_at: datetime
    ) -> Decimal:
        """
        Calculate time extension charge if returned after reserved dropoff time.

        Requires reservation.return_datetime. If unavailable, returns zero.
        Hourly rate = daily_rate / 24.
        """
        if not ra.reservation_id:
            return Decimal("0.00")

        from sqlalchemy import text
        result = await self._session.execute(
            text(
                "SELECT return_datetime, base_rate_daily "
                "FROM reservations "
                "WHERE reservation_id = :rid"
            ),
            {"rid": ra.reservation_id},
        )
        row = result.mappings().first()
        if row is None or row["return_datetime"] is None:
            return Decimal("0.00")

        scheduled_return = row["return_datetime"]
        if isinstance(scheduled_return, str):
            scheduled_return = datetime.fromisoformat(scheduled_return)

        if scheduled_return.tzinfo is None:
            scheduled_return = scheduled_return.replace(tzinfo=timezone.utc)

        if returned_at <= scheduled_return:
            return Decimal("0.00")

        hours_late = Decimal(
            str((returned_at - scheduled_return).total_seconds() / 3600)
        )
        daily_rate = Decimal(str(row["base_rate_daily"] or "0"))
        hourly_rate = daily_rate / Decimal("24")
        charge = (hourly_rate * hours_late).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        return charge

    def _calculate_fuel_penalty(
        self, fuel_out: int, fuel_in: int
    ) -> Decimal:
        """
        Calculate fuel penalty when vehicle returned with less fuel than dispatched.

        fuel_out and fuel_in are 0-100 percentages.
        Default fuel rate: $5 per 12.5% (each "step" on 0-8 scale).
        """
        if fuel_in >= fuel_out:
            return Decimal("0.00")

        # Each step on 0-8 scale ≈ 12.5% = $5 penalty
        steps_missing = (fuel_out - fuel_in) / 12.5
        charge = (Decimal(str(steps_missing)) * Decimal("5.00")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        return charge

    def _calculate_mileage_overage(
        self, odometer_out: int, odometer_in: int, mileage_plan: dict
    ) -> Decimal:
        """
        Calculate mileage overage if miles driven exceed the plan allowance.

        mileage_plan expected keys: free_miles_per_day (int), overage_rate_per_mile (Decimal),
        rental_days (int).
        """
        miles_driven = odometer_in - odometer_out
        if miles_driven <= 0:
            return Decimal("0.00")

        free_per_day = mileage_plan.get("free_miles_per_day", 250)
        rental_days = mileage_plan.get("rental_days", 1)
        overage_rate = Decimal(str(mileage_plan.get("overage_rate_per_mile", "0.25")))

        total_free_miles = free_per_day * rental_days
        overage_miles = max(0, miles_driven - total_free_miles)

        if overage_miles == 0:
            return Decimal("0.00")

        charge = (Decimal(str(overage_miles)) * overage_rate).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        return charge

    async def _get_open_shift(
        self,
        agent_id: uuid.UUID,
        location_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> Optional[ShiftLog]:
        """Return the most recent OPEN shift for this agent at this location today."""
        from datetime import date
        today_start = datetime.combine(
            datetime.now(timezone.utc).date(), datetime.min.time()
        ).replace(tzinfo=timezone.utc)

        result = await self._session.execute(
            select(ShiftLog).where(
                and_(
                    ShiftLog.tenant_id == str(tenant_id),
                    ShiftLog.agent_id == str(agent_id),
                    ShiftLog.location_id == str(location_id),
                    ShiftLog.shift_type == "OPEN",
                    ShiftLog.created_at >= today_start,
                )
            ).order_by(ShiftLog.created_at.desc()).limit(1)
        )
        return result.scalar_one_or_none()

    async def _count_pending_pickups(
        self, location_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> int:
        """Count today's CONFIRMED reservations for this location."""
        from sqlalchemy import text
        now_utc = datetime.now(timezone.utc)
        day_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start.replace(hour=23, minute=59, second=59)
        result = await self._session.execute(
            text(
                "SELECT COUNT(*) FROM reservations "
                "WHERE pickup_location_id = :loc AND tenant_id = :tid "
                "AND status = 'CONFIRMED' "
                "AND pickup_datetime BETWEEN :day_start AND :day_end "
                "AND deleted_at IS NULL"
            ),
            {"loc": str(location_id), "tid": str(tenant_id), "day_start": day_start, "day_end": day_end},
        )
        row = result.first()
        return int(row[0]) if row else 0
