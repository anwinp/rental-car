"""StripeGateway — thin adapter wrapping StripeClient to satisfy PaymentGateway ABC."""
from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Optional

from app.domains.payments.gateway import (
    CaptureResult, PaymentGateway, PaymentStatusResult,
    PreAuthResult, RefundResult, VoidResult,
)
from app.integrations.stripe_client import StripeClient


class StripeGateway(PaymentGateway):

    def __init__(self) -> None:
        self._client = StripeClient()

    async def create_preauth(
        self, amount: Decimal, currency: str, customer_ref: str,
        payment_method_token: str, idempotency_key: str, metadata: dict,
    ) -> PreAuthResult:
        amount_cents = int(amount * 100)
        intent = await self._client.create_payment_intent(
            amount_cents=amount_cents,
            currency=currency.lower(),
            capture_method="manual",
            payment_method_id=payment_method_token,
            metadata={**metadata, "customer_ref": customer_ref},
            confirm=True,
            idempotency_key=idempotency_key,
        )
        return PreAuthResult(
            gateway_payment_id=intent["id"],
            gateway_auth_code=None,
            status="AUTHORIZED",
            amount_authorized=amount,
            currency=currency.upper(),
            auth_expiry_days=7,
        )

    async def capture(self, preauth_id: str, amount: Decimal, idempotency_key: str) -> CaptureResult:
        result = await self._client.capture_payment_intent(
            payment_intent_id=preauth_id,
            amount_to_capture_cents=int(amount * 100),
        )
        charge_id = ""
        charges = result.get("charges", {}).get("data", [])
        if charges:
            charge_id = charges[0].get("id", "")
        return CaptureResult(
            gateway_charge_id=charge_id,
            captured_amount=amount,
            captured_at_iso=datetime.datetime.utcnow().isoformat(),
        )

    async def incremental_auth(
        self, preauth_id: str, new_total_amount: Decimal, idempotency_key: str,
    ) -> PreAuthResult:
        result = await self._client.create_incremental_auth(
            payment_intent_id=preauth_id,
            new_amount_cents=int(new_total_amount * 100),
        )
        return PreAuthResult(
            gateway_payment_id=preauth_id,
            gateway_auth_code=result.get("network_transaction_id"),
            status="AUTHORIZED",
            amount_authorized=new_total_amount,
            currency="",
            auth_expiry_days=7,
        )

    async def void(self, preauth_id: str) -> VoidResult:
        await self._client.cancel_payment_intent(payment_intent_id=preauth_id)
        return VoidResult(voided=True, gateway_void_ref=preauth_id)

    async def refund(
        self, charge_id: str, amount: Decimal, reason: str, idempotency_key: str,
    ) -> RefundResult:
        result = await self._client.create_refund(
            charge_id=charge_id,
            amount_cents=int(amount * 100),
            reason=reason,
        )
        return RefundResult(
            gateway_refund_id=result.get("id", ""),
            refunded_amount=amount,
            status="REFUNDED",
        )

    async def get_status(self, transaction_id: str) -> PaymentStatusResult:
        raise NotImplementedError("StripeGateway.get_status: add stripe.PaymentIntent.retrieve() to StripeClient")
