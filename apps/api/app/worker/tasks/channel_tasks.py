"""OTA channel polling and availability sync Celery tasks."""
from __future__ import annotations
import asyncio
import structlog
from app.worker.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(
    bind=True, name="app.worker.tasks.channel_tasks.poll_ota_channels",
    queue="batch", max_retries=2, default_retry_delay=120,
)
def poll_ota_channels(self) -> dict:
    return asyncio.get_event_loop().run_until_complete(_async_poll_ota_channels())


async def _async_poll_ota_channels() -> dict:
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import text
    polled = 0
    errors = 0
    leads_found = 0

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT channel_id, tenant_id, channel_name, api_key, api_secret, property_id, last_polled_at FROM ota_channels WHERE is_active = TRUE AND webhook_enabled = FALSE"),
        )
        channels = result.mappings().all()

    for ch in channels:
        try:
            channel = _build_channel(dict(ch))
            leads = await channel.poll_new_leads(since=ch["last_polled_at"])
            await _upsert_leads(leads, str(ch["tenant_id"]))
            await _update_last_polled(str(ch["channel_id"]))
            leads_found += len(leads)
            polled += 1
        except NotImplementedError:
            log.warning("ota_channel_not_implemented", channel=ch["channel_name"])
        except Exception as exc:
            log.error("ota_channel_poll_error", channel=ch["channel_name"], error=str(exc))
            errors += 1

    return {"polled": polled, "leads_found": leads_found, "errors": errors}


def _build_channel(ch: dict):
    from app.integrations.channels.booking_com_channel import BookingComChannel
    from app.integrations.channels.expedia_channel import ExpediaChannel
    name = ch["channel_name"]
    if name == "BOOKING_COM":
        return BookingComChannel(ch["api_key"], ch["api_secret"], ch["property_id"])
    if name == "EXPEDIA":
        return ExpediaChannel(ch["api_key"], ch["api_secret"], ch["property_id"])
    raise ValueError(f"Unknown channel: {name}")


async def _upsert_leads(leads, tenant_id: str) -> None:
    if not leads:
        return
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import text
    import uuid
    import json
    async with AsyncSessionLocal() as session:
        for lead in leads:
            await session.execute(
                text("""
                    INSERT INTO ota_leads (lead_id, tenant_id, channel_name, ota_booking_ref,
                      customer_name, customer_email, customer_phone, pickup_date, return_date,
                      vehicle_class_requested, raw_payload, received_at)
                    VALUES (:lid, :tid, :channel, :ref, :name, :email, :phone, :pickup, :return_d, :class_r, :payload, :recv)
                    ON CONFLICT (tenant_id, channel_name, ota_booking_ref) DO NOTHING
                """),
                {
                    "lid": str(uuid.uuid4()), "tid": tenant_id,
                    "channel": lead.channel_name, "ref": lead.ota_booking_ref,
                    "name": lead.customer_name, "email": lead.customer_email,
                    "phone": lead.customer_phone, "pickup": lead.pickup_date,
                    "return_d": lead.return_date, "class_r": lead.vehicle_class_requested,
                    "payload": json.dumps(lead.raw_payload), "recv": lead.received_at,
                },
            )
        await session.commit()


async def _update_last_polled(channel_id: str) -> None:
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as session:
        await session.execute(
            text("UPDATE ota_channels SET last_polled_at = NOW() WHERE channel_id = :cid"),
            {"cid": channel_id},
        )
        await session.commit()


@celery_app.task(
    bind=True, name="app.worker.tasks.channel_tasks.push_availability_to_all_channels",
    queue="batch", max_retries=3, default_retry_delay=60,
)
def push_availability_to_all_channels(
    self, tenant_id: str, date_from: str, date_to: str, vehicle_class_id: str, available_count: int,
) -> dict:
    return asyncio.get_event_loop().run_until_complete(
        _async_push_availability(tenant_id, date_from, date_to, vehicle_class_id, available_count)
    )


async def _async_push_availability(tenant_id, date_from, date_to, vehicle_class_id, available_count) -> dict:
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import text
    from datetime import date as date_type
    pushed = 0
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT channel_id, channel_name, api_key, api_secret, property_id FROM ota_channels WHERE tenant_id = :tid AND is_active = TRUE"),
            {"tid": tenant_id},
        )
        channels = result.mappings().all()
    d_from = date_type.fromisoformat(date_from)
    d_to = date_type.fromisoformat(date_to)
    for ch in channels:
        try:
            channel = _build_channel(dict(ch))
            await channel.push_availability(d_from, d_to, vehicle_class_id, available_count)
            pushed += 1
        except NotImplementedError:
            log.warning("ota_push_avail_stub", channel=ch["channel_name"])
        except Exception as exc:
            log.error("ota_push_avail_error", channel=ch["channel_name"], error=str(exc))
    return {"pushed": pushed}
