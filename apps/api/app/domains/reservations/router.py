"""Reservations domain router."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.redis import get_avail_redis
from app.core.security import UserClaims, get_current_user
from app.domains.reservations.repository import ReservationRepository
from app.domains.reservations.schemas import (
    CancellationPreview,
    CancellationRequest,
    CancellationResult,
    ReservationCreate,
    ReservationModify,
    ReservationResponse,
)
from app.domains.reservations.service import ReservationService

router = APIRouter()


# ── Dependency helpers ────────────────────────────────────────────────────────


def _get_service(
    request: Request,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> ReservationService:
    repo = ReservationRepository(session=session, tenant_id=claims.tenant_id)
    redis = get_avail_redis()
    return ReservationService(repo=repo, redis=redis, tenant_id=claims.tenant_id)


def _get_claims(
    claims: UserClaims = Depends(get_current_user),
) -> UserClaims:
    return claims


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post(
    "/",
    response_model=ReservationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create reservation",
    tags=["reservations"],
)
async def create_reservation(
    payload: ReservationCreate,
    svc: ReservationService = Depends(_get_service),
    claims: UserClaims = Depends(_get_claims),
) -> ReservationResponse:
    reservation = await svc.create_reservation(
        data=payload,
        actor_id=claims.user_id,
    )
    return ReservationResponse.model_validate(reservation)


@router.get(
    "/",
    response_model=list[ReservationResponse],
    summary="List reservations with filters",
    tags=["reservations"],
)
async def list_reservations(
    status: Optional[str] = Query(default=None, description="Filter by status"),
    location_id: Optional[UUID] = Query(default=None),
    customer_id: Optional[UUID] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    source: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    svc: ReservationService = Depends(_get_service),
) -> list[ReservationResponse]:
    reservations = await svc.list_reservations(
        status=status,
        location_id=location_id,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
        source=source,
        limit=limit,
        offset=offset,
    )
    return [ReservationResponse.model_validate(r) for r in reservations]


@router.get(
    "/confirmation/{confirmation_number}",
    response_model=ReservationResponse,
    summary="Lookup by confirmation number (public — manage my booking)",
    tags=["reservations"],
)
async def get_by_confirmation_number(
    confirmation_number: str,
    svc: ReservationService = Depends(_get_service),
) -> ReservationResponse:
    reservation = await svc.get_by_confirmation_number(confirmation_number)
    return ReservationResponse.model_validate(reservation)


@router.get(
    "/{reservation_id}",
    response_model=ReservationResponse,
    summary="Get reservation",
    tags=["reservations"],
)
async def get_reservation(
    reservation_id: UUID,
    svc: ReservationService = Depends(_get_service),
) -> ReservationResponse:
    reservation = await svc.get_reservation(reservation_id)
    return ReservationResponse.model_validate(reservation)


@router.patch(
    "/{reservation_id}",
    response_model=ReservationResponse,
    summary="Modify reservation (CONFIRMED only)",
    tags=["reservations"],
)
async def modify_reservation(
    reservation_id: UUID,
    payload: ReservationModify,
    svc: ReservationService = Depends(_get_service),
    claims: UserClaims = Depends(_get_claims),
) -> ReservationResponse:
    reservation = await svc.modify_reservation(
        reservation_id=reservation_id,
        data=payload,
        actor_id=claims.user_id,
    )
    return ReservationResponse.model_validate(reservation)


@router.post(
    "/{reservation_id}/cancel",
    response_model=CancellationResult,
    summary="Cancel reservation",
    tags=["reservations"],
)
async def cancel_reservation(
    reservation_id: UUID,
    payload: CancellationRequest,
    svc: ReservationService = Depends(_get_service),
    claims: UserClaims = Depends(_get_claims),
) -> CancellationResult:
    return await svc.cancel_reservation(
        reservation_id=reservation_id,
        data=payload,
        actor_id=claims.user_id,
        actor_roles=claims.roles,
    )


@router.get(
    "/{reservation_id}/cancellation-preview",
    response_model=CancellationPreview,
    summary="Preview cancellation fee without cancelling",
    tags=["reservations"],
)
async def cancellation_preview(
    reservation_id: UUID,
    svc: ReservationService = Depends(_get_service),
) -> CancellationPreview:
    return await svc.preview_cancellation(reservation_id)
