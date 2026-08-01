from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.database import AsyncSessionLocal, check_db_health
import structlog

from app.core.redis import (
    check_redis_health,
    get_avail_redis,
    get_broker_redis,
    get_session_redis,
)
from app.core.security import UserClaims, get_current_user  # noqa: F401 — re-exported

# ── Health router ─────────────────────────────────────────────────────────────

log = structlog.get_logger()

health_router = APIRouter()


@health_router.get("/health", include_in_schema=False)
async def health_check():
    """Edge health check: ping the database and every Redis cluster.

    Returns 503 if any dependency is down, so the proxy stops routing here.

    Failure detail is deliberately NOT included in the response. This endpoint
    is unauthenticated and published at rcm-api.ceez.ai, and interpolating the
    driver's exception put the database host, port and username into the body
    of a page anyone could fetch. The reason for a failure belongs in the logs.
    """
    checks: dict[str, str] = {}

    # Database
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        log.error("health_check_failed", component="database", error=str(exc))
        checks["database"] = "error"

    # Redis availability cache
    try:
        await get_avail_redis().ping()
        checks["redis_avail"] = "ok"
    except Exception as exc:
        log.error("health_check_failed", component="redis_avail", error=str(exc))
        checks["redis_avail"] = "error"

    # Redis sessions
    try:
        await get_session_redis().ping()
        checks["redis_sessions"] = "ok"
    except Exception as exc:
        log.error("health_check_failed", component="redis_sessions", error=str(exc))
        checks["redis_sessions"] = "error"

    # Redis broker. This was missing, and it is the one whose absence is
    # invisible: the broker runs in its own container, so if it dies the API
    # keeps answering 200, the proxy keeps routing, and every notification,
    # report and scheduled job silently stops with nothing to alert on.
    try:
        await get_broker_redis().ping()
        checks["redis_broker"] = "ok"
    except Exception as exc:
        log.error("health_check_failed", component="redis_broker", error=str(exc))
        checks["redis_broker"] = "error"

    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if all_ok else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if all_ok else "degraded",
            "checks": checks,
        },
    )


# ── Tenant dependency ─────────────────────────────────────────────────────────

async def get_tenant_id(request: Request) -> str:
    """
    Resolve tenant from X-Tenant-ID header or subdomain parsing.
    Sets request.state.tenant_id for downstream use.
    """
    tenant_id: Optional[str] = request.headers.get("X-Tenant-ID")

    if not tenant_id:
        # Fall back to subdomain: tenant.rcm.app → tenant
        host = request.headers.get("host", "")
        parts = host.split(".")
        if len(parts) >= 3:
            tenant_id = parts[0]

    if tenant_id:
        request.state.tenant_id = tenant_id

    return tenant_id or ""
