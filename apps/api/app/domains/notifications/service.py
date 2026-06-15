"""
Notification domain service.

Dispatch is fire-and-forget via Redis Streams (XADD).
Rendering and sending is performed by the Celery worker consuming the stream.
Notification bodies are NEVER stored in the DB — only their SHA-256 hashes (GDPR).
"""
from __future__ import annotations

import hashlib
import json
import structlog
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from jinja2 import Environment, StrictUndefined, TemplateError
from redis.asyncio import Redis
from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError, ValidationError
from app.core.redis import NOTIFICATION_STREAM, get_session_redis
from app.domains.notifications.models import NotificationLog, NotificationTemplate
from app.domains.notifications.schemas import (
    DeliveryStatusUpdate,
    DispatchRequest,
    NotificationTemplateCreate,
    NotificationTemplateResponse,
    NotificationTemplateUpdate,
    TestSendRequest,
)

log = structlog.get_logger()

# Jinja2 environment for template rendering — strict undefined raises on missing vars
_jinja_env = Environment(undefined=StrictUndefined, autoescape=True)


class NotificationService:
    """
    Two responsibilities:
      1. dispatch_notification() — fast path; pushes to Redis Stream.
      2. render_and_send()       — called by Celery worker; does the actual delivery.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Dispatch (fast path — fire-and-forget) ────────────────────────────────

    async def dispatch_notification(
        self,
        request: DispatchRequest,
        redis: Optional[Redis] = None,
    ) -> None:
        """
        Push a notification request onto the tenant's Redis Stream.
        Returns immediately; a Celery worker handles rendering and delivery.
        """
        if redis is None:
            redis = get_session_redis()

        message = {
            "event_code": request.event_code,
            "recipient_id": request.recipient_id,
            "merge_vars": json.dumps(request.merge_vars),
            "tenant_id": str(request.tenant_id),
            "channel_override": request.channel_override or "",
        }

        stream_key = NOTIFICATION_STREAM.format(tenant_id=str(request.tenant_id))
        await redis.xadd(stream_key, message, maxlen=10000)  # type: ignore[arg-type]
        log.info(
            "notification_dispatched",
            event_code=request.event_code,
            tenant_id=str(request.tenant_id),
            recipient_id=request.recipient_id,
        )

    # ── Render and Send (Celery worker path) ──────────────────────────────────

    async def render_and_send(
        self,
        event_code: str,
        recipient_id: str,
        merge_vars: dict[str, Any],
        tenant_id: str,
        channel: str,
        recipient_address: str,
    ) -> None:
        """
        Look up the template, render with Jinja2, send via appropriate integration,
        and write a NotificationLog record (body hash only, NOT body text — GDPR).

        Called by the Celery worker after consuming from the Redis Stream.
        """
        from app.integrations.sendgrid_client import SendGridClient
        from app.integrations.twilio_client import TwilioClient

        template = await self._get_template(event_code, tenant_id, channel)
        if template is None:
            log.warning(
                "notification_no_template",
                event_code=event_code,
                channel=channel,
                tenant_id=tenant_id,
            )
            return

        # Render Jinja2 template
        try:
            body_template = template.body_html or template.body_text or ""
            rendered_body = _jinja_env.from_string(body_template).render(**merge_vars)
        except TemplateError as exc:
            log.error(
                "notification_render_failed",
                event_code=event_code,
                error=str(exc),
            )
            await self._write_log(
                tenant_id=tenant_id,
                event_code=event_code,
                channel=channel,
                recipient=recipient_address,
                subject=template.subject,
                body_hash=None,
                status="FAILED",
                gateway_msg_id=None,
                failure_reason=str(exc),
            )
            return

        body_hash = hashlib.sha256(rendered_body.encode()).hexdigest()
        gateway_msg_id: Optional[str] = None
        status = "FAILED"
        failure_reason: Optional[str] = None

        try:
            if channel == "EMAIL":
                subject = template.subject or event_code
                if template.body_html:
                    rendered_subject = _jinja_env.from_string(subject).render(**merge_vars)
                    rendered_html = _jinja_env.from_string(template.body_html).render(**merge_vars)
                else:
                    rendered_subject = subject
                    rendered_html = rendered_body

                client = SendGridClient()
                await client.send_email(
                    to_email=recipient_address,
                    subject=rendered_subject,
                    html_body=rendered_html,
                )
                status = "SENT"

            elif channel == "SMS":
                client_twilio = TwilioClient()
                sid = await client_twilio.send_sms(
                    to_phone_e164=recipient_address,
                    body=rendered_body[:1600],
                )
                gateway_msg_id = sid
                status = "SENT"

            else:
                # PUSH and other channels not yet implemented
                log.info("notification_channel_not_implemented", channel=channel)
                status = "FAILED"
                failure_reason = f"Channel '{channel}' not yet implemented."

        except Exception as exc:
            log.error(
                "notification_send_failed",
                event_code=event_code,
                channel=channel,
                error=str(exc),
            )
            failure_reason = str(exc)

        await self._write_log(
            tenant_id=tenant_id,
            event_code=event_code,
            channel=channel,
            recipient=recipient_address,
            subject=template.subject,
            body_hash=body_hash,
            status=status,
            gateway_msg_id=gateway_msg_id,
            failure_reason=failure_reason,
        )

    # ── Delivery Status Update (webhook from SendGrid/Twilio) ─────────────────

    async def update_delivery_status(self, update_data: DeliveryStatusUpdate) -> None:
        """
        Update NotificationLog.status from a delivery webhook callback.
        Matched by gateway_msg_id.
        """
        await self._session.execute(
            update(NotificationLog)
            .where(NotificationLog.gateway_msg_id == update_data.external_message_id)
            .values(
                status=update_data.status,
                sent_at=datetime.now(timezone.utc) if update_data.status == "DELIVERED" else None,
            )
        )
        await self._session.commit()

    # ── Template Management ───────────────────────────────────────────────────

    async def list_templates(self, tenant_id: str) -> list[NotificationTemplate]:
        """Return all templates visible to this tenant (own + system defaults)."""
        result = await self._session.execute(
            select(NotificationTemplate).where(
                and_(
                    NotificationTemplate.is_active.is_(True),
                    # tenant-specific OR system-wide (tenant_id IS NULL)
                    (NotificationTemplate.tenant_id == tenant_id)
                    | (NotificationTemplate.tenant_id.is_(None)),
                )
            )
        )
        return list(result.scalars().all())

    async def create_template(
        self, data: NotificationTemplateCreate, tenant_id: str
    ) -> NotificationTemplate:
        template = NotificationTemplate(
            template_id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            event_code=data.event_code,
            channel=data.channel,
            subject=data.subject,
            body_html=data.body_html,
            body_text=data.body_text,
            merge_variables=data.merge_variables or [],
            is_active=data.is_active,
        )
        self._session.add(template)
        await self._session.commit()
        await self._session.refresh(template)
        return template

    async def get_template(self, template_id: str, tenant_id: str) -> NotificationTemplate:
        result = await self._session.execute(
            select(NotificationTemplate).where(
                and_(
                    NotificationTemplate.template_id == template_id,
                    (NotificationTemplate.tenant_id == tenant_id)
                    | (NotificationTemplate.tenant_id.is_(None)),
                )
            )
        )
        tmpl = result.scalar_one_or_none()
        if tmpl is None:
            raise ResourceNotFoundError("notification_templates", template_id)
        return tmpl

    async def update_template(
        self, template_id: str, data: NotificationTemplateUpdate, tenant_id: str
    ) -> NotificationTemplate:
        tmpl = await self.get_template(template_id, tenant_id)
        update_values = data.model_dump(exclude_none=True)
        if update_values:
            update_values["updated_at"] = datetime.now(timezone.utc)
            await self._session.execute(
                update(NotificationTemplate)
                .where(NotificationTemplate.template_id == template_id)
                .values(**update_values)
            )
            await self._session.commit()
        return await self.get_template(template_id, tenant_id)

    async def test_send(
        self,
        template_id: str,
        data: TestSendRequest,
        tenant_id: str,
    ) -> dict:
        """Render template with sample_data and send to test address."""
        tmpl = await self.get_template(template_id, tenant_id)
        body_template = tmpl.body_html or tmpl.body_text or ""
        try:
            rendered = _jinja_env.from_string(body_template).render(**data.sample_data)
        except TemplateError as exc:
            raise ValidationError(f"Template render error: {exc}")

        result = {"rendered_body": rendered, "sent": False, "error": None}
        try:
            if tmpl.channel == "EMAIL" and data.recipient_email:
                from app.integrations.sendgrid_client import SendGridClient
                client = SendGridClient()
                await client.send_email(
                    to_email=data.recipient_email,
                    subject=tmpl.subject or f"[TEST] {tmpl.event_code}",
                    html_body=rendered,
                )
                result["sent"] = True
            elif tmpl.channel == "SMS" and data.recipient_phone:
                from app.integrations.twilio_client import TwilioClient
                client_t = TwilioClient()
                sid = await client_t.send_sms(
                    to_phone_e164=data.recipient_phone,
                    body=rendered[:1600],
                )
                result["sent"] = True
                result["gateway_msg_id"] = sid
        except Exception as exc:
            result["error"] = str(exc)

        return result

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _get_template(
        self, event_code: str, tenant_id: str, channel: str
    ) -> Optional[NotificationTemplate]:
        """
        Lookup priority: tenant-specific first, then system default.
        """
        # Try tenant-specific template first
        result = await self._session.execute(
            select(NotificationTemplate).where(
                and_(
                    NotificationTemplate.event_code == event_code,
                    NotificationTemplate.channel == channel,
                    NotificationTemplate.tenant_id == tenant_id,
                    NotificationTemplate.is_active.is_(True),
                )
            )
        )
        tmpl = result.scalar_one_or_none()
        if tmpl is not None:
            return tmpl

        # Fall back to system-wide template
        result = await self._session.execute(
            select(NotificationTemplate).where(
                and_(
                    NotificationTemplate.event_code == event_code,
                    NotificationTemplate.channel == channel,
                    NotificationTemplate.tenant_id.is_(None),
                    NotificationTemplate.is_active.is_(True),
                )
            )
        )
        return result.scalar_one_or_none()

    async def _write_log(
        self,
        tenant_id: str,
        event_code: str,
        channel: str,
        recipient: str,
        subject: Optional[str],
        body_hash: Optional[str],
        status: str,
        gateway_msg_id: Optional[str],
        failure_reason: Optional[str] = None,
    ) -> None:
        """Write a NotificationLog row (body_hash only — GDPR)."""
        now = datetime.now(timezone.utc)
        log_entry = NotificationLog(
            log_id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            event_code=event_code,
            channel=channel,
            recipient=recipient,
            subject=subject,
            body_hash=body_hash,
            status=status,
            gateway_msg_id=gateway_msg_id,
            sent_at=now if status == "SENT" else None,
            created_at=now,
        )
        if failure_reason:
            # Store truncated failure reason in subject field (no PII concern)
            log_entry.subject = (subject or "") + f" [ERR: {failure_reason[:100]}]"

        self._session.add(log_entry)
        await self._session.commit()
