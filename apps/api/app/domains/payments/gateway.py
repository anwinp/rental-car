"""Payment gateway abstraction layer."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional


class GatewayErrorCode(str, Enum):
    CARD_DECLINED = "CARD_DECLINED"
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    EXPIRED_CARD = "EXPIRED_CARD"
    FRAUD_DECLINE = "FRAUD_DECLINE"
    TERMINAL_OFFLINE = "TERMINAL_OFFLINE"
    PREAUTH_EXPIRED = "PREAUTH_EXPIRED"
    NETWORK_ERROR = "NETWORK_ERROR"
    CIRCUIT_OPEN = "CIRCUIT_OPEN"
    UNKNOWN = "UNKNOWN"


@dataclass
class PreAuthResult:
    gateway_payment_id: str
    gateway_auth_code: Optional[str]
    status: str
    amount_authorized: Decimal
    currency: str
    auth_expiry_days: int
    iclient_transaction_id: Optional[str] = None


@dataclass
class CaptureResult:
    gateway_charge_id: str
    captured_amount: Decimal
    captured_at_iso: str


@dataclass
class VoidResult:
    voided: bool
    gateway_void_ref: Optional[str]


@dataclass
class RefundResult:
    gateway_refund_id: str
    refunded_amount: Decimal
    status: str


@dataclass
class PaymentStatusResult:
    gateway_payment_id: str
    status: str
    raw_status: str


class PaymentGateway(ABC):
    @abstractmethod
    async def create_preauth(
        self, amount: Decimal, currency: str, customer_ref: str,
        payment_method_token: str, idempotency_key: str, metadata: dict,
    ) -> PreAuthResult: ...

    @abstractmethod
    async def capture(
        self, preauth_id: str, amount: Decimal, idempotency_key: str,
    ) -> CaptureResult: ...

    @abstractmethod
    async def incremental_auth(
        self, preauth_id: str, new_total_amount: Decimal, idempotency_key: str,
    ) -> PreAuthResult: ...

    @abstractmethod
    async def void(self, preauth_id: str) -> VoidResult: ...

    @abstractmethod
    async def refund(
        self, charge_id: str, amount: Decimal, reason: str, idempotency_key: str,
    ) -> RefundResult: ...

    @abstractmethod
    async def get_status(self, transaction_id: str) -> PaymentStatusResult: ...
