from __future__ import annotations

from typing import Any, Optional

from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """
    Base class for all application errors.
    All subclasses produce RFC 7807 problem+json responses.
    """
    status: int = 500
    title: str = "Internal Server Error"
    type_path: str = "internal-error"

    def __init__(
        self,
        detail: str,
        *,
        extra: Optional[dict[str, Any]] = None,
        title: Optional[str] = None,
        status: Optional[int] = None,
    ) -> None:
        self.detail = detail
        self.extra = extra or {}
        if title:
            self.title = title
        if status:
            self.status = status
        super().__init__(detail)

    @property
    def type_uri(self) -> str:
        return f"https://errors.rcm.app/{self.type_path}"


# ── 4xx Client Errors ────────────────────────────────────────────────────────

class ResourceNotFoundError(AppError):
    status = 404
    title = "Resource Not Found"
    type_path = "not-found"

    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(f"{resource} with id '{resource_id}' was not found.")
        self.extra = {"resource": resource, "resource_id": resource_id}


class NotFoundError(ResourceNotFoundError):
    """Alias for ResourceNotFoundError — matches task spec naming."""


class ValidationError(AppError):
    status = 422
    title = "Validation Error"
    type_path = "validation-error"


class BusinessRuleError(AppError):
    status = 422
    title = "Business Rule Violation"
    type_path = "business-rule-error"


class ConflictError(AppError):
    status = 409
    title = "Conflict"
    type_path = "conflict"


class DuplicateError(ConflictError):
    title = "Duplicate Resource"
    type_path = "duplicate"


class AuthenticationError(AppError):
    status = 401
    title = "Authentication Required"
    type_path = "authentication-required"


# Alias used in task spec
AuthError = AuthenticationError


class PermissionDeniedError(AppError):
    status = 403
    title = "Permission Denied"
    type_path = "permission-denied"


# Alias used in task spec
ForbiddenError = PermissionDeniedError


class RateLimitError(AppError):
    status = 429
    title = "Rate Limit Exceeded"
    type_path = "rate-limit-exceeded"

    def __init__(self, retry_after_seconds: int = 60) -> None:
        super().__init__(f"Rate limit exceeded. Retry after {retry_after_seconds} seconds.")
        self.retry_after = retry_after_seconds


class PaymentError(AppError):
    status = 402
    title = "Payment Required"
    type_path = "payment-required"


# ── Domain-Specific Errors ───────────────────────────────────────────────────

class VehicleNotAvailableError(ConflictError):
    type_path = "vehicle-not-available"

    def __init__(self, vehicle_id: str, start: str, end: str) -> None:
        super().__init__(
            f"Vehicle {vehicle_id} is already booked for {start}–{end}. "
            "Please choose a different vehicle or time range."
        )
        self.extra = {"vehicle_id": vehicle_id, "start": start, "end": end}


class InvalidCredentialsError(AuthenticationError):
    type_path = "invalid-credentials"

    def __init__(self) -> None:
        super().__init__("Invalid email address or password.")


class TokenInvalidError(AuthenticationError):
    type_path = "token-invalid"

    def __init__(self) -> None:
        super().__init__("The provided token is invalid or has expired.")


class TokenRevokedError(AuthenticationError):
    type_path = "token-revoked"

    def __init__(self) -> None:
        super().__init__("This session has been revoked. Please log in again.")


class AccountLockedError(AuthenticationError):
    type_path = "account-locked"

    def __init__(self, unlock_at: str) -> None:
        super().__init__(f"Account locked due to failed login attempts. Retry after {unlock_at}.")
        self.extra = {"unlock_at": unlock_at}


class DNRBlockError(PermissionDeniedError):
    type_path = "do-not-rent"

    def __init__(self) -> None:
        super().__init__(
            "This reservation cannot be completed. Please contact our customer service team."
        )


class ReservationNotModifiableError(ConflictError):
    type_path = "reservation-not-modifiable"

    def __init__(self, reservation_id: str, current_status: str) -> None:
        super().__init__(
            f"Reservation {reservation_id} in status '{current_status}' cannot be modified."
        )


class ExclusionConstraintError(ConflictError):
    """Raised when PostgreSQL exclusion constraint (23P01) fires on VehicleBlock insert."""
    type_path = "vehicle-not-available"

    def __init__(self) -> None:
        super().__init__(
            "This vehicle is no longer available for the requested time slot. "
            "Please refresh availability and try again."
        )


class PreAuthExpiredError(ConflictError):
    type_path = "preauth-expired"

    def __init__(self, reservation_id: str) -> None:
        super().__init__(
            f"The pre-authorization for reservation {reservation_id} has expired. "
            "A new pre-authorization is required before checkout."
        )


class InsufficientInventoryError(ConflictError):
    type_path = "insufficient-inventory"

    def __init__(self, class_name: str, location: str) -> None:
        super().__init__(
            f"No vehicles of class '{class_name}' are available at {location} "
            "for the requested dates."
        )


class DamageHoldActiveError(ConflictError):
    type_path = "damage-hold-active"

    def __init__(self, vehicle_id: str, claim_id: str) -> None:
        super().__init__(
            f"Vehicle {vehicle_id} has an active damage hold (claim {claim_id}). "
            "Resolve the damage claim before dispatching this vehicle."
        )


class GDPRLegalHoldError(ConflictError):
    type_path = "gdpr-legal-hold"
    title = "GDPR Legal Hold Active"

    def __init__(self, resource_id: str) -> None:
        super().__init__(
            f"Resource {resource_id} is under a legal hold and cannot be erased."
        )
        self.extra = {"resource_id": resource_id}


# ── Integration / Upstream Errors ────────────────────────────────────────────

class IntegrationError(AppError):
    """An upstream integration (Stripe, Avalara, etc.) returned an error."""
    status = 502
    title = "Integration Error"
    type_path = "integration-error"

    def __init__(self, integration: str, detail: str) -> None:
        super().__init__(detail)
        self.extra = {"integration": integration}


class IntegrationCircuitOpenError(AppError):
    """Circuit breaker is OPEN — integration calls are suspended."""
    status = 503
    title = "Integration Temporarily Unavailable"
    type_path = "integration-circuit-open"

    def __init__(self, integration: str) -> None:
        super().__init__(
            f"The {integration} integration is temporarily unavailable. "
            "Please try again in 60 seconds."
        )
        self.extra = {"integration": integration, "retry_after_seconds": 60}


class StripeError(IntegrationError):
    type_path = "payment-error"

    def __init__(self, stripe_code: str, detail: str) -> None:
        super().__init__("stripe", detail)
        self.extra["stripe_code"] = stripe_code


class AvalaraError(IntegrationError):
    type_path = "tax-calculation-error"

    def __init__(self, detail: str) -> None:
        super().__init__("avalara", detail)


# ── RFC 7807 Exception Handler ───────────────────────────────────────────────

async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """
    FastAPI exception handler for all AppError subclasses.
    Registered in create_app() via app.add_exception_handler(AppError, app_error_handler).

    Response format: RFC 7807 Problem Details for HTTP APIs
    Content-Type: application/problem+json
    """
    content: dict[str, Any] = {
        "type":     exc.type_uri,
        "title":    exc.title,
        "status":   exc.status,
        "detail":   exc.detail,
        "instance": str(request.url),
    }
    if exc.extra:
        content.update(exc.extra)

    headers: dict[str, str] = {"Content-Type": "application/problem+json"}
    if isinstance(exc, RateLimitError):
        headers["Retry-After"] = str(exc.retry_after)

    return JSONResponse(
        status_code=exc.status,
        content=content,
        headers=headers,
    )


async def sqlalchemy_integrity_error_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    """
    Catches PostgreSQL error 23P01 (exclusion_violation) from asyncpg and
    maps it to ExclusionConstraintError.
    Also handles 23505 (unique_violation) → DuplicateError.
    """
    try:
        from asyncpg.exceptions import ExclusionViolationError, UniqueViolationError
    except ImportError:
        raise exc

    cause = getattr(exc, "__cause__", None)
    if isinstance(cause, ExclusionViolationError):
        mapped: AppError = ExclusionConstraintError()
        return await app_error_handler(request, mapped)
    if isinstance(cause, UniqueViolationError):
        mapped = DuplicateError("A record with these values already exists.")
        return await app_error_handler(request, mapped)
    raise exc
