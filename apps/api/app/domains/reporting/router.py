"""Reporting domain router — health endpoint + report generation trigger."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from app.core.rbac import require_permission
from app.core.security import UserClaims

router = APIRouter()


class ReportRequest(BaseModel):
    date: str  # YYYY-MM-DD for daily revenue
    period_start: str | None = None
    period_end: str | None = None


@router.get("/health", include_in_schema=False)
async def reporting_health() -> dict:
    """Health check for reporting domain."""
    return {"status": "ok", "domain": "reporting"}


@router.post("/generate/daily-revenue", status_code=202)
async def trigger_daily_revenue_report(
    payload: ReportRequest,
    background_tasks: BackgroundTasks,
    claims: UserClaims = Depends(require_permission("reporting", "read")),
) -> dict:
    """
    Trigger an async daily revenue report for the authenticated user's tenant.
    The report is generated in the background and stored in S3.
    Returns 202 Accepted with a report_id for status polling.
    """
    from app.worker.tasks.reporting_tasks import generate_daily_revenue_report

    task = generate_daily_revenue_report.delay(
        tenant_id=str(claims.tenant_id),
        date=payload.date,
    )
    return {
        "accepted": True,
        "task_id": task.id,
        "message": f"Daily revenue report for {payload.date} is being generated.",
    }


@router.post("/generate/fleet-utilization", status_code=202)
async def trigger_fleet_utilization_report(
    payload: ReportRequest,
    background_tasks: BackgroundTasks,
    claims: UserClaims = Depends(require_permission("reporting", "read")),
) -> dict:
    """
    Trigger an async fleet utilization report for a date range.
    Returns 202 Accepted with a task_id.
    """
    from app.worker.tasks.reporting_tasks import calculate_fleet_utilization

    if not payload.period_start or not payload.period_end:
        return {"error": "period_start and period_end are required for utilization reports"}

    task = calculate_fleet_utilization.delay(
        tenant_id=str(claims.tenant_id),
        period_start=payload.period_start,
        period_end=payload.period_end,
    )
    return {
        "accepted": True,
        "task_id": task.id,
        "message": f"Fleet utilization report for {payload.period_start}–{payload.period_end} is being generated.",
    }
