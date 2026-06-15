"""
Stripe integration client.

Uses the official Stripe Python SDK (not raw HTTP) per ARCH_PLATFORM.md.
Circuit breaker is applied at the SDK call level.
"""
from __future__ import annotations

from typing import Any

import stripe
import structlog

from app.core.exceptions import IntegrationCircuitOpenError, StripeError
from app.integrations.base import CircuitBreaker

log = structlog.get_logger()


class StripeClient:
    """
    Wraps the Stripe Python SDK with circuit-breaker protection.

    Stripe SDK is synchronous; we call it directly (not via httpx).
    The circuit breaker tracks consecutive failures and opens after 5.
    """

    def __init__(self) -> None:
        from app.core.config import settings
        stripe.api_key = settings.stripe_secret_key.get_secret_value()
        self.circuit = CircuitBreaker(
            integration_name="stripe",
            failure_threshold=5,
            recovery_timeout=60,
        )

    async def _guard(self) -> None:
        """Raise IntegrationCircuitOpenError if the circuit is OPEN."""
        if not await self.circuit.allow_request():
            raise IntegrationCircuitOpenError("stripe")

    async def create_payment_intent(
        self,
        amount_cents: int,
        currency: str,
        capture_method: str = "manual",
        payment_method_id: str | None = None,
        metadata: dict | None = None,
        confirm: bool = True,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a Stripe PaymentIntent.
        capture_method='manual' → pre-authorization hold only.
        confirm=True → immediately confirm (requires payment_method).
        """
        await self._guard()
        kwargs: dict[str, Any] = {
            "amount": amount_cents,
            "currency": currency.lower(),
            "capture_method": capture_method,
            "metadata": metadata or {},
        }
        if payment_method_id:
            kwargs["payment_method"] = payment_method_id
        if confirm:
            kwargs["confirm"] = True
            kwargs["automatic_payment_methods"] = {"enabled": True, "allow_redirects": "never"}

        create_kwargs: dict[str, Any] = {}
        if idempotency_key:
            create_kwargs["idempotency_key"] = idempotency_key

        try:
            intent = stripe.PaymentIntent.create(**kwargs, **create_kwargs)
            await self.circuit.record_success()
            return dict(intent)
        except stripe.error.StripeError as exc:
            await self.circuit.record_failure()
            raise StripeError(
                stripe_code=exc.code or "unknown",
                detail=exc.user_message or str(exc),
            ) from exc

    async def capture_payment_intent(
        self,
        payment_intent_id: str,
        amount_to_capture_cents: int | None = None,
    ) -> dict[str, Any]:
        """
        Capture a previously authorized PaymentIntent.
        Partial captures are supported via amount_to_capture_cents.
        """
        await self._guard()
        try:
            kwargs: dict[str, Any] = {}
            if amount_to_capture_cents is not None:
                kwargs["amount_to_capture"] = amount_to_capture_cents
            result = stripe.PaymentIntent.capture(payment_intent_id, **kwargs)
            await self.circuit.record_success()
            return dict(result)
        except stripe.error.StripeError as exc:
            await self.circuit.record_failure()
            raise StripeError(
                stripe_code=exc.code or "unknown",
                detail=exc.user_message or str(exc),
            ) from exc

    async def cancel_payment_intent(self, payment_intent_id: str) -> dict[str, Any]:
        """Cancel an uncaptured PaymentIntent (void)."""
        await self._guard()
        try:
            result = stripe.PaymentIntent.cancel(payment_intent_id)
            await self.circuit.record_success()
            return dict(result)
        except stripe.error.StripeError as exc:
            await self.circuit.record_failure()
            raise StripeError(
                stripe_code=exc.code or "unknown",
                detail=exc.user_message or str(exc),
            ) from exc

    async def create_refund(
        self,
        charge_id: str,
        amount_cents: int | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a Stripe Refund against a captured charge.
        Partial refunds are supported via amount_cents.
        """
        await self._guard()
        try:
            kwargs: dict[str, Any] = {"charge": charge_id}
            if amount_cents is not None:
                kwargs["amount"] = amount_cents
            if reason:
                # Stripe accepts: duplicate, fraudulent, requested_by_customer
                kwargs["reason"] = "requested_by_customer"
                kwargs["metadata"] = {"reason_detail": reason[:255]}
            result = stripe.Refund.create(**kwargs)
            await self.circuit.record_success()
            return dict(result)
        except stripe.error.StripeError as exc:
            await self.circuit.record_failure()
            raise StripeError(
                stripe_code=exc.code or "unknown",
                detail=exc.user_message or str(exc),
            ) from exc

    async def create_incremental_auth(
        self,
        payment_intent_id: str,
        new_amount_cents: int,
    ) -> dict[str, Any]:
        """
        Incremental authorization — increase an existing pre-auth amount.
        Used for MCC 7512 (car rental) extended pre-auth chains.
        The response contains network_transaction_id for subsequent chain links.
        """
        await self._guard()
        try:
            result = stripe.PaymentIntent.increment_authorization(
                payment_intent_id,
                amount=new_amount_cents,
            )
            await self.circuit.record_success()
            return dict(result)
        except stripe.error.StripeError as exc:
            await self.circuit.record_failure()
            raise StripeError(
                stripe_code=exc.code or "unknown",
                detail=exc.user_message or str(exc),
            ) from exc

    def construct_webhook_event(
        self,
        payload: bytes,
        sig_header: str,
        webhook_secret: str,
    ) -> stripe.Event:
        """
        Verify Stripe webhook signature and return parsed Event.
        Raises stripe.error.SignatureVerificationError on mismatch.
        This is a synchronous call (no network I/O) — no circuit breaker needed.
        """
        return stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=webhook_secret,
        )
