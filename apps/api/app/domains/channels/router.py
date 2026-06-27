from __future__ import annotations
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.channels.schemas import OTALeadResponse, ConfirmLeadRequest, RejectLeadRequest

router = APIRouter()


@router.get("/health", include_in_schema=False)
async def channels_health() -> dict:
    """Health check stub for channels domain."""
    return {"status": "ok", "domain": "channels"}


@router.post("/webhook/{channel_name}", status_code=200, include_in_schema=False)
async def ota_webhook(channel_name: str, request: Request, session: AsyncSession = Depends(get_session)):
    """OTA inbound webhook — always-on, stubs log until credentials configured."""
    payload = await request.json()
    import structlog
    structlog.get_logger().info("ota_webhook_received", channel=channel_name)
    return {"received": True}


@router.get("/leads", response_model=list[OTALeadResponse])
async def list_leads(
    status: Optional[str] = None,
    channel: Optional[str] = None,
    claims: UserClaims = Depends(require_permission("channels", "read")),
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import text
    filters = ["tenant_id = :tid"]
    params: dict = {"tid": str(claims.tenant_id)}
    if status:
        filters.append("status = :status")
        params["status"] = status
    if channel:
        filters.append("channel_name = :channel")
        params["channel"] = channel.upper()
    where = " AND ".join(filters)
    result = await session.execute(
        text(f"SELECT * FROM ota_leads WHERE {where} ORDER BY received_at DESC LIMIT 100"),
        params,
    )
    rows = result.mappings().all()
    return [
        OTALeadResponse.model_validate({k: str(v) if hasattr(v, 'hex') else v for k, v in row.items()})
        for row in rows
    ]


@router.post("/leads/{lead_id}/confirm", response_model=dict)
async def confirm_lead(
    lead_id: uuid.UUID,
    body: ConfirmLeadRequest,
    claims: UserClaims = Depends(require_permission("channels", "update")),
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import text
    await session.execute(
        text("UPDATE ota_leads SET status='CONFIRMED', actioned_at=NOW(), actioned_by=:uid WHERE lead_id=:lid AND tenant_id=:tid"),
        {"uid": str(claims.user_id), "lid": str(lead_id), "tid": str(claims.tenant_id)},
    )
    await session.commit()
    return {"lead_id": str(lead_id), "status": "CONFIRMED"}


@router.post("/leads/{lead_id}/reject", response_model=dict)
async def reject_lead(
    lead_id: uuid.UUID,
    body: RejectLeadRequest,
    claims: UserClaims = Depends(require_permission("channels", "update")),
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import text
    await session.execute(
        text("UPDATE ota_leads SET status='REJECTED', rejection_reason=:reason, actioned_at=NOW(), actioned_by=:uid WHERE lead_id=:lid AND tenant_id=:tid"),
        {"reason": body.reason, "uid": str(claims.user_id), "lid": str(lead_id), "tid": str(claims.tenant_id)},
    )
    await session.commit()
    return {"lead_id": str(lead_id), "status": "REJECTED"}
