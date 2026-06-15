# Rental Car Manager — API Architecture

> **Audience:** Backend engineers implementing the FastAPI service.
> **Status:** Implementation-ready specification (June 2026).
> **Sources:** ARCHITECTURE.md · BACKLOG.md (API-001–025, AUTH-001–009, INT-001–003) · FEATURES.md §21–22 · §29.2 RBAC.
>
> Every code block in this document is the authoritative pattern. Do not deviate without a documented ADR.

---

## Table of Contents

1. [apps/api/ File Tree](#1-appsapi-file-tree)
2. [Application Factory](#2-application-factory)
3. [Configuration Management](#3-configuration-management)
4. [Database Session & GUC Injection](#4-database-session--guc-injection)
5. [Authentication System](#5-authentication-system)
6. [RBAC Architecture](#6-rbac-architecture)
7. [BaseRepository Pattern](#7-baserepository-pattern)
8. [Error Handling — RFC 7807](#8-error-handling--rfc-7807)
9. [Integration Client Pattern](#9-integration-client-pattern)
10. [Domain Module Structure](#10-domain-module-structure)
11. [WebSocket Architecture](#11-websocket-architecture)
12. [OpenAPI & TypeScript Client Generation](#12-openapi--typescript-client-generation)

---

## 1. apps/api/ File Tree

```
apps/api/
├── app/
│   ├── main.py                          # App factory, lifespan handler, router registration
│   ├── instrumentation.py               # OpenTelemetry init (FastAPI + SQLAlchemy + Redis)
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py                    # pydantic-settings BaseSettings
│   │   ├── database.py                  # create_async_engine, get_session, GUC injection
│   │   ├── redis.py                     # Three Redis pool factories (avail / broker / session)
│   │   ├── security.py                  # JWT encode/decode, get_current_user, UserClaims
│   │   ├── dependencies.py              # Shared FastAPI dependency providers
│   │   ├── repository.py                # Generic BaseRepository[ModelT]
│   │   ├── exceptions.py                # AppError hierarchy + RFC 7807 handler
│   │   ├── middleware.py                # RequestID, StructLog, TenantResolution
│   │   └── rbac.py                      # require_permission factory, permission matrix
│   │
│   ├── integrations/
│   │   ├── __init__.py
│   │   ├── base.py                      # IntegrationClient + CircuitBreaker + retry
│   │   ├── stripe_client.py             # Stripe SDK wrapper (extends IntegrationClient)
│   │   ├── avalara_client.py            # Avalara AvaTax
│   │   ├── twilio_client.py             # Twilio SMS
│   │   ├── sendgrid_client.py           # SendGrid email
│   │   ├── nhtsa_client.py              # NHTSA vPIC VIN decode + Recalls
│   │   ├── aamva_client.py              # AAMVA DLDV SOAP (Phase 2)
│   │   ├── geotab_client.py             # Geotab telematics (Phase 3)
│   │   └── samsara_client.py            # Samsara telematics (Phase 3)
│   │
│   ├── domains/
│   │   ├── auth/
│   │   │   ├── __init__.py
│   │   │   ├── router.py
│   │   │   ├── service.py
│   │   │   ├── repository.py
│   │   │   ├── schemas.py
│   │   │   └── models.py
│   │   ├── fleet/            # (same 5-file layout — see §10)
│   │   ├── reservations/
│   │   ├── checkout/
│   │   ├── customers/
│   │   ├── pricing/
│   │   ├── payments/
│   │   ├── damage/
│   │   ├── maintenance/
│   │   ├── corporate/
│   │   ├── reporting/
│   │   ├── notifications/
│   │   ├── channels/
│   │   ├── admin/
│   │   └── billing/
│   │
│   └── worker/
│       ├── __init__.py
│       ├── celery_app.py                # Celery app factory + queue routing
│       ├── celeryconfig.py              # Serializer, result backend, prefetch
│       └── tasks/
│           ├── notifications.py
│           ├── rate_filing.py
│           ├── reports.py
│           ├── batch.py
│           └── toll_processing.py
│
├── alembic/
│   ├── env.py                           # Async SQLAlchemy env, include_schemas=True
│   ├── script.py.mako
│   └── versions/                        # Migration files (expand-contract pattern)
│
├── tests/
│   ├── conftest.py                      # Fixtures: db, session, redis, factory-boy, auth token
│   ├── core/
│   │   ├── test_auth.py
│   │   ├── test_rbac.py
│   │   └── test_repository.py
│   ├── domains/
│   │   ├── test_fleet.py
│   │   ├── test_reservations.py
│   │   ├── test_payments.py
│   │   └── ...
│   └── integration/
│       ├── test_db_constraints.py       # Exclusion constraint, state machine, uniqueness
│       └── test_stripe_webhook.py
│
├── Dockerfile                           # Multi-stage, Python 3.12-slim, uid 1000, arm64
├── requirements.txt                     # Pinned (pip-compile generated)
└── pyproject.toml                       # ruff + mypy --strict config
```

---

## 2. Application Factory

### 2.1 Lifespan Handler

The `lifespan` context manager replaces `@app.on_event` (deprecated in FastAPI 0.93+). It runs startup logic before the app accepts traffic and teardown after the last request.

```python
# app/main.py
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, dispose_engine
from app.core.redis import init_redis_pools, close_redis_pools
from app.core.exceptions import AppError, app_error_handler
from app.core.middleware import RequestIDMiddleware, StructuredLoggingMiddleware
from app.core.rbac import load_permission_matrix
from app.instrumentation import init_tracing


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup: init connections and permission cache. Shutdown: drain pools."""
    # Startup
    await init_redis_pools()          # Three pools: avail, broker, session
    await load_permission_matrix()    # DB → in-memory permission cache
    init_tracing(app)                 # OpenTelemetry (FastAPI + SQLAlchemy + Redis)
    yield
    # Shutdown
    await close_redis_pools()
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Rental Car Manager API",
        version="1.0.0",
        # Hide docs in production — engineers access via staging
        docs_url="/api/docs" if settings.env != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.env != "production" else None,
        # Stable operation IDs for TypeScript client generation (see §12)
        generate_unique_id_function=lambda route: (
            f"{route.tags[0]}-{route.name}" if route.tags else route.name
        ),
        servers=[
            {"url": "https://api.rcm.app", "description": "Production"},
            {"url": "https://api.staging.rcm.app", "description": "Staging"},
            {"url": "http://localhost:8000", "description": "Local development"},
        ],
        lifespan=lifespan,
    )

    # ── Middleware stack (applied bottom-up; first-registered = outermost) ──────
    # Order matters: RequestID must be set before logging reads it.
    app.add_middleware(RequestIDMiddleware)           # 1. Inject X-Request-ID header
    app.add_middleware(StructuredLoggingMiddleware)   # 2. Structured log per request
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,                      # required for httpOnly cookie
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Tenant-ID", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    # ── Exception handlers ──────────────────────────────────────────────────────
    app.add_exception_handler(AppError, app_error_handler)

    # ── Router registration ─────────────────────────────────────────────────────
    from app.domains.auth.router         import router as auth_router
    from app.domains.fleet.router        import router as fleet_router
    from app.domains.reservations.router import router as res_router
    from app.domains.checkout.router     import router as checkout_router
    from app.domains.customers.router    import router as customers_router
    from app.domains.pricing.router      import router as pricing_router
    from app.domains.payments.router     import router as payments_router
    from app.domains.damage.router       import router as damage_router
    from app.domains.maintenance.router  import router as maintenance_router
    from app.domains.corporate.router    import router as corporate_router
    from app.domains.reporting.router    import router as reporting_router
    from app.domains.notifications.router import router as notifications_router
    from app.domains.channels.router     import router as channels_router
    from app.domains.admin.router        import router as admin_router
    from app.domains.billing.router      import router as billing_router

    PREFIX = "/api/v1"
    app.include_router(auth_router,          prefix=f"{PREFIX}/auth",          tags=["auth"])
    app.include_router(fleet_router,         prefix=f"{PREFIX}/fleet",         tags=["fleet"])
    app.include_router(res_router,           prefix=f"{PREFIX}/reservations",  tags=["reservations"])
    app.include_router(checkout_router,      prefix=f"{PREFIX}/checkout",      tags=["checkout"])
    app.include_router(customers_router,     prefix=f"{PREFIX}/customers",     tags=["customers"])
    app.include_router(pricing_router,       prefix=f"{PREFIX}/pricing",       tags=["pricing"])
    app.include_router(payments_router,      prefix=f"{PREFIX}/payments",      tags=["payments"])
    app.include_router(damage_router,        prefix=f"{PREFIX}/damage",        tags=["damage"])
    app.include_router(maintenance_router,   prefix=f"{PREFIX}/maintenance",   tags=["maintenance"])
    app.include_router(corporate_router,     prefix=f"{PREFIX}/corporate",     tags=["corporate"])
    app.include_router(reporting_router,     prefix=f"{PREFIX}/reporting",     tags=["reporting"])
    app.include_router(notifications_router, prefix=f"{PREFIX}/notifications", tags=["notifications"])
    app.include_router(channels_router,      prefix=f"{PREFIX}/channels",      tags=["channels"])
    app.include_router(admin_router,         prefix=f"{PREFIX}/admin",         tags=["admin"])
    app.include_router(billing_router,       prefix=f"{PREFIX}/billing",       tags=["billing"])

    # Health check — no auth, no prefix (ALB health check target)
    from app.core.dependencies import health_router
    app.include_router(health_router)

    return app


app = create_app()
```

### 2.2 Middleware Stack (Execution Order)

Starlette applies middleware in the reverse of registration order (last-registered wraps outermost). The table below shows the order in which a request passes through each layer.

| Order (request in) | Middleware | Purpose |
|---|---|---|
| 1 | `CORSMiddleware` | Preflight OPTIONS; CORS headers on response |
| 2 | `StructuredLoggingMiddleware` | structlog context vars; emit access log on response |
| 3 | `RequestIDMiddleware` | Read or generate `X-Request-ID`; attach to `request.state.request_id` |
| 4 | FastAPI route handler | Auth dependencies, business logic, response |

### 2.3 Health Endpoint

```python
# app/core/dependencies.py (health section)
from fastapi import APIRouter
from sqlalchemy import text
from app.core.database import AsyncSessionLocal
from app.core.redis import get_session_redis

health_router = APIRouter()

@health_router.get("/health", include_in_schema=False)
async def health_check():
    """ALB health check: ping DB and Redis. 503 on failure."""
    # DB ping
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    # Redis ping
    redis = await get_session_redis()
    await redis.ping()
    return {"status": "ok"}
```

---

## 3. Configuration Management

### 3.1 pydantic-settings BaseSettings

All configuration derives from environment variables or AWS Secrets Manager (injected at ECS container start as env vars). `SecretStr` fields are never logged or serialized — `.get_secret_value()` must be called explicitly.

```python
# app/core/config.py
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyUrl, PostgresDsn, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        # In production, env vars are injected by ECS / Secrets Manager.
        # .env is only read in local development.
    )

    # ── Deployment environment ──────────────────────────────────────────────────
    env: Literal["development", "test", "staging", "production"] = "development"

    # ── PostgreSQL (asyncpg dialect) ────────────────────────────────────────────
    # Full DSN including credentials — supplied from Secrets Manager in prod.
    # Format: postgresql+asyncpg://user:password@host:5432/dbname
    database_url: SecretStr

    # ── Redis (three separate clusters in prod; one in dev) ────────────────────
    redis_session_url: SecretStr          # volatile-lru; JWT sessions, OTPs, locks
    redis_avail_url: SecretStr            # allkeys-lru; availability query cache
    redis_broker_url: SecretStr           # noeviction; Celery task broker

    # ── JWT ────────────────────────────────────────────────────────────────────
    # SecretStr prevents accidental logging. Minimum 64 hex chars (256 bits).
    jwt_secret_key: SecretStr
    jwt_algorithm: str = "HS256"
    # Access token TTL varies by app context; counter agents get 8h.
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
    stripe_webhook_secret: SecretStr      # Used to verify webhook signature

    # ── Avalara ────────────────────────────────────────────────────────────────
    avalara_account_id: str
    avalara_license_key: SecretStr
    avalara_company_code: str
    avalara_environment: Literal["sandbox", "production"] = "production"

    # ── Twilio ─────────────────────────────────────────────────────────────────
    twilio_account_sid: str
    twilio_auth_token: SecretStr
    twilio_from_number: str               # E.164 format e.g. +15551234567

    # ── SendGrid ───────────────────────────────────────────────────────────────
    sendgrid_api_key: SecretStr
    sendgrid_from_email: str = "noreply@rcm.app"
    sendgrid_from_name: str = "Rental Car Manager"

    # ── AWS ────────────────────────────────────────────────────────────────────
    aws_region: str = "us-east-1"
    s3_documents_bucket: str
    s3_photos_bucket: str
    s3_reports_bucket: str

    # ── Application ────────────────────────────────────────────────────────────
    # Sentry DSN — empty string disables Sentry (non-prod environments may omit)
    sentry_dsn: str = ""
    # Log level: DEBUG in dev, INFO in staging/prod
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


@lru_cache
def get_settings() -> Settings:
    """Singleton — call get_settings() everywhere; cache avoids repeated I/O."""
    return Settings()


settings = get_settings()
```

### 3.2 Secret Resolution Hierarchy

| Precedence | Source | When Used |
|---|---|---|
| 1 (highest) | ECS task definition `secrets` block (Secrets Manager) | Production / Staging |
| 2 | Shell environment variables | CI, Docker Compose |
| 3 | `.env` file (never committed) | Local development |
| 4 | `pydantic-settings` default value | Non-sensitive defaults only |

Secret fields (type `SecretStr`) never have default values — a missing secret causes startup failure, not a silent fallback.

### 3.3 SECRET_KEY vs SecretStr Distinction

`jwt_secret_key` is typed `SecretStr`. Consuming code must call `.get_secret_value()` at the point of use — it is never passed as a plain `str` across function boundaries.

```python
# Correct
payload = jose.jwt.encode(claims, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm)

# WRONG — never do this
secret = settings.jwt_secret_key  # This is still a SecretStr object, not the value
```

---

## 4. Database Session & GUC Injection

### 4.1 Engine Setup

```python
# app/core/database.py
from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy import event, text

from app.core.config import settings

# PgBouncer runs in transaction-mode pooling as a sidecar.
# The application connects to localhost:5432 (PgBouncer), not RDS directly.
# NullPool is NOT used — PgBouncer manages its own pool; SQLAlchemy maintains
# a small pool for the asyncpg connections to PgBouncer.
engine = create_async_engine(
    settings.database_url.get_secret_value(),
    pool_size=5,          # Connections per Fargate task to PgBouncer
    max_overflow=10,
    pool_pre_ping=True,   # Issues SELECT 1 on checkout; detects stale connections
    pool_recycle=3600,    # Recycle connections every hour to prevent GUC leakage
    echo=settings.env == "development",
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,   # Avoid lazy-load after commit in async context
    autoflush=False,          # Explicit flush control in service layer
    autocommit=False,
)


async def dispose_engine() -> None:
    """Called from lifespan shutdown."""
    await engine.dispose()
```

### 4.2 get_session — Complete Implementation

`get_session` is the raw session provider. **Do not call it directly in route handlers.** Route handlers should use `get_db` (see §4.3), which injects GUC session variables after the RBAC dependency resolves the user claims.

```python
# app/core/database.py (continued)

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Bare session — no GUC injection. Used by health check and Celery tasks."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

### 4.3 Authenticated Session — 5 GUC Injections

Route handlers that need RLS enforcement use `get_db`, which requires `UserClaims` from the RBAC dependency. The GUC variables feed:

1. PostgreSQL RLS policies (`app.current_tenant_id`)
2. Audit trigger function (`app.current_user_id`, `app.current_role`, `app.client_ip`, `app.request_id`)

```python
# app/core/database.py (continued)
from app.core.security import UserClaims

async def get_db(
    claims: UserClaims,
    request_id: str,
    client_ip: str,
    session: AsyncSession,
) -> AsyncGenerator[AsyncSession, None]:
    """
    Set all 5 PostgreSQL GUC session variables within this transaction.
    Must be called BEFORE any query that touches RLS-protected tables.

    The `true` third argument to set_config() scopes the value to the
    current transaction only (not the full connection) — critical for
    connection-pool reuse safety.
    """
    await session.execute(
        text(
            "SELECT "
            "  set_config('app.current_tenant_id', :tid,  true), "
            "  set_config('app.current_user_id',   :uid,  true), "
            "  set_config('app.current_role',       :role, true), "
            "  set_config('app.client_ip',          :ip,   true), "
            "  set_config('app.request_id',         :rid,  true)"
        ),
        {
            "tid":  str(claims.tenant_id),
            "uid":  str(claims.user_id),
            "role": claims.primary_role,
            "ip":   client_ip,
            "rid":  request_id,
        },
    )
    yield session
```

**GUC variable reference:**

| GUC Name | Type | Source | Used By |
|---|---|---|---|
| `app.current_tenant_id` | `uuid` | `UserClaims.tenant_id` | All RLS `USING` clauses |
| `app.current_user_id` | `uuid` | `UserClaims.user_id` | `audit.log_changes()` trigger |
| `app.current_role` | `text` | `UserClaims.primary_role` | Audit trigger; app_service bypass decision |
| `app.client_ip` | `inet` | `request.client.host` (via `X-Forwarded-For` after WAF) | Audit trigger |
| `app.request_id` | `text` | `request.state.request_id` (set by RequestIDMiddleware) | Audit trigger; correlation in logs |

### 4.4 Dependency Chain in Route Handlers

```python
# Example — fleet router
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_session, get_db
from app.core.rbac import require_permission
from app.core.security import UserClaims

async def get_db_with_claims(
    request: Request,
    claims: UserClaims = Depends(require_permission("fleet", "update")),
    session: AsyncSession = Depends(get_session),
) -> AsyncGenerator[AsyncSession, None]:
    client_ip = request.headers.get("X-Forwarded-For", request.client.host).split(",")[0].strip()
    async for db in get_db(claims, request.state.request_id, client_ip, session):
        yield db
```

---

## 5. Authentication System

### 5.1 UserClaims Dataclass

`UserClaims` is the parsed, validated representation of a JWT. It is the object passed through the entire dependency injection chain — from `get_current_user` to repositories to audit logging.

```python
# app/core/security.py
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional

from jose import JWTError, jwt
from fastapi import Cookie, HTTPException, Request, status

from app.core.config import settings
from app.core.redis import get_session_redis


@dataclass(frozen=True)
class UserClaims:
    """
    Parsed JWT access token claims.

    Immutable (frozen=True) — never mutate after construction.
    This object is created once per request in get_current_user().
    """
    sub: str               # user_id as string (JWT standard claim)
    jti: str               # JWT ID — unique per token; checked against Redis revocation set
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    roles: list[str]       # All roles the user holds (may hold multiple)
    primary_role: str      # The highest-privilege role for GUC injection and audit
    location_ids: list[uuid.UUID]  # Location scope — empty = global (System Admin / Super Admin)
    exp: int               # Expiry epoch (standard JWT claim)
    iat: int               # Issued-at epoch (standard JWT claim)
    app_context: str       # "counter" | "web" | "admin" — determines access token TTL
```

### 5.2 Token Claim Structure

```python
# Exact claim dictionary written into the JWT
def _build_access_token_claims(
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    roles: list[str],
    primary_role: str,
    location_ids: list[uuid.UUID],
    jti: str,
    app_context: str,  # "counter" | "web" | "admin"
) -> dict:
    now = datetime.now(timezone.utc)
    if app_context == "counter":
        ttl = timedelta(seconds=settings.jwt_access_token_ttl_counter_seconds)
    else:
        ttl = timedelta(seconds=settings.jwt_access_token_ttl_web_seconds)

    return {
        # Standard JWT claims
        "sub":         str(user_id),
        "jti":         jti,
        "iat":         int(now.timestamp()),
        "exp":         int((now + ttl).timestamp()),
        # Custom claims
        "tenant_id":   str(tenant_id),
        "user_id":     str(user_id),   # redundant with sub; explicit for clarity
        "roles":       roles,
        "primary_role": primary_role,
        "location_ids": [str(lid) for lid in location_ids],
        "app_context": app_context,
    }
```

### 5.3 Complete JWT Flow

#### Login

```python
# app/domains/auth/service.py
import uuid
from datetime import datetime, timezone, timedelta

from jose import jwt
from passlib.context import CryptContext
from fastapi import Response

from app.core.config import settings
from app.core.redis import get_session_redis
from app.core.security import _build_access_token_claims

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Redis key constants (app/core/redis_keys.py)
REVOKED_TOKENS_KEY = "revoked_tokens"           # SET of revoked JTIs
REFRESH_TOKEN_KEY  = "refresh:{jti}"            # STRING: user_id (TTL = refresh TTL)
SESSION_KEY        = "session:{jti}"            # STRING: user_id (TTL = access TTL)


async def login(
    email: str,
    password: str,
    app_context: str,
    response: Response,
    db: AsyncSession,
) -> dict:
    user = await _authenticate_user(email, password, db)
    if not user:
        raise InvalidCredentialsError()

    await _check_lockout(user.user_id)

    # Generate unique token IDs
    access_jti  = str(uuid.uuid4())
    refresh_jti = str(uuid.uuid4())

    # Build tokens
    access_claims  = _build_access_token_claims(
        user_id=user.user_id,
        tenant_id=user.tenant_id,
        roles=user.roles,
        primary_role=user.primary_role,
        location_ids=user.location_ids,
        jti=access_jti,
        app_context=app_context,
    )
    refresh_claims = {
        "sub":         str(user.user_id),
        "jti":         refresh_jti,
        "tenant_id":   str(user.tenant_id),
        "iat":         int(datetime.now(timezone.utc).timestamp()),
        "exp":         int((datetime.now(timezone.utc) + timedelta(
                            seconds=settings.jwt_refresh_token_ttl_seconds
                       )).timestamp()),
        "type":        "refresh",
        "access_jti":  access_jti,   # links refresh to its paired access token
    }

    secret = settings.jwt_secret_key.get_secret_value()
    access_token  = jwt.encode(access_claims,  secret, algorithm=settings.jwt_algorithm)
    refresh_token = jwt.encode(refresh_claims, secret, algorithm=settings.jwt_algorithm)

    # Store session in Redis for revocation support
    redis = await get_session_redis()
    access_ttl  = (settings.jwt_access_token_ttl_counter_seconds
                   if app_context == "counter"
                   else settings.jwt_access_token_ttl_web_seconds)
    await redis.setex(SESSION_KEY.format(jti=access_jti),
                      access_ttl, str(user.user_id))
    await redis.setex(REFRESH_TOKEN_KEY.format(jti=refresh_jti),
                      settings.jwt_refresh_token_ttl_seconds, str(user.user_id))

    # Set httpOnly Secure SameSite=Strict cookies
    # access_token cookie is readable from /api/* paths only
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/api",
        max_age=access_ttl,
    )
    # refresh_token cookie is restricted to the /api/v1/auth/refresh path only
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/api/v1/auth/refresh",
        max_age=settings.jwt_refresh_token_ttl_seconds,
    )

    return {"message": "Authenticated", "app_context": app_context}
```

#### Token Refresh (Rotation)

```python
# app/domains/auth/service.py (continued)

async def refresh_access_token(
    refresh_token_value: str,
    app_context: str,
    response: Response,
    db: AsyncSession,
) -> dict:
    """
    Refresh token rotation:
    1. Decode and validate the refresh token
    2. Verify the refresh JTI is not revoked
    3. Issue a NEW access token with a NEW access JTI
    4. Issue a NEW refresh token with a NEW refresh JTI (rotation)
    5. Invalidate the old refresh token JTI in Redis
    6. Set both new cookies
    """
    secret = settings.jwt_secret_key.get_secret_value()
    try:
        payload = jwt.decode(refresh_token_value, secret,
                             algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise TokenInvalidError()

    if payload.get("type") != "refresh":
        raise TokenInvalidError()

    redis = await get_session_redis()
    old_refresh_jti = payload["jti"]

    # Check revocation
    if await redis.sismember(REVOKED_TOKENS_KEY, old_refresh_jti):
        # Possible token theft — revoke entire session tree
        await _revoke_all_sessions_for_user(payload["sub"], redis)
        raise TokenRevokedError()

    # Delete old refresh session record
    await redis.delete(REFRESH_TOKEN_KEY.format(jti=old_refresh_jti))
    # Add old refresh JTI to revoked set (TTL = remaining time on old token)
    remaining = payload["exp"] - int(datetime.now(timezone.utc).timestamp())
    if remaining > 0:
        await redis.setex(f"revoked:{old_refresh_jti}", remaining, "1")

    # Load user to get current roles (may have changed since token issuance)
    user = await _load_user(uuid.UUID(payload["sub"]), db)

    new_access_jti  = str(uuid.uuid4())
    new_refresh_jti = str(uuid.uuid4())

    # ... build and set new tokens (same as login flow)
    # (omitted for brevity — identical to login token issuance above)

    return {"message": "Token refreshed"}
```

#### Logout

```python
async def logout(
    access_jti: str,
    refresh_jti: Optional[str],
    response: Response,
) -> None:
    """
    Add both JTIs to the Redis revoked_tokens SET.
    TTL on each member = remaining token lifetime (Redis EXPIREAT).
    The SET itself has no TTL — members expire individually.
    """
    redis = await get_session_redis()
    now = int(datetime.now(timezone.utc).timestamp())

    # Revoke access token
    await redis.sadd(REVOKED_TOKENS_KEY, access_jti)

    # Revoke refresh token if provided (it always should be on explicit logout)
    if refresh_jti:
        await redis.sadd(REVOKED_TOKENS_KEY, refresh_jti)
        await redis.delete(REFRESH_TOKEN_KEY.format(jti=refresh_jti))

    await redis.delete(SESSION_KEY.format(jti=access_jti))

    # Clear cookies
    response.delete_cookie("access_token",  path="/api")
    response.delete_cookie("refresh_token", path="/api/v1/auth/refresh")
```

### 5.4 get_current_user Dependency

```python
# app/core/security.py (continued)

async def get_current_user(
    access_token: Optional[str] = Cookie(default=None, alias="access_token"),
) -> UserClaims:
    """
    FastAPI dependency. Validates the access token from the httpOnly cookie.
    Raises HTTP 401 on any failure — never leaks which check failed.
    """
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        payload = jwt.decode(
            access_token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # Revocation check — O(1) Redis SISMEMBER
    redis = await get_session_redis()
    if await redis.sismember(REVOKED_TOKENS_KEY, payload["jti"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        return UserClaims(
            sub=payload["sub"],
            jti=payload["jti"],
            tenant_id=uuid.UUID(payload["tenant_id"]),
            user_id=uuid.UUID(payload["user_id"]),
            roles=payload["roles"],
            primary_role=payload["primary_role"],
            location_ids=[uuid.UUID(lid) for lid in payload.get("location_ids", [])],
            exp=payload["exp"],
            iat=payload["iat"],
            app_context=payload.get("app_context", "web"),
        )
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
```

### 5.5 /auth/me Endpoint

```python
# app/domains/auth/router.py (excerpt)

@router.get("/me", response_model=UserProfile)
async def get_me(
    claims: UserClaims = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> UserProfile:
    """
    Returns the authenticated user's profile and current roles.
    Called by the frontend AuthProvider on every app load.
    Does NOT inject GUCs — read-only, no RLS-protected data needed.
    """
    user = await auth_repo.get_user_profile(claims.user_id, db)
    return UserProfile(
        user_id=claims.user_id,
        tenant_id=claims.tenant_id,
        email=user.email,
        name=user.full_name,
        roles=claims.roles,
        primary_role=claims.primary_role,
        location_ids=claims.location_ids,
        app_context=claims.app_context,
    )
```

### 5.6 Auth Router Endpoints

```
POST   /api/v1/auth/login           → login (sets httpOnly cookies)
POST   /api/v1/auth/refresh         → refresh (reads refresh_token cookie, rotates both)
POST   /api/v1/auth/logout          → logout (revokes JTIs, clears cookies)
GET    /api/v1/auth/me              → current user profile
POST   /api/v1/auth/password/reset-request  → initiate password reset (sends email)
POST   /api/v1/auth/password/reset          → complete password reset (validates token)
POST   /api/v1/auth/mfa/enroll      → TOTP setup (returns provisioning URI + recovery codes)
POST   /api/v1/auth/mfa/verify      → verify TOTP code
DELETE /api/v1/auth/sessions/{jti}  → force-terminate a specific session (admin)
DELETE /api/v1/auth/sessions        → force-terminate all sessions for a user (admin)
```

### 5.7 WebSocket Token Verification

WebSocket connections cannot use Cookie headers in the standard handshake from browser JavaScript. The token is passed as a query parameter and verified on upgrade.

```python
# app/core/security.py

async def verify_ws_token(
    token: Optional[str] = Query(default=None),
) -> UserClaims:
    """
    WebSocket connection dependency. Token passed as ?token=<jwt> query param.
    The token value is the same access JWT stored in the httpOnly cookie —
    the counter app reads document.cookie is NOT possible (httpOnly).

    Implementation note: the counter app fetches a short-lived (60s) WS-specific
    token from POST /api/v1/fleet/ws-token, which returns a one-time token stored
    in Redis. This avoids exposing the primary access token in URLs.
    """
    if not token:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
    # ... same decode + revocation check as get_current_user
```

---

## 6. RBAC Architecture

### 6.1 Role Definitions (12 Roles)

| Role Constant | Display Name | Scope |
|---|---|---|
| `CUSTOMER` | Customer | Own records only |
| `CORPORATE_BOOKER` | Corporate Booker | Own records + corporate account |
| `COUNTER_AGENT` | Counter Agent | Location(s) in `location_ids` claim |
| `SENIOR_AGENT` | Senior Agent | Location(s) in `location_ids` claim |
| `BRANCH_MANAGER` | Branch Manager | Location(s) in `location_ids` claim |
| `REGIONAL_MANAGER` | Regional Manager | All locations in assigned region |
| `FLEET_MANAGER` | Fleet Manager | All locations (fleet operations) |
| `MAINTENANCE_TECH` | Maintenance Technician | All locations (maintenance only) |
| `CLAIMS_COORDINATOR` | Claims Coordinator | Assigned locations |
| `FINANCE` | Finance / AR | All locations (financial data) |
| `SYSTEM_ADMIN` | System Administrator | Tenant-wide |
| `SUPER_ADMIN` | Super Admin / Owner | Tenant-wide, all capabilities |
| `API_PARTNER` | API Partner | Scoped by API key permissions |

### 6.2 Permission Matrix (Partial — Core Resources)

The full matrix is stored in the `staff_roles` table as a `permissions_json` JSONB column. The in-memory cache mirrors this structure. A permission is `{resource}:{action}`.

| Role | `fleet:read` | `fleet:update` | `reservations:create` | `reservations:cancel` | `payments:refund` | `damage:manage` | `admin:config` |
|---|---|---|---|---|---|---|---|
| COUNTER_AGENT | ✓ | — | ✓ | ✓ | — | ✓ (record) | — |
| SENIOR_AGENT | ✓ | — | ✓ | ✓ | ✓ (small) | ✓ | — |
| BRANCH_MANAGER | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| FLEET_MANAGER | ✓ | ✓ | — | — | — | ✓ | — |
| CLAIMS_COORDINATOR | ✓ | — | — | — | ✓ | ✓ | — |
| FINANCE | ✓ | — | — | — | ✓ | ✓ (view) | — |
| SYSTEM_ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| SUPER_ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| API_PARTNER | ✓ | — | ✓ | ✓ | — | — | — |

### 6.3 Permission Matrix Loading

```python
# app/core/rbac.py
import asyncio
from typing import FrozenSet

from app.core.database import AsyncSessionLocal
from sqlalchemy import text

# In-memory permission cache: role → frozenset of "resource:action" strings
_PERMISSION_MATRIX: dict[str, FrozenSet[str]] = {}
_MATRIX_LOCK = asyncio.Lock()

# Permission cache TTL is process lifetime (reloaded on container restart).
# A SYSTEM_ADMIN updating role permissions takes effect on the NEXT deploy
# or by triggering a manual reload via POST /api/v1/admin/rbac/reload.
# This is intentional — permissions are a security boundary, not a config knob.

async def load_permission_matrix() -> None:
    """
    Called once from lifespan startup.
    Loads the permission matrix from staff_roles.permissions_json into memory.
    Also callable via /api/v1/admin/rbac/reload (SUPER_ADMIN only).
    """
    global _PERMISSION_MATRIX
    async with _MATRIX_LOCK:
        async with AsyncSessionLocal() as session:
            rows = await session.execute(
                text("SELECT role_name, permissions_json FROM staff_roles")
            )
            new_matrix: dict[str, FrozenSet[str]] = {}
            for role_name, permissions in rows:
                # permissions_json is an array of "resource:action" strings
                new_matrix[role_name] = frozenset(permissions or [])
            _PERMISSION_MATRIX = new_matrix


def _has_permission(role: str, resource: str, action: str) -> bool:
    permissions = _PERMISSION_MATRIX.get(role, frozenset())
    return f"{resource}:{action}" in permissions or f"{resource}:*" in permissions


def _has_location_access(claims: UserClaims, location_id: Optional[uuid.UUID]) -> bool:
    """
    Global-scope roles (SYSTEM_ADMIN, SUPER_ADMIN, FLEET_MANAGER, FINANCE,
    REGIONAL_MANAGER) have empty location_ids lists — they see all locations.
    Location-scoped roles have an explicit list.
    """
    if not claims.location_ids:
        return True   # Global scope
    if location_id is None:
        return True   # Request is not location-specific
    return location_id in claims.location_ids
```

### 6.4 require_permission Dependency Factory — Complete Implementation

```python
# app/core/rbac.py (continued)
from typing import Callable, Optional
import uuid

from fastapi import Depends, HTTPException, status

from app.core.security import UserClaims, get_current_user


def require_permission(
    resource: str,
    action: str,
    location_id_param: Optional[str] = None,
) -> Callable:
    """
    Factory that returns a FastAPI dependency enforcing role permission AND
    optional location scope.

    Args:
        resource:          The resource name, e.g. "fleet", "reservations", "payments"
        action:            The action, e.g. "read", "create", "update", "delete", "manage"
        location_id_param: If provided, the name of a path/query parameter containing
                           a location UUID to check against the user's location scope.
                           Example: require_permission("fleet", "read", location_id_param="location_id")

    Usage:
        @router.get("/{vehicle_id}")
        async def get_vehicle(
            vehicle_id: UUID,
            claims: UserClaims = Depends(require_permission("fleet", "read")),
        ): ...

        @router.post("/")
        async def create_reservation(
            payload: CreateReservationRequest,
            claims: UserClaims = Depends(
                require_permission("reservations", "create", location_id_param="location_id")
            ),
        ): ...
    """
    async def _dependency(
        request: Request,
        claims: UserClaims = Depends(get_current_user),
    ) -> UserClaims:
        # Check role permission
        has_perm = any(
            _has_permission(role, resource, action) for role in claims.roles
        )
        if not has_perm:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "type":   "https://errors.rcm.app/permission-denied",
                    "title":  "Permission Denied",
                    "status": 403,
                    "detail": f"Role(s) {claims.roles} cannot perform '{action}' on '{resource}'",
                },
            )

        # Check location scope (if applicable)
        if location_id_param:
            raw_loc = (
                request.path_params.get(location_id_param)
                or request.query_params.get(location_id_param)
            )
            if raw_loc:
                try:
                    loc_uuid = uuid.UUID(raw_loc)
                except ValueError:
                    loc_uuid = None
                if loc_uuid and not _has_location_access(claims, loc_uuid):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail={
                            "type":   "https://errors.rcm.app/location-scope-denied",
                            "title":  "Location Access Denied",
                            "status": 403,
                            "detail": f"User does not have access to location {raw_loc}",
                        },
                    )

        # GUC injection happens AFTER permission check succeeds.
        # The session dependency (get_db_with_claims) calls get_db() with these claims.
        return claims

    return _dependency
```

### 6.5 RBAC + RLS: Belt and Suspenders

Two independent enforcement layers prevent data leaks:

1. **FastAPI dependency** (`require_permission`) — checked before any code runs; raises 403 before a DB connection is even acquired.
2. **PostgreSQL RLS** (`tenant_isolation` policy on every table) — enforced by the database for every query after GUC injection. Even if application code has a bug, RLS blocks cross-tenant data access.

JWT payloads contain **roles only, never permissions**. The permission matrix is server-side state. A user cannot escalate privileges by forging token claims.

---

## 7. BaseRepository Pattern

### 7.1 Generic BaseRepository[ModelT]

```python
# app/core/repository.py
from __future__ import annotations

import uuid
from typing import Any, Generic, Optional, Sequence, Type, TypeVar

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime, timezone


ModelT = TypeVar("ModelT", bound=DeclarativeBase)


class BaseRepository(Generic[ModelT]):
    """
    Generic tenant-isolated repository.

    Subclasses declare the `model` class attribute:

        class FleetRepository(BaseRepository[Vehicle]):
            model = Vehicle

    The application-layer `_tenant_filter()` works alongside PostgreSQL RLS.
    Both filter by tenant_id — RLS as the DB guarantee, application filter
    as defense-in-depth (and to produce cleaner query plans with explicit predicates).
    """

    model: Type[ModelT]

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID) -> None:
        self.session = session
        self.tenant_id = tenant_id

    # ── Private helpers ─────────────────────────────────────────────────────────

    def _tenant_filter(self):
        """
        Combined tenant isolation + soft-delete filter.
        Applied to every query in this repository.

        The GUC `app.current_tenant_id` covers tenant isolation at the DB layer.
        This application-layer filter:
          (a) produces index-friendly WHERE clauses (the PK is tenant_id + id)
          (b) provides defense-in-depth if a query bypasses GUC injection
          (c) soft-delete filter (deleted_at IS NULL)
        """
        return and_(
            self.model.tenant_id == self.tenant_id,
            self.model.deleted_at.is_(None),
        )

    def _tenant_filter_include_deleted(self):
        """Use only for admin endpoints that show deleted records."""
        return self.model.tenant_id == self.tenant_id

    # ── Read operations ─────────────────────────────────────────────────────────

    async def get(self, id: uuid.UUID) -> Optional[ModelT]:
        """
        Fetch a single record by primary key.
        Returns None (not 404) — callers raise NotFoundError.
        """
        result = await self.session.execute(
            select(self.model).where(
                self.model.id == id,
                self._tenant_filter(),
            )
        )
        return result.scalar_one_or_none()

    async def get_or_raise(self, id: uuid.UUID) -> ModelT:
        """Convenience: fetch or raise ResourceNotFoundError."""
        from app.core.exceptions import ResourceNotFoundError
        obj = await self.get(id)
        if obj is None:
            raise ResourceNotFoundError(
                resource=self.model.__tablename__,
                resource_id=str(id),
            )
        return obj

    async def list(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        order_by=None,
        filters: Optional[list] = None,
    ) -> list[ModelT]:
        """
        Paginated list of records for the current tenant.

        Args:
            limit:    Page size (max enforced at router level)
            offset:   Pagination offset
            order_by: SQLAlchemy column expression, e.g. Vehicle.created_at.desc()
            filters:  Additional SQLAlchemy WHERE clauses (ANDed with tenant filter)
        """
        stmt = select(self.model).where(self._tenant_filter())
        if filters:
            stmt = stmt.where(*filters)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        else:
            stmt = stmt.order_by(self.model.created_at.desc())
        stmt = stmt.limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count(self, filters: Optional[list] = None) -> int:
        """Total count for pagination metadata."""
        from sqlalchemy import func
        stmt = select(func.count()).select_from(self.model).where(self._tenant_filter())
        if filters:
            stmt = stmt.where(*filters)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    # ── Write operations ────────────────────────────────────────────────────────

    async def create(self, **kwargs: Any) -> ModelT:
        """
        Create a new record.
        tenant_id is always injected from self.tenant_id — callers cannot override it.
        """
        obj = self.model(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            **kwargs,
        )
        self.session.add(obj)
        await self.session.flush()   # Flush to DB but do not commit (caller controls txn)
        await self.session.refresh(obj)
        return obj

    async def update(self, id: uuid.UUID, **kwargs: Any) -> ModelT:
        """
        Update fields on an existing record.
        Always scoped to tenant — cannot update another tenant's record.
        """
        await self.session.execute(
            update(self.model)
            .where(self.model.id == id, self._tenant_filter())
            .values(**kwargs, updated_at=datetime.now(timezone.utc))
        )
        await self.session.flush()
        return await self.get_or_raise(id)

    async def soft_delete(self, id: uuid.UUID) -> None:
        """
        Set deleted_at to now. The exclusion constraint WHERE clause
        (deleted_at IS NULL) immediately releases any VehicleBlock slots.
        Record remains in DB for audit purposes.
        """
        await self.session.execute(
            update(self.model)
            .where(self.model.id == id, self._tenant_filter())
            .values(deleted_at=datetime.now(timezone.utc))
        )
        await self.session.flush()

    async def hard_delete(self, id: uuid.UUID) -> None:
        """
        Permanent deletion. Use ONLY for GDPR erasure flows after legal-hold check.
        Prefer soft_delete in all other cases.
        """
        obj = await self.get_or_raise(id)
        await self.session.delete(obj)
        await self.session.flush()
```

### 7.2 How RLS and Application-Layer Filter Work Together

```
Request arrives:
  ├─ GUC set_config('app.current_tenant_id', 'uuid-A', true)
  │
  └─ Repository._tenant_filter() adds:
       WHERE model.tenant_id = 'uuid-A'   ← application-layer
       AND   model.deleted_at IS NULL
       
  PostgreSQL RLS USING clause adds:
       AND   tenant_id = current_setting('app.current_tenant_id')::uuid
                                          ← database-layer (enforced by PG engine)

Result: tenant isolation is guaranteed at BOTH layers.
If a programming error bypasses the repository filter, RLS still blocks the query.
If GUC injection is skipped (e.g., health check), no RLS-protected tables are touched.
```

### 7.3 Domain Repository Example

```python
# app/domains/fleet/repository.py
from app.core.repository import BaseRepository
from app.domains.fleet.models import Vehicle, VehicleBlock
from sqlalchemy import select, and_
from sqlalchemy.dialects.postgresql import TSTZRANGE


class VehicleRepository(BaseRepository[Vehicle]):
    model = Vehicle

    async def find_available_in_class(
        self,
        class_id: uuid.UUID,
        location_id: uuid.UUID,
        pickup_dt: datetime,
        dropoff_dt: datetime,
    ) -> list[Vehicle]:
        """
        Returns vehicles of the given class at the location that have no
        overlapping vehicle_blocks for the requested period.
        Uses the GiST index on vehicle_blocks for range overlap.
        """
        # Subquery: vehicle IDs that are blocked during the requested range
        blocked_ids = (
            select(VehicleBlock.vehicle_id)
            .where(
                VehicleBlock.tenant_id == self.tenant_id,
                VehicleBlock.deleted_at.is_(None),
                func.tstzrange(VehicleBlock.start_time, VehicleBlock.end_time, "[)").op("&&")(
                    func.tstzrange(pickup_dt, dropoff_dt, "[)")
                ),
            )
            .scalar_subquery()
        )

        result = await self.session.execute(
            select(Vehicle)
            .where(
                self._tenant_filter(),
                Vehicle.class_id == class_id,
                Vehicle.location_id == location_id,
                Vehicle.status == "AVAILABLE",
                Vehicle.id.not_in(blocked_ids),
            )
        )
        return list(result.scalars().all())
```

---

## 8. Error Handling — RFC 7807

### 8.1 AppError Hierarchy

All domain errors inherit from `AppError`. The exception handler serializes them to `application/problem+json` format per RFC 7807.

```python
# app/core/exceptions.py
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
        # Allow subclass overrides at instance level for dynamic messages
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


# ── 4xx Client Errors ───────────────────────────────────────────────────────────

class ResourceNotFoundError(AppError):
    status = 404
    title = "Resource Not Found"
    type_path = "not-found"

    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(f"{resource} with id '{resource_id}' was not found.")
        self.extra = {"resource": resource, "resource_id": resource_id}


class ValidationError(AppError):
    status = 422
    title = "Validation Error"
    type_path = "validation-error"


class ConflictError(AppError):
    status = 409
    title = "Conflict"
    type_path = "conflict"


class AuthenticationError(AppError):
    status = 401
    title = "Authentication Required"
    type_path = "authentication-required"


class PermissionDeniedError(AppError):
    status = 403
    title = "Permission Denied"
    type_path = "permission-denied"


class RateLimitError(AppError):
    status = 429
    title = "Rate Limit Exceeded"
    type_path = "rate-limit-exceeded"

    def __init__(self, retry_after_seconds: int = 60) -> None:
        super().__init__(f"Rate limit exceeded. Retry after {retry_after_seconds} seconds.")
        self.retry_after = retry_after_seconds


# ── Domain-Specific Errors ──────────────────────────────────────────────────────

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
        # Generic message — do not reveal reason to customer
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


# ── Integration / Upstream Errors ───────────────────────────────────────────────

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


# ── RFC 7807 Exception Handler ──────────────────────────────────────────────────

async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """
    FastAPI exception handler for all AppError subclasses.
    Registered in create_app() via app.add_exception_handler(AppError, app_error_handler).

    Response format: RFC 7807 Problem Details for HTTP APIs
    Content-Type: application/problem+json
    """
    content = {
        "type":     exc.type_uri,
        "title":    exc.title,
        "status":   exc.status,
        "detail":   exc.detail,
        "instance": str(request.url),
    }
    if exc.extra:
        content.update(exc.extra)

    headers = {"Content-Type": "application/problem+json"}
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
    maps it to VehicleNotAvailableError.

    Registered separately:
        from asyncpg import exceptions as pg_exc
        app.add_exception_handler(pg_exc.ExclusionViolationError, sqlalchemy_integrity_error_handler)
    """
    from asyncpg.exceptions import ExclusionViolationError
    if isinstance(exc.__cause__, ExclusionViolationError):
        mapped = ExclusionConstraintError()
        return await app_error_handler(request, mapped)
    raise exc
```

### 8.2 RFC 7807 Response Shape

```json
{
  "type":     "https://errors.rcm.app/vehicle-not-available",
  "title":    "Conflict",
  "status":   409,
  "detail":   "Vehicle abc-123 is already booked for 2026-07-01T10:00Z–2026-07-05T10:00Z.",
  "instance": "https://api.rcm.app/api/v1/fleet/abc-123/blocks",
  "vehicle_id": "abc-123",
  "start": "2026-07-01T10:00Z",
  "end":   "2026-07-05T10:00Z"
}
```

`Content-Type: application/problem+json` — all error responses use this content type. Success responses use `application/json`.

---

## 9. Integration Client Pattern

### 9.1 IntegrationClient Base Class — Complete

```python
# app/integrations/base.py
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


# ── Circuit Breaker ─────────────────────────────────────────────────────────────

class CircuitState(Enum):
    CLOSED   = "closed"    # Normal operation
    OPEN     = "open"      # Failing — calls blocked
    HALF_OPEN = "half_open" # Testing recovery


@dataclass
class CircuitBreaker:
    """
    Three-state circuit breaker.

    failure_threshold=5:   5 consecutive failures → OPEN
    recovery_timeout=60:   After 60 seconds in OPEN, move to HALF_OPEN
    success_threshold=2:   2 consecutive successes in HALF_OPEN → CLOSED

    Thread-safe via asyncio.Lock (single-process, event-loop concurrency).
    For multi-process deployments (multiple Fargate tasks), circuit state is
    intentionally per-process — Redis-backed circuit state is an optimization
    deferred to Phase 3. Per-process circuits still protect the upstream service.
    """
    integration_name: str
    failure_threshold: int = 5
    recovery_timeout: int = 60     # seconds
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
            # CLOSED: success resets failure count (already done above)

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


# ── Integration Client Config ────────────────────────────────────────────────────

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
    max_attempts: int = 3         # Total attempts (1 original + 2 retries)
    min_backoff: float = 2.0      # Seconds
    max_backoff: float = 30.0     # Seconds
    jitter_max: float = 1.0       # Random jitter 0–1s to prevent thundering herd


# ── Base Integration Client ─────────────────────────────────────────────────────

class IntegrationClient(ABC):
    """
    Abstract base for all third-party API clients.

    Provides:
    - Circuit breaker (per-client, per-process)
    - Tenacity retry with exponential backoff + jitter
    - Structured logging on success and failure
    - Correlation ID propagation via X-Correlation-ID header
    - httpx.AsyncClient lifecycle management

    Concrete subclasses implement domain-specific methods
    (e.g., StripeClient.create_payment_intent).
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

        Only retries on network-level errors (httpx.TransportError: connection
        refused, timeout, etc.). 4xx errors are NOT retried — they are client
        errors and retrying won't help. 5xx errors are counted as circuit
        breaker failures but retried (upstream may recover).

        IntegrationCircuitOpenError propagation:
            Raised here → propagates to domain service → caught by the RFC 7807
            handler (IntegrationCircuitOpenError.status = 503).
            Domain services must NOT catch IntegrationCircuitOpenError — let it
            propagate so the client receives a 503 with Retry-After guidance.
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
            # 5xx after all retries exhausted
            raise IntegrationError(
                integration=self.config.integration_name,
                detail=(
                    f"{self.config.integration_name} returned HTTP {exc.response.status_code}. "
                    "Please try again later."
                ),
            ) from exc

    # Convenience method shorthands
    async def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("PUT", path, **kwargs)

    async def delete(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.request("DELETE", path, **kwargs)
```

### 9.2 IntegrationCircuitOpenError Propagation

```
IntegrationClient.request()
  └─ circuit.allow_request() → False
      └─ raise IntegrationCircuitOpenError("stripe")    ← 503 status
          └─ domain service (does NOT catch)
              └─ FastAPI exception handler (app_error_handler)
                  └─ returns HTTP 503 {
                       "type": "https://errors.rcm.app/integration-circuit-open",
                       "title": "Integration Temporarily Unavailable",
                       "status": 503,
                       "detail": "The stripe integration is temporarily unavailable.",
                       "retry_after_seconds": 60
                     }
```

Domain services must never catch `IntegrationCircuitOpenError`. They may catch `IntegrationError` and wrap it in domain context, but circuit-open signals must propagate unmodified.

### 9.3 Stripe Client (Domain Implementation Example)

```python
# app/integrations/stripe_client.py
import stripe
from app.integrations.base import IntegrationClient, IntegrationClientConfig
from app.core.config import settings
from app.core.exceptions import StripeError


class StripeClient:
    """
    Wraps the official Stripe Python SDK (not raw HTTP).
    Circuit breaker is applied at the SDK call level, not HTTP level.
    """

    def __init__(self) -> None:
        stripe.api_key = settings.stripe_secret_key.get_secret_value()
        self.circuit = CircuitBreaker("stripe", failure_threshold=5, recovery_timeout=60)

    async def create_payment_intent(
        self,
        amount_cents: int,
        currency: str,
        customer_id: str,
        reservation_id: str,
        idempotency_key: str,
    ) -> stripe.PaymentIntent:
        if not await self.circuit.allow_request():
            raise IntegrationCircuitOpenError("stripe")
        try:
            intent = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency=currency.lower(),
                customer=customer_id,
                capture_method="manual",   # Pre-auth: capture separately at return
                metadata={"reservation_id": reservation_id},
                idempotency_key=idempotency_key,
            )
            await self.circuit.record_success()
            return intent
        except stripe.error.StripeError as exc:
            await self.circuit.record_failure()
            raise StripeError(
                stripe_code=exc.code or "unknown",
                detail=exc.user_message or str(exc),
            ) from exc
```

---

## 10. Domain Module Structure

### 10.1 Standard 5-File Layout

Every domain module follows an identical file layout. No exceptions. Cross-domain calls go through the service layer — never directly between repositories.

```
app/domains/{domain}/
├── __init__.py
├── router.py        # FastAPI router, endpoint functions, no business logic
├── service.py       # Business logic, orchestration, domain error raising
├── repository.py    # Data access layer (extends BaseRepository)
├── schemas.py       # Pydantic request/response models
└── models.py        # SQLAlchemy ORM models
```

### 10.2 Domain Module Template

#### router.py

```python
# app/domains/{domain}/router.py
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.{domain}.schemas import (
    {Model}Response, Create{Model}Request, Update{Model}Request, {Model}ListResponse
)
from app.domains.{domain}.service import {Domain}Service

router = APIRouter()


def get_{domain}_service(
    db: AsyncSession = Depends(get_session),
) -> {Domain}Service:
    """Dependency provider for the service layer."""
    return {Domain}Service(db)


@router.get("/", response_model={Model}ListResponse)
async def list_{models}(
    limit: int = 50,
    offset: int = 0,
    claims: UserClaims = Depends(require_permission("{domain}", "read")),
    service: {Domain}Service = Depends(get_{domain}_service),
) -> {Model}ListResponse:
    items, total = await service.list(
        tenant_id=claims.tenant_id,
        limit=limit,
        offset=offset,
    )
    return {Model}ListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/{id}", response_model={Model}Response)
async def get_{model}(
    id: UUID,
    claims: UserClaims = Depends(require_permission("{domain}", "read")),
    service: {Domain}Service = Depends(get_{domain}_service),
) -> {Model}Response:
    return await service.get(id, tenant_id=claims.tenant_id)


@router.post("/", response_model={Model}Response, status_code=201)
async def create_{model}(
    payload: Create{Model}Request,
    claims: UserClaims = Depends(require_permission("{domain}", "create")),
    service: {Domain}Service = Depends(get_{domain}_service),
) -> {Model}Response:
    return await service.create(payload, actor=claims)


@router.put("/{id}", response_model={Model}Response)
async def update_{model}(
    id: UUID,
    payload: Update{Model}Request,
    claims: UserClaims = Depends(require_permission("{domain}", "update")),
    service: {Domain}Service = Depends(get_{domain}_service),
) -> {Model}Response:
    return await service.update(id, payload, actor=claims)


@router.delete("/{id}", status_code=204)
async def delete_{model}(
    id: UUID,
    claims: UserClaims = Depends(require_permission("{domain}", "delete")),
    service: {Domain}Service = Depends(get_{domain}_service),
) -> None:
    await service.soft_delete(id, actor=claims)
```

#### service.py

```python
# app/domains/{domain}/service.py
import uuid
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import UserClaims
from app.core.exceptions import ResourceNotFoundError
from app.domains.{domain}.repository import {Domain}Repository
from app.domains.{domain}.schemas import Create{Model}Request, Update{Model}Request


class {Domain}Service:
    """
    Business logic layer.
    Does NOT own the database session — it receives one from the route handler.
    Does NOT import from other domain services directly — use event dispatch or
    inject the other service via constructor for cross-domain orchestration.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def _get_repo(self, tenant_id: uuid.UUID) -> {Domain}Repository:
        return {Domain}Repository(session=self.db, tenant_id=tenant_id)

    async def get(self, id: uuid.UUID, *, tenant_id: uuid.UUID):
        repo = self._get_repo(tenant_id)
        return await repo.get_or_raise(id)

    async def list(self, *, tenant_id: uuid.UUID, limit: int, offset: int):
        repo = self._get_repo(tenant_id)
        items = await repo.list(limit=limit, offset=offset)
        total = await repo.count()
        return items, total

    async def create(self, payload: Create{Model}Request, *, actor: UserClaims):
        repo = self._get_repo(actor.tenant_id)
        # Business logic / validation here
        return await repo.create(**payload.model_dump())

    async def update(
        self, id: uuid.UUID, payload: Update{Model}Request, *, actor: UserClaims
    ):
        repo = self._get_repo(actor.tenant_id)
        await repo.get_or_raise(id)  # 404 if not found
        return await repo.update(id, **payload.model_dump(exclude_none=True))

    async def soft_delete(self, id: uuid.UUID, *, actor: UserClaims) -> None:
        repo = self._get_repo(actor.tenant_id)
        await repo.get_or_raise(id)
        await repo.soft_delete(id)
```

#### repository.py

```python
# app/domains/{domain}/repository.py
from app.core.repository import BaseRepository
from app.domains.{domain}.models import {Model}


class {Domain}Repository(BaseRepository[{Model}]):
    model = {Model}

    # Domain-specific query methods go here
    # Standard CRUD is inherited from BaseRepository
```

#### schemas.py

```python
# app/domains/{domain}/schemas.py
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class {Model}Base(BaseModel):
    # Shared fields for request and response schemas


class Create{Model}Request({Model}Base):
    # Fields required on creation (no id, tenant_id, created_at, deleted_at)


class Update{Model}Request(BaseModel):
    # All optional — PATCH semantics
    model_config = ConfigDict(extra="forbid")


class {Model}Response({Model}Base):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class {Model}ListResponse(BaseModel):
    items: list[{Model}Response]
    total: int
    limit: int
    offset: int
```

#### models.py

```python
# app/domains/{domain}/models.py
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class TenantMixin:
    """Apply to all models that need tenant isolation + soft delete + timestamps."""
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.tenant_id"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
```

### 10.3 All 15 Domain Modules

| # | Domain | Primary Models | Key Routes |
|---|---|---|---|
| 1 | `auth` | `StaffUser`, `StaffSession`, `PasswordResetToken` | `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`, `POST /mfa/*` |
| 2 | `fleet` | `Vehicle`, `VehicleBlock`, `VehicleStatusLog`, `VehicleClass` | `GET /`, `POST /`, `PUT /{id}`, `GET /availability`, `PUT /{id}/status`, `WS /ws/fleet/{location_id}` |
| 3 | `reservations` | `Reservation`, `ReservationVersion` | `POST /`, `GET /{id}`, `PUT /{id}` (modify), `POST /{id}/cancel`, `GET /confirmation/{number}` |
| 4 | `checkout` | `RentalAgreement` | `POST /checkout` (open agreement), `POST /check-in` (close agreement), `GET /{id}/pre-delivery-inspection` |
| 5 | `customers` | `Customer`, `DNRRecord` | `GET /`, `POST /`, `GET /{id}`, `PUT /{id}`, `GET /{id}/rental-history`, `POST /{id}/dnr`, `POST /{id}/gdpr-erase` |
| 6 | `pricing` | `RateCode`, `RateScheduleItem`, `ExtrasCatalog`, `TaxTemplate` | `GET /quote`, `POST /rate-codes`, `GET /rate-codes`, `PUT /rate-codes/{id}`, `GET /extras` |
| 7 | `payments` | `Payment`, `ProcessedWebhook` | `POST /preauth`, `POST /capture`, `POST /refund`, `POST /webhooks/stripe` |
| 8 | `damage` | `DamageClaim`, `InspectionForm`, `InspectionPhoto` | `POST /claims`, `GET /claims/{id}`, `PUT /claims/{id}/status`, `POST /inspections`, `POST /inspections/{id}/photos` |
| 9 | `maintenance` | `WorkOrder`, `PMSchedule`, `RecallRecord` | `POST /work-orders`, `GET /work-orders`, `PUT /work-orders/{id}/status`, `GET /recalls` |
| 10 | `corporate` | `CorporateAccount`, `TravelPolicy` | `POST /accounts`, `GET /accounts/{id}`, `POST /accounts/{id}/cdp-lookup`, `GET /accounts/{id}/invoices` |
| 11 | `reporting` | (read-only, no models owned) | `GET /dashboard`, `POST /generate`, `GET /reports/{id}/download`, `POST /reports/schedule` |
| 12 | `notifications` | `NotificationTemplate`, `NotificationLog` | `POST /dispatch` (internal), `GET /templates`, `PUT /templates/{id}`, `POST /templates/{id}/test-send` |
| 13 | `channels` | `ChannelConfig`, `OTABookingMap` | `GET /`, `PUT /{channel_id}/config`, `POST /webhooks/{channel}` (inbound OTA), `POST /sync-availability` |
| 14 | `admin` | `WebhookSubscription`, `APIKey`, `AuditQuery` | `GET /audit`, `GET /sessions`, `DELETE /sessions/{jti}`, `POST /api-keys`, `POST /webhooks`, `POST /rbac/reload` |
| 15 | `billing` | `Subscription`, `SubscriptionInvoice` | `GET /subscription`, `PUT /subscription/upgrade`, `POST /subscription/cancel`, `GET /invoices` |

### 10.4 Dependency Injection Chain

```
HTTP Request
  │
  ├─ Middleware: RequestIDMiddleware → request.state.request_id
  ├─ Middleware: StructuredLoggingMiddleware → structlog context
  │
  └─ Route Handler (e.g., update_vehicle_status)
        │
        ├─ require_permission("fleet", "update")
        │     └─ get_current_user()
        │           └─ Cookie("access_token") → JWT decode → Redis check → UserClaims
        │
        ├─ get_db_with_claims(claims, request)
        │     └─ get_session() → AsyncSession
        │           └─ get_db(claims, request_id, client_ip, session)
        │                 └─ GUC injection (5 SET CONFIG calls)
        │                       └─ yield session (RLS now active)
        │
        └─ get_fleet_service(db=session)
              └─ FleetService(db=session)
                    └─ FleetRepository(session=session, tenant_id=claims.tenant_id)
                          └─ DB query (RLS + application filter both apply)
```

### 10.5 Cross-Domain Service Calls

Services communicate through one of three patterns — never by importing another domain's repository directly.

| Pattern | When to Use | Example |
|---|---|---|
| Constructor injection | Service A needs Service B in the same request | `ReservationService` injecting `PricingService` for rate quotes |
| Domain event via Redis pub/sub | Fire-and-forget notifications after commit | Reservation confirmed → publish to `notifications:{tenant_id}` stream |
| Celery task dispatch | Async work that can fail and retry | Pre-auth placement → `app.worker.tasks.payments.place_preauth.delay(reservation_id)` |

```python
# Cross-domain injection example
# app/domains/reservations/service.py

class ReservationService:
    def __init__(
        self,
        db: AsyncSession,
        pricing_service: "PricingService",   # Injected, not imported-and-constructed
        notification_dispatcher: "NotificationDispatcher",
    ) -> None:
        self.db = db
        self.pricing = pricing_service
        self.notifications = notification_dispatcher

    async def create_reservation(
        self, payload: CreateReservationRequest, *, actor: UserClaims
    ) -> Reservation:
        # 1. Get rate quote (cross-domain call via injected service)
        quote = await self.pricing.get_quote(
            class_id=payload.vehicle_class_id,
            pickup_dt=payload.pickup_datetime,
            dropoff_dt=payload.dropoff_datetime,
            extras=payload.extras,
            tenant_id=actor.tenant_id,
        )

        # 2. Create reservation
        repo = ReservationRepository(self.db, actor.tenant_id)
        reservation = await repo.create(
            quote_snapshot=quote.model_dump(),
            **payload.model_dump(exclude={"extras"}),
        )

        # 3. Dispatch confirmation notification (via Redis Streams — no direct call)
        await self.notifications.dispatch(
            event_code="RESERVATION_CONFIRMED",
            recipient_id=reservation.customer_id,
            context={"reservation_id": str(reservation.id), "confirmation": reservation.confirmation_number},
            tenant_id=actor.tenant_id,
        )

        return reservation
```

---

## 11. WebSocket Architecture

### 11.1 ConnectionManager

```python
# app/domains/fleet/websocket.py
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect, Query
from fastapi.websockets import WebSocketState

import structlog

log = structlog.get_logger()


class ConnectionManager:
    """
    In-process WebSocket connection manager.
    Manages connections scoped by (tenant_id, location_id).

    Note on scaling: This is in-process state. In a multi-task Fargate
    deployment, each task manages its own connections. Redis pub/sub bridges
    messages across tasks (see §11.2). A WebSocket client may reconnect to
    a different task after disconnect — this is expected behavior.
    """

    def __init__(self) -> None:
        # {tenant_id: {location_id: set[WebSocket]}}
        self._connections: dict[str, dict[str, set[WebSocket]]] = defaultdict(
            lambda: defaultdict(set)
        )
        self._lock = asyncio.Lock()

    async def connect(
        self, ws: WebSocket, tenant_id: str, location_id: str
    ) -> None:
        await ws.accept()
        async with self._lock:
            self._connections[tenant_id][location_id].add(ws)
        log.info(
            "ws_connected",
            tenant_id=tenant_id,
            location_id=location_id,
            connection_count=len(self._connections[tenant_id][location_id]),
        )

    async def disconnect(
        self, ws: WebSocket, tenant_id: str, location_id: str
    ) -> None:
        async with self._lock:
            self._connections[tenant_id][location_id].discard(ws)

    async def broadcast(
        self,
        tenant_id: str,
        location_id: str,
        payload: dict,
    ) -> None:
        """
        Send payload to all WebSocket clients in (tenant, location).
        Dead connections are cleaned up silently.
        """
        sockets = self._connections.get(tenant_id, {}).get(location_id, set()).copy()
        dead: set[WebSocket] = set()
        for ws in sockets:
            try:
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_json(payload)
                else:
                    dead.add(ws)
            except Exception:
                dead.add(ws)
        for ws in dead:
            await self.disconnect(ws, tenant_id, location_id)


# Singleton per process
manager = ConnectionManager()
```

### 11.2 Redis Pub/Sub Bridge

The pub/sub bridge enables real-time fleet availability updates to propagate from any Celery worker (telematics, reservation writes) to WebSocket clients on any ECS task.

```
                     ┌──────────────────────┐
  Reservation write  │    Celery Worker      │
  OR telematics sync │                      │
        │            │  redis.publish(       │
        └───────────►│    "fleet:{t}:{loc}", │
                     │    json_payload       │
                     │  )                   │
                     └──────────────────────┘
                                │
                     Redis avail cluster
                     (pub/sub channel)
                                │
              ┌─────────────────┴──────────────────┐
              │                                    │
    ┌─────────▼──────────┐            ┌────────────▼──────────┐
    │  ECS API Task 1    │            │  ECS API Task 2        │
    │  pubsub.listen()   │            │  pubsub.listen()       │
    │  manager.broadcast │            │  manager.broadcast     │
    │  (to WS clients    │            │  (to WS clients        │
    │   on this task)    │            │   on this task)        │
    └────────────────────┘            └───────────────────────┘
```

```python
# app/domains/fleet/router.py

@router.websocket("/ws/fleet/{location_id}")
async def fleet_ws(
    websocket: WebSocket,
    location_id: str,
    token: Optional[str] = Query(default=None),
) -> None:
    """
    Fleet availability WebSocket endpoint.

    Authentication: short-lived (60s) one-time token from POST /fleet/ws-token.
    The primary access_token is httpOnly and cannot be read by JavaScript,
    so we issue a dedicated WS token stored in Redis with 60s TTL.

    Reconnect handling:
    - Client uses exponential backoff: 1s, 2s, 4s, 8s, max 30s
    - On reconnect, client re-fetches from GET /fleet/availability to get
      current state, then re-subscribes to WebSocket for deltas
    - No message history is stored — clients must re-fetch on reconnect
    """
    from app.core.security import verify_ws_token
    from app.core.redis import get_avail_redis

    # Authenticate
    try:
        claims = await verify_ws_token(token)
    except Exception:
        await websocket.close(code=1008)  # Policy violation
        return

    tenant_id = str(claims.tenant_id)
    await manager.connect(websocket, tenant_id, location_id)

    # Subscribe to Redis pub/sub for this (tenant, location) channel
    redis = await get_avail_redis()
    pubsub = redis.pubsub()
    channel = f"fleet:{tenant_id}:{location_id}"
    await pubsub.subscribe(channel)

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                # Forward Redis message to all WS clients
                try:
                    payload = json.loads(message["data"])
                    await manager.broadcast(tenant_id, location_id, payload)
                except (json.JSONDecodeError, Exception) as e:
                    log.warning("ws_broadcast_error", error=str(e))
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await manager.disconnect(websocket, tenant_id, location_id)
```

### 11.3 WebSocket Message Schema

All WebSocket messages follow a typed envelope. Clients switch on `type`.

```typescript
// Message types sent over fleet WebSocket
type FleetWsMessage =
  | { type: "AVAILABILITY_UPDATE"; class_id: string; location_id: string; available_count: number; }
  | { type: "VEHICLE_STATUS_CHANGE"; vehicle_id: string; old_status: string; new_status: string; }
  | { type: "TELEMATICS_UPDATE"; vehicle_id: string; odometer: number; soc_pct: number | null; fuel_pct: number | null; }
  | { type: "RESERVATION_CONFIRMED"; reservation_id: string; vehicle_class: string; }
  | { type: "PING" }   // Sent every 30s; client responds with PONG to detect dead connections
```

### 11.4 Frontend Reconnect Pattern

```typescript
// packages/ui/hooks/useFleetWebSocket.ts
export function useFleetWebSocket(locationId: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelay = useRef(1000)

  useEffect(() => {
    let cancelled = false

    const connect = async () => {
      // Fetch one-time WS token (60s TTL, stored in Redis)
      const { data } = await apiClient.POST('/api/v1/fleet/ws-token')
      if (!data || cancelled) return

      const ws = new WebSocket(`/api/v1/fleet/ws/${locationId}?token=${data.token}`)
      wsRef.current = ws

      ws.onopen = () => {
        reconnectDelay.current = 1000  // Reset backoff on successful connect
      }

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as FleetWsMessage
        if (msg.type === 'PING') { ws.send(JSON.stringify({ type: 'PONG' })); return }
        // Apply patch to TanStack Query cache
        queryClient.setQueryData(['availability', locationId], (old) =>
          old ? applyAvailabilityPatch(old, msg) : old
        )
      }

      ws.onclose = () => {
        if (cancelled) return
        // Exponential backoff with cap at 30s
        setTimeout(connect, Math.min(reconnectDelay.current, 30_000))
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000)
      }
    }

    connect()
    return () => {
      cancelled = true
      wsRef.current?.close()
    }
  }, [locationId])
}
```

---

## 12. OpenAPI & TypeScript Client Generation

### 12.1 OpenAPI Configuration

Stable operation IDs are critical — they become TypeScript function names in the generated client. The `generate_unique_id_function` in `create_app()` produces IDs in the format `{tag}-{function_name}`, e.g., `fleet-get_vehicle`, `reservations-create_reservation`.

**Required server array** (declared in `create_app()`):
- `https://api.rcm.app` — Production
- `https://api.staging.rcm.app` — Staging
- `http://localhost:8000` — Local

Tags map 1:1 to domain names. A route must declare exactly one tag — the domain it belongs to.

### 12.2 TypeScript Client Generation Pipeline

The generated client lives at `packages/api-client/`. Engineers never edit it manually — it is generated from the OpenAPI spec served by the running API.

#### package.json scripts (root)

```json
{
  "scripts": {
    "generate:api-client": "npm run generate:schema && npm run generate:types",
    "generate:schema": "curl -s http://localhost:8000/api/openapi.json -o packages/api-client/openapi.json",
    "generate:types": "npx openapi-typescript packages/api-client/openapi.json -o packages/api-client/schema.d.ts",
    "check:api-drift": "npm run generate:api-client && git diff --exit-code packages/api-client/schema.d.ts"
  }
}
```

CI runs `check:api-drift` on every PR that touches `apps/api/`. A non-zero exit code fails the build — engineers must regenerate and commit the updated client.

#### Generated Client Usage

```typescript
// packages/api-client/index.ts
import createClient from 'openapi-fetch'
import type { paths } from './schema'  // Generated by openapi-typescript

export const apiClient = createClient<paths>({
  baseUrl: '/api/v1',
  credentials: 'include',   // Sends httpOnly access_token cookie automatically
})

// Inject X-Tenant-ID on every request (resolved from hostname)
apiClient.use({
  onRequest({ request }) {
    const tenant = resolveTenantFromHostname(window.location.hostname)
    request.headers.set('X-Tenant-ID', tenant)
    return request
  },
})

// Type-safe usage (TypeScript enforces correct request shape and response type)
const { data, error } = await apiClient.GET('/fleet/availability/{locationId}', {
  params: {
    path: { locationId: 'loc-uuid-here' },
    query: { from: '2026-07-01T10:00:00Z', to: '2026-07-05T10:00:00Z' },
  },
})
```

### 12.3 Keeping Client in Sync

| Trigger | Action |
|---|---|
| Any `apps/api/` change on PR | CI runs `check:api-drift`; fails if schema.d.ts differs |
| Backend deploy to staging | `generate:api-client` runs automatically in CD pipeline |
| Frontend engineer adds a new API call | Must run `npm run generate:api-client` locally first |

Engineers should run `npm run generate:api-client` before starting any frontend feature that requires new API endpoints. The `check:api-drift` CI gate catches cases where they forgot.

### 12.4 Operation ID Naming Convention

| Route | Function Name | Generated Operation ID |
|---|---|---|
| `GET /fleet/` | `list_vehicles` | `fleet-list_vehicles` |
| `POST /reservations/` | `create_reservation` | `reservations-create_reservation` |
| `POST /auth/login` | `login` | `auth-login` |
| `WS /fleet/ws/{location_id}` | `fleet_ws` | `fleet-fleet_ws` |

Operation IDs are used as TypeScript function names. Keep them snake_case, descriptive, and unique within a tag.

---

## Appendix A: Redis Key Namespace Reference

```python
# app/core/redis_keys.py
# All Redis key patterns in one place — no magic strings in business logic.

# Session cluster (volatile-lru)
REVOKED_TOKENS_SET      = "revoked_tokens"                    # SET — revoked JTIs
SESSION_KEY             = "session:{jti}"                     # STRING; TTL = access token TTL
REFRESH_TOKEN_KEY       = "refresh:{jti}"                     # STRING; TTL = 30d
WS_TOKEN_KEY            = "ws_token:{token}"                  # STRING; TTL = 60s
OTP_KEY                 = "otp:{customer_id}"                 # STRING; TTL = 10min
PREAUTH_LOCK_KEY        = "preauth_lock:{reservation_id}"     # STRING (SETNX lock); TTL = 120s
LOGIN_FAIL_KEY          = "login_fail:{email}"                # STRING (counter); TTL = lockout window

# Availability cluster (allkeys-lru)
AVAIL_KEY               = "avail:{location_id}:{class_id}:{bucket}"  # STRING; TTL = 60s
RATE_QUOTE_KEY          = "rate_quote:{quote_hash}"           # STRING; TTL = 30s (race guard)
TAX_CACHE_KEY           = "tax:{inputs_sha256}"               # STRING; TTL = 3600s

# Availability cluster (pub/sub)
FLEET_CHANNEL           = "fleet:{tenant_id}:{location_id}"  # Pub/sub channel

# Session cluster (streams)
NOTIFICATION_STREAM     = "notifications:{tenant_id}"         # Stream; maxlen = 10,000

# Session cluster (dedup / misc)
TELEMATICS_DEDUP_KEY    = "telematics:dedup:{device_id}:{ts}" # STRING; TTL = 300s
```

---

## Appendix B: Environment Variable Reference

All env vars injected by ECS from Secrets Manager (prod) or `.env` (dev).

| Variable | Type | Required | Notes |
|---|---|---|---|
| `ENV` | string | Yes | `development` \| `staging` \| `production` |
| `DATABASE_URL` | SecretStr | Yes | `postgresql+asyncpg://user:pass@host/db` |
| `REDIS_SESSION_URL` | SecretStr | Yes | `redis://host:6379/0` |
| `REDIS_AVAIL_URL` | SecretStr | Yes | `redis://host:6379/1` |
| `REDIS_BROKER_URL` | SecretStr | Yes | `redis://host:6379/2` |
| `JWT_SECRET_KEY` | SecretStr | Yes | Minimum 64 hex chars (256-bit) |
| `JWT_ALGORITHM` | string | No | Default: `HS256` |
| `CORS_ORIGINS` | string | Yes | Comma-separated list |
| `STRIPE_SECRET_KEY` | SecretStr | Yes | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | SecretStr | Yes | `whsec_...` |
| `AVALARA_ACCOUNT_ID` | string | Yes | Numeric string |
| `AVALARA_LICENSE_KEY` | SecretStr | Yes | |
| `AVALARA_COMPANY_CODE` | string | Yes | |
| `TWILIO_ACCOUNT_SID` | string | Yes | `ACxxx` |
| `TWILIO_AUTH_TOKEN` | SecretStr | Yes | |
| `TWILIO_FROM_NUMBER` | string | Yes | E.164 format |
| `SENDGRID_API_KEY` | SecretStr | Yes | `SG.xxx` |
| `AWS_REGION` | string | No | Default: `us-east-1` |
| `S3_DOCUMENTS_BUCKET` | string | Yes | |
| `S3_PHOTOS_BUCKET` | string | Yes | |
| `S3_REPORTS_BUCKET` | string | Yes | |
| `SENTRY_DSN` | string | No | Empty string disables Sentry |
| `LOG_LEVEL` | string | No | Default: `INFO` |

---

## Appendix C: Alembic async env.py Pattern

```python
# alembic/env.py
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.core.config import settings

# Import all models so Alembic can autogenerate migrations
from app.domains.auth.models import *      # noqa: F401, F403
from app.domains.fleet.models import *     # noqa: F401, F403
# ... (all 15 domain model imports)

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url.get_secret_value())

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        transaction_per_migration=True,   # Each migration in its own transaction
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,   # Migrations run once; no pool needed
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

---

*Engineers implementing this API should work through sections in order: scaffold the file tree (§1) → configure Settings (§3) → set up database and sessions (§4) → implement auth (§5) → RBAC (§6) → BaseRepository (§7) → error handling (§8) → then build domain modules one at a time following the template in §10.*

*Integration clients (§9) should be built as domain features require them — do not build all 14 integrations upfront.*

*See ARCHITECTURE.md for the full system context, DATABASE_ARCHITECTURE.md for DDL, BACKLOG.md for prioritized work items, and FEATURES.md for feature requirements.*
