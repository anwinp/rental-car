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
    bind=True,
    name="app.worker.tasks.notifications.dispatch_notification",
    queue="notifications",
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def dispatch_notification(
    self: Any,  # type: ignore[type-arg]
    tenant_id: str,
    event_code: str,
    recipient_id: str,
    context: dict,
    channel: str | None = None,
) -> dict:
    """Send a notification via the appropriate channel."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(
        _async_dispatch(tenant_id, event_code, recipient_id, context, channel)
    )


async def _async_dispatch(
    tenant_id: str,
    event_code: str,
    recipient_id: str,
    context: dict,
    channel: str | None,
) -> dict:
    from app.core.database import AsyncSessionLocal
    from app.domains.notifications.service import NotificationService
    async with AsyncSessionLocal() as session:
        svc = NotificationService(session)
        await svc.send_notification(event_code, recipient_id, context, channel, tenant_id)
    return {"status": "sent", "event_code": event_code, "recipient_id": recipient_id}


@celery_app.task(
    name="app.worker.tasks.notifications.task_due_reminder_scan",
    queue="notifications",
)
def task_due_reminder_scan() -> dict:
    """Scan for tasks due in the next 2 hours and send reminders."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(_async_task_reminder_scan())


async def _async_task_reminder_scan() -> dict:
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import text
    reminded = 0
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT task_id, assignee_id, tenant_id, title, due_datetime
                FROM tasks
                WHERE deleted_at IS NULL
                  AND status NOT IN ('DONE', 'BLOCKED')
                  AND due_datetime BETWEEN NOW() AND NOW() + INTERVAL '2 hours'
                  AND assignee_id IS NOT NULL
                  AND reminded_at IS NULL
                LIMIT 100
            """),
        )
        tasks = result.mappings().all()
        for task in tasks:
            try:
                dispatch_notification.delay(
                    tenant_id=str(task["tenant_id"]),
                    event_code="TASK_DUE_REMINDER",
                    recipient_id=str(task["assignee_id"]),
                    context={"task_title": task["title"], "due_datetime": str(task["due_datetime"])},
                )
                await session.execute(
                    text("UPDATE tasks SET reminded_at = NOW() WHERE task_id = :tid"),
                    {"tid": str(task["task_id"])},
                )
                reminded += 1
            except Exception:
                pass
        await session.commit()
    return {"reminded": reminded}
