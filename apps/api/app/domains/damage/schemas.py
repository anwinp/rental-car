"""Damage & Inspections Pydantic v2 schemas."""
from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── 22 canonical vehicle zones ────────────────────────────────────────────────

VEHICLE_ZONES: list[str] = [
    "FRONT_LEFT", "FRONT_CENTER", "FRONT_RIGHT",
    "ROOF_FRONT", "ROOF_CENTER", "ROOF_REAR",
    "REAR_LEFT", "REAR_CENTER", "REAR_RIGHT",
    "DOOR_FRONT_LEFT", "DOOR_FRONT_RIGHT",
    "DOOR_REAR_LEFT", "DOOR_REAR_RIGHT",
    "MIRROR_LEFT", "MIRROR_RIGHT",
    "WINDSHIELD_FRONT", "WINDSHIELD_REAR",
    "UNDERBODY_FRONT", "UNDERBODY_REAR",
    "INTERIOR_FRONT", "INTERIOR_REAR",
    "TRUNK",
]  # 22 zones exactly


# ── Enumerations ──────────────────────────────────────────────────────────────

class ZoneCondition(str, Enum):
    GOOD = "GOOD"
    SCRATCHED = "SCRATCHED"
    DENTED = "DENTED"
    CRACKED = "CRACKED"
    MISSING = "MISSING"
    BROKEN = "BROKEN"


class InspectionType(str, Enum):
    PRE = "PRE"
    POST = "POST"


class ClaimStatus(str, Enum):
    """Damage claim lifecycle states per DB enum claim_status."""
    OPEN = "OPEN"
    ESTIMATE_SENT = "ESTIMATE_SENT"
    CUSTOMER_ACKNOWLEDGED = "CUSTOMER_ACKNOWLEDGED"
    REPAIR_IN_PROGRESS = "REPAIR_IN_PROGRESS"
    REPAIR_COMPLETE = "REPAIR_COMPLETE"
    INVOICED = "INVOICED"
    PAID = "PAID"
    DISPUTED = "DISPUTED"
    IN_LITIGATION = "IN_LITIGATION"
    WRITTEN_OFF = "WRITTEN_OFF"


# Valid state transitions for damage claims
CLAIM_TRANSITIONS: dict[ClaimStatus, list[ClaimStatus]] = {
    ClaimStatus.OPEN: [ClaimStatus.ESTIMATE_SENT, ClaimStatus.WRITTEN_OFF],
    ClaimStatus.ESTIMATE_SENT: [ClaimStatus.CUSTOMER_ACKNOWLEDGED, ClaimStatus.DISPUTED],
    ClaimStatus.CUSTOMER_ACKNOWLEDGED: [ClaimStatus.REPAIR_IN_PROGRESS],
    ClaimStatus.REPAIR_IN_PROGRESS: [ClaimStatus.REPAIR_COMPLETE],
    ClaimStatus.REPAIR_COMPLETE: [ClaimStatus.INVOICED],
    ClaimStatus.INVOICED: [ClaimStatus.PAID, ClaimStatus.DISPUTED],
    ClaimStatus.DISPUTED: [ClaimStatus.IN_LITIGATION, ClaimStatus.REPAIR_IN_PROGRESS],
    ClaimStatus.IN_LITIGATION: [ClaimStatus.PAID, ClaimStatus.WRITTEN_OFF],
    ClaimStatus.PAID: [],
    ClaimStatus.WRITTEN_OFF: [],
}

# CDW void conditions (per EXT-002 spec)
CDW_VOID_CONDITIONS = ["DUI", "UNAUTHORIZED_DRIVER", "OFF_ROAD", "WRONG_FUEL"]


# ── Zone-level inspection ─────────────────────────────────────────────────────

class ZoneInspection(BaseModel):
    """Per-zone inspection record within an inspection form."""
    zone_id: int = Field(ge=1, le=22, description="Zone number 1-22")
    zone_name: str = Field(description="Zone name from VEHICLE_ZONES list")
    condition: ZoneCondition = ZoneCondition.GOOD
    damage_type: Optional[str] = None
    severity: Optional[int] = Field(default=None, ge=1, le=5)
    photo_keys: list[str] = Field(default_factory=list, description="S3 object keys")


# ── Inspection forms ──────────────────────────────────────────────────────────

class InspectionForm(BaseModel):
    """PRE or POST rental inspection form."""
    rental_agreement_id: UUID
    inspection_type: InspectionType
    zone_data: list[ZoneInspection] = Field(
        description="One entry per damaged zone (GOOD zones may be omitted)"
    )
    odometer: int = Field(ge=0)
    fuel_level: int = Field(ge=0, le=8)
    agent_id: UUID
    # Customer signature stored as S3 reference or upload token (never raw bytes)
    customer_signature: Optional[str] = Field(
        default=None,
        description="S3 key or upload token for signed PDF/image"
    )
    # S3 keys for inspection photos — raw bytes never sent through API
    photos: list[str] = Field(default_factory=list, description="S3 object keys")


class InspectionResponse(BaseModel):
    """Response from recording an inspection."""
    inspection_id: str
    rental_agreement_id: str
    inspection_type: str
    new_damages_found: int = 0
    claims_created: list[str] = Field(default_factory=list, description="Claim IDs created")


# ── Pre/post comparison ───────────────────────────────────────────────────────

class ZoneDiff(BaseModel):
    """A single zone where damage changed between PRE and POST inspection."""
    zone_name: str
    pre_condition: ZoneCondition
    post_condition: ZoneCondition
    is_new_damage: bool


class PrePostComparison(BaseModel):
    """Side-by-side comparison of PRE and POST inspection zone data."""
    rental_agreement_id: str
    pre_zones: dict = Field(description="Zone → condition from PRE inspection")
    post_zones: dict = Field(description="Zone → condition from POST inspection")
    new_damages: list[ZoneDiff] = Field(
        description="Zones where condition degraded from PRE to POST"
    )
    total_new_damage_zones: int = 0


# ── Damage claims ─────────────────────────────────────────────────────────────

class DamageClaimCreate(BaseModel):
    """Create a damage claim from post-inspection results."""
    rental_agreement_id: UUID
    zone_data_diff: list[ZoneDiff] = Field(
        description="New damage zones detected in post-inspection"
    )
    severity: int = Field(ge=1, le=5)
    photos: list[str] = Field(default_factory=list, description="S3 keys")
    notes: Optional[str] = Field(default=None, max_length=2000)


class DamageClaimResponse(BaseModel):
    """Full damage claim read model."""
    model_config = {"from_attributes": True}

    claim_id: str
    tenant_id: str
    claim_reference: str
    rental_agreement_id: str
    vehicle_id: str
    customer_id: str
    status: str
    severity: str
    damage_zone: str
    damage_type: str
    zone_data: Optional[list] = None
    pre_inspection_snapshot: Optional[dict] = None
    post_inspection_snapshot: Optional[dict] = None
    cdw_covered: bool = False
    cdw_void_reason: Optional[str] = None
    repair_estimate: Optional[Decimal] = None
    repair_actual: Optional[Decimal] = None
    loss_of_use_days: int = 0
    loss_of_use_total: Optional[Decimal] = None
    admin_fee: Decimal = Decimal("0.00")
    total_claim_amount: Optional[Decimal] = None
    notes: Optional[str] = None
    inspector_id: Optional[str] = None
    adjuster_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ClaimStatusUpdate(BaseModel):
    """Transition a damage claim to a new status."""
    new_status: ClaimStatus
    reason: str = Field(min_length=1, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=2000)


class LOUCalculation(BaseModel):
    """Loss of Use calculation result."""
    claim_id: str
    lou_days: int
    daily_rate: Decimal
    utilization_factor: Decimal
    lou_amount: Decimal
