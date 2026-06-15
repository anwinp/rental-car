"""Pricing domain router — rate codes, schedule items, extras, rate quotes."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.redis import get_avail_redis
from app.core.security import UserClaims, get_current_user
from app.domains.pricing.repository import PricingRepository
from app.domains.pricing.schemas import (
    ExtrasCatalogCreate,
    ExtrasCatalogUpdate,
    ExtrasCatalogItem,
    ExtrasResponse,
    RateCodeActivate,
    RateCodeCreate,
    RateCodeResponse,
    RateCodeUpdate,
    RateQuoteRequest,
    RateQuoteResponse,
    RateScheduleItemCreate,
    RateScheduleItemResponse,
)
from app.domains.pricing.service import PricingService

router = APIRouter()


# ── Dependency helpers ────────────────────────────────────────────────────────


def _get_service(
    request: Request,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> PricingService:
    repo = PricingRepository(session=session, tenant_id=claims.tenant_id)
    redis = get_avail_redis()
    return PricingService(repo=repo, redis=redis, tenant_id=claims.tenant_id)


def _get_service_public(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> PricingService:
    """For the public quote endpoint — no auth required."""
    # Use a sentinel UUID for unauthenticated callers; RLS is bypassed for
    # quotes because rate codes can be public. Tenant is extracted from the
    # request payload (location_id → tenant lookup) in a real implementation.
    # For now we accept tenant_id from a custom header X-Tenant-ID (no JWT).
    tenant_id_str = request.headers.get("X-Tenant-ID", "00000000-0000-0000-0000-000000000000")
    try:
        tenant_id = UUID(tenant_id_str)
    except ValueError:
        tenant_id = UUID("00000000-0000-0000-0000-000000000000")
    repo = PricingRepository(session=session, tenant_id=tenant_id)
    redis = get_avail_redis()
    return PricingService(repo=repo, redis=redis, tenant_id=tenant_id)


# ── Rate Quote ────────────────────────────────────────────────────────────────


@router.post(
    "/quote",
    response_model=RateQuoteResponse,
    summary="Calculate rate quote",
    description=(
        "Public endpoint (rate-limited). Returns a 30-second cached rate quote "
        "with quote_token for use at reservation creation."
    ),
    tags=["pricing"],
)
async def calculate_rate_quote(
    payload: RateQuoteRequest,
    svc: PricingService = Depends(_get_service_public),
) -> RateQuoteResponse:
    return await svc.calculate_quote(payload)


# ── Rate Codes ────────────────────────────────────────────────────────────────


@router.get(
    "/rate-codes",
    response_model=list[RateCodeResponse],
    summary="List rate codes",
    tags=["pricing"],
)
async def list_rate_codes(
    status: str | None = Query(default=None, description="Filter by status: DRAFT|ACTIVE|ARCHIVED"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    svc: PricingService = Depends(_get_service),
) -> list[RateCodeResponse]:
    codes = await svc.list_rate_codes(status=status, limit=limit, offset=offset)
    return [RateCodeResponse.model_validate(rc) for rc in codes]


@router.post(
    "/rate-codes",
    response_model=RateCodeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create rate code",
    tags=["pricing"],
)
async def create_rate_code(
    payload: RateCodeCreate,
    svc: PricingService = Depends(_get_service),
) -> RateCodeResponse:
    rc = await svc.create_rate_code(payload)
    return RateCodeResponse.model_validate(rc)


@router.get(
    "/rate-codes/{rate_code_id}",
    response_model=RateCodeResponse,
    summary="Get rate code with schedule items",
    tags=["pricing"],
)
async def get_rate_code(
    rate_code_id: UUID,
    svc: PricingService = Depends(_get_service),
) -> RateCodeResponse:
    rc = await svc.get_rate_code(rate_code_id)
    return RateCodeResponse.model_validate(rc)


@router.patch(
    "/rate-codes/{rate_code_id}",
    response_model=RateCodeResponse,
    summary="Update rate code (DRAFT only)",
    tags=["pricing"],
)
async def update_rate_code(
    rate_code_id: UUID,
    payload: RateCodeUpdate,
    svc: PricingService = Depends(_get_service),
) -> RateCodeResponse:
    rc = await svc.update_rate_code(rate_code_id, payload)
    return RateCodeResponse.model_validate(rc)


@router.post(
    "/rate-codes/{rate_code_id}/activate",
    response_model=RateCodeResponse,
    summary="Activate rate code (requires RATE_MANAGER role)",
    tags=["pricing"],
)
async def activate_rate_code(
    rate_code_id: UUID,
    payload: RateCodeActivate = RateCodeActivate(),
    svc: PricingService = Depends(_get_service),
) -> RateCodeResponse:
    rc = await svc.activate_rate_code(rate_code_id, payload)
    return RateCodeResponse.model_validate(rc)


# ── Schedule Items ────────────────────────────────────────────────────────────


@router.get(
    "/rate-codes/{rate_code_id}/schedule",
    response_model=list[RateScheduleItemResponse],
    summary="Get schedule items for a rate code",
    tags=["pricing"],
)
async def get_schedule_items(
    rate_code_id: UUID,
    svc: PricingService = Depends(_get_service),
) -> list[RateScheduleItemResponse]:
    items = await svc.get_schedule_items(rate_code_id)
    return [RateScheduleItemResponse.model_validate(item) for item in items]


@router.post(
    "/rate-codes/{rate_code_id}/schedule",
    response_model=RateScheduleItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add schedule item to rate code",
    tags=["pricing"],
)
async def add_schedule_item(
    rate_code_id: UUID,
    payload: RateScheduleItemCreate,
    svc: PricingService = Depends(_get_service),
) -> RateScheduleItemResponse:
    item = await svc.add_schedule_item(rate_code_id, payload)
    return RateScheduleItemResponse.model_validate(item)


# ── Extras ────────────────────────────────────────────────────────────────────


@router.get(
    "/extras",
    response_model=ExtrasResponse,
    summary="List active extras (tenant + system)",
    tags=["pricing"],
)
async def list_extras(
    svc: PricingService = Depends(_get_service),
) -> ExtrasResponse:
    extras = await svc.list_active_extras()
    items = [ExtrasCatalogItem.model_validate(e) for e in extras]
    return ExtrasResponse(items=items, total=len(items))


@router.post(
    "/extras",
    response_model=ExtrasCatalogItem,
    status_code=status.HTTP_201_CREATED,
    summary="Create extra (SYSTEM_ADMIN only)",
    tags=["pricing"],
)
async def create_extra(
    payload: ExtrasCatalogCreate,
    svc: PricingService = Depends(_get_service),
) -> ExtrasCatalogItem:
    extra = await svc.create_extra(payload)
    return ExtrasCatalogItem.model_validate(extra)


@router.patch(
    "/extras/{extra_id}",
    response_model=ExtrasCatalogItem,
    summary="Update extra",
    tags=["pricing"],
)
async def update_extra(
    extra_id: UUID,
    payload: ExtrasCatalogUpdate,
    svc: PricingService = Depends(_get_service),
) -> ExtrasCatalogItem:
    extra = await svc.update_extra(extra_id, payload)
    return ExtrasCatalogItem.model_validate(extra)
