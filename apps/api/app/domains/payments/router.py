"""Payments domain FastAPI router."""
from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.payments.schemas import (
    CaptureRequest,
    CaptureResponse,
    InitiatePreAuthRequest,
    PaymentResponse,
    PreAuthResponse,
    RefundRequest,
    VoidRequest,
)
from app.domains.payments.service import PaymentService
from app.integrations.stripe_client import StripeClient

log = structlog.get_logger()

router = APIRouter()


def _get_payment_service(db: AsyncSession = Depends(get_session)) -> PaymentService:
    return PaymentService(db)


# ── Pre-Authorization ─────────────────────────────────────────────────────────

@router.post("/pre-auth", response_model=PreAuthResponse, status_code=status.HTTP_201_CREATED)
async def initiate_pre_auth(
    payload: InitiatePreAuthRequest,
    claims: UserClaims = Depends(require_permission("payments", "create")),
    service: PaymentService = Depends(_get_payment_service),
) -> PreAuthResponse:
    """Create a Stripe PaymentIntent pre-authorization hold."""
    return await service.initiate_pre_auth(payload, str(claims.tenant_id))


# ── Capture ───────────────────────────────────────────────────────────────────

@router.post("/capture", response_model=CaptureResponse)
async def capture_payment(
    payload: CaptureRequest,
    claims: UserClaims = Depends(require_permission("payments", "create")),
    service: PaymentService = Depends(_get_payment_service),
) -> CaptureResponse:
    """Capture a pre-authorized payment using the final rental total."""
    return await service.capture_payment(payload, str(claims.tenant_id))


# ── Void ─────────────────────────────────────────────────────────────────────

@router.post("/void", status_code=status.HTTP_204_NO_CONTENT)
async def void_payment(
    payload: VoidRequest,
    claims: UserClaims = Depends(require_permission("payments", "manage")),
    service: PaymentService = Depends(_get_payment_service),
) -> None:
    """Cancel an AUTHORIZED payment intent."""
    await service.void_payment(payload, str(claims.tenant_id))


# ── Refund ────────────────────────────────────────────────────────────────────

@router.post("/refund", response_model=PaymentResponse)
async def process_refund(
    payload: RefundRequest,
    claims: UserClaims = Depends(require_permission("payments", "refund")),
    service: PaymentService = Depends(_get_payment_service),
) -> PaymentResponse:
    """
    Process a refund against a captured payment.
    Refunds > $500 are queued for manager approval.
    """
    payment = await service.process_refund(payload, str(claims.tenant_id))
    return PaymentResponse.model_validate(payment)


# ── Read ──────────────────────────────────────────────────────────────────────

@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment(
    payment_id: UUID,
    claims: UserClaims = Depends(require_permission("payments", "read")),
    service: PaymentService = Depends(_get_payment_service),
) -> PaymentResponse:
    """Retrieve a single payment record."""
    payment = await service.get_payment(str(payment_id), str(claims.tenant_id))
    return PaymentResponse.model_validate(payment)


@router.get("/reservation/{reservation_id}", response_model=list[PaymentResponse])
async def list_payments_for_reservation(
    reservation_id: UUID,
    claims: UserClaims = Depends(require_permission("payments", "read")),
    service: PaymentService = Depends(_get_payment_service),
) -> list[PaymentResponse]:
    """List all payments for a reservation."""
    payments = await service.list_by_reservation(str(reservation_id), str(claims.tenant_id))
    return [PaymentResponse.model_validate(p) for p in payments]


# ── Stripe Webhook (public — no auth cookie required) ─────────────────────────

@router.post(
    "/stripe-webhook",
    status_code=status.HTTP_200_OK,
    include_in_schema=True,
)
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_session),
    stripe_signature: str = Header(default="", alias="stripe-signature"),
) -> dict:
    """
    Stripe webhook endpoint.
    Signature is verified BEFORE any processing.
    This endpoint is PUBLIC (no JWT auth) — security is the Stripe-Signature HMAC.
    """
    raw_body = await request.body()

    stripe_client = StripeClient()
    from app.core.config import settings
    try:
        event = stripe_client.construct_webhook_event(
            payload=raw_body,
            sig_header=stripe_signature,
            webhook_secret=settings.stripe_webhook_secret.get_secret_value(),
        )
    except Exception as exc:
        log.warning("stripe_webhook_invalid_signature", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe webhook signature.",
        )

    # Tenant resolution: Stripe embeds tenant_id in PaymentIntent metadata
    tenant_id = ""
    try:
        if hasattr(event, "data") and hasattr(event.data, "object"):
            meta = getattr(event.data.object, "metadata", {}) or {}
            tenant_id = meta.get("tenant_id", "")
    except Exception:
        pass

    if not tenant_id:
        log.warning("stripe_webhook_no_tenant_id", event_id=getattr(event, "id", "unknown"))
        return {"received": True}

    event_id = getattr(event, "id", "")
    event_type = getattr(event, "type", "")
    obj = getattr(getattr(event, "data", None), "object", {})
    payload_dict = dict(obj) if obj else {}

    service = PaymentService(db)
    await service.handle_stripe_webhook(event_id, event_type, payload_dict, tenant_id)

    return {"received": True}
