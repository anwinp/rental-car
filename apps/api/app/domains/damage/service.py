"""Damage & Inspections service — inspection forms, claim lifecycle, LOU."""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy import select, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BusinessRuleError, ResourceNotFoundError
from app.domains.damage.models import DamageClaim
from app.domains.damage.schemas import (
    CDW_VOID_CONDITIONS,
    CLAIM_TRANSITIONS,
    VEHICLE_ZONES,
    ClaimStatus,
    DamageClaimCreate,
    InspectionForm,
    InspectionResponse,
    InspectionType,
    LOUCalculation,
    PrePostComparison,
    ZoneCondition,
    ZoneDiff,
)


# ── Claim reference generation ────────────────────────────────────────────────

def _generate_claim_reference() -> str:
    """CLM-YYYYMMDD-XXXXX — unique per tenant (enforced by DB constraint)."""
    date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
    suffix = "".join(secrets.choice(string.ascii_uppercase) for _ in range(5))
    return f"CLM-{date_part}-{suffix}"


# ── Zone severity ordering ────────────────────────────────────────────────────

_CONDITION_SEVERITY: dict[ZoneCondition, int] = {
    ZoneCondition.GOOD: 0,
    ZoneCondition.SCRATCHED: 1,
    ZoneCondition.DENTED: 2,
    ZoneCondition.CRACKED: 3,
    ZoneCondition.BROKEN: 4,
    ZoneCondition.MISSING: 4,
}


def _is_worse(post: ZoneCondition, pre: ZoneCondition) -> bool:
    """Return True if post condition is worse (higher severity) than pre condition."""
    return _CONDITION_SEVERITY.get(post, 0) > _CONDITION_SEVERITY.get(pre, 0)


# ── Service ───────────────────────────────────────────────────────────────────

class DamageService:
    """
    Damage & Inspections business logic.

    Photo storage: S3 presigned URLs (raw bytes never flow through the API).
    All monetary values use Python Decimal.
    """

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID) -> None:
        self._session = session
        self._tenant_id = tenant_id

    # ── Inspections ───────────────────────────────────────────────────────────

    async def record_inspection(
        self, data: InspectionForm, tenant_id: uuid.UUID
    ) -> InspectionResponse:
        """
        Record a PRE or POST rental inspection.

        PRE: stored as pre_inspection_snapshot in the RA.
        POST: stored as post_inspection_snapshot; triggers zone comparison;
              new damages → auto-create DamageClaim; vehicle → DAMAGE_HOLD.

        Photos are stored as S3 keys, not raw bytes.
        Returns: {inspection_id, new_damages_found, claims_created}
        """
        # Build zone snapshot dict: {zone_name: condition}
        snapshot: dict[str, str] = {}
        for zone in data.zone_data:
            snapshot[zone.zone_name] = zone.condition.value

        # Store snapshot on RA
        ra_field = (
            "pre_inspection_snapshot"
            if data.inspection_type == InspectionType.PRE
            else "post_inspection_snapshot"
        )
        inspection_id = str(uuid.uuid4())

        await self._session.execute(
            text(
                f"UPDATE rental_agreements "
                f"SET {ra_field} = :snapshot::jsonb, updated_at = now() "
                f"WHERE ra_id = :ra_id AND tenant_id = :tid"
            ),
            {
                "snapshot": __import__("json").dumps(snapshot),
                "ra_id": str(data.rental_agreement_id),
                "tid": str(tenant_id),
            },
        )

        claims_created: list[str] = []
        new_damages_found = 0

        if data.inspection_type == InspectionType.POST:
            # Fetch pre-inspection snapshot for comparison
            result = await self._session.execute(
                text(
                    "SELECT pre_inspection_snapshot, post_inspection_snapshot "
                    "FROM rental_agreements "
                    "WHERE ra_id = :ra_id AND tenant_id = :tid"
                ),
                {"ra_id": str(data.rental_agreement_id), "tid": str(tenant_id)},
            )
            row = result.mappings().first()
            if row and row.get("pre_inspection_snapshot"):
                import json
                pre_data = row["pre_inspection_snapshot"]
                if isinstance(pre_data, str):
                    pre_data = json.loads(pre_data)

                new_damage_zones = self.compare_inspections(pre_data, snapshot)
                new_damages_found = len(new_damage_zones)

                if new_damage_zones:
                    # Auto-create damage claim
                    # Fetch customer and vehicle from RA
                    ra_result = await self._session.execute(
                        text(
                            "SELECT customer_id, vehicle_id FROM rental_agreements "
                            "WHERE ra_id = :ra_id AND tenant_id = :tid"
                        ),
                        {"ra_id": str(data.rental_agreement_id), "tid": str(tenant_id)},
                    )
                    ra_row = ra_result.mappings().first()
                    if ra_row:
                        claim = await self._auto_create_claim(
                            rental_agreement_id=data.rental_agreement_id,
                            vehicle_id=uuid.UUID(ra_row["vehicle_id"]),
                            customer_id=uuid.UUID(ra_row["customer_id"]),
                            new_damage_zones=new_damage_zones,
                            pre_snapshot=pre_data,
                            post_snapshot=snapshot,
                            inspector_id=data.agent_id,
                            photos=data.photos,
                            tenant_id=tenant_id,
                        )
                        claims_created.append(claim.claim_id)

                        # Transition vehicle to DAMAGE_HOLD
                        await self._session.execute(
                            text(
                                "UPDATE vehicles SET status = 'DAMAGE_HOLD', updated_at = now() "
                                "WHERE vehicle_id = :vid AND tenant_id = :tid"
                            ),
                            {"vid": ra_row["vehicle_id"], "tid": str(tenant_id)},
                        )

        await self._session.flush()

        return InspectionResponse(
            inspection_id=inspection_id,
            rental_agreement_id=str(data.rental_agreement_id),
            inspection_type=data.inspection_type.value,
            new_damages_found=new_damages_found,
            claims_created=claims_created,
        )

    def compare_inspections(
        self, pre_data: dict, post_data: dict
    ) -> list[dict]:
        """
        Compare PRE and POST inspection zone snapshots.

        Returns a list of dicts for zones where post condition is worse than pre.
        Zones that were GOOD in pre and have any damage in post → new damage.
        """
        new_damages: list[dict] = []

        for zone_name in VEHICLE_ZONES:
            pre_condition_str = pre_data.get(zone_name, ZoneCondition.GOOD.value)
            post_condition_str = post_data.get(zone_name, ZoneCondition.GOOD.value)

            try:
                pre_cond = ZoneCondition(pre_condition_str)
                post_cond = ZoneCondition(post_condition_str)
            except ValueError:
                continue

            if _is_worse(post_cond, pre_cond):
                new_damages.append(
                    {
                        "zone_name": zone_name,
                        "pre_condition": pre_condition_str,
                        "post_condition": post_condition_str,
                        "is_new_damage": True,
                    }
                )

        return new_damages

    async def get_inspection_data(
        self, ra_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> dict:
        """Retrieve pre and post inspection snapshots for a rental agreement."""
        result = await self._session.execute(
            text(
                "SELECT ra_id, pre_inspection_snapshot, post_inspection_snapshot "
                "FROM rental_agreements "
                "WHERE ra_id = :ra_id AND tenant_id = :tid"
            ),
            {"ra_id": str(ra_id), "tid": str(tenant_id)},
        )
        row = result.mappings().first()
        if row is None:
            raise ResourceNotFoundError("rental_agreement", str(ra_id))
        return dict(row)

    async def get_pre_post_comparison(
        self, ra_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> PrePostComparison:
        """Return a structured pre/post comparison for display."""
        import json

        data = await self.get_inspection_data(ra_id, tenant_id)
        pre_snapshot = data.get("pre_inspection_snapshot") or {}
        post_snapshot = data.get("post_inspection_snapshot") or {}

        if isinstance(pre_snapshot, str):
            pre_snapshot = json.loads(pre_snapshot)
        if isinstance(post_snapshot, str):
            post_snapshot = json.loads(post_snapshot)

        new_damage_dicts = self.compare_inspections(pre_snapshot, post_snapshot)
        new_damages = [
            ZoneDiff(
                zone_name=d["zone_name"],
                pre_condition=ZoneCondition(d["pre_condition"]),
                post_condition=ZoneCondition(d["post_condition"]),
                is_new_damage=d["is_new_damage"],
            )
            for d in new_damage_dicts
        ]

        return PrePostComparison(
            rental_agreement_id=str(ra_id),
            pre_zones=pre_snapshot,
            post_zones=post_snapshot,
            new_damages=new_damages,
            total_new_damage_zones=len(new_damages),
        )

    # ── Damage claims ─────────────────────────────────────────────────────────

    async def create_claim(
        self,
        data: DamageClaimCreate,
        tenant_id: uuid.UUID,
        inspector_id: uuid.UUID,
    ) -> DamageClaim:
        """
        Create a damage claim.

        1. Generate CLM-YYYYMMDD-XXXXX reference
        2. Determine CDW coverage from RA extras_snapshot
        3. Check CDW void conditions
        4. Create DamageClaim with status=OPEN
        5. Create DAMAGE_HOLD vehicle block
        6. Return claim
        """
        # Fetch RA details
        result = await self._session.execute(
            text(
                "SELECT customer_id, vehicle_id, extras_snapshot "
                "FROM rental_agreements "
                "WHERE ra_id = :ra_id AND tenant_id = :tid"
            ),
            {"ra_id": str(data.rental_agreement_id), "tid": str(tenant_id)},
        )
        ra_row = result.mappings().first()
        if ra_row is None:
            raise ResourceNotFoundError("rental_agreement", str(data.rental_agreement_id))

        # Determine CDW coverage
        import json
        extras = ra_row.get("extras_snapshot") or []
        if isinstance(extras, str):
            extras = json.loads(extras)

        cdw_in_extras = any(
            (isinstance(e, dict) and e.get("code") == "CDW")
            or (isinstance(e, str) and "CDW" in e)
            for e in extras
        )

        # Check CDW void conditions
        cdw_void_reason: Optional[str] = None
        notes_lower = (data.notes or "").lower()
        for condition in CDW_VOID_CONDITIONS:
            if condition.lower() in notes_lower or condition.lower() in " ".join(
                str(z) for z in data.zone_data_diff
            ).lower():
                cdw_void_reason = condition
                break

        cdw_covered = cdw_in_extras and cdw_void_reason is None

        # Build primary zone description from first diff
        primary_zone = data.zone_data_diff[0].zone_name if data.zone_data_diff else "UNKNOWN"
        primary_type = (
            data.zone_data_diff[0].post_condition.value if data.zone_data_diff else "DAMAGE"
        )

        claim_reference = _generate_claim_reference()
        now = datetime.now(timezone.utc)

        claim = DamageClaim(
            claim_id=str(uuid.uuid4()),
            tenant_id=str(tenant_id),
            claim_reference=claim_reference,
            rental_agreement_id=str(data.rental_agreement_id),
            vehicle_id=str(ra_row["vehicle_id"]),
            customer_id=str(ra_row["customer_id"]),
            discovered_at=now,
            discovered_by=str(inspector_id),
            discovery_type="RETURN_INSPECTION",
            damage_zone=primary_zone,
            damage_type=primary_type,
            severity=f"GRADE_{data.severity}_MINOR",
            damage_description=data.notes,
            photos=data.photos,
            zone_data=[d.model_dump() for d in data.zone_data_diff],
            cdw_on_agreement=cdw_in_extras,
            cdw_voided=cdw_void_reason is not None,
            cdw_void_reason=cdw_void_reason,
            claim_type="CDW_WAIVER" if cdw_covered else "CUSTOMER_CHARGE",
            notes=data.notes,
            inspector_id=str(inspector_id),
            status="OPEN",
            created_at=now,
            updated_at=now,
        )
        self._session.add(claim)

        # Create DAMAGE_HOLD on vehicle
        await self._session.execute(
            text(
                "UPDATE vehicles SET status = 'DAMAGE_HOLD', updated_at = now() "
                "WHERE vehicle_id = :vid AND tenant_id = :tid"
            ),
            {"vid": str(ra_row["vehicle_id"]), "tid": str(tenant_id)},
        )

        await self._session.flush()
        return claim

    async def get_claim(
        self, claim_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> DamageClaim:
        """Fetch a damage claim by ID."""
        result = await self._session.execute(
            select(DamageClaim).where(
                and_(
                    DamageClaim.claim_id == str(claim_id),
                    DamageClaim.tenant_id == str(tenant_id),
                )
            )
        )
        claim = result.scalar_one_or_none()
        if claim is None:
            raise ResourceNotFoundError("damage_claim", str(claim_id))
        return claim

    async def list_claims(
        self,
        tenant_id: uuid.UUID,
        status: Optional[str] = None,
        vehicle_id: Optional[uuid.UUID] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[DamageClaim]:
        """List damage claims with optional filters."""
        conditions = [
            DamageClaim.tenant_id == str(tenant_id),
        ]
        if status:
            conditions.append(DamageClaim.status == status)
        if vehicle_id:
            conditions.append(DamageClaim.vehicle_id == str(vehicle_id))
        if date_from:
            conditions.append(DamageClaim.created_at >= date_from)
        if date_to:
            conditions.append(DamageClaim.created_at <= date_to)

        result = await self._session.execute(
            select(DamageClaim)
            .where(and_(*conditions))
            .order_by(DamageClaim.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())

    async def transition_claim_status(
        self,
        claim_id: uuid.UUID,
        new_status: ClaimStatus,
        actor_id: uuid.UUID,
        reason: str,
        tenant_id: uuid.UUID,
    ) -> DamageClaim:
        """
        Transition a damage claim to a new status.

        Valid transitions (per CLAIM_TRANSITIONS matrix):
          OPEN → ESTIMATE_SENT, WRITTEN_OFF
          ESTIMATE_SENT → CUSTOMER_ACKNOWLEDGED, DISPUTED
          CUSTOMER_ACKNOWLEDGED → REPAIR_IN_PROGRESS
          REPAIR_IN_PROGRESS → REPAIR_COMPLETE
          REPAIR_COMPLETE → INVOICED
          INVOICED → PAID, DISPUTED
          DISPUTED → IN_LITIGATION, REPAIR_IN_PROGRESS
          IN_LITIGATION → PAID, WRITTEN_OFF

        Any other transition → BusinessRuleError.
        """
        claim = await self.get_claim(claim_id, tenant_id)
        current_status = ClaimStatus(claim.status)

        allowed = CLAIM_TRANSITIONS.get(current_status, [])
        if new_status not in allowed:
            raise BusinessRuleError(
                f"Invalid status transition: {current_status.value} → {new_status.value}. "
                f"Allowed transitions from {current_status.value}: "
                f"{[s.value for s in allowed]}"
            )

        now = datetime.now(timezone.utc)
        claim.status = new_status.value
        claim.notes = f"{claim.notes or ''}\n[{now.isoformat()}] {reason}".strip()
        claim.updated_at = now

        await self._session.flush()
        return claim

    async def calculate_lou(
        self, claim_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> LOUCalculation:
        """
        Calculate Loss of Use (LOU) for a damage claim.

        lou_days = vehicle_available_date - damage_hold_start_date (in days)
        utilization_factor = fleet utilization for that period
        if utilization >= 0.80: factor = 1.0
        else: factor = utilization / 0.80
        lou_amount = daily_rate × lou_days × factor
        """
        claim = await self.get_claim(claim_id, tenant_id)

        # Estimate lou_days from claim age if repair dates not set
        if claim.repair_end_date and claim.repair_start_date:
            lou_days = (claim.repair_end_date - claim.repair_start_date).days
        else:
            # Default: days since claim was created until now
            lou_days = (datetime.now(timezone.utc) - claim.created_at).days
            lou_days = max(lou_days, 1)

        # Fetch vehicle daily rate from rate schedule
        daily_rate = await self._get_vehicle_daily_rate(claim.vehicle_id, tenant_id)

        # Fleet utilization (simplified: fetch from analytics or use 0.75 default)
        utilization_factor = await self._get_fleet_utilization(tenant_id)

        if utilization_factor >= Decimal("0.80"):
            factor = Decimal("1.0")
        else:
            factor = utilization_factor / Decimal("0.80")

        lou_amount = (daily_rate * Decimal(str(lou_days)) * factor).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

        # Update claim with LOU data
        claim.loss_of_use_days = lou_days
        claim.loss_of_use_rate = daily_rate
        claim.loss_of_use_total = lou_amount
        claim.updated_at = datetime.now(timezone.utc)
        await self._session.flush()

        return LOUCalculation(
            claim_id=claim.claim_id,
            lou_days=lou_days,
            daily_rate=daily_rate,
            utilization_factor=factor,
            lou_amount=lou_amount,
        )

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _auto_create_claim(
        self,
        rental_agreement_id: uuid.UUID,
        vehicle_id: uuid.UUID,
        customer_id: uuid.UUID,
        new_damage_zones: list[dict],
        pre_snapshot: dict,
        post_snapshot: dict,
        inspector_id: uuid.UUID,
        photos: list[str],
        tenant_id: uuid.UUID,
    ) -> DamageClaim:
        """Create a damage claim automatically from zone comparison results."""
        primary_zone = new_damage_zones[0]["zone_name"] if new_damage_zones else "UNKNOWN"
        primary_type = new_damage_zones[0]["post_condition"] if new_damage_zones else "DAMAGE"

        claim_reference = _generate_claim_reference()
        now = datetime.now(timezone.utc)

        # Determine CDW from RA extras
        cdw_in_extras = await self._check_cdw_in_extras(rental_agreement_id, tenant_id)

        claim = DamageClaim(
            claim_id=str(uuid.uuid4()),
            tenant_id=str(tenant_id),
            claim_reference=claim_reference,
            rental_agreement_id=str(rental_agreement_id),
            vehicle_id=str(vehicle_id),
            customer_id=str(customer_id),
            discovered_at=now,
            discovered_by=str(inspector_id),
            discovery_type="RETURN_INSPECTION",
            damage_zone=primary_zone,
            damage_type=primary_type,
            severity="GRADE_2_MINOR",
            photos=photos,
            zone_data=new_damage_zones,
            pre_inspection_snapshot=pre_snapshot,
            post_inspection_snapshot=post_snapshot,
            cdw_on_agreement=cdw_in_extras,
            cdw_voided=False,
            claim_type="CDW_WAIVER" if cdw_in_extras else "CUSTOMER_CHARGE",
            inspector_id=str(inspector_id),
            status="OPEN",
            created_at=now,
            updated_at=now,
        )
        self._session.add(claim)
        return claim

    async def _check_cdw_in_extras(
        self, rental_agreement_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> bool:
        """Check if CDW extra is present in the RA extras_snapshot."""
        import json
        result = await self._session.execute(
            text(
                "SELECT extras_snapshot FROM rental_agreements "
                "WHERE ra_id = :ra_id AND tenant_id = :tid"
            ),
            {"ra_id": str(rental_agreement_id), "tid": str(tenant_id)},
        )
        row = result.mappings().first()
        if not row:
            return False
        extras = row.get("extras_snapshot") or []
        if isinstance(extras, str):
            extras = json.loads(extras)
        return any(
            (isinstance(e, dict) and e.get("code") == "CDW")
            or (isinstance(e, str) and "CDW" in e)
            for e in extras
        )

    async def _get_vehicle_daily_rate(
        self, vehicle_id: str, tenant_id: uuid.UUID
    ) -> Decimal:
        """Fetch the daily rental rate for a vehicle. Default $50/day if unavailable."""
        try:
            result = await self._session.execute(
                text(
                    "SELECT rsi.price_per_day "
                    "FROM vehicles v "
                    "JOIN rate_schedule_items rsi ON rsi.vehicle_class_id = v.vehicle_class_id "
                    "WHERE v.vehicle_id = :vid AND v.tenant_id = :tid "
                    "LIMIT 1"
                ),
                {"vid": vehicle_id, "tid": str(tenant_id)},
            )
            row = result.first()
            if row and row[0]:
                return Decimal(str(row[0]))
        except Exception:
            pass
        return Decimal("50.00")

    async def _get_fleet_utilization(self, tenant_id: uuid.UUID) -> Decimal:
        """
        Compute fleet utilization as (ON_RENT vehicles) / (total active vehicles).
        Defaults to 0.75 if calculation fails.
        """
        try:
            result = await self._session.execute(
                text(
                    "SELECT "
                    "  COUNT(*) FILTER (WHERE status = 'ON_RENT') AS on_rent, "
                    "  COUNT(*) AS total "
                    "FROM vehicles "
                    "WHERE tenant_id = :tid AND deleted_at IS NULL "
                    "AND status NOT IN ('DISPOSED', 'PENDING_DISPOSAL')"
                ),
                {"tid": str(tenant_id)},
            )
            row = result.first()
            if row and row[1] and row[1] > 0:
                return (Decimal(str(row[0])) / Decimal(str(row[1]))).quantize(
                    Decimal("0.0001"), rounding=ROUND_HALF_UP
                )
        except Exception:
            pass
        return Decimal("0.75")
