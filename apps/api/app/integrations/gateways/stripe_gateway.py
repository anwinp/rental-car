"""StripeGateway — adapts StripeMerchantApi to the PaymentGateway ABC.

Credentials are constructor arguments, not ambient process state. `stripe_account`
is what will make a charge land on the tenant's own connected account in Phase 1;
it is threaded through now so that becomes a caller change rather than a rewrite.
"""
from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Optional

from app.domains.payments.gateway import (
    CaptureResult, PaymentGateway, PaymentStatusResult,
    PreAuthResult, RefundResult, VoidResult,
)
from app.integrations.stripe_merchant import StripeMerchantApi


class StripeGateway(PaymentGateway):

    def __init__(self, *, api_key: str, stripe_account: str | None = None) -> None:
        self._client = StripeMerchantApi(
            api_key=api_key, stripe_account=stripe_account,
        )

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
            rental_hold=True,
        )
        return _preauth_from_intent(intent, amount, currency.upper())

    async def capture(self, preauth_id: str, amount: Decimal, idempotency_key: str) -> CaptureResult:
        result = await self._client.capture_payment_intent(
            payment_intent_id=preauth_id,
            amount_to_capture_cents=int(amount * 100),
            idempotency_key=idempotency_key,
        )
        return CaptureResult(
            gateway_charge_id=_charge_id(result),
            captured_amount=amount,
            captured_at_iso=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )

    async def incremental_auth(
        self, preauth_id: str, new_total_amount: Decimal, idempotency_key: str,
    ) -> PreAuthResult:
        result = await self._client.create_incremental_auth(
            payment_intent_id=preauth_id,
            new_amount_cents=int(new_total_amount * 100),
            idempotency_key=idempotency_key,
        )
        out = _preauth_from_intent(result, new_total_amount, str(result.get("currency", "")).upper())
        # An increment does not move the deadline; the original hold's window
        # still governs. Carrying the network reference lets the chain be
        # followed if an issuer queries it.
        out.gateway_auth_code = result.get("network_transaction_id")
        return out

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
            idempotency_key=idempotency_key,
        )
        return RefundResult(
            gateway_refund_id=result.get("id", ""),
            refunded_amount=amount,
            status="REFUNDED",
        )

    async def get_status(self, transaction_id: str) -> PaymentStatusResult:
        intent = await self._client.retrieve_payment_intent(transaction_id)
        raw = str(intent.get("status", ""))
        return PaymentStatusResult(
            gateway_payment_id=transaction_id,
            status=_STATUS_MAP.get(raw, "UNKNOWN"),
            raw_status=raw,
        )


# Stripe's PaymentIntent vocabulary mapped onto ours. Anything unlisted stays
# UNKNOWN rather than being guessed at — a wrong status on a payment is worse
# than an unrecognised one.
_STATUS_MAP = {
    "requires_capture": "AUTHORIZED",
    "succeeded": "CAPTURED",
    "canceled": "VOIDED",
    "processing": "PENDING",
    "requires_payment_method": "FAILED",
    "requires_confirmation": "PENDING",
    "requires_action": "PENDING",
}


# ── reading Stripe's answer ──────────────────────────────────────────────────

def _charge(intent: dict) -> dict:
    """The charge behind a PaymentIntent.

    `charges` was removed from the PaymentIntent in favour of `latest_charge`,
    so the old `intent["charges"]["data"][0]` read returned nothing and the
    captured charge id was always the empty string — which a refund needs.
    Both shapes are handled because a pinned older API version still returns
    the first.
    """
    latest = intent.get("latest_charge")
    if isinstance(latest, dict):
        return latest
    data = (intent.get("charges") or {}).get("data") or []
    return data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else {}


def _charge_id(intent: dict) -> str:
    latest = intent.get("latest_charge")
    if isinstance(latest, str):
        return latest
    return str(_charge(intent).get("id") or "")


def _preauth_from_intent(
    intent: dict, amount: Decimal, currency: str,
) -> PreAuthResult:
    """Build the result from what the gateway actually granted.

    The deadline comes from `capture_before` on the charge, which Stripe
    documents as authoritative because network rules change without notice. If
    it is absent — the extension was not granted, or the response is not
    expanded — expires_at stays None and the caller assumes the short window.
    Guessing long is the failure that strands a capture at the counter.
    """
    card = (_charge(intent).get("payment_method_details") or {}).get("card") or {}

    capture_before = card.get("capture_before")
    expires_at = (
        datetime.datetime.fromtimestamp(capture_before, tz=datetime.timezone.utc)
        if isinstance(capture_before, (int, float)) else None
    )

    return PreAuthResult(
        gateway_payment_id=str(intent.get("id") or ""),
        gateway_auth_code=None,
        status="AUTHORIZED",
        amount_authorized=amount,
        currency=currency,
        expires_at=expires_at,
        extended_authorization=(
            (card.get("extended_authorization") or {}).get("status") == "enabled"
        ),
        incremental_authorization=(
            (card.get("incremental_authorization") or {}).get("status") == "available"
        ),
        card_last4=card.get("last4"),
        card_brand=card.get("brand"),
        card_exp_month=card.get("exp_month"),
        card_exp_year=card.get("exp_year"),
    )
