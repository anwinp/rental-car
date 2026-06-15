"""Channels domain router — stub with health endpoint."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", include_in_schema=False)
async def channels_health() -> dict:
    """Health check stub for channels domain."""
    return {"status": "ok", "domain": "channels"}
