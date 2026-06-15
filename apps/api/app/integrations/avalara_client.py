"""
Avalara AvaTax REST API v2 client.

Extends IntegrationClient for circuit-breaker + retry behavior.
Tax calculation results are cached in the avail Redis cluster using a
SHA-256 digest of the request inputs (TTL = 3600 s).

Environment variables (via Settings):
  AVALARA_ACCOUNT_ID    — numeric account ID
  AVALARA_LICENSE_KEY   — license key (SecretStr)
  AVALARA_COMPANY_CODE  — company code string
  AVALARA_ENVIRONMENT   — "sandbox" | "production"
"""
from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Optional

import structlog

from app.core.config import settings
from app.core.exceptions import AvalaraError
from app.integrations.base import IntegrationClient, IntegrationClientConfig

log = structlog.get_logger()

# Base URLs per environment
_BASE_URLS = {
    "production": "https://rest.avatax.com/api/v2",
    "sandbox": "https://sandbox-rest.avatax.com/api/v2",
}


@dataclass
class AvalaraLineItem:
    """Represents one line item in an AvaTax transaction."""

    number: str
    amount: float  # pre-tax amount in transaction currency
    tax_code: str  # e.g. "P0000000" for general products, "FR020900" for car rental
    description: str
    quantity: float = 1.0


@dataclass
class AvalaraAddress:
    """Address for shipFrom / shipTo in an AvaTax transaction."""

    line1: str
    city: str
    region: str      # 2-letter state/province code
    postal_code: str
    country: str = "US"


@dataclass
class TaxLine:
    """Per-line tax result from AvaTax."""

    line_number: str
    taxable_amount: float
    tax: float
    tax_code: str
    tax_name: str


@dataclass
class TaxTransactionResult:
    """Result of a successful CreateTransaction call."""

    transaction_code: str
    total_tax: float
    total_amount: float
    currency: str
    lines: list[TaxLine] = field(default_factory=list)
    raw: dict = field(default_factory=dict)


@dataclass
class TaxCode:
    """A single AvaTax tax code."""

    tax_code: str
    description: str
    is_physical: bool


class AvalaraClient(IntegrationClient):
    """
    Avalara AvaTax REST API v2 client.

    Authentication: HTTP Basic auth with account_id:license_key.
    All transactional methods go through the circuit breaker + retry
    provided by IntegrationClient.request().
    """

    def __init__(self) -> None:
        env = getattr(settings, "avalara_environment", "production")
        base_url = _BASE_URLS.get(env, _BASE_URLS["production"])

        # Build Basic auth header
        creds = (
            f"{settings.avalara_account_id}"
            f":{settings.avalara_license_key.get_secret_value()}"
        )
        encoded = base64.b64encode(creds.encode()).decode()

        super().__init__(
            IntegrationClientConfig(
                integration_name="avalara",
                base_url=base_url,
                default_headers={
                    "Authorization": f"Basic {encoded}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                connect_timeout=5.0,
                read_timeout=30.0,
                write_timeout=15.0,
                max_attempts=3,
                min_backoff=2.0,
                max_backoff=30.0,
            )
        )
        self._redis: Any = None  # Injected via set_cache() or property

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _cache_key(inputs: dict) -> str:
        """Deterministic SHA-256 key over the request inputs."""
        canonical = json.dumps(inputs, sort_keys=True, default=str)
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        return f"tax:{digest}"

    async def _get_cached(self, key: str) -> Optional[dict]:
        if self._redis is None:
            return None
        try:
            cached = await self._redis.get(key)
            if cached:
                return json.loads(cached)
        except Exception as exc:  # noqa: BLE001
            log.warning("avalara_cache_read_error", error=str(exc))
        return None

    async def _set_cached(self, key: str, value: dict, ttl: int = 3600) -> None:
        if self._redis is None:
            return
        try:
            await self._redis.setex(key, ttl, json.dumps(value))
        except Exception as exc:  # noqa: BLE001
            log.warning("avalara_cache_write_error", error=str(exc))

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------

    async def create_transaction(
        self,
        company_code: str,
        customer_code: str,
        date: str,
        lines: list[AvalaraLineItem],
        ship_from: AvalaraAddress,
        ship_to: AvalaraAddress,
        transaction_code: Optional[str] = None,
        currency: str = "USD",
        commit: bool = False,
    ) -> TaxTransactionResult:
        """
        POST /api/v2/transactions/create

        Creates a Sales transaction in AvaTax. Expensive calls are cached
        by input hash in the avail Redis cluster (TTL = 3600 s).

        Args:
            company_code:     AvaTax company code (from settings).
            customer_code:    Unique customer identifier for exemption lookup.
            date:             Transaction date as YYYY-MM-DD string.
            lines:            List of AvalaraLineItem instances.
            ship_from:        Origin address (rental pickup location).
            ship_to:          Destination address (typically same as ship_from for rentals).
            transaction_code: Optional idempotency code; AvaTax dedupes on this.
            currency:         ISO 4217 currency code.
            commit:           If True, commits transaction immediately (use for final charges).

        Returns:
            TaxTransactionResult with per-line tax breakdowns.

        Raises:
            AvalaraError:              AvaTax returned an error response.
            IntegrationCircuitOpenError: Circuit breaker is OPEN.
        """
        cache_inputs = {
            "company_code": company_code,
            "customer_code": customer_code,
            "date": date,
            "lines": [
                {
                    "number": li.number,
                    "amount": li.amount,
                    "tax_code": li.tax_code,
                    "description": li.description,
                    "quantity": li.quantity,
                }
                for li in lines
            ],
            "ship_from": {
                "line1": ship_from.line1,
                "city": ship_from.city,
                "region": ship_from.region,
                "postal_code": ship_from.postal_code,
                "country": ship_from.country,
            },
            "ship_to": {
                "line1": ship_to.line1,
                "city": ship_to.city,
                "region": ship_to.region,
                "postal_code": ship_to.postal_code,
                "country": ship_to.country,
            },
            "currency": currency,
        }
        cache_key = self._cache_key(cache_inputs)

        # Only cache non-committed reads (QUOTE-type calls)
        if not commit:
            cached = await self._get_cached(cache_key)
            if cached:
                log.info("avalara_cache_hit", cache_key=cache_key)
                return self._parse_transaction(cached)

        payload: dict = {
            "type": "SalesOrder" if not commit else "SalesInvoice",
            "companyCode": company_code,
            "date": date,
            "customerCode": customer_code,
            "currencyCode": currency,
            "addresses": {
                "shipFrom": {
                    "line1": ship_from.line1,
                    "city": ship_from.city,
                    "region": ship_from.region,
                    "postalCode": ship_from.postal_code,
                    "country": ship_from.country,
                },
                "shipTo": {
                    "line1": ship_to.line1,
                    "city": ship_to.city,
                    "region": ship_to.region,
                    "postalCode": ship_to.postal_code,
                    "country": ship_to.country,
                },
            },
            "lines": [
                {
                    "number": li.number,
                    "quantity": li.quantity,
                    "amount": li.amount,
                    "taxCode": li.tax_code,
                    "description": li.description,
                }
                for li in lines
            ],
            "commit": commit,
        }
        if transaction_code:
            payload["code"] = transaction_code

        response = await self.post("/transactions/create", json=payload)

        if response.status_code != 201 and response.status_code != 200:
            _raise_avalara_error(response)

        data = response.json()
        result = self._parse_transaction(data)

        if not commit:
            await self._set_cached(cache_key, data)

        return result

    async def void_transaction(
        self,
        company_code: str,
        transaction_code: str,
        void_reason: str = "DocVoided",
    ) -> dict:
        """
        POST /api/v2/companies/{companyCode}/transactions/{transactionCode}/void

        Voids a previously committed transaction (e.g. on reservation cancellation).

        Args:
            company_code:     AvaTax company code.
            transaction_code: Transaction code to void.
            void_reason:      One of: DocDeleted, DocVoided, Unspecified, PostFailed.

        Returns:
            Raw AvaTax void response dict.
        """
        path = f"/companies/{company_code}/transactions/{transaction_code}/void"
        response = await self.post(path, json={"code": void_reason})

        if response.status_code not in (200, 201):
            _raise_avalara_error(response)

        return response.json()  # type: ignore[no-any-return]

    async def get_tax_codes(
        self, top: int = 1000, skip: int = 0
    ) -> list[TaxCode]:
        """
        GET /api/v2/definitions/taxcodes

        Returns paginated list of AvaTax tax code definitions.

        Args:
            top:  Number of records to return (max 1000 per request).
            skip: Number of records to skip (for pagination).
        """
        response = await self.get(
            "/definitions/taxcodes",
            params={"$top": top, "$skip": skip},
        )

        if response.status_code != 200:
            _raise_avalara_error(response)

        data = response.json()
        return [
            TaxCode(
                tax_code=item.get("taxCode", ""),
                description=item.get("description", ""),
                is_physical=item.get("isPhysical", False),
            )
            for item in data.get("value", [])
        ]

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_transaction(data: dict) -> TaxTransactionResult:
        lines = []
        for line_data in data.get("lines", []):
            details = line_data.get("details", [{}])
            first_detail = details[0] if details else {}
            lines.append(
                TaxLine(
                    line_number=str(line_data.get("lineNumber", "")),
                    taxable_amount=float(line_data.get("taxableAmount", 0)),
                    tax=float(line_data.get("tax", 0)),
                    tax_code=str(line_data.get("taxCode", "")),
                    tax_name=str(first_detail.get("taxName", "")),
                )
            )
        return TaxTransactionResult(
            transaction_code=str(data.get("code", "")),
            total_tax=float(data.get("totalTax", 0)),
            total_amount=float(data.get("totalAmount", 0)),
            currency=str(data.get("currencyCode", "USD")),
            lines=lines,
            raw=data,
        )


def _raise_avalara_error(response: Any) -> None:
    """Parse AvaTax error envelope and raise AvalaraError."""
    try:
        body = response.json()
        error_obj = body.get("error", {})
        msg = error_obj.get("message", f"HTTP {response.status_code}")
        detail_msgs = [
            d.get("description", "")
            for d in error_obj.get("details", [])
        ]
        full_msg = msg + (f": {'; '.join(detail_msgs)}" if detail_msgs else "")
    except Exception:  # noqa: BLE001
        full_msg = f"HTTP {response.status_code}"
    raise AvalaraError(full_msg)
