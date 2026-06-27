"""Agents domain router — /api/v1/agents/chat, /api/v1/agents/chat/stream, /api/v1/agents/health."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.redis import get_session_redis
from app.core.security import UserClaims, get_optional_current_user_or_bearer
from app.domains.agents.service import AgentOrchestrator

router = APIRouter()


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str


class ChatResponse(BaseModel):
    session_id: str
    message: str
    card: Optional[dict[str, Any]] = None
    chips: list[str] = []
    agent: str = "echo"


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    claims: Optional[UserClaims] = Depends(get_optional_current_user_or_bearer),
) -> ChatResponse:
    tenant_id = (
        str(claims.tenant_id) if claims else request.headers.get("X-Tenant-ID", "")
    )
    orchestrator = AgentOrchestrator(tenant_id=tenant_id, customer_claims=claims)
    result = await orchestrator.handle(payload.session_id, payload.message)
    return ChatResponse(**result)


@router.get("/chat/stream")
async def chat_stream(
    session_id: Optional[str] = None,
    message: str = "",
    request: Request = None,
    claims: Optional[UserClaims] = Depends(get_optional_current_user_or_bearer),
) -> StreamingResponse:
    """
    SSE streaming endpoint — alternative to POST /chat.
    Emits events: data: {"type":"thinking"}, data: {...full ChatResponse...}, data: [DONE]
    """
    tenant_id = (
        str(claims.tenant_id) if claims else (request.headers.get("X-Tenant-ID", "") if request else "")
    )

    async def _event_stream() -> AsyncIterator[str]:
        yield "data: " + json.dumps({"type": "thinking"}) + "\n\n"
        try:
            orchestrator = AgentOrchestrator(tenant_id=tenant_id, customer_claims=claims)
            result = await orchestrator.handle(session_id, message)
            yield "data: " + json.dumps({**result, "type": "response"}) + "\n\n"
        except Exception as exc:
            yield "data: " + json.dumps({"type": "error", "message": str(exc)}) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/counter-suggestions")
async def counter_suggestions(
    session: Optional[str] = None,
    request: Request = None,
    claims: Optional[UserClaims] = Depends(get_optional_current_user_or_bearer),
) -> dict:
    """
    Rule-based suggestions for the counter checkout surface.
    Queries overdue rentals and fleet availability to surface actionable items.
    """
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.core.database import get_session

    tenant_id = (
        str(claims.tenant_id) if claims else (request.headers.get("X-Tenant-ID", "") if request else "")
    )
    suggestions: list[dict] = []

    try:
        db_gen = get_session()
        db: AsyncSession = await db_gen.__anext__()
        try:
            # Overdue rentals
            overdue_row = await db.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt FROM rental_agreements ra
                    JOIN reservations r ON ra.reservation_id = r.reservation_id
                    WHERE r.tenant_id = :tid
                      AND ra.status = 'ACTIVE'
                      AND ra.return_datetime < NOW()
                    """
                ),
                {"tid": tenant_id},
            )
            overdue = overdue_row.scalar() or 0
            if overdue > 0:
                suggestions.append({
                    "id": "overdue",
                    "type": "alert",
                    "title": f"{overdue} overdue rental{'s' if overdue != 1 else ''}",
                    "body": "Vehicles past their return time — contact customers and flag for ops.",
                    "action": "View overdue",
                })

            # Fleet utilisation
            fleet_row = await db.execute(
                text(
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE status = 'AVAILABLE') AS available,
                      COUNT(*) AS total
                    FROM vehicles WHERE tenant_id = :tid AND is_active
                    """
                ),
                {"tid": tenant_id},
            )
            fleet = fleet_row.mappings().first()
            if fleet:
                avail = fleet["available"] or 0
                total = fleet["total"] or 1
                utilization = round((total - avail) / total * 100)
                if utilization >= 85:
                    suggestions.append({
                        "id": "fleet_util",
                        "type": "warn",
                        "title": f"Fleet at {utilization}% utilization",
                        "body": "Only a few vehicles left — prioritize returns and upsell to higher classes.",
                        "action": "Open fleet view",
                    })
        finally:
            await db.close()
    except Exception:
        pass  # non-critical — return empty suggestions on DB error

    if not suggestions:
        suggestions.append({
            "id": "all_clear",
            "type": "info",
            "title": "All systems normal",
            "body": "No immediate action items. Have a great shift!",
            "action": None,
        })

    return {"session": session, "suggestions": suggestions}


@router.get("/health")
async def agents_health() -> dict:
    redis_status = "ok"
    try:
        redis = get_session_redis()
        await redis.ping()
    except Exception:
        redis_status = "error"

    # Claude API: report system key + BYOK support
    anthropic_configured = False
    try:
        from app.core.config import settings
        anthropic_configured = bool(settings.anthropic_api_key.get_secret_value())
    except Exception:
        pass
    claude_status = "configured" if anthropic_configured else "unconfigured"

    # OpenAI-compatible LLM (NVIDIA NIM / OpenAI) — the active conversation engine
    llm_configured = False
    llm_model = ""
    try:
        from app.core.config import settings
        llm_configured = bool(settings.llm_api_key.get_secret_value())
        llm_model = settings.llm_model
    except Exception:
        pass

    overall = "ok" if redis_status == "ok" else "degraded"
    return {
        "status": overall,
        "redis": redis_status,
        "claude_api": claude_status,
        "llm": "configured" if llm_configured else "unconfigured",
        "llm_model": llm_model if llm_configured else None,
        "byok": "supported",  # per-tenant keys configurable via PUT /tenants/{id}/llm-settings
    }
