from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Deployment environment ──────────────────────────────────────────────────
    env: Literal["development", "test", "staging", "production"] = "development"

    # ── PostgreSQL (asyncpg dialect) ────────────────────────────────────────────
    database_url: SecretStr
    # True when DATABASE_URL points at PgBouncer in transaction-pooling mode.
    # Disables asyncpg's prepared-statement cache — see app/core/database.py.
    db_via_pgbouncer: bool = False

    # ── Redis (three separate clusters in prod; one in dev) ────────────────────
    redis_session_url: SecretStr
    redis_avail_url: SecretStr
    redis_broker_url: SecretStr

    # ── JWT ────────────────────────────────────────────────────────────────────
    jwt_secret_key: SecretStr
    jwt_algorithm: str = "HS256"
    jwt_access_token_ttl_counter_seconds: int = 28800    # 8 hours
    jwt_access_token_ttl_web_seconds: int = 3600          # 1 hour
    jwt_refresh_token_ttl_seconds: int = 2592000          # 30 days

    # ── CORS ───────────────────────────────────────────────────────────────────
    cors_origins: list[str] = [
        "https://booking.rcm.app",
        "https://counter.rcm.app",
        "https://admin.rcm.app",
    ]

    # ── Stripe ─────────────────────────────────────────────────────────────────
    stripe_secret_key: SecretStr
    stripe_webhook_secret: SecretStr

    # ── Avalara ────────────────────────────────────────────────────────────────
    avalara_account_id: str
    avalara_license_key: SecretStr
    avalara_company_code: str
    avalara_environment: Literal["sandbox", "production"] = "production"

    # ── Twilio ─────────────────────────────────────────────────────────────────
    twilio_account_sid: str
    twilio_auth_token: SecretStr
    twilio_from_number: str
    twilio_verify_service_sid: str = ""
    twilio_whatsapp_from: str = ""

    # ── SendGrid ───────────────────────────────────────────────────────────────
    sendgrid_api_key: SecretStr
    sendgrid_from_email: str = "noreply@rcm.app"
    sendgrid_from_name: str = "Rental Car Manager"

    # ── SMTP (fallback when SendGrid key is a placeholder) ─────────────────────
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from_email: str = ""
    # False for a local mail catcher (MailHog/Mailpit), True for a real relay.
    smtp_start_tls: bool = True
    smtp_from_name: str = "Rental Car Manager"

    # ── AWS ────────────────────────────────────────────────────────────────────
    aws_region: str = "us-east-1"
    s3_documents_bucket: str
    s3_photos_bucket: str
    s3_reports_bucket: str
    # Set for S3-compatible storage (MinIO). Empty = real AWS S3.
    # Internal endpoint used for server-side calls from the API/worker containers.
    s3_endpoint_url: str = ""
    # Public endpoint that browser-facing presigned URLs are signed against.
    s3_public_endpoint: str = ""

    # ── Google OAuth ───────────────────────────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    # redirect_uri registered in Google Cloud Console — must exactly match
    google_oauth_redirect_uri: str = "http://localhost:3400/api/auth/google/callback"
    # Base URL of the customer-facing frontend
    frontend_url: str = "http://localhost:3400"

    # ── AI Agents ──────────────────────────────────────────────────────────────
    anthropic_api_key: SecretStr = SecretStr("")
    # OpenAI-compatible LLM (NVIDIA NIM / OpenAI / local). When llm_api_key is set
    # the agent orchestrator drives conversations with this model via tool-calling.
    llm_api_key: SecretStr = SecretStr("")
    llm_base_url: str = "https://integrate.api.nvidia.com/v1"
    llm_model: str = "nvidia/nemotron-3-ultra-550b-a55b"
    # Base URL the agents use to call back into this API (tool calls). Uses an
    # explicit IPv4 loopback so it never resolves to an IPv6 listener (e.g. a
    # Docker-forwarded port) ahead of the local Uvicorn process.
    agent_internal_api_url: str = "http://127.0.0.1:8000"
    agent_session_ttl_seconds: int = 86400        # 24 hours
    agent_token_ttl_seconds: int = 7776000        # 90 days
    agent_goodwill_cap_usd: float = 75.0          # max goodwill per customer per window
    agent_goodwill_window_days: int = 90          # rolling window for cap enforcement

    # ── Public surfaces ────────────────────────────────────────────────────────
    # Each tenant is reached at {slug}.{host} on two separate surfaces: the
    # customer booking site and the back-office admin app. Held as host:port so
    # local development (different ports) and production (different subdomains
    # on 443) use the same construction.
    # *.localtest.me resolves to 127.0.0.1 publicly, so tenant subdomains work
    # locally with no hosts-file editing.
    #
    # These defaults are DEVELOPMENT values, and they fail quietly if they
    # survive into production: the platform label is what strips the "-rcm"
    # suffix from <slug>-rcm.ceez.ai, so with "localtest.me" configured, the
    # slug for test-rental-co-rcm.ceez.ai comes out as "test-rental-co-rcm",
    # matches no workspace, and every tenant hostname is rejected — including
    # by the on-demand TLS gate, so no certificate is ever issued. Production
    # must set PUBLIC_BOOKING_HOST/PUBLIC_ADMIN_HOST; see the validator below.
    public_booking_host: str = "localtest.me:3400"
    public_admin_host: str = "localtest.me:3002"
    public_counter_host: str = "localtest.me:3001"
    public_url_scheme: str = "http"

    # ── Application ────────────────────────────────────────────────────────────
    sentry_dsn: str = ""
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        """Allow comma-separated string from env var."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

    @field_validator("database_url", mode="before")
    @classmethod
    def ensure_asyncpg_dialect(cls, v: str) -> str:
        """Swap postgresql:// → postgresql+asyncpg:// if operator omitted dialect."""
        if isinstance(v, str) and v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        return v

    @model_validator(mode="after")
    def warn_on_dev_public_hosts(self) -> "Settings":
        """Say so, loudly, if production is still on the localtest defaults.

        This was found in production: both hosts were unset, so every
        <slug>-rcm.ceez.ai resolved to no workspace and the TLS gate refused a
        certificate for every tenant. Nothing logged a complaint — the feature
        simply did not work. A warning is enough; raising here would take the
        API down over a setting that only affects per-tenant hostnames.
        """
        if self.env == "production":
            stale = [
                name
                for name, value in (
                    ("PUBLIC_BOOKING_HOST", self.public_booking_host),
                    ("PUBLIC_ADMIN_HOST", self.public_admin_host),
                    ("PUBLIC_COUNTER_HOST", self.public_counter_host),
                )
                if "localtest.me" in (value or "")
            ]
            if stale:
                import warnings

                warnings.warn(
                    f"{', '.join(stale)} still set to the localtest.me development "
                    "default in production. Per-tenant hostnames will not resolve "
                    "and on-demand TLS will refuse every certificate.",
                    stacklevel=2,
                )
        return self


@lru_cache
def get_settings() -> Settings:
    """Singleton — call get_settings() everywhere; cache avoids repeated I/O."""
    return Settings()


settings = get_settings()
