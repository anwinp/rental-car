"""Damage & Inspections router — FastAPI endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.damage.schemas import (
    ClaimStatusUpdate,
    DamageClaimCreate,
    DamageClaimResponse,
    InspectionForm,
    InspectionResponse,
    LOUCalculation,
    PrePostComparison,
)
from app.domains.damage.service import DamageService

router = APIRouter()


# ── Photo Upload URL ──────────────────────────────────────────────────────────

class PhotoUploadRequest(BaseModel):
    zone_id: str
    ra_id: Optional[str] = None


@router.post("/photo-upload-url")
async def get_photo_upload_url(
    body: PhotoUploadRequest,
    claims: UserClaims = Depends(require_permission("damage", "create")),
) -> dict:
    """Generate S3 presigned URL for inspection photo upload."""
    import uuid as _uuid
    from app.core.config import settings
    s3_key = f"inspections/{claims.tenant_id}/{body.ra_id or 'general'}/{body.zone_id}/{_uuid.uuid4()}.jpg"
    try:
        from app.core.s3 import get_presign_client
        s3 = get_presign_client()
        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": getattr(settings, "s3_photos_bucket", "rcm-photos"),
                "Key": s3_key,
                "ContentType": "image/jpeg",
            },
            ExpiresIn=300,
        )
    except Exception:
        url = f"https://s3-placeholder.local/{s3_key}"
    return {"upload_url": url, "s3_key": s3_key}


# ── Inspections ───────────────────────────────────────────────────────────────

@router.post(
    "/inspections",
    response_model=InspectionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def record_inspection(
    body: InspectionForm,
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
    session: AsyncSession = Depends(get_session),
) -> InspectionResponse:
    """
    Record a PRE or POST inspection form for a rental agreement.

    POST inspections automatically compare against the PRE snapshot to detect
    new damage zones. One DamageClaim is auto-created per new damage zone.

    Photos must be pre-uploaded to S3; supply S3 keys (not raw bytes).
    """
    svc = DamageService(session, claims.tenant_id)
    return await svc.record_inspection(body, claims.tenant_id)


@router.get("/inspections/{ra_id}")
async def get_inspection_data(
    ra_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Retrieve pre and post inspection snapshot data for a rental agreement."""
    svc = DamageService(session, claims.tenant_id)
    return await svc.get_inspection_data(ra_id, claims.tenant_id)


@router.get("/inspections/{ra_id}/comparison", response_model=PrePostComparison)
async def get_inspection_comparison(
    ra_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
    session: AsyncSession = Depends(get_session),
) -> PrePostComparison:
    """
    Return a structured zone-by-zone PRE vs POST comparison for a rental agreement.

    Highlights zones where condition degraded (i.e. new damage).
    """
    svc = DamageService(session, claims.tenant_id)
    return await svc.get_pre_post_comparison(ra_id, claims.tenant_id)


# ── Damage claims ─────────────────────────────────────────────────────────────

@router.post(
    "/claims",
    response_model=DamageClaimResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_claim(
    body: DamageClaimCreate,
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
    session: AsyncSession = Depends(get_session),
) -> DamageClaimResponse:
    """
    Manually create a damage claim from post-inspection diff data.

    CDW coverage is determined from the RA's extras_snapshot.
    CDW is voided if DUI / UNAUTHORIZED_DRIVER / OFF_ROAD / WRONG_FUEL appears in notes.
    A DAMAGE_HOLD vehicle block is created automatically.
    """
    svc = DamageService(session, claims.tenant_id)
    claim = await svc.create_claim(body, claims.tenant_id, claims.user_id)
    return DamageClaimResponse.model_validate(claim, from_attributes=True)


@router.get("/claims", response_model=list[DamageClaimResponse])
async def list_claims(
    status: Optional[str] = Query(default=None, description="Filter by claim status"),
    vehicle_id: Optional[uuid.UUID] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    claims: UserClaims = Depends(require_permission("damage", "read")),
    session: AsyncSession = Depends(get_session),
) -> list[DamageClaimResponse]:
    """List damage claims with optional filters (status, vehicle, date range)."""
    svc = DamageService(session, claims.tenant_id)
    results = await svc.list_claims(
        tenant_id=claims.tenant_id,
        status=status,
        vehicle_id=vehicle_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return [DamageClaimResponse.model_validate(c, from_attributes=True) for c in results]


@router.get("/claims/{claim_id}", response_model=DamageClaimResponse)
async def get_claim(
    claim_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("damage", "read")),
    session: AsyncSession = Depends(get_session),
) -> DamageClaimResponse:
    """Fetch a damage claim by ID."""
    svc = DamageService(session, claims.tenant_id)
    claim = await svc.get_claim(claim_id, claims.tenant_id)
    return DamageClaimResponse.model_validate(claim, from_attributes=True)


@router.post("/claims/{claim_id}/status", response_model=DamageClaimResponse)
async def transition_claim_status(
    claim_id: uuid.UUID,
    body: ClaimStatusUpdate,
    claims: UserClaims = Depends(require_permission("damage", "update")),
    session: AsyncSession = Depends(get_session),
) -> DamageClaimResponse:
    """
    Transition a damage claim to a new lifecycle state.

    Valid state machine:
      OPEN → ESTIMATE_SENT | WRITTEN_OFF
      ESTIMATE_SENT → CUSTOMER_ACKNOWLEDGED | DISPUTED
      CUSTOMER_ACKNOWLEDGED → REPAIR_IN_PROGRESS
      REPAIR_IN_PROGRESS → REPAIR_COMPLETE
      REPAIR_COMPLETE → INVOICED
      INVOICED → PAID | DISPUTED
      DISPUTED → IN_LITIGATION | REPAIR_IN_PROGRESS
      IN_LITIGATION → PAID | WRITTEN_OFF
    """
    svc = DamageService(session, claims.tenant_id)
    claim = await svc.transition_claim_status(
        claim_id=claim_id,
        new_status=body.new_status,
        actor_id=claims.user_id,
        reason=body.reason,
        tenant_id=claims.tenant_id,
    )
    return DamageClaimResponse.model_validate(claim, from_attributes=True)


@router.get("/claims/{claim_id}/lou", response_model=LOUCalculation)
async def calculate_lou(
    claim_id: uuid.UUID,
    claims: UserClaims = Depends(require_permission("damage", "read")),
    session: AsyncSession = Depends(get_session),
) -> LOUCalculation:
    """
    Calculate Loss of Use (LOU) for a damage claim.

    LOU formula:
      lou_amount = daily_rate × lou_days × utilization_factor
      where utilization_factor = min(1.0, fleet_utilization / 0.80)
    """
    svc = DamageService(session, claims.tenant_id)
    return await svc.calculate_lou(claim_id, claims.tenant_id)

