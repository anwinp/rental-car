# Rental Car Management System — Architecture

> **Stack:** FastAPI (Python 3.12) · PostgreSQL 16 · React / Next.js 14 · AWS (ECS Fargate, RDS, ElastiCache)
> **Designed against:** FEATURES.md Parts I–III (Sections 1–43)
> **Authored:** June 2026 — multi-agent architecture review

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Repository Structure](#2-repository-structure)
3. [FastAPI Backend Architecture](#3-fastapi-backend-architecture)
4. [Database Architecture](#4-database-architecture)
5. [React Frontend Architecture](#5-react-frontend-architecture)
6. [AWS Infrastructure Architecture](#6-aws-infrastructure-architecture)
7. [Integration & Real-Time Architecture](#7-integration--real-time-architecture)
8. [Security Architecture](#8-security-architecture)
9. [Deployment & DevOps](#9-deployment--devops)
10. [Third-Party Library Manifest](#10-third-party-library-manifest)

---

## 1. System Overview

The system is a multi-tenant SaaS rental car management platform serving operators of all sizes — from a single-location independents to regional chains with 500+ vehicles. It handles the full rental lifecycle: fleet inventory, booking engine, counter operations, payment processing, damage claims, maintenance, telematics, and back-office reporting.

### High-Level Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        Customers / Renters                       │
│            (Web, iOS, Android, OTA, GDS, API Partners)          │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────────┐
│                    CloudFront + WAF                              │
│          (OWASP rules, rate limiting, geo-blocking)              │
└────┬────────────────────────────────────────────┬───────────────┘
     │ /api/*                                      │ /*
┌────▼──────────────────────┐          ┌──────────▼──────────────┐
│   FastAPI (ECS Fargate)   │          │  React SPA (S3+CF)      │
│   15 domain modules       │          │  - Next.js 14 (booking) │
│   JWT · RBAC · RLS        │          │  - Vite+React (counter) │
│   SQLAlchemy 2.0 async    │          │  - Vite+React (admin)   │
└──┬────────────────────────┘          └─────────────────────────┘
   │
   ├── PostgreSQL 16 (RDS Multi-AZ) — primary operational store
   ├── Redis (ElastiCache) — availability cache · Celery broker · sessions
   ├── Celery Workers (ECS Fargate) — async tasks, scheduled jobs
   ├── S3 — vehicle photos, inspection images, signed rental agreements, reports
   └── SQS — notification queue, rate-filing queue, toll processing queue

External integrations:
   Stripe → payments/pre-auth      Twilio → SMS
   Avalara → tax calculation        SendGrid → email
   Geotab / Samsara → telematics   NHTSA → VIN decode + recall
   AAMVA → license validation       Expedia/Booking.com → OTA channels
   Sabre/Amadeus → GDS filing
```

### Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth token storage | httpOnly cookie (not localStorage) | XSS cannot exfiltrate the token; SameSite=Strict prevents CSRF |
| Tenant isolation | PostgreSQL RLS + GUC session variable | Zero risk of cross-tenant data leak; no per-query `WHERE tenant_id` needed |
| Double-booking prevention | PostgreSQL exclusion constraint (btree_gist + tstzrange) | Database-level guarantee; survives concurrent transactions |
| PCI DSS scope | Stripe hosted fields (SAQ A) | No raw PANs on platform servers; card data never touches our infrastructure |
| Async background tasks | Celery + Redis (not FastAPI BackgroundTasks) | Long-running jobs survive request termination; retries, scheduling, DLQ |
| Frontend state | TanStack Query v5 (server) + Zustand (UI) | Clean separation; TQ handles cache/refetch; Zustand avoids prop drilling |
| Offline support | Workbox service worker on counter app only | Counter agents need it; booking engine needs SEO (SSR) |
| Multi-region | Single-region (us-east-1) with Multi-AZ failover | Day-1 simplicity; expand to multi-region at Series B scale |

---

## 2. Repository Structure

Turborepo monorepo for the full system.

```
rental-car-manager/
├── apps/
│   ├── api/                     # FastAPI backend
│   │   ├── app/
│   │   │   ├── main.py          # App factory, middleware, router registration
│   │   │   ├── core/            # Config, database, security, dependencies
│   │   │   ├── domains/         # 15 domain modules (see §3.1)
│   │   │   └── worker/          # Celery app, task definitions
│   │   ├── alembic/             # Migrations
│   │   ├── tests/               # Pytest suites
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   │
│   ├── web-booking/             # Customer-facing booking engine (Next.js 14, SSR/SEO)
│   ├── web-counter/             # Counter agent app (Vite+React, offline-capable)
│   └── web-admin/               # Operator admin panel (Vite+React)
│
├── packages/
│   ├── ui/                      # Shared shadcn/ui + Tailwind component library
│   ├── api-client/              # Generated OpenAPI TypeScript client (openapi-typescript)
│   ├── shared-types/            # Shared TypeScript types
│   └── eslint-config/           # Shared ESLint config
│
├── infra/                       # Terraform modules + environments
│   ├── modules/                 # vpc, alb, ecs-api, ecs-workers, rds, elasticache, s3-storage, cloudfront, secrets, iam, monitoring
│   └── environments/            # dev/, staging/, prod/
│
├── e2e/                         # Playwright end-to-end tests
├── scripts/                     # check_lock_safety.py, data migration, seed scripts
├── FEATURES.md
├── ARCHITECTURE.md
├── turbo.json
└── package.json
```

---

## 3. FastAPI Backend Architecture

### 3.1 Domain Module Organization

The API is organized into 15 domain modules. Each module owns its own router, service layer, and repository layer — no cross-domain repository calls.

```
apps/api/app/domains/
├── auth/            # JWT issuance, refresh, OIDC SSO
├── fleet/           # Vehicle CRUD, status transitions, telematics sync
├── reservations/    # Booking engine, availability, modification, cancellation
├── checkout/        # Counter checkout / check-in flow
├── customers/       # Customer profiles, KYC, DNR, loyalty
├── pricing/         # Rate engine, extras pricing, promotion codes
├── payments/        # Pre-auth lifecycle, capture, refund, Stripe webhook handler
├── damage/          # Damage claims, inspections, photos
├── maintenance/     # Work orders, PM scheduling, recall management
├── corporate/       # Corporate accounts, CDP codes, direct billing
├── reporting/       # Report generation, dashboard aggregations
├── notifications/   # Notification dispatch via Redis Streams
├── channels/        # OTA/GDS channel adapters
├── admin/           # Tenant config, user management, RBAC
└── billing/         # SaaS subscription management, operator invoicing
```

### 3.2 Application Factory

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import engine
from app.instrumentation import init_tracing

def create_app() -> FastAPI:
    app = FastAPI(
        title="Rental Car Manager API",
        version="1.0.0",
        docs_url="/api/docs" if settings.env != "production" else None,
        redoc_url=None,
        generate_unique_id_function=lambda route: f"{route.tags[0]}-{route.name}",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register domain routers
    from app.domains.auth.router import router as auth_router
    from app.domains.fleet.router import router as fleet_router
    from app.domains.reservations.router import router as res_router
    # ... (all 15 domains)

    app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(fleet_router, prefix="/api/v1/fleet", tags=["fleet"])
    app.include_router(res_router, prefix="/api/v1/reservations", tags=["reservations"])

    init_tracing(app)

    return app

app = create_app()
```

### 3.3 Database Session & Connection Pool

```python
# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from app.core.config import settings

engine = create_async_engine(
    settings.database_url,              # asyncpg dialect
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=settings.env == "development",
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        # Set GUC session variables for RLS and audit triggers
        # These are extracted from the JWT token in the RBAC dependency
        yield session
```

GUC variables for RLS are set per-request by the RBAC dependency (see §3.4) immediately after the session is acquired:

```python
await session.execute(
    text("SELECT set_config('app.current_tenant_id', :tid, true), "
         "       set_config('app.current_user_id',   :uid, true), "
         "       set_config('app.current_role',       :role, true), "
         "       set_config('app.client_ip',          :ip, true), "
         "       set_config('app.request_id',         :rid, true)"),
    {"tid": str(claims.tenant_id), "uid": str(claims.user_id),
     "role": claims.primary_role, "ip": client_ip, "rid": request_id}
)
```

### 3.4 RBAC Dependency Injection

```python
# app/core/security.py
from fastapi import Depends, HTTPException, Cookie
from jose import jwt, JWTError
from dataclasses import dataclass
from typing import Optional

@dataclass
class TokenClaims:
    user_id: UUID
    tenant_id: UUID
    roles: list[str]
    primary_role: str
    session_id: str

async def get_current_user(
    access_token: Optional[str] = Cookie(default=None),
) -> TokenClaims:
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(access_token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Check token not revoked (jti lookup in Redis)
    if await redis.sismember("revoked_tokens", payload["jti"]):
        raise HTTPException(status_code=401, detail="Token revoked")

    return TokenClaims(**payload)


def require_permission(resource: str, action: str):
    """Factory returning a FastAPI dependency that checks RBAC."""
    async def _check(claims: TokenClaims = Depends(get_current_user)) -> TokenClaims:
        allowed = any(
            _permission_granted(role, resource, action) for role in claims.roles
        )
        if not allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied: {action} on {resource}"
            )
        return claims
    return _check
```

Usage in a router:

```python
# app/domains/fleet/router.py
@router.put("/{vehicle_id}/status")
async def update_vehicle_status(
    vehicle_id: UUID,
    payload: VehicleStatusUpdateRequest,
    claims: TokenClaims = Depends(require_permission("fleet", "update")),
    service: FleetService = Depends(get_fleet_service),
):
    return await service.transition_status(vehicle_id, payload, actor=claims)
```

### 3.5 Repository Pattern with Tenant Isolation

```python
# app/core/repository.py
from typing import Generic, TypeVar, Optional
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

ModelT = TypeVar("ModelT")

class BaseRepository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.session = session
        self.tenant_id = tenant_id

    def _tenant_filter(self):
        return and_(
            self.model.tenant_id == self.tenant_id,
            self.model.deleted_at.is_(None),
        )

    async def get(self, id: uuid.UUID) -> Optional[ModelT]:
        result = await self.session.execute(
            select(self.model).where(
                self.model.id == id,
                self._tenant_filter()
            )
        )
        return result.scalar_one_or_none()

    async def list(self, *, limit: int = 50, offset: int = 0) -> list[ModelT]:
        result = await self.session.execute(
            select(self.model)
            .where(self._tenant_filter())
            .limit(limit)
            .offset(offset)
        )
        return list(result.scalars().all())
```

### 3.6 SQLAlchemy 2.0 ORM Models

```python
# app/domains/fleet/models.py
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import ForeignKey, Enum as PgEnum, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB, TSTZRANGE
from sqlalchemy.schema import ExcludeConstraint
from sqlalchemy.sql import text
import uuid

class TenantBase(DeclarativeBase):
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.tenant_id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)


class VehicleBlock(TenantBase):
    __tablename__ = "vehicle_blocks"

    block_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.vehicle_id"), nullable=False
    )
    block_type: Mapped[str] = mapped_column(
        PgEnum("RESERVATION","TURNAROUND","MAINTENANCE","RECALL_HOLD",
               "IN_TRANSIT","HOLD","INSPECTION","STAGING","CHARGING",
               name="vehicle_block_type"), nullable=False
    )
    start_time: Mapped[datetime] = mapped_column(nullable=False)
    end_time: Mapped[datetime] = mapped_column(nullable=False)

    __table_args__ = (
        # Exclusion constraint — database-level double-booking prevention (§4)
        ExcludeConstraint(
            ("vehicle_id", "="),
            (func.tstzrange(text("start_time"), text("end_time"), "[)"), "&&"),
            using="gist",
            where=text("deleted_at IS NULL"),
            name="no_overlapping_vehicle_blocks",
        ),
    )
```

### 3.7 WebSocket Real-Time Updates

```python
# app/domains/fleet/websocket.py
from fastapi import WebSocket
from collections import defaultdict
import asyncio, json

class ConnectionManager:
    def __init__(self):
        # {tenant_id: {location_id: set[WebSocket]}}
        self._connections: dict[str, dict[str, set[WebSocket]]] = defaultdict(
            lambda: defaultdict(set)
        )
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, tenant_id: str, location_id: str):
        await ws.accept()
        async with self._lock:
            self._connections[tenant_id][location_id].add(ws)

    async def disconnect(self, ws: WebSocket, tenant_id: str, location_id: str):
        async with self._lock:
            self._connections[tenant_id][location_id].discard(ws)

    async def broadcast(self, tenant_id: str, location_id: str, payload: dict):
        sockets = self._connections.get(tenant_id, {}).get(location_id, set())
        dead = set()
        for ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            await self.disconnect(ws, tenant_id, location_id)


manager = ConnectionManager()

@router.websocket("/ws/fleet/{location_id}")
async def fleet_ws(
    websocket: WebSocket,
    location_id: str,
    claims: TokenClaims = Depends(verify_ws_token),
):
    await manager.connect(websocket, str(claims.tenant_id), location_id)
    pubsub = await redis.pubsub()
    await pubsub.subscribe(f"fleet:{claims.tenant_id}:{location_id}")
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"].decode())
    except WebSocketDisconnect:
        await manager.disconnect(websocket, str(claims.tenant_id), location_id)
```

### 3.8 Error Handling (RFC 7807)

```python
# app/core/exceptions.py
from fastapi import Request
from fastapi.responses import JSONResponse

class AppError(Exception):
    def __init__(self, title: str, status: int, detail: str, type_uri: str = None):
        self.title = title
        self.status = status
        self.detail = detail
        self.type_uri = type_uri or f"https://errors.rcm.app/{status}"

class VehicleNotAvailableError(AppError):
    def __init__(self, vehicle_id: str, start: str, end: str):
        super().__init__(
            title="Vehicle Not Available",
            status=409,
            detail=f"Vehicle {vehicle_id} is already booked for {start}–{end}",
            type_uri="https://errors.rcm.app/vehicle-not-available",
        )

async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={
            "type": exc.type_uri,
            "title": exc.title,
            "status": exc.status,
            "detail": exc.detail,
            "instance": str(request.url),
        },
        headers={"Content-Type": "application/problem+json"},
    )
```

### 3.9 Celery Configuration

```python
# app/worker/celery_app.py
from celery import Celery
from kombu import Queue

celery_app = Celery("rcm")
celery_app.config_from_object("app.worker.celeryconfig")

# Task routing by queue
celery_app.conf.task_routes = {
    "app.worker.tasks.notifications.*": {"queue": "notifications"},
    "app.worker.tasks.rate_filing.*":   {"queue": "rate_filing"},
    "app.worker.tasks.reports.*":       {"queue": "reports"},
    "app.worker.tasks.batch.*":         {"queue": "batch"},
    "app.worker.tasks.toll.*":          {"queue": "toll_processing"},
}

celery_app.conf.task_queues = [
    Queue("notifications",  routing_key="notifications"),
    Queue("rate_filing",    routing_key="rate_filing"),
    Queue("reports",        routing_key="reports"),
    Queue("batch",          routing_key="batch"),
    Queue("toll_processing",routing_key="toll_processing"),
]
```

**Scheduled tasks (RedBeat on Redis):**

| Task | Schedule | Queue |
|---|---|---|
| `renew_expiring_preauths` | Every 6h | `rate_filing` |
| `no_show_transition` | Every 15min | `notifications` |
| `nhtsa_recall_poll` | Daily 02:00 | `batch` |
| `document_expiry_alerts` | Daily 08:00 | `notifications` |
| `toll_charge_batch` | Every 4h | `toll_processing` |
| `availability_cache_rebuild` | Every 5min | `batch` |
| `depreciation_journal_entries` | Monthly 1st 01:00 | `batch` |
| `pre_auth_expiry_report` | Daily 06:00 | `reports` |

---

## 4. Database Architecture

> Full DDL lives in `DATABASE_ARCHITECTURE.md`. This section captures the key structural decisions.

### 4.1 Schema Organization

| Schema | Purpose |
|---|---|
| `public` | Live operational data — all tables the application reads/writes |
| `audit` | Append-only immutable audit event log (UPDATE/DELETE revoked from all roles) |
| `archive` | Records aged out of `public` after retention thresholds; read-only for operations |

### 4.2 Multi-Tenancy: Row-Level Security

Every `public` table carries `tenant_id UUID NOT NULL`. RLS is enabled on every table. The application sets a GUC session variable once per connection, and PostgreSQL enforces isolation automatically — no per-query `WHERE tenant_id = $1` needed.

```sql
SET app.current_tenant_id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.vehicles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Internal service role bypasses RLS for cross-tenant operations (network-wide DNR)
CREATE ROLE app_service;
ALTER TABLE public.vehicles NO FORCE ROW LEVEL SECURITY FOR ROLE app_service;
```

### 4.3 Core Tables

| Table | Purpose |
|---|---|
| `tenants` | Operator accounts; subscription tier, DPA/ToS status |
| `locations` | Branch/location config; hours, turnaround times, tax template |
| `vehicles` | Fleet inventory; full spec, operational state, financial/depreciation data |
| `vehicle_status_log` | Immutable log of every vehicle status transition |
| `vehicle_blocks` | Time-blocked slots on vehicle calendar (reservations, maintenance, etc.) |
| `customers` | Customer profiles, driver's license, loyalty, DNR |
| `reservations` | Booking records with pricing snapshots; version-tracked |
| `reservation_versions` | Full state snapshot at each modification |
| `rental_agreements` | Signed contracts created at checkout; odometer, fuel, signatures |
| `payments` | One row per payment event: preauth, capture, incremental auth, refund |
| `damage_claims` | Damage discovery, coverage determination, repair financials |
| `rate_codes` + `rate_schedule_items` | Rate definitions with per-class/per-duration pricing |

### 4.4 Double-Booking Prevention

The exclusion constraint on `vehicle_blocks` is the database-level guarantee:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CONSTRAINT no_overlapping_vehicle_blocks EXCLUDE USING gist (
  vehicle_id  WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (deleted_at IS NULL)
```

The half-open range `[)` (start inclusive, end exclusive) ensures back-to-back rentals are non-overlapping. Any INSERT or UPDATE that would create an overlap raises `ERROR 23P01` and rolls back the transaction before any application code can produce a duplicate booking. This survives concurrent transactions — application-level locks are not sufficient.

### 4.5 Audit Log

```sql
CREATE TABLE audit.audit_events (
  event_id      UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID,
  event_time    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor_user_id UUID,
  actor_role    user_role,
  actor_ip      INET,
  action        audit_action NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  old_data      JSONB,
  new_data      JSONB,
  changed_fields TEXT[],
  request_id    TEXT,
  PRIMARY KEY   (event_id, event_time)
) PARTITION BY RANGE (event_time);  -- monthly partitions via pg_partman

REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM app_service;
```

A `SECURITY DEFINER` trigger function (`audit.log_changes()`) fires on INSERT/UPDATE/DELETE on all critical tables. It captures old/new row diffs and reads actor context from GUC session variables. Installed on: `reservations`, `rental_agreements`, `payments`, `vehicles`, `damage_claims`, `customers`, `rate_codes`.

### 4.6 PostgreSQL Enums (14 types)

```
reservation_status  vehicle_status  vehicle_block_type
damage_severity     claim_status    payment_method
payment_status      user_role       rate_type
fleet_type          depreciation_method  fuel_type
transmission_type   kyc_status      audit_action
```

### 4.7 Critical Indexes

| Index | Type | Optimizes |
|---|---|---|
| `vehicle_blocks(vehicle_id, tstzrange)` | GiST | Availability search (range overlap) |
| `reservations(confirmation_number)` | Unique B-tree | Counter confirmation lookup |
| `customers(license_number, license_country)` | B-tree partial | Counter checkout, DNR check |
| `customers(tsvector name+email)` | GIN | Customer search bar full-text |
| `reservations(customer_id, pickup_datetime DESC)` | B-tree partial | Customer rental history |
| `vehicles(class_id, location_id, status='AVAILABLE')` | B-tree partial | Fleet availability matrix |
| `payments(tenant_id, auth_expiry_at) WHERE status='AUTHORIZED'` | B-tree partial | Pre-auth renewal job |
| `audit_events(tenant_id, resource_type, resource_id, event_time DESC)` | B-tree | DSAR / compliance lookups |

### 4.8 Partitioned Tables

Three high-volume tables use monthly range partitioning managed by `pg_partman`:

- **`audit.audit_events`** — 7-year retention; older partitions move to S3 Glacier
- **`public.telematics_events`** — 12-month retention; expired partitions auto-dropped
- **`public.notification_log`** — 12-month retention; body not stored (SHA-256 hash only for GDPR)

### 4.9 Migration Strategy

Alembic with async SQLAlchemy. All schema changes follow the **expand-contract** three-phase pattern:

1. **Expand** — Add nullable column / new table. Safe to deploy while old app runs.
2. **Backfill** — Populate new column. Separate deployment/data job.
3. **Contract** — Make column NOT NULL / drop old column. Only after new app is fully deployed.

CI gate (`scripts/check_lock_safety.py`) rejects migrations that acquire `ACCESS EXCLUSIVE` locks on tables larger than 10,000 rows. `CREATE INDEX CONCURRENTLY` is required for all index additions.

### 4.10 Archive Strategy

Records in `public` are moved to the `archive` schema after retention thresholds pass. A nightly `pg_cron` job runs `archive.run_archive_job()`:

1. Copy closed rental agreements older than 1 year → `archive.rental_agreements`
2. Soft-delete the `public` rows (exclusion constraint releases)
3. Hard-delete `archive` rows older than 7 years (except legal-hold records)

After cold-archive, a separate job serializes archive tables to Parquet and uploads to S3 Glacier Instant Retrieval, then hard-deletes the PostgreSQL rows.

### 4.11 Seed Data Required Before First Rental

- SIPP/ACRISS vehicle class codes (Mini through Special)
- US jurisdiction tax rate templates (per state/type)
- 30 canonical notification event templates
- System staff roles with permissions JSONB
- Extras catalog (CDW, LDW, SLI, PAI, RSA, GPS, CSS, TOLL, PPFP)

---

## 5. React Frontend Architecture

### 5.1 Application Split

| App | Framework | Rendering | Offline | Audience |
|---|---|---|---|---|
| `web-booking` | Next.js 14 (App Router) | SSR + ISR | No | Customers (SEO-critical) |
| `web-counter` | Vite + React | SPA | Yes (Workbox) | Counter agents |
| `web-admin` | Vite + React | SPA | No | Operators / admins |

Next.js is used for the booking engine specifically to get server-side rendering for SEO and initial page load performance. Counter and admin are SPA — they don't need SEO, and counter needs offline mode.

### 5.2 State Management

```
Server state:   TanStack Query v5 (useQuery / useMutation / useInfiniteQuery)
UI/client state: Zustand (modal state, stepper position, offline queue)
Forms:          React Hook Form + Zod
```

```typescript
// packages/api-client/index.ts — typed client generated from OpenAPI spec
import createClient from 'openapi-fetch'
import type { paths } from './schema'  // generated by openapi-typescript

export const apiClient = createClient<paths>({
  baseUrl: '/api/v1',
  credentials: 'include',  // sends httpOnly cookie automatically
})

// Inject tenant ID from hostname on every request
apiClient.use({
  onRequest({ request }) {
    const tenant = resolveTenantFromHostname(window.location.hostname)
    request.headers.set('X-Tenant-ID', tenant)
    return request
  },
})
```

### 5.3 Authentication (httpOnly Cookie)

Auth tokens are stored in httpOnly cookies — never localStorage. XSS cannot read them.

```typescript
// packages/ui/auth/AuthProvider.tsx
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    apiClient.GET('/auth/me')
      .then(({ data }) => setUser(data ?? null))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

// RouteGuard — wraps protected routes
export function RouteGuard({
  roles = [],
  children,
}: {
  roles?: UserRole[]
  children: ReactNode
}) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace />
  if (roles.length > 0 && !roles.some(r => user.roles.includes(r)))
    return <Navigate to="/unauthorized" replace />
  return <>{children}</>
}
```

### 5.4 Counter App: Availability Grid

```typescript
// apps/web-counter/src/features/availability/AvailabilityGrid.tsx
export function AvailabilityGrid({ locationId }: { locationId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['availability', locationId],
    queryFn: () => apiClient.GET('/fleet/availability/{locationId}', {
      params: { path: { locationId } }
    }).then(r => r.data),
    refetchInterval: 30_000,  // poll every 30s; WebSocket pushes intermediary updates
    staleTime: 25_000,
  })

  // Subscribe to WebSocket for real-time updates
  useEffect(() => {
    const ws = new WebSocket(`/api/v1/ws/fleet/${locationId}`)
    ws.onmessage = (e) => {
      const event = JSON.parse(e.data)
      queryClient.setQueryData(['availability', locationId], (old) =>
        applyAvailabilityPatch(old, event)
      )
    }
    return () => ws.close()
  }, [locationId])

  return (
    <div className="grid grid-cols-[auto_repeat(var(--col-count),1fr)] gap-px">
      {/* class rows × time-slot columns */}
    </div>
  )
}
```

### 5.5 Counter App: Offline Mode

The counter app uses Workbox to allow agents to complete check-ins during connectivity loss.

```typescript
// apps/web-counter/src/service-worker.ts
import { registerRoute, Route } from 'workbox-routing'
import { NetworkFirst, CacheFirst } from 'workbox-strategies'
import { BackgroundSyncPlugin } from 'workbox-background-sync'

// Queue writes for sync when back online
const bgSyncPlugin = new BackgroundSyncPlugin('offline-write-queue', {
  maxRetentionTime: 24 * 60,  // retry for up to 24 hours
})

registerRoute(
  ({ request, url }) =>
    request.method === 'POST' &&
    (url.pathname.includes('/checkout') || url.pathname.includes('/check-in')),
  new NetworkFirst({ plugins: [bgSyncPlugin] })
)

// Static assets: cache-first
registerRoute(
  ({ request }) => request.destination === 'script' || request.destination === 'style',
  new CacheFirst({ cacheName: 'static-assets', plugins: [...] })
)
```

### 5.6 Booking Engine: Next.js 14 App Router

```typescript
// apps/web-booking/src/app/search/page.tsx
// Server component — rendered on Edge with ISR
export default async function SearchPage({
  searchParams,
}: {
  searchParams: { pickup: string; dropoff: string; from: string; to: string }
}) {
  // Fetch availability server-side for first paint
  const availability = await fetchAvailability(searchParams)

  return (
    <Suspense fallback={<SearchSkeleton />}>
      <AvailabilityList initialData={availability} searchParams={searchParams} />
    </Suspense>
  )
}

export const revalidate = 60  // ISR: revalidate availability every 60 seconds
```

### 5.7 WCAG 2.1 AA Compliance

All interactive elements meet AA contrast ratios (4.5:1 text, 3:1 UI components). Key patterns:

```typescript
// Accessible stepper (keyboard navigable)
<div role="tablist" aria-label="Booking steps">
  {steps.map((step, i) => (
    <button
      key={step.id}
      role="tab"
      aria-selected={i === currentStep}
      aria-controls={`step-panel-${step.id}`}
      tabIndex={i === currentStep ? 0 : -1}
      onKeyDown={handleArrowKey}
    >
      {step.label}
    </button>
  ))}
</div>

// Form error announcements via live region
<div role="alert" aria-live="polite" aria-atomic="true">
  {error && <p className="text-destructive">{error}</p>}
</div>
```

### 5.8 Testing Strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Components, hooks, utilities |
| Integration | Testing Library | Feature flows with MSW mocked API |
| E2E | Playwright | Critical paths: search→book, checkout, check-in, damage claim |
| Visual regression | Chromatic | Component library snapshots |

```typescript
// e2e/booking-flow.spec.ts
test('customer can complete a booking', async ({ page }) => {
  await page.goto('/search?pickup=ORD&dropoff=ORD&from=2026-07-01&to=2026-07-05')
  await page.getByRole('button', { name: /Economy/i }).first().click()
  await page.getByLabel('First name').fill('Jane')
  await page.getByLabel('Last name').fill('Smith')
  // ... payment via Stripe test card
  await expect(page.getByRole('heading', { name: /Booking confirmed/i })).toBeVisible()
})
```

---

## 6. AWS Infrastructure Architecture

### 6.1 VPC Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  VPC: 10.0.0.0/16                                                        │
│                                                                          │
│  ┌────── AZ us-east-1a ─────────────────┐  ┌─── AZ us-east-1b ─────────┐│
│  │  PUBLIC (10.0.0.0/24)               │  │  PUBLIC (10.0.2.0/24)     ││
│  │  ALB node · NAT Gateway             │  │  ALB node · NAT Gateway   ││
│  │                                     │  │                           ││
│  │  PRIVATE (10.0.1.0/24)             │  │  PRIVATE (10.0.3.0/24)    ││
│  │  ECS API tasks (2–10)              │  │  ECS API tasks (replicas) ││
│  │  ECS Celery workers (3 services)   │  │  ECS workers (replicas)   ││
│  │  ECS Celery Beat (1 task, no-scale)│  │                           ││
│  │                                     │  │                           ││
│  │  DATA (10.0.4.0/24)               │  │  DATA (10.0.5.0/24)       ││
│  │  RDS PostgreSQL 16 (Primary)       │  │  RDS Multi-AZ Standby     ││
│  │  RDS Read Replica (reports)        │  │  ElastiCache Redis        ││
│  │  ElastiCache Redis (primary)       │  │  (replicas)               ││
│  └─────────────────────────────────────┘  └───────────────────────────┘│
│                                                                          │
│  SQS (regional): rcm-notifications.fifo · rcm-rate-filing.fifo          │
│                  rcm-reports · rcm-toll-processing · rcm-telematics     │
│                  + per-queue dead-letter queues (3 retries before DLQ)  │
│                                                                          │
│  S3: rcm-documents · rcm-photos · rcm-reports · rcm-frontend            │
└─────────────────────────────────────────────────────────────────────────┘

Traffic flow: Route 53 → CloudFront → WAF → ALB → ECS API tasks
Stripe webhooks: ALB /webhooks/stripe → ECS API (dedicated listener)
Telematics webhooks: ALB /webhooks/telematics → SQS rcm-telematics → Celery worker
```

### 6.2 Terraform Module Structure

```
infra/
├── modules/
│   ├── vpc/           # VPC, subnets, IGW, NAT GW, route tables
│   ├── alb/           # ALB, target groups, listeners, WAF association
│   ├── ecs-api/       # ECS cluster, API task definition, service, auto-scaling
│   ├── ecs-workers/   # Celery worker task definitions (3 types + Beat)
│   ├── rds/           # PostgreSQL instance, parameter group, read replica
│   ├── elasticache/   # Redis replication groups (avail cache, broker, sessions)
│   ├── s3-storage/    # Buckets, lifecycle policies, CORS
│   ├── cloudfront/    # CDN distributions (SPA + API), OAC for S3
│   ├── secrets/       # Secrets Manager, KMS keys, rotation lambdas
│   ├── iam/           # ECS task roles, service-linked roles
│   └── monitoring/    # CloudWatch dashboards, alarms, log groups, Datadog agent
│
└── environments/
    ├── dev/           # db.t4g.medium, min_tasks=1
    ├── staging/       # db.r7g.large, min_tasks=2
    └── prod/          # db.r7g.2xlarge, min_tasks=3
```

### 6.3 ECS Services

**API Service** — FastAPI (Uvicorn, 4 workers)

```json
{
  "family": "rcm-api",
  "cpu": "1024",
  "memory": "2048",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "containerDefinitions": [{
    "name": "api",
    "image": "ACCT.dkr.ecr.us-east-1.amazonaws.com/rcm-api:TAG",
    "portMappings": [{"containerPort": 8000}],
    "healthCheck": {
      "command": ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"],
      "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60
    },
    "secrets": [
      {"name": "DATABASE_URL",   "valueFrom": "arn:aws:secretsmanager:...:rcm/prod/db-url"},
      {"name": "REDIS_URL",      "valueFrom": "arn:aws:secretsmanager:...:rcm/prod/redis-url"},
      {"name": "STRIPE_SECRET",  "valueFrom": "arn:aws:secretsmanager:...:rcm/prod/stripe"},
      {"name": "JWT_SECRET_KEY", "valueFrom": "arn:aws:secretsmanager:...:rcm/prod/jwt"}
    ]
  }]
}
```

Auto-scaling: Target-tracking on CPU (60% target). Secondary trigger: ALB `RequestCountPerTarget` > 500. Min 3 / Max 20 tasks in prod.

**Celery Worker Services** — Three separate ECS services from the same image:

| Service | Queue(s) | CPU | Memory | Concurrency |
|---|---|---|---|---|
| `rcm-worker-notifications` | `notifications` | 512 | 1024 MB | 8 (I/O-bound) |
| `rcm-worker-rate-filing` | `rate_filing, toll_processing` | 1024 | 2048 MB | 4 (API-heavy) |
| `rcm-worker-reports` | `reports, batch` | 2048 | 4096 MB | 2 (CPU-heavy) |

**Celery Beat** — Single task, `desiredCount: 1`, no auto-scaling. Uses RedBeat scheduler backed by Redis to survive task restarts without duplicate executions.

**PgBouncer** — Sidecar on API service, transaction-mode pooling. API connects to PgBouncer (`localhost:5432`) rather than RDS directly. Keeps RDS `max_connections=100` while supporting 100+ concurrent Fargate tasks.

### 6.4 RDS Configuration

```hcl
resource "aws_db_instance" "primary" {
  engine                      = "postgres"
  engine_version              = "16.3"
  instance_class              = var.db_instance_class
  multi_az                    = true
  storage_type                = "gp3"
  allocated_storage           = 100
  max_allocated_storage       = 1000              # auto-scaling up to 1 TB
  backup_retention_period     = 35                # 35-day PITR
  deletion_protection         = true
  performance_insights_enabled = true
  monitoring_interval         = 60               # enhanced monitoring
}
```

**Recommended instance sizes:**

| Scale | Instance | vCPU | RAM |
|---|---|---|---|
| Small (1 location, 20 vehicles) | `db.t4g.large` | 2 | 8 GB |
| Medium (5 locations, 100 vehicles) | `db.r7g.large` | 2 | 16 GB |
| Large (20+ locations, 500+ vehicles) | `db.r7g.2xlarge` | 8 | 64 GB |

Key parameter group tuning:
- `max_connections = 100` (PgBouncer sits in front)
- `idle_in_transaction_session_timeout = 30000` (30s; prevents lock buildup at counter)
- `log_min_duration_statement = 1000` (log slow queries)
- `random_page_cost = 1.1` (gp3 SSD; close to sequential cost)

### 6.5 ElastiCache Redis (Three Separate Clusters)

| Cluster | Purpose | Config | `maxmemory-policy` |
|---|---|---|---|
| `rcm-avail-cache` | Availability query cache | 3 shards × 1 replica (cluster mode) | `allkeys-lru` |
| `rcm-celery-broker` | Celery task broker | 1 primary + 1 replica | `noeviction` |
| `rcm-sessions` | JWT session store, OTPs, distributed locks | 1 primary + 1 replica | `volatile-lru` |

**Redis key TTL strategy:**

| Pattern | TTL | Notes |
|---|---|---|
| `avail:{loc}:{class}:{bucket}` | 60s | Invalidated on reservation write |
| `rate_quote:{hash}` | 30s | Race-condition guard at booking confirmation |
| `session:{jti}` | 8h / 30d | Counter vs customer app |
| `otp:{customer_id}` | 10min | KYC / login codes |
| `preauth_lock:{res_id}` | 120s | Distributed lock for concurrent pre-auth renewal |
| `telematics:dedup:{device}:{ts}` | 5min | Prevents duplicate event processing |

### 6.6 Cost Estimates

**Small operator (1 location, 20 vehicles):** ~$303/month

| Component | Monthly |
|---|---|
| ECS Fargate (API + workers) | ~$37 |
| RDS db.t4g.large Multi-AZ | ~$140 |
| ElastiCache t4g.medium × 2 | ~$60 |
| ALB + CloudFront + S3 + SQS | ~$28 |
| NAT Gateway + Secrets + Monitoring | ~$38 |

**Medium operator (5 locations, 100 vehicles):** ~$1,714/month

| Component | Monthly |
|---|---|
| ECS Fargate (API + 3 worker types) | ~$220 |
| RDS r7g.large + Multi-AZ + read replica | ~$550 |
| ElastiCache (availability cluster 6 nodes + broker + sessions) | ~$450 |
| ALB + CloudFront + S3 | ~$62 |
| Datadog APM (5 hosts) | ~$300 |
| NAT + compliance stack | ~$132 |

**Top cost optimization levers:**
1. Reserved Instances on RDS (1-year All Upfront) → 37% savings
2. Graviton2 Fargate (`arm64` builds) → 20% cheaper than x86
3. S3 + ECR VPC Endpoints → eliminates 40–60% of NAT Gateway costs
4. S3 Intelligent Tiering on `rcm-photos` → 40% savings on historical archive

---

## 7. Integration & Real-Time Architecture

### 7.1 Integration Inventory

| Integration | Protocol | Auth | Use Case |
|---|---|---|---|
| Stripe | REST + Webhooks | Secret key + webhook secret | Payments, pre-auth, refunds |
| Avalara AvaTax | REST | Account ID + license key | Tax calculation |
| Twilio | REST | Account SID + Auth Token | SMS notifications |
| SendGrid | REST | API key | Transactional email |
| Apple/Google Push | APNS/FCM | Certificates / service account | Mobile push |
| Geotab | REST polling (5min) | OAuth 2.0 | Telematics |
| Samsara | REST polling (5min) | API token | Telematics |
| NHTSA vPIC | REST | None (public) | VIN decode |
| NHTSA Recalls | REST | None (public) | Recall polling (nightly) |
| AAMVA DLDV | SOAP/XML | State-issued credentials | DL validation at counter |
| Expedia Rapid | REST | API key + secret | OTA channel distribution |
| Booking.com | REST | OAuth 2.0 | OTA channel distribution |
| Sabre | SOAP (OTA XML) | Session token | GDS rate filing |
| Amadeus | REST | OAuth 2.0 | GDS rate filing |

### 7.2 IntegrationClient Base Class

All third-party calls go through a base class with retry logic, circuit breaker, and structured logging:

```python
# app/core/integrations/base.py
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from circuitbreaker import CircuitBreaker
import structlog

log = structlog.get_logger()

class IntegrationClient:
    def __init__(self, config: IntegrationClientConfig):
        self.config = config
        self.circuit = CircuitBreaker(
            failure_threshold=5,
            recovery_timeout=60,
            expected_exception=httpx.HTTPStatusError,
        )
        self._client = httpx.AsyncClient(
            base_url=config.base_url,
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
            headers=config.default_headers,
        )

    async def request(self, method: str, path: str, *, correlation_id: str = None, **kwargs):
        if not self.circuit.allow_request():
            raise IntegrationCircuitOpenError(
                f"Circuit OPEN for {self.config.integration_name} — skipping request"
            )

        @retry(
            stop=stop_after_attempt(self.config.max_attempts),
            wait=wait_exponential(multiplier=1, min=2, max=30)
                 + wait_random(0, 1),          # jitter prevents thundering herd
            retry=retry_if_exception_type(httpx.TransportError),
            reraise=True,
        )
        async def _execute():
            response = await self._client.request(
                method, path,
                headers={"X-Correlation-ID": correlation_id or str(uuid4())},
                **kwargs
            )
            if response.status_code >= 500:
                self.circuit.record_failure()
                response.raise_for_status()
            self.circuit.record_success()
            log.info("integration_request_success",
                     integration=self.config.integration_name,
                     method=method, path=path,
                     status=response.status_code)
            return response

        return await _execute()
```

### 7.3 Stripe Payment Lifecycle

```
Booking confirmed → CreatePaymentIntent(amount=deposit, capture_method=manual)
                    → PreAuth created (status=AUTHORIZED, auth_expiry_at = now+7d)

Checkout         → ConfirmPaymentIntent (idempotency_key=reservation_id)
                    → VehicleBlock created with block_type=RESERVATION

Return           → CapturePaymentIntent(amount=final_total)
                    → Payment status → CAPTURED

Extension        → IncrementalAuthorizationRequest (Visa/MC Network Transaction ID chain)
                    → New payment row (type=INCREMENTAL_AUTH) linked to original preauth

Cancellation     → CancelPaymentIntent → VOIDED
                    → VehicleBlock.deleted_at = now()
```

**Stripe Webhook Handler with Idempotency:**

```python
# app/domains/payments/stripe_webhook.py
@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    # Idempotency: check if already processed
    existing = await db.get(ProcessedWebhook, event["id"])
    if existing:
        return {"status": "already_processed"}

    # Dispatch to domain-specific handlers
    handler = _WEBHOOK_HANDLERS.get(event["type"])
    if handler:
        await handler(event["data"]["object"], db)

    # Mark as processed within the same transaction
    db.add(ProcessedWebhook(event_id=event["id"], event_type=event["type"]))
    await db.commit()

    return {"status": "ok"}
```

### 7.4 Telematics Integration

Geotab and Samsara are polled every 5 minutes by a Celery task. Telematics events are published to a Redis pub/sub channel for WebSocket fan-out to the counter fleet view.

```python
# app/worker/tasks/telematics.py
@celery_app.task(name="sync_telematics_events", queue="batch")
async def sync_telematics_events(tenant_id: str, provider: str):
    client = _get_telematics_client(provider)
    events = await client.get_recent_events(since=datetime.utcnow() - timedelta(minutes=6))

    for event in events:
        # Dedup: skip events already processed (5-minute TTL on dedup key)
        dedup_key = f"telematics:dedup:{event.device_id}:{event.timestamp.isoformat()}"
        if await redis.exists(dedup_key):
            continue
        await redis.setex(dedup_key, 300, "1")

        # Persist to partitioned telematics_events table
        await db.execute(insert(TelematicsEvent).values(**event.to_db()))

        # Update vehicle.odometer and soc_pct / fuel_pct
        await vehicle_repo.apply_telematics_update(event.vehicle_id, event)

        # Publish for WebSocket fan-out
        await redis.publish(
            f"fleet:{tenant_id}:{event.location_id}",
            json.dumps({"type": "TELEMATICS_UPDATE", "vehicle_id": event.vehicle_id,
                        "odometer": event.odometer, "soc_pct": event.soc_pct})
        )
```

### 7.5 OTA Channel Adapter Pattern

```python
# app/domains/channels/base.py
from abc import ABC, abstractmethod

class OTAChannelAdapter(ABC):
    """All OTA/GDS channel implementations conform to this interface."""

    @abstractmethod
    async def check_availability(self, request: AvailabilityRequest) -> AvailabilityResponse:
        """Translate platform availability to OTA-specific format."""
        ...

    @abstractmethod
    async def confirm_booking(self, booking: OTABooking) -> ReservationID:
        """Receive OTA booking, create internal reservation, return confirmation."""
        ...

    @abstractmethod
    async def file_rates(self, rate_codes: list[RateCode]) -> FilingResult:
        """Push rates to GDS / OTA channel."""
        ...

    @abstractmethod
    async def cancel_booking(self, ota_ref: str) -> None:
        ...
```

Each OTA (Expedia Rapid, Booking.com, Sabre OTA XML) has a concrete adapter. The channel dispatcher routes inbound webhooks/polls to the correct adapter. Rate filing Celery tasks call `adapter.file_rates()` on a schedule after every rate code change.

### 7.6 Notification Dispatch via Redis Streams

```python
# app/domains/notifications/dispatcher.py
async def dispatch_notification(
    event_code: str,
    recipient_id: UUID,
    context: dict,
    tenant_id: UUID,
):
    """Push notification to Redis Stream; workers consume and deliver."""
    await redis.xadd(
        f"notifications:{tenant_id}",
        {
            "event_code": event_code,
            "recipient_id": str(recipient_id),
            "context": json.dumps(context),
            "channels": json.dumps(_resolve_channels(event_code, recipient_id)),
        },
        maxlen=10_000,  # cap stream length
    )
```

Notification worker consumes the stream, renders templates (email HTML, SMS, push body), and delivers via SendGrid / Twilio / APNS/FCM. Each delivery attempt is logged to `notification_log`. The 30 canonical notification events are defined in FEATURES.md §40.7.

### 7.7 Avalara Tax Caching

Avalara charges per API call. Tax calculations are cached by a SHA-256 hash of the inputs:

```python
# app/domains/pricing/tax_service.py
async def calculate_taxes(
    location_id: UUID,
    line_items: list[LineItem],
    customer_address: Address,
) -> TaxResult:
    cache_key = f"tax:{hashlib.sha256(json.dumps({
        'location_id': str(location_id),
        'items': [i.dict() for i in sorted(line_items)],
        'address': customer_address.dict(),
    }, sort_keys=True).encode()).hexdigest()}"

    cached = await redis.get(cache_key)
    if cached:
        return TaxResult.parse_raw(cached)

    result = await avalara_client.create_transaction(location_id, line_items, customer_address)
    await redis.setex(cache_key, 3600, result.json())  # 1-hour TTL
    return result
```

### 7.8 Outbound Webhooks (API Partner Notifications)

```python
# app/domains/admin/webhooks.py
async def deliver_webhook(subscription: WebhookSubscription, payload: dict):
    """Deliver signed webhook to API partner endpoint."""
    body = json.dumps({"event": payload["event_type"], "data": payload, "id": str(uuid4())})
    signature = hmac.new(
        subscription.signing_secret.encode(),
        body.encode(),
        hashlib.sha256,
    ).hexdigest()

    async with httpx.AsyncClient() as client:
        response = await client.post(
            subscription.endpoint_url,
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-RCM-Signature": f"sha256={signature}",
                "X-RCM-Event": payload["event_type"],
            },
            timeout=10.0,
        )
        response.raise_for_status()
```

---

## 8. Security Architecture

### 8.1 Authentication

```
Flow:
  POST /auth/login → validate credentials → issue JWT
  Response: Set-Cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/api
            Set-Cookie: refresh_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh

JWT claims: {sub, jti, tenant_id, roles, primary_role, exp, iat}
Access token TTL: 8h (counter), 1h (web booking)
Refresh token TTL: 30d, rotated on use

Revocation: jti added to Redis SET `revoked_tokens` with TTL matching token expiry.
            Counter logout immediately invalidates the session.
```

### 8.2 Authorization (RBAC)

```
Roles: CUSTOMER · CORPORATE_BOOKER · COUNTER_AGENT · SENIOR_AGENT
       BRANCH_MANAGER · REGIONAL_MANAGER · FLEET_MANAGER
       MAINTENANCE_TECH · CLAIMS_COORDINATOR · FINANCE
       SYSTEM_ADMIN · SUPER_ADMIN · API_PARTNER

Permissions are checked at two layers:
1. FastAPI dependency (require_permission) — API route level
2. PostgreSQL RLS — data row level (belt and suspenders)

No JWT payload contains permissions (only roles). Permission matrix is loaded
from the database on application startup and cached in memory.
```

### 8.3 PCI DSS Compliance (SAQ A)

The platform achieves PCI DSS SAQ A compliance — the narrowest scope — by ensuring no raw card data ever touches platform servers:

- **Browser/app:** Stripe.js tokenizes card data in an iframe served from Stripe's domain
- **API:** Receives only the payment method token (e.g., `pm_xxx`), never a PAN or CVV
- **Database:** Stores only the last 4 digits, card brand, expiry, and Stripe token reference
- **Pre-auth:** Server calls `stripe.PaymentIntents.create(capture_method="manual")` — no card number involved
- **Network segregation:** WAF + VPC security groups block direct internet access to database subnets

### 8.4 Network Security

```hcl
# WAF rules (on ALB)
- AWS Managed Rules: CommonRuleSet (OWASP Top 10), SQLiRuleSet, KnownBadInputsRuleSet
- Rate limit: 2000 requests per 5-minute window per IP → BLOCK
- Geo-block: configurable per tenant

# Security Groups
- ALB SG: inbound 443/80 from 0.0.0.0/0 (CloudFront managed prefix list in prod)
- API SG: inbound 8000 from ALB SG only
- RDS SG: inbound 5432 from API SG + Workers SG only
- Redis SG: inbound 6379 from API SG + Workers SG only
- No 0.0.0.0/0 inbound on any private resource
```

### 8.5 Secrets Management

All secrets stored in AWS Secrets Manager, injected at ECS container start. No secrets in Dockerfile ENV or plaintext task definition. KMS customer-managed keys per data classification (RDS, ElastiCache, S3 separately keyed).

```
rcm/{env}/db-credentials     — auto-rotated 30 days
rcm/{env}/redis-url          — manual rotation
rcm/{env}/stripe             — manual rotation (Stripe dashboard)
rcm/{env}/jwt                — auto-rotated 90 days (invalidates all sessions)
rcm/{env}/smtp               — manual rotation
rcm/{env}/ota-api-keys       — manual rotation
rcm/{env}/twilio             — manual rotation
```

### 8.6 Compliance Controls

| Control | Implementation |
|---|---|
| VPC Flow Logs | Enabled all subnets; 90-day S3 retention |
| CloudTrail | All regions; management + data events; S3 Object Lock (COMPLIANCE, 7 years) |
| GuardDuty | All regions; findings → SNS → PagerDuty |
| AWS Config | Managed rules: `rds-storage-encrypted`, `s3-bucket-ssl-requests-only`, `ecs-task-definition-nonroot-user` |
| GDPR | Customer anonymization via `anonymized_at` flag; DSAR export via audit log; notification body stored as SHA-256 hash only |
| Data retention | 7-year financial records; 12-month telematics; 90-day session logs; archive → S3 Glacier after PostgreSQL retention |

---

## 9. Deployment & DevOps

### 9.1 Blue/Green CI/CD Pipeline

```
Push to main
  │
  ▼
┌─ test ─────────────────────────────────────────────────────┐
│  pytest (real postgres + redis via GitHub Actions services) │
│  ruff check + mypy                                          │
│  alembic upgrade --sql | check_lock_safety.py              │
└────────────────────────────────────────────────────────────┘
  │
  ▼
┌─ build-push ────────────────────────────────────────────────┐
│  docker build (arm64 for Graviton) + push to ECR            │
│  SHA-tagged: rcm-api:sha-<short_sha>                        │
└────────────────────────────────────────────────────────────┘
  │
  ▼
┌─ deploy-staging ────────────────────────────────────────────┐
│  Register new ECS task definition with new image tag         │
│  CodeDeploy blue/green: shifts traffic, waits health check   │
│  Retains blue fleet 1h before termination                    │
└────────────────────────────────────────────────────────────┘
  │
  ▼
┌─ smoke-tests ───────────────────────────────────────────────┐
│  Playwright E2E against staging environment                  │
│  Must pass before production gate opens                      │
└────────────────────────────────────────────────────────────┘
  │
  ▼
┌─ approval ─ (GitHub environment: production) ───────────────┐
│  Required reviewer approves; pauses pipeline                 │
└────────────────────────────────────────────────────────────┘
  │
  ▼
┌─ deploy-prod ───────────────────────────────────────────────┐
│  CodeDeploy blue/green to production ECS                     │
│  Health check loop (10 × 30s); auto-rollback on failure      │
└────────────────────────────────────────────────────────────┘
```

### 9.2 Database Migration Protocol

```
1. Run alembic upgrade head on staging → verify
2. Schema must be backward-compatible (expand phase only at this step)
3. Deploy new application code
4. Run backfill migrations (separate job, not in deploy critical path)
5. Deploy contract migration (add NOT NULL / drop old column) after all old pods drained
```

Migration files must pass the lock-safety CI gate (no `ACCESS EXCLUSIVE` locks on large tables). All index additions use `CREATE INDEX CONCURRENTLY`.

### 9.3 Monitoring Alerts (CloudWatch)

| Alarm | Threshold | Action |
|---|---|---|
| API p95 latency | > 2s for 5 consecutive minutes | SNS → PagerDuty |
| 5xx error rate | > 10 errors/minute | SNS → PagerDuty |
| RDS CPU | > 75% for 15min | SNS → ops Slack |
| Redis memory | > 80% | SNS → ops Slack |
| SQS notification queue depth | > 500 messages | SNS → ops Slack |
| Celery task failures | > 10 failures / 5min | SNS → PagerDuty |
| Pre-auth renewal failures | > 0 in 6h window | SNS → finance Slack |

### 9.4 SLA Targets

| Metric | Target |
|---|---|
| API availability | 99.9% monthly |
| Booking engine p95 latency | < 800ms |
| Counter checkout API p95 latency | < 500ms |
| Availability search p95 latency | < 300ms (Redis cache hit) |
| Notification delivery | < 60s from event trigger |
| RTO (Recovery Time Objective) | < 30 minutes (RDS Multi-AZ failover) |
| RPO (Recovery Point Objective) | < 5 minutes (synchronous Multi-AZ replication) |

### 9.5 Observability Stack

**Structured JSON logging (all services):**

```python
import structlog
log = structlog.get_logger()

# Every log line emitted as:
# {"timestamp":"...","level":"info","service":"rcm-api","trace_id":"...",
#  "event":"reservation.confirmed","reservation_id":"...","duration_ms":145}
```

**OpenTelemetry tracing → Datadog APM:**

```python
# app/instrumentation.py
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor

def init_tracing(app):
    FastAPIInstrumentor.instrument_app(app)
    SQLAlchemyInstrumentor().instrument()
    RedisInstrumentor().instrument()
```

**Log queries** (CloudWatch Logs Insights) defined for:
- Slow API calls by endpoint (> 1s)
- 5xx errors by path and status code
- Celery failure rate by task name
- Pre-auth renewal failures with reservation ID
- Stripe webhook processing time

---

## 10. Third-Party Library Manifest

### Backend (Python)

| Library | Version | Purpose |
|---|---|---|
| `fastapi` | 0.115+ | Web framework |
| `uvicorn[standard]` | 0.30+ | ASGI server |
| `sqlalchemy[asyncio]` | 2.0+ | ORM |
| `asyncpg` | 0.29+ | PostgreSQL async driver |
| `alembic` | 1.13+ | Database migrations |
| `pydantic` | 2.7+ | Data validation / settings |
| `python-jose[cryptography]` | 3.3+ | JWT encoding/decoding |
| `passlib[bcrypt]` | 1.7+ | Password hashing |
| `celery[redis]` | 5.4+ | Background task queue |
| `redbeat` | 2.2+ | Redis-backed Celery scheduler |
| `httpx` | 0.27+ | Async HTTP client |
| `tenacity` | 8.3+ | Retry logic |
| `circuitbreaker` | 2.0+ | Circuit breaker pattern |
| `stripe` | 9.12+ | Stripe SDK |
| `structlog` | 24.4+ | Structured logging |
| `opentelemetry-sdk` | 1.25+ | Tracing |
| `opentelemetry-instrumentation-fastapi` | 0.46b+ | FastAPI auto-instrumentation |
| `sentry-sdk[fastapi]` | 2.12+ | Error tracking |
| `jinja2` | 3.1+ | Email template rendering |
| `weasyprint` | 62+ | PDF generation (rental agreements) |
| `boto3` | 1.34+ | AWS SDK (S3, SQS, Secrets Manager) |
| `pytest` | 8.2+ | Testing framework |
| `pytest-asyncio` | 0.23+ | Async test support |
| `ruff` | 0.5+ | Linting + formatting |
| `mypy` | 1.11+ | Static type checking |

### Frontend (TypeScript)

| Library | Version | Purpose |
|---|---|---|
| `next` | 14.x | SSR booking engine |
| `react` | 18.x | UI framework |
| `@tanstack/react-query` | 5.x | Server state management |
| `zustand` | 4.x | Client UI state |
| `react-hook-form` | 7.x | Form state |
| `zod` | 3.x | Schema validation |
| `openapi-typescript` | 7.x | TypeScript client generation |
| `openapi-fetch` | 0.12+ | Typed fetch client |
| `@radix-ui/*` | 1.x | Headless accessible components |
| `tailwindcss` | 3.x | Utility CSS |
| `shadcn/ui` | latest | Component library (built on Radix) |
| `workbox-*` | 7.x | Service worker / offline |
| `@stripe/stripe-js` | 4.x | Stripe.js for card capture |
| `date-fns` | 3.x | Date utilities |
| `recharts` | 2.x | Dashboard charts |
| `@dnd-kit/*` | 6.x | Drag-and-drop (fleet grid, schedule view) |
| `playwright` | 1.45+ | E2E testing |
| `vitest` | 1.6+ | Unit testing |
| `@testing-library/react` | 16.x | Integration testing |

### Infrastructure

| Tool | Purpose |
|---|---|
| Terraform 1.8+ | Infrastructure as Code |
| `hashicorp/aws` provider 5.x | AWS resource management |
| GitHub Actions | CI/CD pipelines |
| AWS CodeDeploy | Blue/green ECS deployments |
| `pg_partman` | PostgreSQL partition management |
| `pg_cron` | Database-level scheduled jobs |
| Datadog | APM, infrastructure monitoring |
| PagerDuty | On-call alerting |

---

*This document describes the complete architecture for the Rental Car Management System. For feature requirements, see `FEATURES.md`. For full database DDL, see `DATABASE_ARCHITECTURE.md`. The three documents together form the complete specification for implementing the system.*
