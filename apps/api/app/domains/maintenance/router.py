"""Maintenance domain router — stub with health endpoint."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", include_in_schema=False)
async def maintenance_health() -> dict:
    """Health check stub for maintenance domain."""
    return {"status": "ok", "domain": "maintenance"}
