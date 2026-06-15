"""Notifications domain Pydantic v2 schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Request schemas ───────────────────────────────────────────────────────────

class DispatchRequest(BaseModel):
    """
    Fire-and-forget notification dispatch.
    Pushes a message to the Redis Stream; a Celery worker delivers it.
    """
    event_code: str = Field(description="e.g. RESERVATION_CONFIRMED, PAYMENT_AUTHORIZED")
    recipient_id: str = Field(description="customer_id or staff_user_id (UUID string)")
    tenant_id: UUID
    channel_override: Optional[str] = Field(
        default=None,
        description="Override channel: EMAIL | SMS | PUSH. Uses template default if omitted.",
    )
    merge_vars: dict[str, Any] = Field(
        default_factory=dict,
        description="Jinja2 template variables",
    )


class NotificationTemplateCreate(BaseModel):
    """Body for POST /notifications/templates."""
    event_code: str
    channel: str = Field(description="EMAIL | SMS | PUSH")
    subject: Optional[str] = Field(default=None, max_length=255)
    body_html: Optional[str] = Field(default=None)
    body_text: Optional[str] = Field(default=None)
    merge_variables: list[str] = Field(default_factory=list)
    is_active: bool = True


class NotificationTemplateUpdate(BaseModel):
    """Body for PUT /notifications/templates/{id}."""
    subject: Optional[str] = Field(default=None, max_length=255)
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    merge_variables: Optional[list[str]] = None
    is_active: Optional[bool] = None


class DeliveryStatusUpdate(BaseModel):
    """
    Inbound webhook from SendGrid or Twilio reporting delivery status.
    Used by POST /notifications/sendgrid-webhook and /notifications/twilio-webhook.
    """
    external_message_id: str
    status: str = Field(description="DELIVERED | FAILED | BOUNCED")
    failure_reason: Optional[str] = None


class TestSendRequest(BaseModel):
    """Body for POST /notifications/templates/{id}/test-send."""
    recipient_email: Optional[str] = None
    recipient_phone: Optional[str] = None
    sample_data: dict[str, Any] = Field(default_factory=dict)


# ── Response schemas ──────────────────────────────────────────────────────────

class NotificationTemplateResponse(BaseModel):
    """Full template response."""
    model_config = {"from_attributes": True}

    template_id: UUID
    tenant_id: Optional[UUID] = None
    event_code: str
    channel: str
    subject: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    merge_variables: Optional[list[str]] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
