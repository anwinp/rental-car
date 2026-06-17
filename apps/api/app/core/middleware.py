from __future__ import annotations

import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.config import settings


def configure_structlog() -> None:
    """Configure structlog processors — JSON in production, console in development."""
    shared_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.ExceptionRenderer(),
    ]

    # Mandatory fields added to every log event
    def add_service_info(logger, method, event_dict):  # noqa: ANN001
        event_dict["service"] = "rcm-api"
        event_dict["environment"] = settings.env
        return event_dict

    shared_processors.insert(0, add_service_info)

    if settings.env == "production":
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer()

    structlog.configure(
        processors=shared_processors + [renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(__import__("logging"), settings.log_level, 20)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


# Run configuration at module import time
configure_structlog()


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Read or generate X-Request-ID.
    Attaches to request.state.request_id.
    Adds X-Request-ID to every response.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class StructuredLoggingMiddleware(BaseHTTPMiddleware):
    """
    Emit one structured access log per request (on response).
    Binds request_id and tenant_id into structlog context vars.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        start_time = time.perf_counter()

        # Bind context available before route handler runs
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=getattr(request.state, "request_id", None),
            method=request.method,
            path=request.url.path,
        )

        response = await call_next(request)

        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

        # tenant_id is set by auth dependency after middleware runs
        tenant_id = getattr(request.state, "tenant_id", None)

        log = structlog.get_logger()
        log.info(
            "http_request",
            status_code=response.status_code,
            duration_ms=duration_ms,
            tenant_id=tenant_id,
        )
        structlog.contextvars.clear_contextvars()
        return response
