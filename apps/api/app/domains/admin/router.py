"""Admin domain router — stub with health endpoint."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", include_in_schema=False)
async def admin_health() -> dict:
    """Health check stub for admin domain."""
    return {"status": "ok", "domain": "admin"}
