"""Notifications domain FastAPI router."""
from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.notifications.schemas import (
    DeliveryStatusUpdate,
    DispatchRequest,
    NotificationTemplateCreate,
    NotificationTemplateResponse,
    NotificationTemplateUpdate,
    TestSendRequest,
)
from app.domains.notifications.service import NotificationService

log = structlog.get_logger()

router = APIRouter()


def _get_notification_service(db: AsyncSession = Depends(get_session)) -> NotificationService:
    return NotificationService(db)


# ── Dispatch (internal — SYSTEM role only) ────────────────────────────────────

@router.post("/dispatch", status_code=status.HTTP_202_ACCEPTED)
async def dispatch_notification(
    payload: DispatchRequest,
    claims: UserClaims = Depends(require_permission("notifications", "dispatch")),
    service: NotificationService = Depends(_get_notification_service),
) -> dict:
    """
    Fire-and-forget notification dispatch.
    Pushes to the tenant's Redis Stream; a Celery worker delivers it.
    Internal endpoint — requires SYSTEM_ADMIN or API_PARTNER role.
    """
    from app.core.redis import get_session_redis
    redis = get_session_redis()
    await service.dispatch_notification(payload, redis)
    return {"queued": True, "event_code": payload.event_code}


# ── Template Management ───────────────────────────────────────────────────────

@router.get("/templates", response_model=list[NotificationTemplateResponse])
async def list_templates(
    claims: UserClaims = Depends(require_permission("notifications", "read")),
    service: NotificationService = Depends(_get_notification_service),
) -> list[NotificationTemplateResponse]:
    """List all notification templates visible to this tenant."""
    templates = await service.list_templates(str(claims.tenant_id))
    return [NotificationTemplateResponse.model_validate(t) for t in templates]


@router.post(
    "/templates",
    response_model=NotificationTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_template(
    payload: NotificationTemplateCreate,
    claims: UserClaims = Depends(require_permission("notifications", "manage")),
    service: NotificationService = Depends(_get_notification_service),
) -> NotificationTemplateResponse:
    """Create a new notification template for this tenant."""
    template = await service.create_template(payload, str(claims.tenant_id))
    return NotificationTemplateResponse.model_validate(template)


@router.get("/templates/{template_id}", response_model=NotificationTemplateResponse)
async def get_template(
    template_id: UUID,
    claims: UserClaims = Depends(require_permission("notifications", "read")),
    service: NotificationService = Depends(_get_notification_service),
) -> NotificationTemplateResponse:
    """Get a notification template with rendered preview."""
    template = await service.get_template(str(template_id), str(claims.tenant_id))
    return NotificationTemplateResponse.model_validate(template)


@router.put("/templates/{template_id}", response_model=NotificationTemplateResponse)
async def update_template(
    template_id: UUID,
    payload: NotificationTemplateUpdate,
    claims: UserClaims = Depends(require_permission("notifications", "manage")),
    service: NotificationService = Depends(_get_notification_service),
) -> NotificationTemplateResponse:
    """Update a tenant notification template."""
    template = await service.update_template(str(template_id), payload, str(claims.tenant_id))
    return NotificationTemplateResponse.model_validate(template)


@router.post("/templates/{template_id}/test-send", response_model=dict)
async def test_send(
    template_id: UUID,
    payload: TestSendRequest,
    claims: UserClaims = Depends(require_permission("notifications", "manage")),
    service: NotificationService = Depends(_get_notification_service),
) -> dict:
    """Render template with sample data and send a test message."""
    return await service.test_send(str(template_id), payload, str(claims.tenant_id))


# ── Delivery Webhooks (public — signature-verified) ───────────────────────────

@router.post(
    "/sendgrid-webhook",
    status_code=status.HTTP_200_OK,
    include_in_schema=True,
)
async def sendgrid_webhook(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """
    SendGrid delivery event webhook.
    Receives delivery status updates (DELIVERED, BOUNCED, FAILED).

    Production: verify SendGrid Event Webhook Signature before processing.
    https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
    """
    body = await request.json()
    service = NotificationService(db)

    if isinstance(body, list):
        events = body
    else:
        events = [body]

    for event in events:
        sg_event_type = event.get("event", "")
        msg_id = event.get("sg_message_id", "").split(".")[0]  # Strip suffix
        if not msg_id:
            continue

        status_map = {
            "delivered": "DELIVERED",
            "bounce": "BOUNCED",
            "dropped": "FAILED",
            "spamreport": "FAILED",
            "unsubscribe": "FAILED",
        }
        delivery_status = status_map.get(sg_event_type)
        if delivery_status:
            update = DeliveryStatusUpdate(
                external_message_id=msg_id,
                status=delivery_status,
                failure_reason=event.get("reason") or event.get("type"),
            )
            await service.update_delivery_status(update)

    return {"processed": len(events)}


@router.post(
    "/twilio-webhook",
    status_code=status.HTTP_200_OK,
    include_in_schema=True,
)
async def twilio_webhook(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """
    Twilio SMS delivery status webhook.
    Receives status callbacks for sent SMS messages.

    Production: verify X-Twilio-Signature before processing.
    https://www.twilio.com/docs/usage/webhooks/webhooks-security
    """
    form_data = await request.form()
    msg_sid = form_data.get("MessageSid", "")
    sms_status = str(form_data.get("MessageStatus", "")).upper()

    if not msg_sid:
        return {"processed": 0}

    status_map = {
        "DELIVERED": "DELIVERED",
        "FAILED": "FAILED",
        "UNDELIVERED": "FAILED",
    }
    delivery_status = status_map.get(sms_status)
    if delivery_status:
        service = NotificationService(db)
        update = DeliveryStatusUpdate(
            external_message_id=str(msg_sid),
            status=delivery_status,
            failure_reason=form_data.get("ErrorMessage"),
        )
        await service.update_delivery_status(update)

    return {"processed": 1}
