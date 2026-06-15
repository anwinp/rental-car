"""Fleet domain router — vehicles, blocks, classes, availability, WebSocket."""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.redis import WS_TOKEN_KEY, get_session_redis
from app.core.security import UserClaims, get_current_user, verify_ws_token
from app.domains.fleet.schemas import (
    AvailabilityQuery,
    AvailabilityResponse,
    BulkImportResult,
    VehicleBlockCreate,
    VehicleBlockResponse,
    VehicleClassCreate,
    VehicleClassResponse,
    VehicleCreate,
    VehicleResponse,
    VehicleStatus,
    VehicleStatusTransitionRequest,
    VehicleUpdate,
)
from app.domains.fleet.service import FleetService

router = APIRouter()
_svc = FleetService()

# ── Helper: is the user a fleet manager or above? ────────────────────────────

_MANAGER_ROLES = frozenset(
    {"FLEET_MANAGER", "BRANCH_MANAGER", "REGIONAL_MANAGER", "SYSTEM_ADMIN", "SUPER_ADMIN"}
)


def _is_manager(claims: UserClaims) -> bool:
    return bool(set(claims.roles) & _MANAGER_ROLES)


# ── Vehicle class endpoints ───────────────────────────────────────────────────


@router.get(
    "/classes",
    response_model=list[VehicleClassResponse],
    summary="List vehicle classes (system + tenant-custom)",
)
async def list_classes(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> list[VehicleClassResponse]:
    classes = await _svc.list_classes(session, claims.tenant_id)
    return [VehicleClassResponse.model_validate(c) for c in classes]


@router.post(
    "/classes",
    response_model=VehicleClassResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a custom vehicle class",
)
async def create_class(
    body: VehicleClassCreate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleClassResponse:
    cls = await _svc.create_class(session, claims.tenant_id, body)
    return VehicleClassResponse.model_validate(cls)


# ── Vehicle CRUD endpoints ────────────────────────────────────────────────────


@router.post(
    "/vehicles",
    response_model=VehicleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a vehicle to the fleet",
)
async def create_vehicle(
    body: VehicleCreate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleResponse:
    vehicle = await _svc.create_vehicle(
        session, claims.tenant_id, body, created_by=str(claims.user_id)
    )
    return VehicleResponse.model_validate(vehicle)


@router.get(
    "/vehicles",
    response_model=list[VehicleResponse],
    summary="List vehicles with optional filters",
)
async def list_vehicles(
    location_id: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    class_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
) -> list[VehicleResponse]:
    vehicles = await _svc.list_vehicles(
        session,
        claims.tenant_id,
        location_id=location_id,
        status=status_filter,
        class_id=class_id,
        limit=limit,
        offset=offset,
    )
    return [VehicleResponse.model_validate(v) for v in vehicles]


@router.get(
    "/vehicles/{vehicle_id}",
    response_model=VehicleResponse,
    summary="Get vehicle details",
)
async def get_vehicle(
    vehicle_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
) -> VehicleResponse:
    vehicle = await _svc.get_vehicle(session, claims.tenant_id, vehicle_id)
    return VehicleResponse.model_validate(vehicle)


@router.patch(
    "/vehicles/{vehicle_id}",
    response_model=VehicleResponse,
    summary="Update vehicle attributes",
)
async def update_vehicle(
    vehicle_id: str,
    body: VehicleUpdate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleResponse:
    vehicle = await _svc.update_vehicle(session, claims.tenant_id, vehicle_id, body)
    return VehicleResponse.model_validate(vehicle)


@router.post(
    "/vehicles/{vehicle_id}/status",
    response_model=VehicleResponse,
    summary="Transition vehicle status",
)
async def transition_status(
    vehicle_id: str,
    body: VehicleStatusTransitionRequest,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> VehicleResponse:
    """
    Enforces the state machine. Returns HTTP 422 with INVALID_STATUS_TRANSITION
    if the requested transition is not allowed from the current status.
    """
    vehicle = await _svc.transition_status(
        session,
        claims.tenant_id,
        vehicle_id,
        new_status=body.new_status.value,
        actor_id=str(claims.user_id),
        reason=body.reason,
    )
    return VehicleResponse.model_validate(vehicle)


@router.delete(
    "/vehicles/{vehicle_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a vehicle",
)
async def delete_vehicle(
    vehicle_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> None:
    await _svc.soft_delete_vehicle(session, claims.tenant_id, vehicle_id)


# ── Bulk import ───────────────────────────────────────────────────────────────


@router.post(
    "/vehicles/bulk-import",
    response_model=BulkImportResult,
    summary="Bulk import vehicles from CSV",
)
async def bulk_import_vehicles(
    file: UploadFile = File(..., description="CSV file with vehicle records"),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> BulkImportResult:
    """
    Validates ALL rows before importing any.
    Returns created/skipped/error counts.
    Partial imports never occur — the service validates first, then imports atomically.
    """
    content = await file.read()
    text_content = content.decode("utf-8-sig")  # Handle BOM

    reader = csv.DictReader(io.StringIO(text_content))
    rows = [dict(row) for row in reader]

    return await _svc.bulk_import_vehicles(
        session,
        claims.tenant_id,
        rows,
        created_by=str(claims.user_id),
    )


# ── Availability ──────────────────────────────────────────────────────────────


@router.get(
    "/availability",
    response_model=AvailabilityResponse,
    summary="Check vehicle availability for a class/location/period",
)
async def get_availability(
    location_id: str = Query(...),
    vehicle_class_id: str = Query(...),
    pickup_dt: datetime = Query(...),
    dropoff_dt: datetime = Query(...),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> AvailabilityResponse:
    """
    Primary: Redis cache (60s TTL).
    Fallback: DB query counting AVAILABLE vehicles with no overlapping blocks.
    Manager roles additionally receive the vehicle list.
    """
    query = AvailabilityQuery(
        location_id=location_id,
        vehicle_class_id=vehicle_class_id,
        pickup_dt=pickup_dt,
        dropoff_dt=dropoff_dt,
    )
    include_vehicle_list = _is_manager(claims)
    return await _svc.get_availability(
        session, claims.tenant_id, query, include_vehicle_list=include_vehicle_list
    )


# ── Blocks ────────────────────────────────────────────────────────────────────


@router.post(
    "/blocks",
    response_model=VehicleBlockResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a vehicle block",
)
async def create_block(
    body: VehicleBlockCreate,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicle_blocks", "create")),
) -> VehicleBlockResponse:
    """
    Creates a VehicleBlock.
    Returns HTTP 409 if the vehicle is already blocked during the requested period
    (DB exclusion constraint violation).
    """
    block = await _svc.create_block(
        session,
        claims.tenant_id,
        body,
        created_by=str(claims.user_id),
    )
    return VehicleBlockResponse.model_validate(block)


@router.delete(
    "/blocks/{block_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a vehicle block",
)
async def delete_block(
    block_id: str,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicle_blocks", "create")),
) -> None:
    await _svc.soft_delete_block(
        session, claims.tenant_id, block_id, actor_id=str(claims.user_id)
    )


# ── WebSocket token ───────────────────────────────────────────────────────────


@router.post(
    "/ws-token",
    summary="Obtain a one-time WebSocket token (60s TTL)",
    status_code=status.HTTP_200_OK,
)
async def get_ws_token(
    claims: UserClaims = Depends(get_current_user),
) -> dict:
    """
    Issues a short-lived one-time token for the /ws/fleet/{location_id} WebSocket.
    The counter app fetches this before opening the WS connection.
    """
    token = str(uuid.uuid4())
    redis = get_session_redis()
    key = WS_TOKEN_KEY.format(token=token)
    await redis.set(key, str(claims.user_id), ex=60)
    return {"ws_token": token, "expires_in_seconds": 60}


# ── WebSocket endpoint ────────────────────────────────────────────────────────


@router.websocket("/ws/fleet/{location_id}")
async def fleet_websocket(
    location_id: str,
    websocket: WebSocket,
    claims: UserClaims = Depends(verify_ws_token),
) -> None:
    """
    Real-time availability broadcast for a location.
    Authenticated via one-time token from POST /fleet/ws-token.
    """
    from app.core.redis import FLEET_CHANNEL, get_avail_redis

    await websocket.accept()
    redis = get_avail_redis()
    pubsub = redis.pubsub()
    channel = FLEET_CHANNEL.format(
        tenant_id=str(claims.tenant_id), location_id=location_id
    )
    await pubsub.subscribe(channel)

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
