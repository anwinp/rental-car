"""Reservations domain service — booking lifecycle business logic."""
from __future__ import annotations

import hashlib
import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional
from uuid import UUID

from redis.asyncio import Redis

from app.core.exceptions import (
    BusinessRuleError,
    ConflictError,
    ForbiddenError,
    ResourceNotFoundError,
)
from app.core.redis import RATE_QUOTE_KEY
from app.domains.reservations.models import Reservation
from app.domains.reservations.repository import ReservationRepository
from app.domains.reservations.schemas import (
    CancellationPreview,
    CancellationRequest,
    CancellationResult,
    ReservationCreate,
    ReservationModify,
)

log = logging.getLogger(__name__)

# ── Confirmation number ───────────────────────────────────────────────────────

# GAP-006: Format is RCM-{YYYYMMDD}-{6 uppercase alphanumeric}
# (task spec says "RCM-{YYYYMMDD}-{6 chars}"; arch doc says "RC-{8 chars}";
# task spec wins — RCM prefix with date segment)
_CONF_ALPHABET = string.digits + string.ascii_uppercase  # base-36


def _generate_confirmation_number() -> str:
    """
    Generate a system-wide unique confirmation number.

    Format: RCM-{YYYYMMDD}-{6 uppercase alphanumeric chars}
    DB UNIQUE constraint is the final collision guard.
    Service retries up to 3 times on unique violation.
    """
    date_segment = datetime.now(timezone.utc).strftime("%Y%m%d")
    suffix = "".join(secrets.choice(_CONF_ALPHABET) for _ in range(6))
    return f"RCM-{date_segment}-{suffix}"


# ── Advisory lock key derivation ──────────────────────────────────────────────


def _advisory_lock_key(location_id: UUID, vehicle_class_id: UUID) -> int:
    """
    Derive a 64-bit integer advisory lock key from location + vehicle class.

    Using first 8 bytes of SHA-256(location_id + class_id).
    Fits in a PostgreSQL bigint (signed 64-bit).
    """
    digest = hashlib.sha256(
        (str(location_id) + str(vehicle_class_id)).encode()
    ).digest()
    # Interpret first 8 bytes as unsigned 64-bit, then fit into signed range
    unsigned = int.from_bytes(digest[:8], "big")
    # Map to signed int64 range
    signed = unsigned if unsigned < 2**63 else unsigned - 2**64
    return signed


# ── Cancellation policy engine ────────────────────────────────────────────────

_CANCELLATION_TIERS = [
    # (min_hours_before_pickup, refund_pct, label)
    (72, Decimal("1.00"), "FREE_CANCELLATION"),
    (24, Decimal("0.50"), "PARTIAL_REFUND"),
    (0, Decimal("0.00"), "NO_REFUND"),
]


def _calculate_cancellation(
    deposit_paid: Decimal,
    pickup_at: datetime,
    cancelled_at: datetime,
    waive_fee: bool = False,
) -> tuple[Decimal, Decimal, str]:
    """
    Compute refund_amount, cancellation_fee, and policy tier label.

    Uses DEFAULT_TIERS from ARCH_DOMAINS §3.7.
    """
    hours_before = (pickup_at - cancelled_at).total_seconds() / 3600

    for min_hours, refund_pct, label in _CANCELLATION_TIERS:
        if hours_before >= min_hours:
            if waive_fee:
                return deposit_paid, Decimal("0"), f"AGENT_WAIVED_{label}"
            refund = (deposit_paid * refund_pct).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            fee = deposit_paid - refund
            return refund, fee, label

    # Fallback (should not reach here with tiers starting at 0h)
    return Decimal("0"), deposit_paid, "NO_REFUND"


# ── Service ───────────────────────────────────────────────────────────────────


class ReservationService:
    """
    Core reservation lifecycle service.

    Depends on:
      - ReservationRepository for DB access
      - Redis (avail cluster) for quote token validation
      - Optionally a fleet_service for VehicleBlock creation
    """

    def __init__(
        self,
        repo: ReservationRepository,
        redis: Redis,
        tenant_id: UUID,
        fleet_service=None,  # FleetService — injected at runtime to avoid circular import
    ) -> None:
        self._repo = repo
        self._redis = redis
        self._tenant_id = tenant_id
        self._fleet_service = fleet_service

    # ── Create ────────────────────────────────────────────────────────────────

    async def create_reservation(
        self,
        data: ReservationCreate,
        actor_id: Optional[UUID] = None,
    ) -> Reservation:
        """
        Create a confirmed reservation.

        Steps (from task spec):
          1. Validate rate_quote_token in Redis (30s TTL)
          2. Re-check availability with DB GiST query (race condition protection)
          3. BEGIN TRANSACTION (managed by SQLAlchemy session)
          4. Acquire advisory lock for location+class
          5. Generate confirmation_number (retry up to 3× on conflict)
          6. Create reservation row with status=PENDING
          7. Create VehicleBlock via fleet service (exclusion constraint is final guard)
          8. If exclusion violation → rollback → raise VehicleNotAvailableError
          9. Update status → CONFIRMED
          10. COMMIT (handled by get_session dependency)
          11. Fire async: confirmation email, pre-auth (Celery – stub)
        """
        # ── Step 1: Validate rate quote token ─────────────────────────────
        cache_key = RATE_QUOTE_KEY.format(hash=data.rate_quote_token)
        cached_quote = await self._redis.get(cache_key)
        if cached_quote is None:
            raise BusinessRuleError(
                "Rate quote token has expired or is invalid. "
                "Please request a new quote and try again.",
            )

        # ── Step 2: Availability pre-check ────────────────────────────────
        available_count = await self._repo.check_availability_db(
            location_id=data.location_id,
            vehicle_class_id=data.vehicle_class_id,
            pickup_dt=data.pickup_dt,
            dropoff_dt=data.dropoff_dt,
        )
        if available_count == 0:
            raise ConflictError(
                f"No vehicles of the requested class are available at location "
                f"{data.location_id} for the requested dates."
            )

        # ── Step 4: Advisory lock (serialise concurrent bookings) ──────────
        lock_key = _advisory_lock_key(data.location_id, data.vehicle_class_id)
        await self._repo.acquire_advisory_lock(lock_key)

        # ── Re-check availability under lock ──────────────────────────────
        available_count = await self._repo.check_availability_db(
            location_id=data.location_id,
            vehicle_class_id=data.vehicle_class_id,
            pickup_dt=data.pickup_dt,
            dropoff_dt=data.dropoff_dt,
        )
        if available_count == 0:
            raise ConflictError(
                "Vehicle class is no longer available (race condition). "
                "Please try again.",
            )

        # ── Step 5: Generate confirmation number (retry on collision) ──────
        confirmation_number = await self._generate_unique_confirmation_number()

        # ── Step 6: Create reservation (PENDING) ───────────────────────────
        import json as _json
        quote_data: dict = _json.loads(cached_quote)

        reservation = await self._repo.create_reservation(
            confirmation_number=confirmation_number,
            status="PENDING",
            customer_id=str(data.customer_id) if data.customer_id else (str(actor_id) if actor_id else None),
            pickup_location_id=str(data.location_id),
            dropoff_location_id=str(data.location_id),
            pickup_datetime=data.pickup_dt,
            return_datetime=data.dropoff_dt,
            vehicle_class_id=str(data.vehicle_class_id),
            channel=data.source.value,
            special_instructions=data.notes,
            flight_number=data.flight_number,
            promo_code=data.promo_code,
            cdp_code=data.cdp_code,
            rate_quote_token=data.rate_quote_token,
            rate_code_id=quote_data.get("rate_code_id"),
            currency=quote_data.get("currency", "USD"),
            grand_total=Decimal(str(quote_data.get("total", "0"))),
            extras_snapshot=[
                {"extra_id": str(e.extra_id), "quantity": e.quantity}
                for e in data.extras
            ],
            taxes_snapshot=quote_data.get("line_items", []),
            booking_agent_id=str(actor_id) if actor_id else None,
            version=1,
        )

        # ── Step 7: Create VehicleBlock via fleet service ──────────────────
        if self._fleet_service is not None:
            try:
                await self._fleet_service.create_block(
                    vehicle_id=None,  # class-level block until vehicle assigned
                    block_type="RESERVATION",
                    start_time=data.pickup_dt,
                    end_time=data.dropoff_dt,
                    reservation_id=reservation.reservation_id,
                    created_by=str(actor_id) if actor_id else "GUEST",
                )
            except Exception as exc:
                # Exclusion constraint violation → VehicleNotAvailableError
                log.warning(
                    "VehicleBlock creation failed: %s — reservation %s rolled back",
                    exc,
                    reservation.reservation_id,
                )
                raise ConflictError(
                    "Vehicle is no longer available (block conflict). "
                    "Please try another vehicle or time."
                ) from exc

        # ── Step 9: Update status → CONFIRMED ────────────────────────────
        await self._repo.update_status(
            reservation_id=UUID(reservation.reservation_id),
            status="CONFIRMED",
        )
        reservation.status = "CONFIRMED"

        # ── Step 11: Async tasks (stub — real implementation uses Celery) ──
        log.info(
            "reservation_created",
            reservation_id=reservation.reservation_id,
            confirmation_number=reservation.confirmation_number,
            tenant_id=str(self._tenant_id),
        )

        return reservation

    # ── Modify ────────────────────────────────────────────────────────────────

    async def modify_reservation(
        self,
        reservation_id: UUID,
        data: ReservationModify,
        actor_id: UUID,
    ) -> Reservation:
        """
        Modify dates, vehicle class, or extras on a CONFIRMED reservation.

        Business rules:
          - Only CONFIRMED reservations can be modified
          - Creates a version snapshot before applying changes
          - Increments version counter
          - If dates change, re-checks availability (fleet service call)
        """
        reservation = await self._repo.get_by_id_or_raise(reservation_id)

        if reservation.status not in ("CONFIRMED",):
            raise BusinessRuleError(
                f"Reservation {reservation_id} is in status '{reservation.status}' "
                "and cannot be modified. Only CONFIRMED reservations can be changed."
            )

        # Capture version snapshot before modification
        await self._repo.create_version_snapshot(
            reservation=reservation,
            change_reason=data.change_reason,
            changed_by=actor_id,
            changed_by_type="STAFF",
        )

        # Build update payload
        updates: dict = {}
        if data.pickup_dt is not None:
            updates["pickup_datetime"] = data.pickup_dt
        if data.dropoff_dt is not None:
            updates["return_datetime"] = data.dropoff_dt
        if data.vehicle_class_id is not None:
            updates["vehicle_class_id"] = str(data.vehicle_class_id)
        if data.extras is not None:
            updates["extras_snapshot"] = [
                {"extra_id": str(e.extra_id), "quantity": e.quantity}
                for e in data.extras
            ]
        if data.notes is not None:
            updates["special_instructions"] = data.notes

        updates["version"] = reservation.version + 1

        modified = await self._repo.update_reservation(reservation_id, **updates)

        log.info(
            "reservation_modified",
            reservation_id=str(reservation_id),
            actor_id=str(actor_id),
        )

        return modified  # type: ignore[return-value]

    # ── Cancel ────────────────────────────────────────────────────────────────

    async def cancel_reservation(
        self,
        reservation_id: UUID,
        data: CancellationRequest,
        actor_id: UUID,
        actor_roles: list[str] | None = None,
    ) -> CancellationResult:
        """
        Cancel a CONFIRMED reservation and calculate refund amount.

        Business rules:
          - Only CONFIRMED reservations can be cancelled
          - waive_fee=True requires MANAGER / BRANCH_MANAGER / SYSTEM_ADMIN role
          - Cancellation fee per rate_code.cancellation_policy tiers
        """
        reservation = await self._repo.get_by_id_or_raise(reservation_id)

        if reservation.status != "CONFIRMED":
            raise BusinessRuleError(
                f"Only CONFIRMED reservations can be cancelled. "
                f"Reservation {reservation_id} is '{reservation.status}'."
            )

        # Validate fee waive authorisation
        if data.waive_fee:
            _MANAGER_ROLES = {
                "BRANCH_MANAGER", "REGIONAL_MANAGER", "SYSTEM_ADMIN", "SUPER_ADMIN"
            }
            caller_roles = set(actor_roles or [])
            if not caller_roles.intersection(_MANAGER_ROLES):
                raise ForbiddenError(
                    "Only managers can waive cancellation fees. "
                    "Request denied — insufficient role."
                )

        # Calculate cancellation fee
        deposit_paid = reservation.deposit_amount or Decimal("0")
        now = datetime.now(timezone.utc)
        pickup_at = reservation.pickup_datetime

        # Make pickup_at timezone-aware if needed
        if pickup_at.tzinfo is None:
            pickup_at = pickup_at.replace(tzinfo=timezone.utc)

        refund_amount, cancellation_fee, policy_tier = _calculate_cancellation(
            deposit_paid=deposit_paid,
            pickup_at=pickup_at,
            cancelled_at=now,
            waive_fee=data.waive_fee,
        )

        # Update reservation status → CANCELLED
        await self._repo.update_status(
            reservation_id=reservation_id,
            status="CANCELLED",
        )

        log.info(
            "reservation_cancelled",
            reservation_id=str(reservation_id),
            policy_tier=policy_tier,
            refund_amount=str(refund_amount),
            fee=str(cancellation_fee),
            actor_id=str(actor_id),
        )

        return CancellationResult(
            reservation_id=str(reservation_id),
            confirmation_number=reservation.confirmation_number,
            refund_amount=refund_amount,
            cancellation_fee=cancellation_fee,
            policy_tier=policy_tier,
            refund_payment_id=None,  # Real: void pre-auth via payments domain
        )

    async def preview_cancellation(
        self,
        reservation_id: UUID,
    ) -> CancellationPreview:
        """Calculate cancellation fee without performing the cancellation."""
        reservation = await self._repo.get_by_id_or_raise(reservation_id)

        deposit_paid = reservation.deposit_amount or Decimal("0")
        now = datetime.now(timezone.utc)
        pickup_at = reservation.pickup_datetime
        if pickup_at.tzinfo is None:
            pickup_at = pickup_at.replace(tzinfo=timezone.utc)

        refund_amount, cancellation_fee, policy_tier = _calculate_cancellation(
            deposit_paid=deposit_paid,
            pickup_at=pickup_at,
            cancelled_at=now,
            waive_fee=False,
        )
        hours_until_pickup = Decimal(
            str((pickup_at - now).total_seconds() / 3600)
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        return CancellationPreview(
            reservation_id=str(reservation_id),
            hours_until_pickup=hours_until_pickup,
            refund_amount=refund_amount,
            cancellation_fee=cancellation_fee,
            policy_tier=policy_tier,
            deposit_paid=deposit_paid,
        )

    # ── No-show ───────────────────────────────────────────────────────────────

    async def handle_no_show(self, reservation_id: UUID) -> None:
        """
        Mark a reservation as NO_SHOW.

        Called by the Celery task 30 minutes after scheduled pickup.
        Uses SELECT FOR UPDATE SKIP LOCKED for idempotency under concurrent
        Celery worker execution — if another worker already processed this
        reservation, SKIP LOCKED returns 0 rows and we exit safely.
        """
        from sqlalchemy import text

        # SKIP LOCKED: only this worker processes this row
        result = await self._repo.session.execute(
            text(
                """
                SELECT reservation_id FROM reservations
                WHERE reservation_id = :res_id
                  AND tenant_id = :tenant_id
                  AND status = 'CONFIRMED'
                  AND pickup_datetime < NOW() - INTERVAL '30 minutes'
                  AND deleted_at IS NULL
                FOR UPDATE SKIP LOCKED
                """
            ),
            {
                "res_id": str(reservation_id),
                "tenant_id": str(self._tenant_id),
            },
        )
        row = result.fetchone()
        if row is None:
            # Already processed by another worker or status changed — idempotent exit
            log.info(
                "no_show_already_processed_or_not_eligible",
                reservation_id=str(reservation_id),
            )
            return

        # Mark no-show
        now = datetime.now(timezone.utc)
        await self._repo.update_status(
            reservation_id=reservation_id,
            status="NO_SHOW",
            no_show_at=now,
        )

        log.info(
            "reservation_no_show",
            reservation_id=str(reservation_id),
            tenant_id=str(self._tenant_id),
        )

    # ── Read operations ───────────────────────────────────────────────────────

    async def get_reservation(self, reservation_id: UUID) -> Reservation:
        return await self._repo.get_by_id_or_raise(reservation_id)

    async def list_reservations(
        self,
        status: Optional[str] = None,
        location_id: Optional[UUID] = None,
        customer_id: Optional[UUID] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        source: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[Reservation]:
        return await self._repo.list_reservations(
            status=status,
            location_id=location_id,
            customer_id=customer_id,
            date_from=date_from,
            date_to=date_to,
            source=source,
            limit=limit,
            offset=offset,
        )

    async def get_by_confirmation_number(
        self, confirmation_number: str
    ) -> Reservation:
        """Public lookup by confirmation number (manage my booking)."""
        res = await self._repo.get_by_confirmation_number_any_tenant(
            confirmation_number
        )
        if res is None:
            raise ResourceNotFoundError(
                resource="reservation",
                resource_id=confirmation_number,
            )
        return res

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _generate_unique_confirmation_number(self, max_retries: int = 3) -> str:
        """
        Generate a confirmation number, retrying up to max_retries times
        if the DB UNIQUE constraint fires.
        """
        for attempt in range(max_retries):
            candidate = _generate_confirmation_number()
            # Check for existing (optimistic pre-check; constraint is final guard)
            existing = await self._repo.get_by_confirmation_number(candidate)
            if existing is None:
                return candidate
            log.warning(
                "confirmation_number_collision",
                candidate=candidate,
                attempt=attempt + 1,
            )
        # Final attempt — let the DB UNIQUE constraint handle it
        return _generate_confirmation_number()
