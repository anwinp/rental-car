"""Payment gateway abstraction layer."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
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

    # When the hold actually dies, as the gateway reports it.
    #
    # Not a number of days computed by us. Vehicle rental qualifies for extended
    # authorisations, but whether one is granted depends on the card network,
    # the issuer and the merchant category, and the window is 27-30 days rather
    # than a round number. Stripe returns `capture_before` on the charge and
    # says it is authoritative because network rules change without notice.
    #
    # None means the gateway did not tell us. Callers must then assume the
    # short window, because guessing long is the failure that strands a capture.
    expires_at: Optional[datetime] = None

    # Whether the extension and future increases were actually granted, as
    # opposed to requested. A rental cannot be extended on a hold that did not
    # get incremental authorisation, and the counter needs to know that before
    # promising it.
    extended_authorization: bool = False
    incremental_authorization: bool = False

    # Carried so the payment record can show which card is on the hold. The
    # previous code built a stub dict here, so every stored payment had a null
    # last4 and brand.
    card_last4: Optional[str] = None
    card_brand: Optional[str] = None
    card_exp_month: Optional[int] = None
    card_exp_year: Optional[int] = None

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
