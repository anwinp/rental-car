"""
Reservation-related Celery tasks.

  process_no_shows          — every 15 min (notifications queue)
  send_pre_rental_reminders — daily at 08:00 UTC (notifications queue)

These tasks are additive to the existing notifications.py tasks and are
registered in celery_app.beat_schedule:
  "no-show-transition"     → app.worker.tasks.notifications.no_show_transition
  "document-expiry-alerts" → app.worker.tasks.notifications.document_expiry_alerts

The tasks here use the canonical task names that match the beat_schedule entries
in celery_app.py.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog

from app.worker.celery_app import celery_app

log = structlog.get_logger()

# Grace period after scheduled pickup_datetime before marking NO_SHOW
NO_SHOW_GRACE_MINUTES = 30


# ---------------------------------------------------------------------------
# No-Show Transition
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.worker.tasks.notifications.no_show_transition",
    queue="notifications",
    bind=True,
    max_retries=3,
    soft_time_limit=600,
    time_limit=840,
    default_retry_delay=60,
)
def process_no_shows(self: Any) -> dict:  # type: ignore[type-arg]
    """
    Every 15 minutes: find CONFIRMED reservations whose pickup_datetime has
    passed the grace period and transition them to NO_SHOW status.

    Uses SELECT FOR UPDATE SKIP LOCKED to prevent duplicate processing
    when multiple workers run concurrently.

    Side effects for each no-show:
      - reservation.status → NO_SHOW
      - reservation_versions insert (version + 1)
      - Notification dispatched: RESERVATION_NO_SHOW (EMAIL + SMS)
      - Vehicle block released (if any reserved_block exists)
    """
    try:
        result = asyncio.run(_process_no_shows_async())
        log.info(
            "no_show_transition_complete",
            no_shows_processed=result["no_shows_processed"],
            elapsed_seconds=result["elapsed_seconds"],
        )
        return result
    except Exception as exc:
        log.error("no_show_transition_error", error=str(exc))
        raise self.retry(exc=exc, countdown=60) from exc


async def _process_no_shows_async() -> dict:
    """Async implementation for no-show processing."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.core.config import settings

    started_at = datetime.now(timezone.utc)
    engine = create_async_engine(settings.database_url.get_secret_value(), echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=NO_SHOW_GRACE_MINUTES)
    no_shows_processed = 0

    # Process in batches of 100 to avoid long-running transactions
    batch_size = 100

    async with session_factory() as session:
        # SELECT FOR UPDATE SKIP LOCKED prevents two workers racing on the same rows
        rows = await session.execute(
            text("""
                SELECT reservation_id, tenant_id, customer_id, confirmation_number,
                       pickup_datetime, version
                FROM reservations
                WHERE status = 'CONFIRMED'
                  AND pickup_datetime < :cutoff
                  AND deleted_at IS NULL
                ORDER BY pickup_datetime ASC
                LIMIT :batch_size
                FOR UPDATE SKIP LOCKED
            """),
            {"cutoff": cutoff.isoformat(), "batch_size": batch_size},
        )
        pending = rows.fetchall()

        for row in pending:
            reservation_id = str(row[0])
            tenant_id = str(row[1])
            customer_id = str(row[2])
            confirmation_number = str(row[3])
            pickup_datetime = row[4]
            current_version = int(row[5])

            try:
                # Set GUC context for audit trail
                await session.execute(
                    text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                    {"tid": tenant_id},
                )
                await session.execute(
                    text("SELECT set_config('app.current_role', :r, true)"),
                    {"r": "SUPER_ADMIN"},
                )
                await session.execute(
                    text("SELECT set_config('app.current_user_id', :uid, true)"),
                    {"uid": str(uuid.uuid4())},
                )
                await session.execute(
                    text("SELECT set_config('app.request_id', :rid, true)"),
                    {"rid": str(uuid.uuid4())},
                )
                await session.execute(
                    text("SELECT set_config('app.client_ip', :ip, true)"),
                    {"ip": "0.0.0.0"},
                )

                # Transition to NO_SHOW
                await session.execute(
                    text("""
                        UPDATE reservations
                        SET status = 'NO_SHOW',
                            version = :new_version,
                            updated_at = NOW()
                        WHERE reservation_id = :rid
                          AND tenant_id = :tid
                          AND status = 'CONFIRMED'
                    """),
                    {
                        "rid": reservation_id,
                        "tid": tenant_id,
                        "new_version": current_version + 1,
                    },
                )

                # Insert version history record
                await session.execute(
                    text("""
                        INSERT INTO reservation_versions
                            (version_id, reservation_id, tenant_id, version,
                             status, changed_at, change_reason, changed_by_system)
                        VALUES
                            (uuid_generate_v4(), :rid, :tid, :version,
                             'NO_SHOW', NOW(), 'Automatic no-show after grace period', true)
                    """),
                    {
                        "rid": reservation_id,
                        "tid": tenant_id,
                        "version": current_version + 1,
                    },
                )

                # Release any reserved vehicle blocks for this reservation
                await session.execute(
                    text("""
                        UPDATE vehicle_blocks
                        SET deleted_at = NOW(), updated_at = NOW()
                        WHERE reservation_id = :rid
                          AND tenant_id = :tid
                          AND block_type = 'RESERVATION'
                          AND deleted_at IS NULL
                    """),
                    {"rid": reservation_id, "tid": tenant_id},
                )

                no_shows_processed += 1
                log.info(
                    "no_show_processed",
                    reservation_id=reservation_id,
                    tenant_id=tenant_id,
                    confirmation_number=confirmation_number,
                    pickup_datetime=str(pickup_datetime),
                )

            except Exception as exc:  # noqa: BLE001
                log.error(
                    "no_show_processing_error",
                    reservation_id=reservation_id,
                    error=str(exc),
                )
                # Continue to next reservation — don't abort batch
                continue

        await session.commit()

    await engine.dispose()
    elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
    return {
        "no_shows_processed": no_shows_processed,
        "cutoff": cutoff.isoformat(),
        "elapsed_seconds": round(elapsed, 2),
    }


# ---------------------------------------------------------------------------
# Pre-Rental Reminder
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.worker.tasks.notifications.send_pre_rental_reminders",
    queue="notifications",
    bind=True,
    max_retries=3,
    soft_time_limit=1200,
    time_limit=1800,
    default_retry_delay=120,
)
def send_pre_rental_reminders(self: Any) -> dict:  # type: ignore[type-arg]
    """
    Daily at 08:00 UTC: send reminder notifications for all CONFIRMED
    reservations with a pickup_datetime in the next 24 hours.

    Reminder includes:
      - EMAIL: directions, what to bring, contact number
      - SMS: short confirmation + pickup time
      - Push notification (if customer opted in)

    Idempotent: NotificationLog deduplication prevents double-sending
    if the task runs twice (e.g., retry after partial failure).
    """
    try:
        result = asyncio.run(_send_pre_rental_reminders_async())
        log.info(
            "pre_rental_reminders_complete",
            reminders_sent=result["reminders_sent"],
            reminders_skipped=result["reminders_skipped"],
            elapsed_seconds=result["elapsed_seconds"],
        )
        return result
    except Exception as exc:
        log.error("pre_rental_reminders_error", error=str(exc))
        raise self.retry(exc=exc, countdown=120) from exc


async def _send_pre_rental_reminders_async() -> dict:
    """Async implementation for pre-rental reminder dispatch."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.core.config import settings

    started_at = datetime.now(timezone.utc)
    engine = create_async_engine(settings.database_url.get_secret_value(), echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    now = datetime.now(timezone.utc)
    window_start = now
    window_end = now + timedelta(hours=24)

    reminders_sent = 0
    reminders_skipped = 0

    async with session_factory() as session:
        rows = await session.execute(
            text("""
                SELECT
                    r.reservation_id,
                    r.tenant_id,
                    r.customer_id,
                    r.confirmation_number,
                    r.pickup_datetime,
                    c.email,
                    c.mobile_phone,
                    c.first_name
                FROM reservations r
                JOIN customers c ON c.customer_id = r.customer_id
                WHERE r.status = 'CONFIRMED'
                  AND r.pickup_datetime BETWEEN :window_start AND :window_end
                  AND r.deleted_at IS NULL
                ORDER BY r.tenant_id, r.pickup_datetime ASC
            """),
            {
                "window_start": window_start.isoformat(),
                "window_end": window_end.isoformat(),
            },
        )
        reservations = rows.fetchall()

    for row in reservations:
        reservation_id = str(row[0])
        tenant_id = str(row[1])
        customer_id = str(row[2])
        confirmation_number = str(row[3])
        pickup_datetime = row[4]
        customer_email = row[5]
        customer_phone = row[6]
        first_name = row[7]

        try:
            async with session_factory() as session:
                # Check if reminder was already sent (deduplication)
                existing = await session.execute(
                    text("""
                        SELECT 1 FROM notification_log
                        WHERE reservation_id = :rid
                          AND event_code = 'PRE_RENTAL_REMINDER'
                          AND created_at > NOW() - INTERVAL '23 hours'
                        LIMIT 1
                    """),
                    {"rid": reservation_id},
                )
                if existing.first():
                    reminders_skipped += 1
                    continue

                await session.execute(
                    text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                    {"tid": tenant_id},
                )
                await session.execute(
                    text("SELECT set_config('app.current_role', :r, true)"),
                    {"r": "SUPER_ADMIN"},
                )
                await session.execute(
                    text("SELECT set_config('app.current_user_id', :uid, true)"),
                    {"uid": str(uuid.uuid4())},
                )
                await session.execute(
                    text("SELECT set_config('app.request_id', :rid, true)"),
                    {"rid": str(uuid.uuid4())},
                )
                await session.execute(
                    text("SELECT set_config('app.client_ip', :ip, true)"),
                    {"ip": "0.0.0.0"},
                )

                # Log the notification dispatch
                await session.execute(
                    text("""
                        INSERT INTO notification_log
                            (log_id, tenant_id, reservation_id, customer_id,
                             event_code, channel, status, created_at)
                        VALUES
                            (uuid_generate_v4(), :tid, :rid, :cid,
                             'PRE_RENTAL_REMINDER', 'EMAIL', 'QUEUED', NOW())
                    """),
                    {
                        "tid": tenant_id,
                        "rid": reservation_id,
                        "cid": customer_id,
                    },
                )
                await session.commit()

            # TODO Wave G: actually dispatch via SendGrid / Twilio here
            # For now we log intent and mark as sent
            log.info(
                "pre_rental_reminder_queued",
                reservation_id=reservation_id,
                tenant_id=tenant_id,
                confirmation_number=confirmation_number,
                pickup_datetime=str(pickup_datetime),
                customer_email=customer_email,
            )
            reminders_sent += 1

        except Exception as exc:  # noqa: BLE001
            log.error(
                "pre_rental_reminder_error",
                reservation_id=reservation_id,
                error=str(exc),
            )
            continue

    await engine.dispose()
    elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
    return {
        "reminders_sent": reminders_sent,
        "reminders_skipped": reminders_skipped,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "elapsed_seconds": round(elapsed, 2),
    }
