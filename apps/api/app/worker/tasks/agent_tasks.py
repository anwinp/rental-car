"""
Agent Celery tasks — Wave 3 implementations.
All async logic uses asyncio.run() (not deprecated get_event_loop()).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    name="app.worker.tasks.agent_tasks.scan_ev_alerts",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def scan_ev_alerts(self) -> dict:
    """Poll telematics_events for EVs with SOC ≤ 20% and dispatch EV_LOW_SOC_ALERT."""
    return asyncio.run(_async_scan_ev_alerts())


@shared_task(
    name="app.worker.tasks.agent_tasks.scan_overdue_rentals",
    bind=True,
    max_retries=3,
    default_retry_delay=120,
)
def scan_overdue_rentals(self) -> dict:
    """Scan active RAs past return_datetime and dispatch soft/hard overdue SMS."""
    return asyncio.run(_async_scan_overdue_rentals())


async def _async_scan_ev_alerts() -> dict:
    """Query telematics_events for low SOC, dispatch EV_LOW_SOC_ALERT notifications."""
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy import text as sqlt
    from app.core.database import async_session_maker

    alerts_sent = 0
    try:
        async with async_session_maker() as session:
            result = await session.execute(sqlt("""
                SELECT DISTINCT ON (te.vehicle_id)
                    te.vehicle_id,
                    v.tenant_id,
                    v.license_plate,
                    te.soc_pct
                FROM telematics_events te
                JOIN vehicles v ON v.vehicle_id = te.vehicle_id
                WHERE te.soc_pct <= 20
                  AND te.recorded_at >= NOW() - INTERVAL '10 minutes'
                  AND v.deleted_at IS NULL
                ORDER BY te.vehicle_id, te.recorded_at DESC
            """))
            rows = result.mappings().all()

            for row in rows:
                try:
                    from app.domains.notifications.service import NotificationService
                    svc = NotificationService(session)
                    await svc.dispatch_notification(
                        tenant_id=str(row["tenant_id"]),
                        event_code="EV_LOW_SOC_ALERT",
                        channel="SMS",
                        merge_vars={
                            "license_plate": row["license_plate"],
                            "soc_pct": str(int(row["soc_pct"])),
                        },
                        recipient_phone=None,  # dispatch to fleet manager on duty
                    )
                    alerts_sent += 1
                except Exception as exc:
                    logger.warning("ev_alert_failed vehicle_id=%s error=%s", row["vehicle_id"], exc)
    except Exception as exc:
        logger.error("scan_ev_alerts_failed error=%s", exc)

    logger.info("scan_ev_alerts_complete alerts_sent=%d", alerts_sent)
    return {"status": "ok", "alerts_sent": alerts_sent}


async def _async_scan_overdue_rentals() -> dict:
    """Scan RAs past return_datetime and dispatch soft (T+90min) / hard (T+2h) SMS."""
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy import text as sqlt
    from app.core.database import async_session_maker

    now = datetime.now(timezone.utc)
    soft_threshold = now - timedelta(minutes=90)
    hard_threshold = now - timedelta(hours=2)
    rentals_checked = 0
    alerts_sent = 0

    try:
        async with async_session_maker() as session:
            result = await session.execute(sqlt("""
                SELECT
                    ra.ra_id,
                    ra.tenant_id,
                    r.return_datetime,
                    c.first_name,
                    c.phone,
                    c.email
                FROM rental_agreements ra
                JOIN reservations r ON r.reservation_id = ra.reservation_id
                JOIN customers c ON c.customer_id = r.customer_id
                WHERE ra.status IN ('ACTIVE', 'EXTENDED')
                  AND r.return_datetime < :soft_threshold
                  AND ra.actual_return_datetime IS NULL
                ORDER BY r.return_datetime ASC
                LIMIT 200
            """), {"soft_threshold": soft_threshold})
            rows = result.mappings().all()
            rentals_checked = len(rows)

            from app.domains.notifications.service import NotificationService
            svc = NotificationService(session)

            for row in rows:
                return_dt: datetime = row["return_datetime"]
                overdue_minutes = int((now - return_dt).total_seconds() / 60)
                overdue_hours = overdue_minutes // 60
                event_code = "RENTAL_OVERDUE_HARD" if return_dt <= hard_threshold else "RENTAL_OVERDUE_SOFT"

                if not row.get("phone"):
                    continue
                try:
                    await svc.dispatch_notification(
                        tenant_id=str(row["tenant_id"]),
                        event_code=event_code,
                        channel="SMS",
                        merge_vars={
                            "first_name": row["first_name"],
                            "return_time": return_dt.strftime("%I:%M %p"),
                            "hours_overdue": str(overdue_hours),
                            "support_phone": "1-800-RCM-HELP",
                        },
                        recipient_phone=row["phone"],
                    )
                    alerts_sent += 1
                except Exception as exc:
                    logger.warning("overdue_alert_failed ra_id=%s error=%s", row["ra_id"], exc)
    except Exception as exc:
        logger.error("scan_overdue_rentals_failed error=%s", exc)

    logger.info("scan_overdue_complete checked=%d alerts=%d", rentals_checked, alerts_sent)
    return {"status": "ok", "rentals_checked": rentals_checked, "alerts_sent": alerts_sent}
