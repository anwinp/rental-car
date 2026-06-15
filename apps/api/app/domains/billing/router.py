"""Billing domain router — stub with health endpoint."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", include_in_schema=False)
async def billing_health() -> dict:
    """Health check stub for billing domain."""
    return {"status": "ok", "domain": "billing"}
