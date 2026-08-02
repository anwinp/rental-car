"""Auth domain Pydantic v2 schemas."""
from __future__ import annotations

import re
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── Password complexity ────────────────────────────────────────────────────────
# At least 12 chars, one uppercase, one lowercase, one digit, one special char.
_PASSWORD_RE = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:\'",.<>?/\\|`~]).{12,}$'
)


class LoginRequest(BaseModel):
    """Credentials submitted to POST /auth/login."""
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1)
    app_context: str = Field(default="web", description="'counter' | 'web' | 'admin'")


class TokenResponse(BaseModel):
    """
    Returned from login/refresh — for JS-readable display only.
    Actual auth is enforced via httpOnly cookies set by the server.
    """
    message: str
    app_context: str


class UserProfile(BaseModel):
    """Current user profile — returned by GET /auth/me."""
    model_config = {"from_attributes": True}

    user_id: UUID
    tenant_id: UUID
    email: str
    first_name: str
    last_name: str
    role: str
    roles: list[str] = Field(default_factory=list)
    location_ids: list[UUID] = Field(default_factory=list)
    is_mfa_enabled: bool = False
    app_context: str = "web"


class PasswordChange(BaseModel):
    """Body for POST /auth/change-password."""
    current_password: str
    new_password: str = Field(min_length=12)

    @field_validator("new_password")
    @classmethod
    def validate_complexity(cls, v: str) -> str:
        if not _PASSWORD_RE.match(v):
            raise ValueError(
                "Password must be at least 12 characters and include an uppercase letter, "
                "a lowercase letter, a digit, and a special character."
            )
        return v


class PasswordResetRequest(BaseModel):
    """Body for POST /auth/request-password-reset.

    Deliberately carries no tenant. It used to require one, which meant the
    caller chose which workspace's account to reset — and the shipped front end
    sent the tenant in a HEADER instead, so every request 422'd and no reset
    email was ever sent to anyone. The tenant is now derived from the host.
    """
    email: str = Field(min_length=3, max_length=254)


class PasswordResetComplete(BaseModel):
    """Body for POST /auth/reset-password."""
    token: str
    new_password: str = Field(min_length=12)

    @field_validator("new_password")
    @classmethod
    def validate_complexity(cls, v: str) -> str:
        if not _PASSWORD_RE.match(v):
            raise ValueError(
                "Password must be at least 12 characters and include an uppercase letter, "
                "a lowercase letter, a digit, and a special character."
            )
        return v


class MFAEnrollResponse(BaseModel):
    """Returned from POST /auth/mfa/enroll."""
    secret: str
    qr_code_uri: str
    backup_codes: list[str] = Field(description="10 single-use backup codes")


class MFAVerifyRequest(BaseModel):
    """Body for POST /auth/mfa/verify."""
    totp_code: str = Field(min_length=6, max_length=8)


class SessionInfo(BaseModel):
    """Metadata for a single active session."""
    jti: str
    created_at: Optional[str] = None
    app_context: Optional[str] = None
