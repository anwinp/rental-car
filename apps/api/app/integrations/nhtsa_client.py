"""
NHTSA (National Highway Traffic Safety Administration) client.

Two public APIs — no authentication required:
  1. vPIC VIN Decoder:  https://vpic.nhtsa.dot.gov/api/vehicles/
  2. Recalls API:       https://api.nhtsa.gov/recalls/

These are government APIs with high uptime SLAs but occasional rate limits.
No circuit breaker is applied (public API, no per-tenant cost), but basic
retry logic is included via httpx.

Usage:
    async with NHTSAClient() as client:
        result = await client.decode_vin("1HGBH41JXMN109186")
        recalls = await client.get_recalls_for_vin("1HGBH41JXMN109186")
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx
import structlog

log = structlog.get_logger()

_VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles"
_RECALLS_BASE = "https://api.nhtsa.gov/recalls"

# Keywords that signal a safety-critical recall
_CRITICAL_KEYWORDS = frozenset({"FIRE", "CRASH", "INJURY", "DEATH", "FATALITY", "EXPLOSION"})


@dataclass
class VinDecodeResult:
    """
    Parsed result from the vPIC VIN decoder.

    Field names match the Vehicle ORM model columns for easy mapping.
    """

    vin: str
    make: str
    model: str
    year: int
    body_class: str
    transmission: str       # "AUTOMATIC" | "MANUAL" | "CVT" | "UNKNOWN"
    fuel_type: str          # "GASOLINE" | "DIESEL" | "ELECTRIC" | "HYBRID" | "UNKNOWN"
    engine_cylinders: Optional[int]
    plant_country: str
    vehicle_type: str
    error_code: str         # "0" = no error
    raw: dict = field(default_factory=dict)

    @property
    def is_valid(self) -> bool:
        """True if VIN decoded without a critical error."""
        return self.error_code in ("0", "6")  # 6 = valid VIN with minor mismatch


@dataclass
class RecallResult:
    """
    A single recall record from the NHTSA Recalls API.
    """

    campaign_id: str
    manufacturer: str
    component: str
    summary: str
    consequence: str
    remedy: str
    recall_date: str        # YYYY-MM-DD
    is_safety_critical: bool

    @classmethod
    def from_api_response(cls, item: dict) -> "RecallResult":
        """Parse a single recall item from the API response."""
        consequence = item.get("consequence", "") or ""
        consequence_upper = consequence.upper()
        is_critical = any(kw in consequence_upper for kw in _CRITICAL_KEYWORDS)
        return cls(
            campaign_id=item.get("NHTSACampaignNumber", ""),
            manufacturer=item.get("Manufacturer", ""),
            component=item.get("Component", ""),
            summary=item.get("Summary", ""),
            consequence=consequence,
            remedy=item.get("Remedy", ""),
            recall_date=item.get("ReportReceivedDate", "")[:10],  # truncate to date
            is_safety_critical=is_critical,
        )


class NHTSAClient:
    """
    NHTSA vPIC VIN decoder + Recalls API client.

    Public government API — no authentication, no circuit breaker.
    Uses a shared httpx.AsyncClient with connection pooling for efficiency
    when processing many VINs in a batch.

    Usage as async context manager:
        async with NHTSAClient() as client:
            result = await client.decode_vin(vin)
    """

    def __init__(
        self,
        connect_timeout: float = 5.0,
        read_timeout: float = 30.0,
        max_retries: int = 2,
    ) -> None:
        self._timeout = httpx.Timeout(connect=connect_timeout, read=read_timeout, write=10.0)
        self._max_retries = max_retries
        self._vpic_client = httpx.AsyncClient(
            base_url=_VPIC_BASE,
            timeout=self._timeout,
            follow_redirects=True,
        )
        self._recalls_client = httpx.AsyncClient(
            base_url=_RECALLS_BASE,
            timeout=self._timeout,
            follow_redirects=True,
        )

    async def __aenter__(self) -> "NHTSAClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self._vpic_client.aclose()
        await self._recalls_client.aclose()

    # ------------------------------------------------------------------
    # VIN Decoder
    # ------------------------------------------------------------------

    async def decode_vin(self, vin: str) -> VinDecodeResult:
        """
        Decode a VIN using the NHTSA vPIC API.

        GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json

        Maps the flat results array (key/value pairs) to a VinDecodeResult.
        The API always returns 200 even for invalid VINs; check result.is_valid.

        Args:
            vin: 17-character VIN string (not validated here — API validates).

        Returns:
            VinDecodeResult with decoded vehicle attributes.
        """
        vin = vin.strip().upper()
        url = f"/DecodeVin/{vin}"

        data = await self._vpic_get(self._vpic_client, url, params={"format": "json"})

        results = {r["Variable"]: r["Value"] for r in data.get("Results", [])}

        make = results.get("Make", "") or ""
        model = results.get("Model", "") or ""
        model_year_raw = results.get("Model Year", "") or ""
        body_class = results.get("Body Class", "") or ""
        transmission_raw = results.get("Transmission Style", "") or ""
        fuel_raw = results.get("Fuel Type - Primary", "") or ""
        cylinders_raw = results.get("Engine Number of Cylinders", "") or ""
        plant_country = results.get("Plant Country", "") or ""
        vehicle_type = results.get("Vehicle Type", "") or ""
        error_code = results.get("Error Code", "0") or "0"

        # Parse model year
        try:
            year = int(model_year_raw)
        except (ValueError, TypeError):
            year = 0

        # Parse cylinders
        try:
            engine_cylinders: Optional[int] = int(cylinders_raw)
        except (ValueError, TypeError):
            engine_cylinders = None

        # Normalize transmission
        transmission = _normalize_transmission(transmission_raw)

        # Normalize fuel type
        fuel_type = _normalize_fuel_type(fuel_raw)

        log.info(
            "nhtsa_vin_decoded",
            vin=vin,
            make=make,
            model=model,
            year=year,
            error_code=error_code,
        )

        return VinDecodeResult(
            vin=vin,
            make=make,
            model=model,
            year=year,
            body_class=body_class,
            transmission=transmission,
            fuel_type=fuel_type,
            engine_cylinders=engine_cylinders,
            plant_country=plant_country,
            vehicle_type=vehicle_type,
            error_code=error_code,
            raw=data,
        )

    # ------------------------------------------------------------------
    # Recalls API
    # ------------------------------------------------------------------

    async def get_recalls_for_vin(self, vin: str) -> list[RecallResult]:
        """
        Fetch open safety recalls for a specific VIN.

        GET https://api.nhtsa.gov/recalls/recallsByVehicle?vin={vin}

        Marks recalls as safety-critical if the consequence text contains
        any of: FIRE, CRASH, INJURY, DEATH, FATALITY, EXPLOSION.

        Args:
            vin: 17-character VIN string.

        Returns:
            List of RecallResult objects (may be empty if no recalls).
        """
        vin = vin.strip().upper()
        data = await self._vpic_get(
            self._recalls_client, "/recallsByVehicle", params={"vin": vin}
        )

        recalls_raw = data.get("results", []) or data.get("Results", [])

        recalls = [RecallResult.from_api_response(item) for item in recalls_raw]

        log.info(
            "nhtsa_recalls_fetched",
            vin=vin,
            total=len(recalls),
            critical=sum(1 for r in recalls if r.is_safety_critical),
        )

        return recalls

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _vpic_get(
        self, client: httpx.AsyncClient, path: str, params: Optional[dict] = None
    ) -> dict:
        """Shared GET with simple retry for transient errors."""
        last_exc: Optional[Exception] = None
        for attempt in range(self._max_retries + 1):
            try:
                response = await client.get(path, params=params)
                response.raise_for_status()
                return response.json()  # type: ignore[no-any-return]
            except httpx.TransportError as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    await asyncio.sleep(2.0 ** attempt)
                    log.warning(
                        "nhtsa_retry",
                        path=path,
                        attempt=attempt + 1,
                        error=str(exc),
                    )
            except httpx.HTTPStatusError as exc:
                log.error("nhtsa_http_error", path=path, status=exc.response.status_code)
                raise
        log.error("nhtsa_request_failed", path=path, error=str(last_exc))
        raise last_exc or RuntimeError("NHTSA request failed after retries")


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------


def _normalize_transmission(raw: str) -> str:
    """Map vPIC transmission strings to canonical values."""
    upper = raw.upper()
    if "AUTOMATIC" in upper:
        return "AUTOMATIC"
    if "MANUAL" in upper:
        return "MANUAL"
    if "CVT" in upper or "CONTINUOUSLY" in upper:
        return "CVT"
    if "DUAL" in upper or "DCT" in upper or "PDK" in upper:
        return "AUTOMATIC"
    return "UNKNOWN"


def _normalize_fuel_type(raw: str) -> str:
    """Map vPIC fuel type strings to canonical values."""
    upper = raw.upper()
    if "ELECTRIC" in upper and ("GASOLINE" in upper or "HYBRID" in upper or "PLUG" in upper):
        return "HYBRID"
    if "ELECTRIC" in upper:
        return "ELECTRIC"
    if "DIESEL" in upper:
        return "DIESEL"
    if "GASOLINE" in upper or "PETROL" in upper:
        return "GASOLINE"
    if "FLEX" in upper or "E85" in upper:
        return "FLEX"
    if "HYDROGEN" in upper or "FUEL CELL" in upper:
        return "HYDROGEN"
    return "UNKNOWN"
