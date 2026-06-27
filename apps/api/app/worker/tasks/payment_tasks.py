"""
Payment-related Celery tasks.

Tasks:
  - renew_expiring_preauths: renew AUTHORIZED pre-auths expiring within 24 hours
  - process_notification_stream: consume Redis Streams and deliver notifications
"""
from __future__ import annotations

import asyncio
import json
import structlog

from app.worker.celery_app import celery_app

log = structlog.get_logger()


# ── Pre-Auth Renewal ──────────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="app.worker.tasks.payment_tasks.renew_expiring_preauths",
    queue="batch",
    max_retries=3,
    default_retry_delay=300,  # 5 minutes between retries
    autoretry_for=(Exception,),
)
def renew_expiring_preauths(self) -> dict:
    """
    Celery beat task — every 6 hours.
    Queries for AUTHORIZED payments whose auth_expiry_at < NOW + 24h.
    Calls PaymentService.renew_pre_auth() for each, using a Redis SETNX lock
    to prevent concurrent renewal of the same payment.
    """
    return asyncio.get_event_loop().run_until_complete(_async_renew_expiring_preauths())


async def _async_renew_expiring_preauths() -> dict:
    """Async implementation of the pre-auth renewal batch task."""
    from app.core.database import AsyncSessionLocal
    from app.domains.payments.repository import PaymentRepository
    from app.domains.payments.service import PaymentService

    renewed = 0
    failed = 0

    async with AsyncSessionLocal() as session:
        # Fetch payments expiring within the next 24 hours (cross-tenant query)
        # We need a system-level query here — no tenant isolation for the batch scan
        from sqlalchemy import select, text
        from app.domains.payments.models import Payment
        result = await session.execute(
            select(Payment).where(
                Payment.status == "AUTHORIZED",
                Payment.payment_type == "PREAUTH",
                Payment.auth_expiry_at.isnot(None),
                Payment.auth_expiry_at <= text("NOW() + INTERVAL '24 hours'"),
            )
        )
        expiring_payments = list(result.scalars().all())

    log.info("renew_preauths_batch_start", count=len(expiring_payments))

    for payment in expiring_payments:
        try:
            async with AsyncSessionLocal() as session:
                service = PaymentService(session)
                await service.renew_pre_auth(payment.payment_id, payment.tenant_id)
            renewed += 1
        except Exception as exc:
            log.error(
                "renew_preauth_failed",
                payment_id=payment.payment_id,
                error=str(exc),
            )
            failed += 1

    log.info("renew_preauths_batch_done", renewed=renewed, failed=failed)
    return {"renewed": renewed, "failed": failed}


# ── Notification Stream Consumer ──────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="app.worker.tasks.payment_tasks.process_notification_stream",
    queue="notifications",
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
)
def process_notification_stream(self, tenant_id: str) -> dict:
    """
    Celery task — triggered per-tenant to drain the notifications:{tenant_id} Redis Stream.
    Uses XREADGROUP for at-least-once delivery.
    Calls NotificationService.render_and_send() for each message.
    XACK on success; DLQ on 3rd failure.
    """
    return asyncio.get_event_loop().run_until_complete(
        _async_process_notification_stream(tenant_id)
    )


async def _async_process_notification_stream(tenant_id: str) -> dict:
    """Async implementation of the Redis Stream notification consumer."""
    from app.core.database import AsyncSessionLocal
    from app.core.redis import NOTIFICATION_STREAM, get_session_redis
    from app.domains.notifications.service import NotificationService

    redis = get_session_redis()
    stream_key = NOTIFICATION_STREAM.format(tenant_id=tenant_id)
    consumer_group = f"notification_workers_{tenant_id}"
    consumer_name = f"worker_{tenant_id}"

    # Ensure consumer group exists
    try:
        await redis.xgroup_create(stream_key, consumer_group, id="0", mkstream=True)
    except Exception:
        pass  # Group already exists

    processed = 0
    dlq_count = 0
    max_messages = 100  # Process up to 100 messages per invocation

    try:
        # Read pending messages (previously delivered but not ACKed)
        pending = await redis.xreadgroup(
            groupname=consumer_group,
            consumername=consumer_name,
            streams={stream_key: "0"},
            count=max_messages,
            block=0,
        )

        for _stream, messages in (pending or []):
            for msg_id, fields in messages:
                success = await _deliver_notification(
                    fields, tenant_id, msg_id, consumer_group, stream_key, redis
                )
                if success:
                    processed += 1
                else:
                    dlq_count += 1

        # Read new messages
        new_msgs = await redis.xreadgroup(
            groupname=consumer_group,
            consumername=consumer_name,
            streams={stream_key: ">"},
            count=max_messages,
            block=1000,  # 1 second block
        )

        for _stream, messages in (new_msgs or []):
            for msg_id, fields in messages:
                success = await _deliver_notification(
                    fields, tenant_id, msg_id, consumer_group, stream_key, redis
                )
                if success:
                    processed += 1
                else:
                    dlq_count += 1

    except Exception as exc:
        log.error("notification_stream_consumer_error", tenant_id=tenant_id, error=str(exc))
        raise

    return {"processed": processed, "dlq": dlq_count}


# ── Bond Release ──────────────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="app.worker.tasks.payment_tasks.process_bond_release",
    queue="batch",
    max_retries=3,
    default_retry_delay=60,
)
def process_bond_release(
    self,
    reservation_id: str,
    tenant_id: str,
    return_condition: str,
    damage_charge_amount: str,
    agent_id: str,
) -> dict:
    """Bond release: NO_DAMAGE->void, DAMAGE_FOUND->capture, PENDING->skip."""
    return asyncio.get_event_loop().run_until_complete(
        _async_process_bond_release(reservation_id, tenant_id, return_condition, damage_charge_amount, agent_id)
    )


async def _async_process_bond_release(
    reservation_id, tenant_id, return_condition, damage_charge_amount, agent_id
) -> dict:
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import text
    from decimal import Decimal

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT p.payment_id, p.gateway_payment_id, p.gateway, p.amount
                FROM payments p
                WHERE p.reservation_id = CAST(:rid AS uuid)
                  AND CAST(p.payment_type AS text) = 'PRE_AUTH'
                  AND CAST(p.status AS text) = 'AUTHORIZED'
                ORDER BY p.created_at DESC LIMIT 1
            """),
            {"rid": reservation_id},
        )
        payment = result.mappings().first()
        if not payment:
            return {"status": "NO_PREAUTH_FOUND"}

        if return_condition == "NO_DAMAGE":
            await session.execute(
                text("UPDATE payments SET status = 'VOIDED', updated_at = NOW() WHERE payment_id = :pid"),
                {"pid": str(payment["payment_id"])},
            )
            await session.commit()
            try:
                from app.domains.payments.gateway_factory import get_gateway_for_tenant
                gw = await get_gateway_for_tenant(tenant_id, session)
                await gw.void(preauth_id=str(payment["gateway_payment_id"]))
            except NotImplementedError:
                pass  # Tyro not yet configured
            return {"status": "VOIDED"}

        elif return_condition == "DAMAGE_FOUND":
            charge = Decimal(damage_charge_amount)
            capture_amount = min(charge, Decimal(str(payment["amount"])))
            try:
                from app.domains.payments.gateway_factory import get_gateway_for_tenant
                import uuid as _uuid
                gw = await get_gateway_for_tenant(tenant_id, session)
                await gw.capture(
                    preauth_id=str(payment["gateway_payment_id"]),
                    amount=capture_amount,
                    idempotency_key=str(_uuid.uuid4()),
                )
                await session.execute(
                    text("UPDATE payments SET status = 'CAPTURED', updated_at = NOW() WHERE payment_id = :pid"),
                    {"pid": str(payment["payment_id"])},
                )
                await session.commit()
            except NotImplementedError:
                pass
            return {"status": "CAPTURED", "amount": str(capture_amount)}

        return {"status": "PENDING_INSPECTION"}


async def _deliver_notification(
    fields: dict,
    tenant_id: str,
    msg_id: str,
    consumer_group: str,
    stream_key: str,
    redis,
) -> bool:
    """
    Attempt to deliver a single notification.
    Returns True on success (and XACKs), False on failure (after max retries → DLQ).
    """
    from app.core.database import AsyncSessionLocal
    from app.domains.notifications.service import NotificationService

    event_code = fields.get("event_code", "")
    recipient_id = fields.get("recipient_id", "")
    merge_vars_raw = fields.get("merge_vars", "{}")
    channel_override = fields.get("channel_override", "") or None
    channel = channel_override or "EMAIL"  # Default to EMAIL

    try:
        merge_vars = json.loads(merge_vars_raw) if isinstance(merge_vars_raw, str) else {}
    except json.JSONDecodeError:
        merge_vars = {}

    # Resolve recipient address (simplified — real implementation would look up
    # customer email/phone from DB based on recipient_id + channel)
    recipient_address = merge_vars.get("email") or merge_vars.get("phone") or recipient_id

    try:
        async with AsyncSessionLocal() as session:
            service = NotificationService(session)
            await service.render_and_send(
                event_code=event_code,
                recipient_id=recipient_id,
                merge_vars=merge_vars,
                tenant_id=tenant_id,
                channel=channel,
                recipient_address=recipient_address,
            )

        await redis.xack(stream_key, consumer_group, msg_id)
        log.info(
            "notification_delivered",
            event_code=event_code,
            tenant_id=tenant_id,
            msg_id=msg_id,
        )
        return True

    except Exception as exc:
        log.error(
            "notification_delivery_failed",
            event_code=event_code,
            tenant_id=tenant_id,
            msg_id=msg_id,
            error=str(exc),
        )
        # Check delivery attempt count
        pending_info = await redis.xpending_range(
            stream_key, consumer_group, min=msg_id, max=msg_id, count=1
        )
        delivery_count = pending_info[0]["times_delivered"] if pending_info else 1

        if delivery_count >= 3:
            # Move to DLQ after 3 failures
            dlq_key = f"notifications_dlq:{tenant_id}"
            await redis.xadd(dlq_key, {
                **fields,
                "original_msg_id": msg_id,
                "failure_reason": str(exc),
                "delivery_attempts": str(delivery_count),
            }, maxlen=1000)
            await redis.xack(stream_key, consumer_group, msg_id)
            log.error(
                "notification_sent_to_dlq",
                event_code=event_code,
                tenant_id=tenant_id,
                msg_id=msg_id,
                attempts=delivery_count,
            )

        return False
