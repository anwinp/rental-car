"""Stripe calls made on a *tenant's* merchant account.

This replaces the module-global credential in the old `StripeClient`, which
did:

    stripe.api_key = settings.stripe_secret_key      # process-global

That is safe only while every charge in the system belongs to the same Stripe
account. The moment credentials become per-tenant it is a cross-tenant money
bug: `stripe.api_key` is one variable shared by the whole process, so two
concurrent requests race and tenant B's key can be in place when tenant A's
charge goes out. The charge succeeds — against the wrong company's account.
Nothing in the response says so.

So the credential is never module state here. Each instance builds its own
`stripe.StripeClient`, and the key travels with the call.

Two other things change as a consequence.

**Calls are awaited.** The old client invoked the synchronous SDK from `async`
methods, which blocks the event loop for the duration of a network round trip
to Stripe — under load that stalls every other request on the worker. The
per-instance client exposes `*_async` variants, so this actually awaits.

**`stripe_account` is plumbed through but unused.** Phase 1 charges on the
tenant's connected account by setting it; passing it here from the start means
that change is a constructor argument rather than a rewrite. See
PAYMENTS_STRATEGY.md §3 for why the charge must land on their account and not
ours.

Named `StripeMerchantApi`, not `StripeClient`, because the SDK now has a class
of that name and shadowing it is how the old code read as if it were using one.
"""
from __future__ import annotations

from typing import Any

import stripe
import structlog

from app.core.exceptions import IntegrationCircuitOpenError, StripeError
from app.integrations.base import CircuitBreaker

log = structlog.get_logger()


class StripeMerchantApi:
    """Stripe, bound to one set of credentials for the life of the instance."""

    def __init__(self, *, api_key: str, stripe_account: str | None = None) -> None:
        if not api_key:
            raise ValueError("StripeMerchantApi requires an API key.")
        # Per-instance. Never assigned to the `stripe` module.
        self._stripe = stripe.StripeClient(api_key=api_key)
        self._stripe_account = stripe_account
        self.circuit = CircuitBreaker(
            integration_name="stripe",
            failure_threshold=5,
            recovery_timeout=60,
        )

    # ── plumbing ─────────────────────────────────────────────────────────────

    def _options(self, idempotency_key: str | None = None) -> dict[str, Any]:
        """Per-request options: which account, and the idempotency key.

        `stripe_account` is what makes a charge land on the connected account
        rather than the one owning the API key.
        """
        opts: dict[str, Any] = {}
        if self._stripe_account:
            opts["stripe_account"] = self._stripe_account
        if idempotency_key:
            opts["idempotency_key"] = idempotency_key
        return opts

    async def _guard(self) -> None:
        if not await self.circuit.allow_request():
            raise IntegrationCircuitOpenError("stripe")

    def _translate(self, exc: Exception) -> StripeError:
        code = getattr(exc, "code", None) or "unknown"
        message = getattr(exc, "user_message", None) or str(exc)
        return StripeError(stripe_code=code, detail=message)

    # ── operations ───────────────────────────────────────────────────────────

    async def create_payment_intent(
        self,
        amount_cents: int,
        currency: str,
        capture_method: str = "manual",
        payment_method_id: str | None = None,
        metadata: dict | None = None,
        confirm: bool = True,
        idempotency_key: str | None = None,
        rental_hold: bool = False,
    ) -> dict[str, Any]:
        """capture_method='manual' → an authorisation hold, not a charge.

        `rental_hold` asks the card networks for the two things a vehicle rental
        needs and an ordinary sale does not: a validity window longer than the
        default seven days, and permission to raise the amount later when a
        rental is extended. Both are requested `if_available` — an issuer may
        refuse, and the response says which were granted.
        """
        await self._guard()
        params: dict[str, Any] = {
            "amount": amount_cents,
            "currency": currency.lower(),
            "capture_method": capture_method,
            "metadata": metadata or {},
            # Without this the charge comes back as an id and the authorisation
            # deadline — which lives on the charge — cannot be read.
            "expand": ["latest_charge"],
        }
        if payment_method_id:
            params["payment_method"] = payment_method_id
        if confirm:
            params["confirm"] = True
            params["automatic_payment_methods"] = {
                "enabled": True, "allow_redirects": "never",
            }

        rental_options = {
            "card": {
                "request_extended_authorization": "if_available",
                "request_incremental_authorization": "if_available",
            }
        }
        try:
            intent = await self._stripe.payment_intents.create_async(
                {**params, "payment_method_options": rental_options}
                if rental_hold else params,
                options=self._options(idempotency_key),
            )
            await self.circuit.record_success()
            return dict(intent)
        except stripe.StripeError as exc:
            # Asking for card features the account cannot use rejects the whole
            # PaymentIntent — no hold at all, which is worse than a short one.
            # Eligibility depends on the account's pricing plan and category, so
            # it cannot be known from here; the honest move is to ask, and fall
            # back to an ordinary hold when the answer is no.
            #
            # A fresh idempotency key is required: Stripe refuses to reuse one
            # with different parameters.
            if rental_hold and "not eligible for the requested card features" in str(exc):
                log.info("rental_hold_features_unavailable",
                         detail="account cannot use extended or incremental "
                                "authorisation; falling back to a standard hold")
                try:
                    intent = await self._stripe.payment_intents.create_async(
                        params,
                        options=self._options(
                            f"{idempotency_key}:basic" if idempotency_key else None
                        ),
                    )
                    await self.circuit.record_success()
                    return dict(intent)
                except stripe.StripeError as retry_exc:
                    await self.circuit.record_failure()
                    raise self._translate(retry_exc) from retry_exc
            await self.circuit.record_failure()
            raise self._translate(exc) from exc

    async def capture_payment_intent(
        self,
        payment_intent_id: str,
        amount_to_capture_cents: int | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Capture an authorisation, optionally for less than was held."""
        await self._guard()
        params: dict[str, Any] = {"expand": ["latest_charge"]}
        if amount_to_capture_cents is not None:
            params["amount_to_capture"] = amount_to_capture_cents
        try:
            result = await self._stripe.payment_intents.capture_async(
                payment_intent_id, params, options=self._options(idempotency_key),
            )
            await self.circuit.record_success()
            return dict(result)
        except stripe.StripeError as exc:
            await self.circuit.record_failure()
            raise self._translate(exc) from exc

    async def cancel_payment_intent(self, payment_intent_id: str) -> dict[str, Any]:
        """Release an uncaptured authorisation."""
        await self._guard()
        try:
            result = await self._stripe.payment_intents.cancel_async(
                payment_intent_id, options=self._options(),
            )
            await self.circuit.record_success()
            return dict(result)
        except stripe.StripeError as exc:
            await self.circuit.record_failure()
            raise self._translate(exc) from exc

    async def create_refund(
        self,
        charge_id: str,
        amount_cents: int | None = None,
        reason: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        await self._guard()
        params: dict[str, Any] = {"charge": charge_id}
        if amount_cents is not None:
            params["amount"] = amount_cents
        if reason:
            # Stripe's own vocabulary is duplicate | fraudulent |
            # requested_by_customer; anything more specific goes in metadata.
            params["reason"] = "requested_by_customer"
            params["metadata"] = {"reason_detail": reason[:255]}
        try:
            result = await self._stripe.refunds.create_async(
                params, options=self._options(idempotency_key),
            )
            await self.circuit.record_success()
            return dict(result)
        except stripe.StripeError as exc:
            await self.circuit.record_failure()
            raise self._translate(exc) from exc

    async def create_incremental_auth(
        self,
        payment_intent_id: str,
        new_amount_cents: int,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Raise an existing hold — a rental extended past its estimate.

        Stripe caps this at 10 increments per PaymentIntent, so callers need a
        fallback rather than assuming it always succeeds.
        """
        await self._guard()
        try:
            result = await self._stripe.payment_intents.increment_authorization_async(
                payment_intent_id, {"amount": new_amount_cents},
                options=self._options(idempotency_key),
            )
            await self.circuit.record_success()
            return dict(result)
        except stripe.StripeError as exc:
            await self.circuit.record_failure()
            raise self._translate(exc) from exc

    async def retrieve_payment_intent(self, payment_intent_id: str) -> dict[str, Any]:
        await self._guard()
        try:
            result = await self._stripe.payment_intents.retrieve_async(
                payment_intent_id, options=self._options(),
            )
            await self.circuit.record_success()
            return dict(result)
        except stripe.StripeError as exc:
            await self.circuit.record_failure()
            raise self._translate(exc) from exc

    # ── webhooks ─────────────────────────────────────────────────────────────

    @staticmethod
    def construct_webhook_event(
        payload: bytes, sig_header: str, webhook_secret: str,
    ) -> stripe.Event:
        """Verify the signature and parse. Raises on mismatch.

        Static because signature verification is pure computation over the raw
        body and the endpoint's own secret — it needs no merchant credentials,
        and requiring them was part of why the old code built a client (and so
        set the global key) just to check a signature.
        """
        return stripe.Webhook.construct_event(
            payload=payload, sig_header=sig_header, secret=webhook_secret,
        )
