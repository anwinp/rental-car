from __future__ import annotations

import asyncio
import uuid
from abc import ABC
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

import httpx
import structlog
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    wait_random,
)

from app.core.exceptions import IntegrationCircuitOpenError, IntegrationError

log = structlog.get_logger()


# ── Circuit Breaker ──────────────────────────────────────────────────────────

class CircuitState(Enum):
    CLOSED    = "closed"     # Normal operation
    OPEN      = "open"       # Failing — calls blocked
    HALF_OPEN = "half_open"  # Testing recovery


@dataclass
class CircuitBreaker:
    """
    Three-state circuit breaker.

    failure_threshold=5:   5 consecutive failures → OPEN
    recovery_timeout=60:   After 60 seconds in OPEN, move to HALF_OPEN
    success_threshold=2:   2 consecutive successes in HALF_OPEN → CLOSED

    Thread-safe via asyncio.Lock (single-process, event-loop concurrency).
    """
    integration_name: str
    failure_threshold: int = 5
    recovery_timeout: int = 60      # seconds
    success_threshold: int = 2

    state: CircuitState = field(default=CircuitState.CLOSED, init=False)
    failure_count: int = field(default=0, init=False)
    success_count: int = field(default=0, init=False)
    opened_at: Optional[datetime] = field(default=None, init=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False)

    async def allow_request(self) -> bool:
        async with self._lock:
            if self.state == CircuitState.CLOSED:
                return True
            if self.state == CircuitState.OPEN:
                elapsed = (datetime.now(timezone.utc) - self.opened_at).total_seconds()
                if elapsed >= self.recovery_timeout:
                    self.state = CircuitState.HALF_OPEN
                    self.success_count = 0
                    log.warning("circuit_half_open", integration=self.integration_name)
                    return True
                return False
            # HALF_OPEN — allow one probe request
            return True

    async def record_success(self) -> None:
        async with self._lock:
            self.failure_count = 0
            if self.state == CircuitState.HALF_OPEN:
                self.success_count += 1
                if self.success_count >= self.success_threshold:
                    self.state = CircuitState.CLOSED
                    log.info("circuit_closed", integration=self.integration_name)

    async def record_failure(self) -> None:
        async with self._lock:
            self.failure_count += 1
            self.success_count = 0
            if self.state == CircuitState.HALF_OPEN or (
                self.state == CircuitState.CLOSED
                and self.failure_count >= self.failure_threshold
            ):
                self.state = CircuitState.OPEN
                self.opened_at = datetime.now(timezone.utc)
                log.error(
                    "circuit_opened",
                    integration=self.integration_name,
                    failure_count=self.failure_count,
                )


# ── Integration Client Config ────────────────────────────────────────────────

@dataclass
class IntegrationClientConfig:
    integration_name: str
    base_url: str
    default_headers: dict[str, str] = field(default_factory=dict)
    # Timeout values (seconds)
    connect_timeout: float = 5.0
    read_timeout: float = 30.0
    write_timeout: float = 10.0
    pool_timeout: float = 5.0
    # Retry policy
    max_attempts: int = 3
    min_backoff: float = 2.0
    max_backoff: float = 30.0
    jitter_max: float = 1.0


# ── Base Integration Client ──────────────────────────────────────────────────

class IntegrationClient(ABC):
    """
    Abstract base for all third-party API clients.

    Provides:
    - Circuit breaker (per-client, per-process)
    - Tenacity retry with exponential backoff + jitter
    - Structured logging on success and failure
    - Correlation ID propagation via X-Correlation-ID header
    - httpx.AsyncClient lifecycle management

    Domain services must NOT catch IntegrationCircuitOpenError — let it
    propagate so the client receives a 503 with Retry-After guidance.
    """

    def __init__(self, config: IntegrationClientConfig) -> None:
        self.config = config
        self.circuit = CircuitBreaker(
            integration_name=config.integration_name,
            failure_threshold=5,
            recovery_timeout=60,
        )
        self._client = httpx.AsyncClient(
            base_url=config.base_url,
            timeout=httpx.Timeout(
                connect=config.connect_timeout,
                read=config.read_timeout,
                write=config.write_timeout,
                pool=config.pool_timeout,
            ),
            headers=config.default_headers,
            follow_redirects=False,
        )

    async def __aenter__(self) -> "IntegrationClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        correlation_id: Optional[str] = None,
        **kwargs: Any,
    ) -> httpx.Response:
        """
        Execute an HTTP request through circuit breaker + retry.

        Only retries on network-level errors and 5xx responses.
        4xx errors are NOT retried.
        """
        if not await self.circuit.allow_request():
            log.warning(
                "integration_circuit_open",
                integration=self.config.integration_name,
                method=method,
                path=path,
            )
            raise IntegrationCircuitOpenError(self.config.integration_name)

        cid = correlation_id or str(uuid.uuid4())

        async def _execute() -> httpx.Response:
            response = await self._client.request(
                method,
                path,
                headers={"X-Correlation-ID": cid},
                **kwargs,
            )
            if response.status_code >= 500:
                await self.circuit.record_failure()
                log.error(
                    "integration_request_5xx",
                    integration=self.config.integration_name,
                    method=method,
                    path=path,
                    status=response.status_code,
                    correlation_id=cid,
                    response_body=response.text[:500],
                )
                response.raise_for_status()  # Raises httpx.HTTPStatusError → retried
            await self.circuit.record_success()
            log.info(
                "integration_request_success",
                integration=self.config.integration_name,
                method=method,
                path=path,
                status=response.status_code,
                correlation_id=cid,
            )
            return response

        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self.config.max_attempts),
                wait=(
                    wait_exponential(
                        multiplier=1,
                        min=self.config.min_backoff,
                        max=self.config.max_backoff,
                    )
                    + wait_random(0, self.config.jitter_max)
                ),
                retry=retry_if_exception_type(
                    (httpx.TransportError, httpx.HTTPStatusError)
                ),
                reraise=True,
            ):
                with attempt:
                    return await _execute()
        except httpx.TransportError as exc:
            await self.circuit.record_failure()
            raise IntegrationError(
                integration=self.config.integration_name,
                detail=f"Network error contacting {self.config.integration_name}: {exc}",
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise IntegrationError(
                integration=self.config.integration_name,
                detail=(
                    f"{self.config.integration_name} returned HTTP {exc.response.status_code}. "
                    "Please try again later."
                ),
            ) from exc

    async def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("DELETE", path, **kwargs)
