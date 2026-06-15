from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.database import AsyncSessionLocal, check_db_health
from app.core.redis import check_redis_health, get_avail_redis, get_session_redis
from app.core.security import UserClaims, get_current_user  # noqa: F401 — re-exported

# ── Health router ─────────────────────────────────────────────────────────────

health_router = APIRouter()


@health_router.get("/health", include_in_schema=False)
async def health_check():
    """ALB health check: ping DB and all Redis clusters. 503 on any failure."""
    checks: dict[str, str] = {}

    # Database
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"

    # Redis availability cache
    try:
        redis_avail = get_avail_redis()
        await redis_avail.ping()
        checks["redis_avail"] = "ok"
    except Exception as exc:
        checks["redis_avail"] = f"error: {exc}"

    # Redis sessions
    try:
        redis_session = get_session_redis()
        await redis_session.ping()
        checks["redis_sessions"] = "ok"
    except Exception as exc:
        checks["redis_sessions"] = f"error: {exc}"

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
