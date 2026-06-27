"""TyroGateway — skeleton implementation. Fill in _tyro_* methods when credentials arrive."""
from __future__ import annotations

import datetime
import structlog
from decimal import Decimal
from typing import Any, Optional

from app.domains.payments.gateway import (
    CaptureResult, GatewayErrorCode, PaymentGateway, PaymentStatusResult,
    PreAuthResult, RefundResult, VoidResult,
)

log = structlog.get_logger()


class TyroGateway(PaymentGateway):

    def __init__(self) -> None:
        from app.core.config import settings
        self._merchant_id: str = getattr(settings, "tyro_merchant_id", "")
        self._api_key: str = getattr(settings, "tyro_api_key", "")
        self._api_secret: str = getattr(settings, "tyro_api_secret", "")
        self._terminal_id: str = getattr(settings, "tyro_terminal_id", "")
        self._ecom_base_url: str = getattr(settings, "tyro_ecom_base_url", "https://api.tyro.com")
        self._iclient_base_url: str = getattr(settings, "tyro_iclient_base_url", "https://iclient.tyro.com")

    async def create_preauth(
        self, amount: Decimal, currency: str, customer_ref: str,
        payment_method_token: str, idempotency_key: str, metadata: dict,
    ) -> PreAuthResult:
        session_token = await self._tyro_init_transaction(
            amount_cents=int(amount * 100),
            transaction_type="PREAUTH",
            idempotency_key=idempotency_key,
            metadata=metadata,
        )
        return PreAuthResult(
            gateway_payment_id=session_token,
            gateway_auth_code=None,
            status="PENDING",
            amount_authorized=amount,
            currency=currency.upper(),
            auth_expiry_days=5,
            iclient_transaction_id=session_token,
        )

    async def capture(self, preauth_id: str, amount: Decimal, idempotency_key: str) -> CaptureResult:
        result = await self._tyro_completion(
            preauth_id=preauth_id,
            amount_cents=int(amount * 100),
            idempotency_key=idempotency_key,
        )
        return CaptureResult(
            gateway_charge_id=result.get("settlement_ref", ""),
            captured_amount=amount,
            captured_at_iso=datetime.datetime.utcnow().isoformat(),
        )

    async def incremental_auth(
        self, preauth_id: str, new_total_amount: Decimal, idempotency_key: str,
    ) -> PreAuthResult:
        result = await self._tyro_incremental_auth(
            preauth_id=preauth_id,
            new_amount_cents=int(new_total_amount * 100),
            idempotency_key=idempotency_key,
        )
        return PreAuthResult(
            gateway_payment_id=preauth_id,
            gateway_auth_code=result.get("approval_code"),
            status="AUTHORIZED",
            amount_authorized=new_total_amount,
            currency="AUD",
            auth_expiry_days=5,
        )

    async def void(self, preauth_id: str) -> VoidResult:
        await self._tyro_void(preauth_id=preauth_id)
        return VoidResult(voided=True, gateway_void_ref=preauth_id)

    async def refund(
        self, charge_id: str, amount: Decimal, reason: str, idempotency_key: str,
    ) -> RefundResult:
        result = await self._tyro_refund(
            settlement_ref=charge_id,
            amount_cents=int(amount * 100),
            idempotency_key=idempotency_key,
        )
        return RefundResult(
            gateway_refund_id=result.get("refund_id", ""),
            refunded_amount=amount,
            status="REFUNDED",
        )

    async def get_status(self, transaction_id: str) -> PaymentStatusResult:
        result = await self._tyro_get_transaction(transaction_id=transaction_id)
        raw_status = result.get("status", "UNKNOWN")
        return PaymentStatusResult(
            gateway_payment_id=transaction_id,
            status=self._map_tyro_status(raw_status),
            raw_status=raw_status,
        )

    def _map_tyro_status(self, raw: str) -> str:
        return {
            "APPROVED": "AUTHORIZED", "COMPLETED": "CAPTURED",
            "DECLINED": "DECLINED", "CANCELLED": "VOIDED",
            "REFUNDED": "REFUNDED", "PENDING": "PENDING",
        }.get(raw.upper(), "PENDING")

    # ── STUBS: fill in when Tyro credentials arrive ──────────────────────────

    async def _tyro_init_transaction(self, amount_cents, transaction_type, idempotency_key, metadata) -> str:
        raise NotImplementedError(
            "TyroGateway._tyro_init_transaction: POST /transactions/init. "
            "Needs TYRO_MERCHANT_ID, TYRO_TERMINAL_ID, TYRO_API_KEY."
        )

    async def _tyro_completion(self, preauth_id, amount_cents, idempotency_key) -> dict:
        raise NotImplementedError("TyroGateway._tyro_completion: fill when creds arrive.")

    async def _tyro_incremental_auth(self, preauth_id, new_amount_cents, idempotency_key) -> dict:
        raise NotImplementedError("TyroGateway._tyro_incremental_auth: verify MCC 7512 support first.")

    async def _tyro_void(self, preauth_id) -> None:
        raise NotImplementedError("TyroGateway._tyro_void: fill when creds arrive.")

    async def _tyro_refund(self, settlement_ref, amount_cents, idempotency_key) -> dict:
        raise NotImplementedError("TyroGateway._tyro_refund: fill when creds arrive.")

    async def _tyro_get_transaction(self, transaction_id) -> dict:
        raise NotImplementedError("TyroGateway._tyro_get_transaction: fill when creds arrive.")
