"""
Report Celery tasks.

Re-exports Wave F reporting tasks and provides stubs for remaining
beat_schedule entries.

Beat schedule entries in celery_app.py:
  "preauth-expiry-report"  → app.worker.tasks.reports.pre_auth_expiry_report
  "generate-scheduled-report" → app.worker.tasks.reports.generate_scheduled_report
"""
from __future__ import annotations

from typing import Any

import structlog

from app.worker.celery_app import celery_app

# Re-export from reporting_tasks so the beat schedule and routing table resolve
from app.worker.tasks.reporting_tasks import (  # noqa: F401
    calculate_fleet_utilization,
    generate_daily_revenue_report,
)

log = structlog.get_logger()


@celery_app.task(
    name="app.worker.tasks.reports.pre_auth_expiry_report",
    queue="reports",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def pre_auth_expiry_report(self: Any) -> dict:  # type: ignore[type-arg]
    """
    Daily at 06:00 UTC: generate a report of pre-authorizations expiring
    in the next 24 hours so counter agents can take action.

    Implementation deferred to Wave G (full reporting pipeline).
    """
    log.info("pre_auth_expiry_report_stub_called")
    return {"status": "stub", "message": "Pre-auth expiry report not yet implemented."}


@celery_app.task(
    name="app.worker.tasks.reports.generate_scheduled_report",
    queue="reports",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def generate_scheduled_report(
    self: Any,  # type: ignore[type-arg]
    tenant_id: str,
    report_type: str,
    params: dict | None = None,
) -> dict:
    """
    Generate a scheduled report of the given type for a tenant.

    Args:
        tenant_id:   Tenant UUID string.
        report_type: One of: DAILY_REVENUE, FLEET_UTILIZATION, DAMAGE_SUMMARY,
                     PREAUTH_EXPIRY, CORPORATE_INVOICE
        params:      Report-specific parameters (dates, filters, etc.)

    Implementation deferred to Wave G.
    """
    log.info(
        "generate_scheduled_report_stub",
        tenant_id=tenant_id,
        report_type=report_type,
    )
    return {
        "status": "stub",
        "tenant_id": tenant_id,
        "report_type": report_type,
        "message": "Scheduled report generation not yet fully implemented.",
    }
