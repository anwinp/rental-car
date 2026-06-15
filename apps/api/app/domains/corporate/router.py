"""Corporate accounts domain router — stub with health endpoint."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", include_in_schema=False)
async def corporate_health() -> dict:
    """Health check stub for corporate domain."""
    return {"status": "ok", "domain": "corporate"}
