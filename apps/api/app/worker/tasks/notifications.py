"""
Notification Celery tasks.

Re-exports Wave F reservation tasks that use the notifications queue,
plus provides document_expiry_alerts stub.

Beat schedule entries in celery_app.py:
  "no-show-transition"     → app.worker.tasks.notifications.no_show_transition
  "document-expiry-alerts" → app.worker.tasks.notifications.document_expiry_alerts
"""
from __future__ import annotations

from typing import Any

import structlog

from app.worker.celery_app import celery_app

# Re-export from reservation_tasks so the beat schedule canonical name resolves
from app.worker.tasks.reservation_tasks import (  # noqa: F401
    process_no_shows as no_show_transition,
    send_pre_rental_reminders,
)

log = structlog.get_logger()


@celery_app.task(
    name="app.worker.tasks.notifications.document_expiry_alerts",
    queue="notifications",
    bind=True,
    max_retries=3,
    default_retry_delay=300,
)
def document_expiry_alerts(self: Any) -> dict:  # type: ignore[type-arg]
    """
    Daily at 08:00 UTC: send alerts for expiring driver's licenses,
    insurance documents, and corporate agreements.

    Implementation deferred to Wave G (document management module).
    """
    log.info("document_expiry_alerts_stub_called")
    return {"status": "stub", "message": "Document expiry alerts not yet implemented."}


@celery_app.task(
    name="app.worker.tasks.notifications.dispatch_notification",
    queue="notifications",
    bind=True,
    max_retries=5,
    default_retry_delay=30,
)
def dispatch_notification(
    self: Any,  # type: ignore[type-arg]
    tenant_id: str,
    event_code: str,
    recipient_id: str,
    context: dict,
    channels: list | None = None,
) -> dict:
    """
    Dispatch a single notification to a recipient.

    Args:
        tenant_id:    Tenant UUID string.
        event_code:   e.g. RESERVATION_CONFIRMED, PAYMENT_AUTHORIZED
        recipient_id: Customer UUID string.
        context:      Merge variables dict for the template.
        channels:     Optional list of channels; defaults to template defaults.

    Implementation deferred to Wave G (full notification pipeline).
    """
    log.info(
        "dispatch_notification_stub",
        tenant_id=tenant_id,
        event_code=event_code,
        recipient_id=recipient_id,
    )
    return {
        "status": "stub",
        "tenant_id": tenant_id,
        "event_code": event_code,
        "recipient_id": recipient_id,
    }
