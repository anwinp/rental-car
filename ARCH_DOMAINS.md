# ARCH_DOMAINS.md — Domain Architecture Reference
## Rental Car Manager · Phase 1 MVP · 11 Business Domains

**Generated:** 2026-06-15  
**Status:** Implementation-Ready  
**Stack:** FastAPI 0.111 · Python 3.12 · SQLAlchemy 2.0 async · Pydantic v2 · PostgreSQL 16 · Celery 5.3 · Redis 7

---

## Table of Contents

1. [Design Conflicts & Gaps (Read First)](#0-design-conflicts--gaps)
2. [Cross-Cutting Conventions](#cross-cutting-conventions)
3. [Domain 1 — Tenant & Multi-Tenancy](#domain-1--tenant--multi-tenancy)
4. [Domain 2 — Fleet & Vehicles](#domain-2--fleet--vehicles)
5. [Domain 3 — Reservations](#domain-3--reservations)
6. [Domain 4 — Rate Engine](#domain-4--rate-engine)
7. [Domain 5 — Extras & Protection Products](#domain-5--extras--protection-products)
8. [Domain 6 — Payments](#domain-6--payments)
9. [Domain 7 — Counter Operations](#domain-7--counter-operations)
10. [Domain 8 — Customer Management](#domain-8--customer-management)
11. [Domain 9 — Damage & Inspections](#domain-9--damage--inspections)
12. [Domain 10 — Notification System](#domain-10--notification-system)
13. [Domain 11 — SaaS Billing](#domain-11--saas-billing)
14. [ASCII Sequence Diagrams](#ascii-sequence-diagrams)

---

## 0. Design Conflicts & Gaps

The following inconsistencies were found across FEATURES.md, BACKLOG.md, DATABASE_ARCHITECTURE.md, and ARCHITECTURE.md. Each is flagged with a resolution recommendation.

### GAP-001 · Day-Zero Readiness Gate: 8 vs 9 Checks
- **BACKLOG.md TNT-003:** "8 readiness checks"
- **FEATURES.md §39.1:** Lists 9 items (adds "notification email credentials configured" as #9)
- **Resolution:** FEATURES.md is the canonical feature spec. Implement **9 checks**. Update BACKLOG.md TNT-003 acceptance criteria to match. The 9th check (notification credentials) is critical for transactional email delivery and must not be omitted.

### GAP-002 · DNR Scope Enum: BRAND vs REGIONAL
- **DATABASE_ARCHITECTURE.md customers table:** `CHECK (dnr_scope IN ('LOCATION','BRAND','NETWORK'))`
- **BACKLOG.md CUS-002:** `LOCATION/REGIONAL/NETWORK`
- **Resolution:** Use `('LOCATION','REGIONAL','NETWORK')` everywhere. "BRAND" is semantically incorrect for a franchise/regional operator hierarchy. Update DATABASE_ARCHITECTURE.md CHECK constraint and the `customers` table enum. All service code must use `DNRScope.REGIONAL`.

### GAP-003 · Vehicle Status Count: 13 vs 14 States
- **BACKLOG.md FLT-003:** "14 states"
- **DATABASE_ARCHITECTURE.md vehicle_status enum:** 13 values (`STAGING, AVAILABLE, ON_RENT, RETURNING, READY_FOR_INSPECTION, CLEANING, MAINTENANCE, IN_REPAIR, DAMAGE_HOLD, ADMIN_HOLD, PENDING_DISPOSAL, DISPOSED, PENDING_DELIVERY`)
- **Root cause:** `CHARGING` appears in `vehicle_block_type` enum but not `vehicle_status` enum. BACKLOG.md likely counted it as a status.
- **Resolution:** `CHARGING` is a **block type**, not a vehicle status. The state machine has **13 named statuses**. When a vehicle is charging it remains `AVAILABLE` (or its current status) with a `VehicleBlock` of type `CHARGING`. Update BACKLOG.md FLT-003 to read "13 statuses." No schema change needed.

### GAP-004 · Reservation Status: ACTIVE vs CHECKED_OUT
- **ARCHITECTURE.md §42.4 text:** References `ACTIVE` status in a CHECK constraint example
- **DATABASE_ARCHITECTURE.md reservation_status enum:** Uses `CHECKED_OUT`
- **Resolution:** The canonical value is `CHECKED_OUT` (DATABASE_ARCHITECTURE.md is ground truth for schema). All service code and documentation must use `CHECKED_OUT`. The ARCHITECTURE.md reference to `ACTIVE` is a documentation error.

### GAP-005 · Backend Tech Stack Deviation
- **FEATURES.md §24.1:** Recommends Node.js/NestJS as primary backend
- **ARCHITECTURE.md:** Implements FastAPI/Python 3.12
- **Resolution:** This is a **deliberate architectural decision** (FastAPI chosen for ML-adjacent data processing, Pydantic v2 integration, and team expertise). FEATURES.md §24.1 is treated as a non-binding recommendation. No action required; document as ADR-001 in a separate Architecture Decision Record file.

### GAP-006 · Confirmation Number Uniqueness Scope
- **FEATURES.md:** Implies per-tenant uniqueness
- **DATABASE_ARCHITECTURE.md:** `UNIQUE` constraint is system-wide (no `tenant_id` in the unique index)
- **Resolution:** System-wide uniqueness is correct and simpler. It prevents cross-tenant confusion in support scenarios. Implement as-is. Prefix is `RC-` + 8 alphanumeric characters (base-36 encoded timestamp + random suffix).

### GAP-007 · Notification Body Storage
- **FEATURES.md:** Implies full body stored for audit
- **DATABASE_ARCHITECTURE.md notification_log:** Stores only `body_hash` (SHA-256), not body text
- **Resolution:** Body-hash-only is correct for GDPR compliance. Full rendered bodies are ephemeral. The original Jinja2 template + context variables (minus PII) are sufficient for audit reconstruction. No change needed.

---

## Cross-Cutting Conventions

### BaseRepository Pattern
```python
# apps/api/app/repositories/base.py
from typing import Generic, TypeVar, Type, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

ModelT = TypeVar("ModelT")

class BaseRepository(Generic[ModelT]):
    model: Type[ModelT]

    def __init__(self, session: AsyncSession, tenant_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id

    def _tenant_filter(self) -> Any:
        return self.model.tenant_id == self._tenant_id  # type: ignore[attr-defined]

    def _base_query(self):
        return select(self.model).where(
            and_(self._tenant_filter(), self.model.deleted_at.is_(None))  # type: ignore[attr-defined]
        )
```

### GUC Session Variable Injection
```python
# apps/api/app/middleware/tenant.py
async def inject_guc(session: AsyncSession, claims: TokenClaims) -> None:
    await session.execute(text("SELECT set_config('app.tenant_id', :tid, TRUE)"), {"tid": claims.tenant_id})
    await session.execute(text("SELECT set_config('app.user_id',   :uid, TRUE)"), {"uid": claims.user_id})
    await session.execute(text("SELECT set_config('app.role',      :rol, TRUE)"), {"rol": claims.primary_role})
```

### RFC 7807 Error Convention
All domain errors inherit from `DomainError` and map to HTTP status codes via the exception handler in `apps/api/app/exceptions.py`. Example:
```python
class DomainError(Exception):
    http_status: int = 500
    error_code: str = "INTERNAL_ERROR"

class ConflictError(DomainError):
    http_status = 409

class NotFoundError(DomainError):
    http_status = 404

class ValidationError(DomainError):
    http_status = 422

class ForbiddenError(DomainError):
    http_status = 403
```

### Soft Delete Pattern
All tables include `deleted_at: datetime | None`. All repository `_base_query()` methods filter `WHERE deleted_at IS NULL`. Hard deletes are never performed on operational data.

### Audit Trail
All writes go through DB triggers (`audit.log_change()` SECURITY DEFINER function) that read GUC variables and insert into `audit.audit_events`. No application-level audit calls are needed; the trigger is the single source of truth.

### IntegrationClient Base Class
```python
# apps/api/app/integrations/base.py
from tenacity import retry, stop_after_attempt, wait_exponential, wait_jitter

class IntegrationClient:
    _failure_count: int = 0
    _failure_threshold: int = 5
    _recovery_timeout: int = 60  # seconds
    _open_until: float = 0.0

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10) + wait_jitter(1),
        reraise=True,
    )
    async def _call(self, method: str, url: str, **kwargs) -> dict:
        ...  # circuit breaker check + httpx call
```

---

## Domain 1 — Tenant & Multi-Tenancy

### 1.1 Responsibility
Provisioning new operator tenants, managing slug generation, enforcing the day-zero readiness gate, tracking ToS acceptance, handling tenant suspension, and propagating `tenant_id` to all downstream operations via GUC session variables and JWT claims.

### 1.2 Service Interface
```python
# apps/api/app/domains/tenant/service.py
from typing import Protocol
from uuid import UUID
from .schemas import (
    TenantProvisionRequest, TenantProvisionResult,
    TenantReadinessReport, TenantSuspendRequest,
    ToSAcceptanceRequest,
)

class TenantServiceProtocol(Protocol):
    async def provision_tenant(
        self, req: TenantProvisionRequest
    ) -> TenantProvisionResult:
        """
        Execute 7-step provisioning wizard.
        Raises DuplicateSlugError if slug already taken.
        Raises TenantProvisionError on any step failure (rolls back entire saga).
        """
        ...

    async def generate_slug(self, company_name: str) -> str:
        """
        Slugify company_name → lowercase, hyphen-separated, max 32 chars.
        Appends numeric suffix (-2, -3, …) on collision.
        """
        ...

    async def check_readiness(self, tenant_id: UUID) -> TenantReadinessReport:
        """
        Run all 9 day-zero readiness checks.
        Returns report with per-check pass/fail and blocking status.
        """
        ...

    async def accept_tos(self, req: ToSAcceptanceRequest) -> None:
        """
        Record ToS acceptance with version, timestamp, IP address, user_id.
        Idempotent — subsequent calls for same version are no-ops.
        """
        ...

    async def suspend_tenant(self, req: TenantSuspendRequest) -> None:
        """
        Set tenant.status = SUSPENDED, reason, suspended_at, suspended_by.
        Immediately invalidates all active sessions for the tenant.
        All subsequent API calls return HTTP 402 (subscription issue) or 403.
        """
        ...

    async def reactivate_tenant(self, tenant_id: UUID, reactivated_by: UUID) -> None:
        """Reverse suspension. Sets status = ACTIVE."""
        ...

    async def get_tenant(self, tenant_id: UUID) -> "TenantRead":
        ...
```

### 1.3 Repository Interface
```python
# apps/api/app/domains/tenant/repository.py
from typing import Protocol
from uuid import UUID
from .models import Tenant

class TenantRepositoryProtocol(Protocol):
    async def create(self, tenant: Tenant) -> Tenant: ...
    async def get_by_id(self, tenant_id: UUID) -> Tenant | None: ...
    async def get_by_slug(self, slug: str) -> Tenant | None: ...
    async def slug_exists(self, slug: str) -> bool: ...
    async def update_status(self, tenant_id: UUID, status: str, **kwargs) -> None: ...
    async def record_tos_acceptance(
        self, tenant_id: UUID, user_id: UUID, version: str, ip: str
    ) -> None: ...
    async def get_readiness_checks(self, tenant_id: UUID) -> dict[str, bool]: ...
```

### 1.4 Pydantic v2 Schemas
```python
# apps/api/app/domains/tenant/schemas.py
from pydantic import BaseModel, Field, field_validator, model_validator
from uuid import UUID
from datetime import datetime
import re

SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9\-]{1,31}$')

class TenantProvisionRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, description="Auto-generated if omitted")
    owner_email: str = Field(pattern=r'^[^@]+@[^@]+\.[^@]+$')
    owner_name: str = Field(min_length=1, max_length=120)
    country_code: str = Field(min_length=2, max_length=2, pattern=r'^[A-Z]{2}$')
    currency_code: str = Field(min_length=3, max_length=3, pattern=r'^[A-Z]{3}$')
    timezone: str = Field(description="IANA timezone string e.g. America/New_York")
    plan_id: str = Field(description="SaaS plan identifier")

    @field_validator('slug')
    @classmethod
    def validate_slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("Slug must be lowercase alphanumeric with hyphens, 2-32 chars")
        return v

class TenantProvisionResult(BaseModel):
    tenant_id: UUID
    slug: str
    owner_user_id: UUID
    trial_ends_at: datetime
    readiness_report: "TenantReadinessReport"

class ReadinessCheck(BaseModel):
    key: str
    label: str
    passed: bool
    detail: str | None = None

class TenantReadinessReport(BaseModel):
    tenant_id: UUID
    all_passed: bool
    checks: list[ReadinessCheck]  # Always 9 items

    # 9 canonical check keys (see GAP-001 resolution):
    # company_profile, location_hours, payment_gateway_connected,
    # payment_gateway_tested, active_rate_code, vehicle_available,
    # tax_template, ra_template, counter_agent_activated,
    # notification_email_credentials

class TenantSuspendRequest(BaseModel):
    tenant_id: UUID
    reason: str = Field(min_length=5, max_length=500)
    suspended_by: UUID

class ToSAcceptanceRequest(BaseModel):
    tenant_id: UUID
    user_id: UUID
    tos_version: str
    accepted_at: datetime
    ip_address: str

class TenantRead(BaseModel):
    model_config = {"from_attributes": True}
    tenant_id: UUID
    slug: str
    company_name: str
    status: str
    plan_id: str
    trial_ends_at: datetime | None
    created_at: datetime
```

### 1.5 Provisioning Flow (7 Steps)
```
Step 1: Validate input + generate slug (collision-safe)
Step 2: Create tenant record (status=PROVISIONING)
Step 3: Create owner user record + send welcome email
Step 4: Seed default rate classes, SIPP codes (tenant_id=NULL rows are system-wide)
Step 5: Create default notification templates from system defaults
Step 6: Create Stripe customer (SaaS billing) → store stripe_customer_id
Step 7: Set tenant.status=ACTIVE, emit TENANT_PROVISIONED audit event
```
All 7 steps run in a database transaction. If any step fails, the entire transaction rolls back and a TENANT_PROVISION_FAILED audit event is written (via a compensating write in the exception handler, using a new session).

### 1.6 Day-Zero Readiness Gate (9 Checks)

| # | Key | Check Logic |
|---|-----|------------|
| 1 | company_profile | `tenant.company_name IS NOT NULL AND tenant.address IS NOT NULL` |
| 2 | location_hours | `EXISTS (SELECT 1 FROM locations WHERE tenant_id=:tid AND deleted_at IS NULL AND hours_json IS NOT NULL)` |
| 3 | payment_gateway_connected | `tenant.stripe_account_id IS NOT NULL` |
| 4 | payment_gateway_tested | `tenant.stripe_test_charge_succeeded = TRUE` |
| 5 | active_rate_code | `EXISTS (SELECT 1 FROM rate_codes WHERE tenant_id=:tid AND is_active=TRUE)` |
| 6 | vehicle_available | `EXISTS (SELECT 1 FROM vehicles WHERE tenant_id=:tid AND status='AVAILABLE')` |
| 7 | tax_template | `EXISTS (SELECT 1 FROM tax_templates WHERE tenant_id=:tid)` |
| 8 | ra_template | `tenant.ra_template_id IS NOT NULL` |
| 9 | notification_email_credentials | `tenant.smtp_host IS NOT NULL OR tenant.sendgrid_api_key IS NOT NULL` |

Checks 1–9 are all **blocking** (operator cannot go live with any failed check). The API returns `HTTP 412 Precondition Failed` if `GET /tenants/{id}/readiness` shows `all_passed=false` when the operator attempts to open for business.

### 1.7 Business Rules (Testable Assertions)
```python
# tests/domains/tenant/test_rules.py

def test_slug_uniqueness_enforced():
    """Two tenants cannot share the same slug."""

def test_slug_auto_suffix_on_collision():
    """If 'acme' exists, next attempt produces 'acme-2'."""

def test_provisioning_rolls_back_on_stripe_failure():
    """If Stripe customer creation fails, no tenant record persists."""

def test_readiness_gate_blocks_go_live_with_failed_check():
    """POST /locations/{id}/open returns 412 when readiness.all_passed=False."""

def test_tos_acceptance_idempotent():
    """Accepting same ToS version twice does not raise and does not create duplicate records."""

def test_suspension_invalidates_sessions():
    """After tenant suspension, existing JWT tokens for that tenant are rejected."""

def test_nine_readiness_checks_always_returned():
    """TenantReadinessReport.checks always has exactly 9 items."""

def test_tenant_id_injected_as_guc_before_query():
    """All repository calls set app.tenant_id GUC before executing SQL."""
```

### 1.8 Error Types
| Error Class | HTTP | Code | Trigger |
|-------------|------|------|---------|
| `DuplicateSlugError` | 409 | `TENANT_SLUG_TAKEN` | Slug already registered |
| `TenantProvisionError` | 500 | `TENANT_PROVISION_FAILED` | Saga step failure |
| `TenantNotFoundError` | 404 | `TENANT_NOT_FOUND` | Unknown tenant_id |
| `TenantSuspendedError` | 402 | `TENANT_SUSPENDED` | Request from suspended tenant |
| `ReadinessGateFailedError` | 412 | `READINESS_GATE_FAILED` | Go-live blocked |
| `ToSNotAcceptedError` | 403 | `TOS_NOT_ACCEPTED` | Current ToS version not accepted |

### 1.9 Integration Points
- **Stripe Billing:** `StripeClient.create_customer()` in Step 6 of provisioning
- **Email (SMTP/SendGrid):** Welcome email in Step 3 via `NotificationService.dispatch()`
- **Redis Sessions:** `redis.delete_pattern(f"session:*:{tenant_id}")` on suspension

---

## Domain 2 — Fleet & Vehicles

### 2.1 Responsibility
Vehicle lifecycle management across 13 statuses, VIN decode via NHTSA, SIPP classification, VehicleBlock exclusion constraint enforcement, real-time availability calculation, and the 5-step vehicle entry wizard.

### 2.2 Service Interface
```python
# apps/api/app/domains/fleet/service.py
from typing import Protocol
from uuid import UUID
from datetime import datetime
from .schemas import (
    VehicleCreateRequest, VehicleRead, VehicleStatusTransition,
    AvailabilityQuery, AvailabilityResult, VehicleBlockCreate,
    VINDecodeResult,
)

class FleetServiceProtocol(Protocol):
    async def create_vehicle(
        self, req: VehicleCreateRequest, created_by: UUID
    ) -> VehicleRead:
        """
        5-step wizard: VIN decode → classification → pricing → photos → review.
        Raises VINAlreadyRegisteredError if VIN exists for tenant.
        Initial status = STAGING.
        """
        ...

    async def transition_status(
        self, vehicle_id: UUID, transition: VehicleStatusTransition, by: UUID
    ) -> VehicleRead:
        """
        Enforce state machine via DB trigger check.
        Raises InvalidStatusTransitionError if transition not allowed.
        """
        ...

    async def decode_vin(self, vin: str) -> VINDecodeResult:
        """
        Call NHTSA vPIC API. Cache result 24h in Redis.
        Raises VINDecodeError on API failure (CircuitBreaker applies).
        """
        ...

    async def check_availability(self, query: AvailabilityQuery) -> AvailabilityResult:
        """
        Primary: Redis avail:{loc}:{class}:{bucket} cache (60s TTL).
        Fallback: DB query counting available vehicles minus active blocks.
        """
        ...

    async def create_block(self, block: VehicleBlockCreate, by: UUID) -> "VehicleBlock":
        """
        INSERT INTO vehicle_blocks.
        Exclusion constraint enforces no overlap — raises VehicleBlockConflictError on violation.
        """
        ...

    async def remove_block(self, block_id: UUID, by: UUID) -> None:
        """Soft-delete the VehicleBlock (sets deleted_at)."""
        ...

    async def get_vehicle(self, vehicle_id: UUID) -> VehicleRead: ...

    async def list_vehicles(
        self, location_id: UUID | None, status: str | None,
        sipp_class: str | None, limit: int, offset: int
    ) -> list[VehicleRead]: ...

    async def assign_vehicle_to_reservation(
        self, vehicle_id: UUID, reservation_id: UUID, by: UUID
    ) -> None:
        """
        Atomically:
        1. Verify vehicle status = AVAILABLE
        2. Create VehicleBlock(type=RENTAL, reservation_id=...) using exclusion constraint
        3. Transition vehicle to STAGING (pre-checkout hold)
        Raises VehicleNotAvailableError (HTTP 409) if conflict.
        """
        ...
```

### 2.3 Repository Interface
```python
class FleetRepositoryProtocol(Protocol):
    async def create(self, vehicle: "Vehicle") -> "Vehicle": ...
    async def get_by_id(self, vehicle_id: UUID) -> "Vehicle | None": ...
    async def get_by_vin(self, vin: str) -> "Vehicle | None": ...
    async def update_status(self, vehicle_id: UUID, new_status: str) -> None: ...
    async def list_by_location(
        self, location_id: UUID, status: str | None
    ) -> list["Vehicle"]: ...
    async def create_block(self, block: "VehicleBlock") -> "VehicleBlock": ...
    async def delete_block(self, block_id: UUID) -> None: ...
    async def get_available_count(
        self, location_id: UUID, sipp_class: str, start: datetime, end: datetime
    ) -> int: ...
    async def get_active_block(
        self, vehicle_id: UUID, at_time: datetime
    ) -> "VehicleBlock | None": ...
```

### 2.4 Pydantic v2 Schemas
```python
# apps/api/app/domains/fleet/schemas.py
from pydantic import BaseModel, Field, field_validator
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from enum import Enum

class VehicleStatus(str, Enum):
    STAGING = "STAGING"
    AVAILABLE = "AVAILABLE"
    ON_RENT = "ON_RENT"
    RETURNING = "RETURNING"
    READY_FOR_INSPECTION = "READY_FOR_INSPECTION"
    CLEANING = "CLEANING"
    MAINTENANCE = "MAINTENANCE"
    IN_REPAIR = "IN_REPAIR"
    DAMAGE_HOLD = "DAMAGE_HOLD"
    ADMIN_HOLD = "ADMIN_HOLD"
    PENDING_DISPOSAL = "PENDING_DISPOSAL"
    DISPOSED = "DISPOSED"
    PENDING_DELIVERY = "PENDING_DELIVERY"
    # 13 statuses total (see GAP-003)

class VehicleBlockType(str, Enum):
    RENTAL = "RENTAL"
    MAINTENANCE = "MAINTENANCE"
    CLEANING = "CLEANING"
    CHARGING = "CHARGING"   # EV charging block (not a vehicle status)
    ADMIN = "ADMIN"

class VehicleCreateRequest(BaseModel):
    # Step 1: VIN
    vin: str = Field(min_length=17, max_length=17)
    # Step 2: Classification
    sipp_code: str = Field(min_length=4, max_length=4, description="SIPP/ACRISS 4-char code")
    location_id: UUID
    # Step 3: Pricing baseline
    daily_rate_override: Decimal | None = Field(default=None, ge=0)
    # Step 4: Photos (S3 keys uploaded separately via presigned URL)
    photo_s3_keys: list[str] = Field(default_factory=list)
    # Step 5: Metadata
    license_plate: str = Field(max_length=20)
    license_plate_state: str | None = Field(default=None, max_length=2)
    year: int = Field(ge=1980, le=2100)
    make: str = Field(max_length=60)
    model: str = Field(max_length=60)
    trim: str | None = Field(default=None, max_length=60)
    color: str = Field(max_length=40)
    odometer_km: int = Field(ge=0)
    fuel_type: str = Field(default="GASOLINE")
    transmission: str = Field(default="AUTOMATIC")
    notes: str | None = Field(default=None, max_length=2000)

class VINDecodeResult(BaseModel):
    vin: str
    make: str
    model: str
    year: int
    trim: str | None
    body_style: str | None
    engine: str | None
    fuel_type: str | None
    transmission: str | None
    recalls: list["RecallSummary"] = Field(default_factory=list)
    nhtsa_raw: dict = Field(default_factory=dict)

class RecallSummary(BaseModel):
    campaign_number: str
    component: str
    summary: str
    remedy: str | None

class VehicleStatusTransition(BaseModel):
    vehicle_id: UUID
    from_status: VehicleStatus
    to_status: VehicleStatus
    reason: str | None = None

class AvailabilityQuery(BaseModel):
    location_id: UUID
    sipp_class: str = Field(min_length=1, max_length=4)
    pickup_at: datetime
    return_at: datetime

    @field_validator('return_at')
    @classmethod
    def return_after_pickup(cls, v: datetime, info) -> datetime:
        if 'pickup_at' in info.data and v <= info.data['pickup_at']:
            raise ValueError("return_at must be after pickup_at")
        return v

class AvailabilityResult(BaseModel):
    location_id: UUID
    sipp_class: str
    pickup_at: datetime
    return_at: datetime
    available_count: int
    is_available: bool
    cache_hit: bool

class VehicleBlockCreate(BaseModel):
    vehicle_id: UUID
    block_type: VehicleBlockType
    start_time: datetime
    end_time: datetime
    reservation_id: UUID | None = None
    notes: str | None = None

class VehicleRead(BaseModel):
    model_config = {"from_attributes": True}
    vehicle_id: UUID
    tenant_id: UUID
    vin: str
    sipp_code: str
    location_id: UUID
    status: VehicleStatus
    year: int
    make: str
    model: str
    trim: str | None
    color: str
    license_plate: str
    odometer_km: int
    fuel_type: str
    created_at: datetime
    updated_at: datetime
```

### 2.5 State Machine (13 States)

```
                    PENDING_DELIVERY
                          │
                          ▼
             ┌──────── STAGING ◄──────────────────────────────┐
             │            │                                    │
             │            ▼                                    │
             │       AVAILABLE ──────────────┐                │
             │            │                  │ (admin hold)   │
             │            │ (reserved)       ▼                │
             │            ▼           ADMIN_HOLD ─────────────┤
             │        ON_RENT                                  │
             │            │                                    │
             │            ▼                                    │
             │       RETURNING                                 │
             │            │                                    │
             │            ▼                                    │
             │  READY_FOR_INSPECTION                           │
             │       │         │                               │
             │       │ (damage)│ (clean)                      │
             │       ▼         ▼                               │
             │  DAMAGE_HOLD  CLEANING ────────────────────────┘
             │       │                                         │
             │       └──────────────────────────────┐         │
             │                                      ▼         │
             │                                MAINTENANCE      │
             │                                      │         │
             │                                      ▼         │
             │                                 IN_REPAIR ─────┘
             │
             └──► PENDING_DISPOSAL ──► DISPOSED
```

**Allowed Transitions (enforced by DB trigger `check_vehicle_status_transition`):**

| From | To | Trigger |
|------|----|---------|
| PENDING_DELIVERY | STAGING | Vehicle physically arrives |
| STAGING | AVAILABLE | Inspection passed, block cleared |
| AVAILABLE | ON_RENT | Checkout completes |
| AVAILABLE | ADMIN_HOLD | Manual admin action |
| AVAILABLE | MAINTENANCE | Preventive maintenance scheduled |
| ON_RENT | RETURNING | Return initiated |
| RETURNING | READY_FOR_INSPECTION | Vehicle parked at lot |
| READY_FOR_INSPECTION | CLEANING | No damage found |
| READY_FOR_INSPECTION | DAMAGE_HOLD | Damage found on inspection |
| DAMAGE_HOLD | MAINTENANCE | Repair authorized |
| CLEANING | AVAILABLE | Cleaning complete |
| MAINTENANCE | IN_REPAIR | Repair started |
| MAINTENANCE | AVAILABLE | Cleared without repair |
| IN_REPAIR | MAINTENANCE | Back to shop review |
| IN_REPAIR | AVAILABLE | Repair complete |
| ADMIN_HOLD | AVAILABLE | Hold released |
| ADMIN_HOLD | MAINTENANCE | Admin routed to service |
| AVAILABLE | PENDING_DISPOSAL | Decommission initiated |
| PENDING_DISPOSAL | DISPOSED | Final disposal |

### 2.6 Availability Calculation Algorithm
```
1. Read Redis key: avail:{location_id}:{sipp_class}:{date_bucket}
   - date_bucket = ISO week string e.g. "2026-W24"
   - On HIT: return cached count (60s TTL)
   
2. On MISS, execute:
   SELECT COUNT(v.vehicle_id)
   FROM vehicles v
   WHERE v.tenant_id = :tenant_id
     AND v.location_id = :location_id
     AND v.sipp_code LIKE :sipp_prefix  -- first char = category
     AND v.status = 'AVAILABLE'
     AND v.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM vehicle_blocks vb
       WHERE vb.vehicle_id = v.vehicle_id
         AND vb.deleted_at IS NULL
         AND tstzrange(vb.start_time, vb.end_time, '[)') &&
             tstzrange(:pickup, :return, '[)')
     )

3. Write result to Redis with 60s TTL (SET NX or unconditional SET)
4. Return count; is_available = count > 0
```

**Cache invalidation:** `AVAILABLE` count cache is busted (DEL key) whenever:
- A vehicle block is created/deleted for that location+class
- A vehicle status changes to/from AVAILABLE in that location+class
Cache busting is performed in the service layer after the DB write commits.

### 2.7 VehicleBlock Exclusion Constraint
```sql
CONSTRAINT no_overlapping_vehicle_blocks EXCLUDE USING gist (
  vehicle_id  WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (deleted_at IS NULL)
```
Half-open interval `[)` allows back-to-back rentals: a return at 14:00 does not conflict with a pickup at 14:00.

**Application handling:** `asyncpg.ExclusionViolationError` (PostgreSQL error code 23P01) is caught at the repository layer and re-raised as `VehicleBlockConflictError → HTTP 409`.

### 2.8 Business Rules (Testable Assertions)
```python
def test_initial_status_is_staging():
    """Newly created vehicle always starts with status=STAGING."""

def test_vin_unique_per_tenant():
    """Second vehicle with same VIN under same tenant_id raises VINAlreadyRegisteredError."""

def test_same_vin_different_tenants_allowed():
    """VIN uniqueness is scoped to tenant, not system-wide."""

def test_back_to_back_blocks_allowed():
    """Block ending 14:00 and block starting 14:00 do not conflict (half-open [))."""

def test_overlapping_blocks_raise_conflict():
    """Block [13:00,15:00) and [14:00,16:00) on same vehicle raises VehicleBlockConflictError."""

def test_charging_is_block_type_not_status():
    """VehicleStatus enum has 13 values; CHARGING is not among them."""

def test_disposed_vehicle_cannot_transition():
    """Attempting any transition from DISPOSED raises InvalidStatusTransitionError."""

def test_availability_cache_busted_on_status_change():
    """Transitioning a vehicle to AVAILABLE deletes the Redis avail: cache key."""
```

### 2.9 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `VINAlreadyRegisteredError` | 409 | `VIN_ALREADY_REGISTERED` |
| `VehicleNotFoundError` | 404 | `VEHICLE_NOT_FOUND` |
| `InvalidStatusTransitionError` | 422 | `INVALID_STATUS_TRANSITION` |
| `VehicleBlockConflictError` | 409 | `VEHICLE_BLOCK_CONFLICT` |
| `VehicleNotAvailableError` | 409 | `VEHICLE_NOT_AVAILABLE` |
| `VINDecodeError` | 502 | `VIN_DECODE_FAILED` |

### 2.10 ORM Query Patterns
```python
# Fetch vehicle with active block (single join, no N+1)
stmt = (
    select(Vehicle)
    .options(selectinload(Vehicle.active_blocks))
    .where(Vehicle.vehicle_id == vehicle_id)
    .where(Vehicle.tenant_id == tenant_id)
    .where(Vehicle.deleted_at.is_(None))
)

# Availability count with exclusion
stmt = (
    select(func.count(Vehicle.vehicle_id))
    .where(Vehicle.tenant_id == tenant_id)
    .where(Vehicle.location_id == location_id)
    .where(Vehicle.status == VehicleStatus.AVAILABLE)
    .where(Vehicle.deleted_at.is_(None))
    .where(
        ~exists(
            select(VehicleBlock.block_id)
            .where(VehicleBlock.vehicle_id == Vehicle.vehicle_id)
            .where(VehicleBlock.deleted_at.is_(None))
            .where(func.tstzrange(
                VehicleBlock.start_time, VehicleBlock.end_time, '[)'
            ).op('&&')(func.tstzrange(pickup_at, return_at, '[)')))
        )
    )
)
```

### 2.11 Celery Tasks
```python
# apps/api/app/domains/fleet/tasks.py

@app.task(queue='batch', name='fleet.poll_nhtsa_recalls')
async def poll_nhtsa_recalls() -> None:
    """
    Nightly (02:00 UTC via pg_cron or Celery beat).
    Fetches recall data for all VINs from NHTSA Recalls API.
    Updates vehicles.has_open_recall flag.
    Emits VEHICLE_RECALL_FOUND notification event if new recall detected.
    """

@app.task(queue='batch', name='fleet.refresh_availability_cache')
async def refresh_availability_cache() -> None:
    """
    Every 5 minutes.
    Rebuilds Redis avail: cache for all active locations.
    """
```

### 2.12 Integration Points
- **NHTSA vPIC API:** `NHTSAClient.decode_vin(vin)` — `GET https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/{vin}?format=json`
- **NHTSA Recalls API:** `NHTSAClient.get_recalls(make, model, year)` — nightly Celery task
- **S3:** Presigned PUT URLs for vehicle photos (`s3://rental-photos/{tenant_id}/vehicles/{vin}/{uuid}.jpg`)
- **WebSocket:** `FleetWSManager.broadcast_status_change(vehicle_id, new_status)` → counter app real-time update

---

## Domain 3 — Reservations

### 3.1 Responsibility
Booking creation, modification, cancellation, no-show detection, confirmation number generation, and the full reservation state machine (11 states).

### 3.2 Service Interface
```python
# apps/api/app/domains/reservations/service.py
from typing import Protocol
from uuid import UUID
from datetime import datetime
from .schemas import (
    ReservationCreateRequest, ReservationRead,
    ReservationModifyRequest, CancellationRequest,
    CancellationResult,
)

class ReservationServiceProtocol(Protocol):
    async def create_reservation(
        self, req: ReservationCreateRequest, created_by: UUID
    ) -> ReservationRead:
        """
        1. Validate availability (Redis cache check)
        2. Acquire advisory lock: SELECT pg_advisory_xact_lock(vehicle_class_hash)
        3. Re-check availability in DB (double-check under lock)
        4. Create VehicleBlock (exclusion constraint is final guard)
        5. Generate confirmation number (RC- + base36 8 chars, system-wide unique)
        6. Create reservation record (status=PENDING)
        7. Dispatch RESERVATION_CREATED notification event
        Raises ReservationConflictError (409) if vehicle unavailable.
        """
        ...

    async def confirm_reservation(
        self, reservation_id: UUID, confirmed_by: UUID
    ) -> ReservationRead:
        """Transition PENDING → CONFIRMED. Triggers pre-auth hold."""
        ...

    async def modify_reservation(
        self, reservation_id: UUID, req: ReservationModifyRequest, by: UUID
    ) -> ReservationRead:
        """
        Allows changes to: pickup/return dates, vehicle class, extras.
        Recalculates rate quote. Re-checks availability.
        If dates change: delete old VehicleBlock, create new one (exclusion constraint guard).
        Dispatches RESERVATION_MODIFIED notification.
        """
        ...

    async def cancel_reservation(
        self, reservation_id: UUID, req: CancellationRequest, by: UUID
    ) -> CancellationResult:
        """
        Apply cancellation policy engine.
        Soft-delete VehicleBlock.
        Calculate refund amount per policy tier.
        Dispatch RESERVATION_CANCELLED notification.
        Trigger refund if deposit was collected.
        """
        ...

    async def mark_no_show(self, reservation_id: UUID) -> None:
        """
        Transition CONFIRMED → NO_SHOW.
        Called by Celery task 30 min after scheduled pickup with no checkout.
        Releases VehicleBlock (soft-delete).
        Dispatches NO_SHOW notification.
        Applies no-show fee per policy.
        """
        ...

    async def get_reservation(self, reservation_id: UUID) -> ReservationRead: ...
    async def get_by_confirmation_number(self, confirmation_number: str) -> ReservationRead: ...
    async def list_reservations(
        self, location_id: UUID | None, status: str | None,
        customer_id: UUID | None, date_from: datetime | None,
        date_to: datetime | None, limit: int, offset: int
    ) -> list[ReservationRead]: ...
```

### 3.3 Repository Interface
```python
class ReservationRepositoryProtocol(Protocol):
    async def create(self, res: "Reservation") -> "Reservation": ...
    async def get_by_id(self, reservation_id: UUID) -> "Reservation | None": ...
    async def get_by_confirmation_number(self, cn: str) -> "Reservation | None": ...
    async def update_status(self, reservation_id: UUID, status: str, **kwargs) -> None: ...
    async def list_overdue_pending(self, cutoff: datetime) -> list["Reservation"]: ...
    async def list_upcoming(
        self, location_id: UUID, within_hours: int
    ) -> list["Reservation"]: ...
    async def acquire_advisory_lock(self, lock_key: int) -> None:
        """SELECT pg_advisory_xact_lock(:key) — held for transaction duration."""
        ...
```

### 3.4 Pydantic v2 Schemas
```python
# apps/api/app/domains/reservations/schemas.py
from pydantic import BaseModel, Field, model_validator, computed_field
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from enum import Enum

class ReservationStatus(str, Enum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    CHECKED_OUT = "CHECKED_OUT"   # Canonical: see GAP-004
    RETURNING = "RETURNING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"
    MODIFIED = "MODIFIED"
    EXTENDED = "EXTENDED"
    ON_HOLD = "ON_HOLD"
    DISPUTED = "DISPUTED"
    # 11 states total

class ReservationCreateRequest(BaseModel):
    customer_id: UUID
    location_id: UUID
    vehicle_class: str = Field(min_length=1, max_length=4, description="SIPP first char or full 4-char code")
    pickup_at: datetime
    return_at: datetime
    rate_quote_id: str = Field(description="Opaque rate quote token from rate engine")
    extras: list["ExtraSelection"] = Field(default_factory=list)
    promo_code: str | None = None
    cdp_code: str | None = Field(default=None, description="Corporate Discount Program code")
    source_channel: str = Field(default="DIRECT")
    driver_license_number: str | None = None
    driver_license_state: str | None = None

    @model_validator(mode='after')
    def validate_dates(self) -> "ReservationCreateRequest":
        if self.return_at <= self.pickup_at:
            raise ValueError("return_at must be strictly after pickup_at")
        max_days = 365
        duration = (self.return_at - self.pickup_at).days
        if duration > max_days:
            raise ValueError(f"Rental duration cannot exceed {max_days} days")
        return self

class ExtraSelection(BaseModel):
    extra_id: UUID
    quantity: int = Field(default=1, ge=1)

class ReservationModifyRequest(BaseModel):
    pickup_at: datetime | None = None
    return_at: datetime | None = None
    vehicle_class: str | None = None
    extras: list[ExtraSelection] | None = None
    reason: str | None = None

class CancellationRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=500)
    waive_fee: bool = Field(default=False, description="Agent override to waive cancellation fee")

class CancellationResult(BaseModel):
    reservation_id: UUID
    refund_amount: Decimal
    cancellation_fee: Decimal
    policy_tier: str
    refund_payment_id: UUID | None

class ReservationRead(BaseModel):
    model_config = {"from_attributes": True}
    reservation_id: UUID
    tenant_id: UUID
    confirmation_number: str
    customer_id: UUID
    location_id: UUID
    vehicle_class: str
    assigned_vehicle_id: UUID | None
    status: ReservationStatus
    pickup_at: datetime
    return_at: datetime
    actual_pickup_at: datetime | None
    actual_return_at: datetime | None
    quoted_total: Decimal
    extras: list[ExtraSelection]
    source_channel: str
    created_at: datetime
    updated_at: datetime
```

### 3.5 Reservation Status Machine (11 States)
```
PENDING ──────────────────────────────────────────► CANCELLED
   │                                                     ▲
   │ (payment pre-auth succeeds)                         │
   ▼                                                     │
CONFIRMED ────────────────────────────────────────► CANCELLED
   │         │ (30min past pickup, no checkout)          │
   │         ▼                                           │
   │      NO_SHOW                                        │
   │                                                     │
   │ (counter checkout)                                  │
   ▼                                                     │
CHECKED_OUT ──────────────────────────────────────► DISPUTED
   │         │ (extension granted)                       │
   │         ▼                                           │
   │      EXTENDED ──────────────────────────────► DISPUTED
   │
   │ (return initiated)
   ▼
RETURNING
   │
   ▼
COMPLETED ◄────── ON_HOLD (pending damage adjudication)
```

### 3.6 Confirmation Number Generation
```python
import secrets, string, time

ALPHABET = string.digits + string.ascii_uppercase  # base-36

def generate_confirmation_number() -> str:
    """
    RC- prefix + 8 chars from base-36 alphabet.
    DB UNIQUE constraint is final collision guard.
    Retry up to 3 times on collision (astronomically unlikely).
    """
    suffix = ''.join(secrets.choice(ALPHABET) for _ in range(8))
    return f"RC-{suffix}"
```

### 3.7 Cancellation Policy Engine
```python
class CancellationPolicyEngine:
    """
    Determines refund amount and fee based on hours until pickup.
    Policy tiers (configurable per tenant, defaults shown):
    """
    DEFAULT_TIERS = [
        # (min_hours_before_pickup, refund_pct, fee_label)
        (72, 1.00, "FREE_CANCELLATION"),
        (24, 0.50, "PARTIAL_REFUND"),
        (0,  0.00, "NO_REFUND"),
    ]

    def calculate(
        self, deposit_paid: Decimal, pickup_at: datetime,
        cancelled_at: datetime, waive_fee: bool = False
    ) -> tuple[Decimal, Decimal, str]:
        """Returns (refund_amount, cancellation_fee, policy_tier_label)."""
        hours_before = (pickup_at - cancelled_at).total_seconds() / 3600
        for min_hours, refund_pct, label in self.DEFAULT_TIERS:
            if hours_before >= min_hours:
                if waive_fee:
                    return deposit_paid, Decimal("0"), f"AGENT_WAIVED_{label}"
                refund = (deposit_paid * Decimal(str(refund_pct))).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
                fee = deposit_paid - refund
                return refund, fee, label
        return Decimal("0"), deposit_paid, "NO_REFUND"
```

### 3.8 Business Rules (Testable Assertions)
```python
def test_no_double_booking_same_vehicle():
    """Two reservations for the same vehicle in overlapping periods raises ReservationConflictError."""

def test_confirmation_number_system_wide_unique():
    """Confirmation number is unique across all tenants (no tenant_id scoping)."""

def test_confirmation_number_format():
    """Confirmation number matches regex r'^RC-[0-9A-Z]{8}$'."""

def test_no_show_triggered_30min_after_pickup():
    """Celery task marks reservation NO_SHOW if not checked out 30 minutes after pickup_at."""

def test_cancellation_free_before_72h():
    """Cancel 73 hours before pickup returns 100% refund, zero fee."""

def test_cancellation_partial_24_to_72h():
    """Cancel 48 hours before pickup returns 50% refund."""

def test_cancellation_no_refund_within_24h():
    """Cancel 6 hours before pickup returns 0% refund."""

def test_agent_fee_waive_overrides_policy():
    """waive_fee=True always returns 100% refund regardless of timing."""

def test_advisory_lock_acquired_before_availability_check():
    """DB advisory lock is held before re-checking availability to prevent race conditions."""

def test_reservation_dates_validated():
    """return_at <= pickup_at raises ValidationError with clear message."""
```

### 3.9 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `ReservationConflictError` | 409 | `RESERVATION_CONFLICT` |
| `ReservationNotFoundError` | 404 | `RESERVATION_NOT_FOUND` |
| `InvalidReservationTransitionError` | 422 | `INVALID_RESERVATION_TRANSITION` |
| `RateQuoteExpiredError` | 422 | `RATE_QUOTE_EXPIRED` |
| `CustomerDNRError` | 403 | `CUSTOMER_DO_NOT_RENT` |
| `VehicleClassUnavailableError` | 409 | `VEHICLE_CLASS_UNAVAILABLE` |

### 3.10 Celery Tasks
```python
@app.task(queue='batch', name='reservations.check_no_shows')
async def check_no_shows() -> None:
    """
    Runs every 15 minutes.
    Finds CONFIRMED reservations where pickup_at < NOW() - 30min.
    Calls ReservationService.mark_no_show() for each.
    """

@app.task(queue='notifications', name='reservations.send_pickup_reminder')
async def send_pickup_reminder(reservation_id: str) -> None:
    """
    Scheduled at reservation creation for T-24h and T-2h before pickup.
    Dispatches RESERVATION_REMINDER notification event.
    """
```

---

## Domain 4 — Rate Engine

### 4.1 Responsibility
Rate quote generation, SHA-256 cache management, ISO 4217 rounding, CDW/extras pricing, CDP code lookup, promo code validation with concurrency control.

### 4.2 Service Interface
```python
# apps/api/app/domains/rates/service.py
from typing import Protocol
from uuid import UUID
from datetime import datetime
from .schemas import RateQuoteRequest, RateQuoteResponse, PromoCodeValidation

class RateEngineServiceProtocol(Protocol):
    async def get_rate_quote(
        self, req: RateQuoteRequest
    ) -> RateQuoteResponse:
        """
        1. Build cache key: SHA-256(tenant_id|location|class|pickup|return|extras|promo|cdp)
        2. Check Redis rate_quote:{hash} (30s TTL)
        3. On miss: execute rate calculation algorithm (§4.4)
        4. Avalara tax calculation (1h cached per address+items SHA-256)
        5. Store result in Redis with 30s TTL
        6. Return opaque quote_token (== cache key hash)
        Raises NoActiveRateCodeError if no rate applies.
        """
        ...

    async def validate_promo_code(
        self, code: str, tenant_id: UUID, usage_context: dict
    ) -> PromoCodeValidation:
        """
        SELECT ... FOR UPDATE on promo_codes row to prevent concurrent over-use.
        Checks: active, not expired, uses_count < max_uses, eligible vehicle class.
        Returns discount_type, discount_value.
        """
        ...

    async def lookup_cdp_code(
        self, cdp_code: str, tenant_id: UUID
    ) -> "CDPRate | None":
        """Look up Corporate Discount Program rate override."""
        ...

    async def list_active_rate_codes(
        self, tenant_id: UUID, location_id: UUID | None
    ) -> list["RateCode"]: ...

    async def create_rate_code(
        self, rate_code: "RateCodeCreate", by: UUID
    ) -> "RateCode": ...
```

### 4.3 Pydantic v2 Schemas
```python
# apps/api/app/domains/rates/schemas.py
from pydantic import BaseModel, Field, computed_field
from uuid import UUID
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

class RateQuoteRequest(BaseModel):
    tenant_id: UUID
    location_id: UUID
    vehicle_class: str
    pickup_at: datetime
    return_at: datetime
    extras: list["ExtraQuoteItem"] = Field(default_factory=list)
    promo_code: str | None = None
    cdp_code: str | None = None
    currency_code: str = Field(default="USD", min_length=3, max_length=3)

class ExtraQuoteItem(BaseModel):
    extra_id: UUID
    quantity: int = Field(default=1, ge=1)

class RateLineItem(BaseModel):
    label: str
    quantity: Decimal
    unit_price: Decimal
    subtotal: Decimal
    tax_amount: Decimal = Decimal("0")

class RateQuoteResponse(BaseModel):
    quote_token: str = Field(description="SHA-256 hash; used as idempotency key at booking")
    tenant_id: UUID
    location_id: UUID
    vehicle_class: str
    pickup_at: datetime
    return_at: datetime
    currency_code: str
    rental_days: Decimal = Field(description="Exact day fraction, 6 decimal precision")
    base_rate_per_day: Decimal
    base_subtotal: Decimal
    extras_subtotal: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    line_items: list[RateLineItem]
    promo_applied: bool
    cdp_applied: bool
    expires_at: datetime = Field(description="Now + 30 seconds (matches Redis TTL)")
    avalara_doc_code: str | None = None
    cache_hit: bool = False

class PromoCodeValidation(BaseModel):
    code: str
    is_valid: bool
    discount_type: Literal["PERCENT", "FIXED"] | None = None
    discount_value: Decimal | None = None
    error_reason: str | None = None
```

### 4.4 Rate Quote Algorithm
```
INPUTS: tenant_id, location_id, vehicle_class, pickup_at, return_at,
        extras[], promo_code?, cdp_code?

STEP 1 — Duration
  rental_days = (return_at - pickup_at).total_seconds() / 86400
  # Keep 6 decimal places for intermediate math

STEP 2 — Base Rate Lookup (priority order)
  a. CDP code rate override → if cdp_code provided and valid
  b. Seasonal rate → if current date in rate_seasons range
  c. Standard daily rate for vehicle_class at location
  d. Standard daily rate for vehicle_class at tenant level
  Raises NoActiveRateCodeError if none found.

STEP 3 — Base Subtotal
  base_subtotal = base_rate_per_day × rental_days
  # Still 6 decimal places

STEP 4 — Extras Pricing
  For each extra in extras[]:
    if extra.billing_type == 'PER_DAY':
      extra_subtotal += extra.rate × rental_days × quantity
    elif extra.billing_type == 'FLAT':
      extra_subtotal += extra.rate × quantity
    elif extra.billing_type == 'PER_INCIDENT':
      extra_subtotal += extra.rate × quantity

STEP 5 — Promo Code Discount
  if promo_code:
    validation = await validate_promo_code(promo_code)  # SELECT FOR UPDATE
    if discount_type == 'PERCENT':
      discount = (base_subtotal + extras_subtotal) × discount_value / 100
    elif discount_type == 'FIXED':
      discount = min(discount_value, base_subtotal + extras_subtotal)

STEP 6 — Pre-tax Subtotal
  pretax = base_subtotal + extras_subtotal - discount

STEP 7 — Tax (Avalara AvaTax)
  cache_key = SHA-256(location_id | sorted(line_items) | billing_address)
  tax_amount = avalara_cache[cache_key] or await AvaTax.calculate(pretax, ...)
  # 1h TTL on Avalara cache

STEP 8 — Total (ISO 4217 ROUND_HALF_UP to currency minor unit)
  total = (pretax + tax_amount).quantize(Decimal("0.01"), ROUND_HALF_UP)

STEP 9 — Cache & Return
  cache_key = SHA-256(all inputs concatenated deterministically)
  redis.set(f"rate_quote:{cache_key}", quote_json, ex=30)
  return RateQuoteResponse(quote_token=cache_key, ...)
```

### 4.5 Promo Code Concurrency Control
```python
async def validate_promo_code(self, code: str, ...) -> PromoCodeValidation:
    # Within the SAME transaction as reservation creation:
    stmt = (
        select(PromoCode)
        .where(PromoCode.code == code)
        .where(PromoCode.tenant_id == self._tenant_id)
        .with_for_update()  # SELECT FOR UPDATE — serializes concurrent uses
    )
    promo = await self._session.scalar(stmt)
    if promo is None:
        return PromoCodeValidation(code=code, is_valid=False, error_reason="NOT_FOUND")
    if promo.uses_count >= promo.max_uses:
        return PromoCodeValidation(code=code, is_valid=False, error_reason="MAX_USES_REACHED")
    if promo.expires_at and promo.expires_at < datetime.utcnow():
        return PromoCodeValidation(code=code, is_valid=False, error_reason="EXPIRED")
    # Increment uses_count atomically in same transaction
    await self._session.execute(
        update(PromoCode)
        .where(PromoCode.promo_id == promo.promo_id)
        .values(uses_count=PromoCode.uses_count + 1)
    )
    return PromoCodeValidation(code=code, is_valid=True, ...)
```

### 4.6 Business Rules (Testable Assertions)
```python
def test_rate_quote_cached_30_seconds():
    """Identical request within 30s returns same quote_token from Redis without DB hit."""

def test_promo_code_max_uses_enforced_concurrently():
    """100 concurrent requests with 10-use promo code: exactly 10 succeed."""

def test_iso_4217_rounding():
    """Total of 12.345 USD rounds to 12.35 (ROUND_HALF_UP)."""

def test_intermediate_6_decimal_precision():
    """rental_days=1.500000, rate=29.99 → base_subtotal=44.985000 before rounding."""

def test_cdp_code_takes_priority_over_standard_rate():
    """If CDP code provides rate, it overrides seasonal and standard rates."""

def test_no_active_rate_raises_error():
    """No matching rate code for vehicle class raises NoActiveRateCodeError (HTTP 404)."""

def test_expired_quote_token_rejected():
    """Using quote_token older than 30s at reservation creation raises RateQuoteExpiredError."""

def test_avalara_cache_1h():
    """Same location+items combination reuses Avalara result for up to 1 hour."""
```

### 4.7 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `NoActiveRateCodeError` | 404 | `NO_ACTIVE_RATE_CODE` |
| `RateQuoteExpiredError` | 422 | `RATE_QUOTE_EXPIRED` |
| `PromoCodeNotFoundError` | 404 | `PROMO_CODE_NOT_FOUND` |
| `PromoCodeExhaustedError` | 409 | `PROMO_CODE_EXHAUSTED` |
| `PromoCodeExpiredError` | 422 | `PROMO_CODE_EXPIRED` |
| `TaxCalculationError` | 502 | `TAX_CALCULATION_FAILED` |

### 4.8 Integration Points
- **Avalara AvaTax:** `AvalaraClient.calculate_tax(lines, ship_to_address)` — SHA-256 cached 1h
- **Redis:** Rate quote cache `rate_quote:{hash}` TTL 30s

---

## Domain 5 — Extras & Protection Products

### 5.1 Responsibility
CDW/LDW mandatory disclosure workflow, optional protection products, physical extras inventory, combinability rules, and per-rental extras tracking.

### 5.2 Service Interface
```python
# apps/api/app/domains/extras/service.py
from typing import Protocol
from uuid import UUID
from .schemas import (
    ExtraRead, CDWDisclosureRequest, CDWDisclosureResult,
    ExtraInventoryCheck, RentalExtrasRecord,
)

class ExtrasServiceProtocol(Protocol):
    async def list_available_extras(
        self, tenant_id: UUID, location_id: UUID, vehicle_class: str
    ) -> list[ExtraRead]:
        """Returns extras eligible for this vehicle class and location."""
        ...

    async def check_combinability(
        self, extra_ids: list[UUID], tenant_id: UUID
    ) -> list["CombinabilityConflict"]:
        """
        Check combinability rules matrix.
        e.g., CDW + LDW may be mutually exclusive.
        Returns list of conflicts (empty = all compatible).
        """
        ...

    async def present_cdw_disclosure(
        self, req: CDWDisclosureRequest
    ) -> CDWDisclosureResult:
        """
        Initiate CDW/LDW mandatory disclosure workflow.
        Returns disclosure_id and full disclosure text to render.
        Customer must scroll to bottom before accept/decline is enabled.
        """
        ...

    async def record_cdw_decision(
        self,
        disclosure_id: UUID,
        decision: str,  # ACCEPTED | DECLINED
        rental_agreement_id: UUID,
        channel: str,
        customer_signature_hash: str | None,
    ) -> "CDWDeclinationRecord | None":
        """
        Record accept/decline with timestamp, channel, RA ID.
        DECLINED: create CDWDeclinationRecord (required by state law in many jurisdictions).
        Raises CDWDisclosureNotScrolledError if scroll_confirmed=False.
        """
        ...

    async def check_physical_inventory(
        self, check: ExtraInventoryCheck
    ) -> bool:
        """
        For physical extras (GPS units, car seats, etc.):
        Checks available inventory count at location for requested period.
        """
        ...

    async def allocate_extras(
        self, rental_agreement_id: UUID, extras: list["ExtraAllocation"]
    ) -> RentalExtrasRecord: ...

    async def deallocate_extras(self, rental_agreement_id: UUID) -> None:
        """Return physical extras to inventory pool on return."""
        ...
```

### 5.3 Pydantic v2 Schemas
```python
# apps/api/app/domains/extras/schemas.py
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal

class ExtraType(str, Enum):
    CDW = "CDW"           # Collision Damage Waiver
    LDW = "LDW"           # Loss Damage Waiver
    SLI = "SLI"           # Supplemental Liability Insurance
    PAI = "PAI"           # Personal Accident Insurance
    RSA = "RSA"           # Roadside Assistance
    GPS = "GPS"           # Navigation Device
    CSS = "CSS"           # Child Safety Seat
    TOLL = "TOLL"         # Toll Pass
    PPFP = "PPFP"         # Prepaid Fuel Plan
    # 9 system extras seeded in DB; tenants may add custom extras

class BillingType(str, Enum):
    PER_DAY = "PER_DAY"
    FLAT = "FLAT"
    PER_INCIDENT = "PER_INCIDENT"

class ExtraRead(BaseModel):
    model_config = {"from_attributes": True}
    extra_id: UUID
    extra_type: ExtraType
    name: str
    description: str
    rate: Decimal
    billing_type: BillingType
    is_protection_product: bool
    requires_disclosure: bool
    is_physical_inventory: bool
    available_quantity: int | None  # None = unlimited (non-physical)

class CDWDisclosureRequest(BaseModel):
    tenant_id: UUID
    customer_id: UUID
    rental_agreement_id: UUID | None = None  # May be pre-created
    channel: Literal["COUNTER", "WEB", "MOBILE"]
    jurisdiction: str = Field(description="US state or country code for jurisdiction-specific text")

class CDWDisclosureResult(BaseModel):
    disclosure_id: UUID
    disclosure_text: str = Field(description="Full regulatory disclosure text (Jinja2 rendered)")
    requires_scroll_to_bottom: bool = True
    scroll_confirmation_token: str = Field(description="Signed token proving scroll completion")
    expires_at: datetime

class CDWDeclinationRecord(BaseModel):
    declination_id: UUID
    rental_agreement_id: UUID
    customer_id: UUID
    declined_at: datetime
    channel: str
    jurisdiction: str
    agent_id: UUID | None  # Set if declined at counter

class CombinabilityConflict(BaseModel):
    extra_id_a: UUID
    extra_id_b: UUID
    reason: str

class ExtraInventoryCheck(BaseModel):
    extra_id: UUID
    location_id: UUID
    start_time: datetime
    end_time: datetime
    quantity_requested: int = 1

class ExtraAllocation(BaseModel):
    extra_id: UUID
    quantity: int
    rate_snapshot: Decimal
    billing_type: BillingType

class RentalExtrasRecord(BaseModel):
    rental_agreement_id: UUID
    allocations: list[ExtraAllocation]
    protection_products: list[ExtraType]
    cdw_status: Literal["ACCEPTED", "DECLINED", "NOT_OFFERED", "PENDING"]
```

### 5.4 CDW Mandatory Disclosure Workflow
```
Counter Agent / Web Booking
        │
        ▼
  GET /extras/cdw-disclosure (CDWDisclosureRequest)
        │
        ▼
  ExtrasService.present_cdw_disclosure()
  - Render jurisdiction-specific text via Jinja2
  - Generate signed scroll_confirmation_token
  - Store in DB: cdw_disclosures(disclosure_id, tenant_id, customer_id, RA_id, text_hash, channel)
        │
        ▼
  Frontend renders full disclosure
  - Scroll-to-bottom event fires
  - UI enables ACCEPT / DECLINE buttons
  - Frontend sends scroll_confirmation_token back
        │
        ▼
  POST /extras/cdw-decision (decision, scroll_confirmation_token)
        │
        ▼
  ExtrasService.record_cdw_decision()
  - Verify scroll_confirmation_token signature
  - If DECLINED: INSERT cdw_declinations record
  - Log: disclosure_id, decision, timestamp, channel, customer_id, RA_id
  - Raises CDWDisclosureNotScrolledError if token invalid/missing
```

**Regulatory requirement:** CDW/LDW declination records must be retained for 7 years (varies by jurisdiction). `cdw_declinations` table must NOT have soft-delete purge scheduled within that window.

### 5.5 Business Rules (Testable Assertions)
```python
def test_cdw_disclosure_required_before_decision():
    """Submitting CDW decision without valid scroll_confirmation_token raises error."""

def test_cdw_declination_record_created_on_decline():
    """DECLINED decision creates exactly one CDWDeclinationRecord row."""

def test_cdw_acceptance_no_declination_record():
    """ACCEPTED decision does not create a CDWDeclinationRecord row."""

def test_cdw_ldw_mutually_exclusive():
    """Selecting both CDW and LDW raises CombinabilityConflictError."""

def test_physical_extra_inventory_blocked_when_unavailable():
    """Allocating GPS unit when none available at location raises ExtraUnavailableError."""

def test_cdw_status_in_rental_record():
    """Every RentalExtrasRecord has cdw_status set (never null)."""
```

### 5.6 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `CDWDisclosureNotScrolledError` | 422 | `CDW_SCROLL_REQUIRED` |
| `CombinabilityConflictError` | 422 | `EXTRAS_INCOMPATIBLE` |
| `ExtraUnavailableError` | 409 | `EXTRA_UNAVAILABLE` |
| `ExtraNotFoundError` | 404 | `EXTRA_NOT_FOUND` |

---

## Domain 6 — Payments

### 6.1 Responsibility
Stripe PaymentIntent lifecycle (pre-auth with `capture_method=manual`), capture formula, pre-auth renewal via Network Transaction ID chain, refund routing, ProcessedWebhook idempotency, and 3 Celery tasks.

### 6.2 Service Interface
```python
# apps/api/app/domains/payments/service.py
from typing import Protocol
from uuid import UUID
from decimal import Decimal
from .schemas import (
    PreAuthRequest, PreAuthResult, CaptureRequest, CaptureResult,
    RefundRequest, RefundResult, WebhookProcessRequest,
)

class PaymentServiceProtocol(Protocol):
    async def create_pre_auth(
        self, req: PreAuthRequest
    ) -> PreAuthResult:
        """
        Create Stripe PaymentIntent(capture_method='manual', confirm=False).
        Store in payments table: intent_id, status=AUTHORIZED, amount, currency.
        Dispatch PAYMENT_AUTHORIZED notification.
        """
        ...

    async def capture_payment(
        self, req: CaptureRequest
    ) -> CaptureResult:
        """
        Calculate final capture amount (see §6.5 formula).
        Stripe PaymentIntent.capture(amount_to_capture=calculated_amount).
        Update payments.status=CAPTURED, captured_at, capture_amount.
        Dispatch PAYMENT_CAPTURED notification.
        Raises CaptureAmountExceedsAuthError if amount > authorized.
        """
        ...

    async def renew_pre_auth(
        self, payment_id: UUID
    ) -> PreAuthResult:
        """
        Called by Celery task every 6h for active pre-auths.
        Uses Network Transaction ID (NTI) for incremental authorization.
        Updates payments.network_txn_id, renewed_at.
        """
        ...

    async def create_refund(
        self, req: RefundRequest
    ) -> RefundResult:
        """
        Stripe Refund.create(payment_intent=intent_id, amount=refund_amount).
        Creates refund record in payments table.
        Dispatch PAYMENT_REFUNDED notification.
        """
        ...

    async def process_webhook(
        self, req: WebhookProcessRequest
    ) -> None:
        """
        1. Verify Stripe-Signature header (HMAC).
        2. INSERT INTO processed_webhooks(event_id) — raises on duplicate (idempotency).
        3. Route to domain handler based on event type.
        4. All in one DB transaction.
        """
        ...

    async def get_payment(self, payment_id: UUID) -> "PaymentRead": ...
    async def list_payments_for_rental(
        self, rental_agreement_id: UUID
    ) -> list["PaymentRead"]: ...
```

### 6.3 Repository Interface
```python
class PaymentRepositoryProtocol(Protocol):
    async def create(self, payment: "Payment") -> "Payment": ...
    async def get_by_id(self, payment_id: UUID) -> "Payment | None": ...
    async def get_by_intent_id(self, intent_id: str) -> "Payment | None": ...
    async def update(self, payment_id: UUID, **kwargs) -> None: ...
    async def list_by_rental(self, rental_agreement_id: UUID) -> list["Payment"]: ...
    async def is_webhook_processed(self, event_id: str) -> bool: ...
    async def mark_webhook_processed(self, event_id: str) -> None: ...
    async def list_expiring_pre_auths(self, within_hours: int) -> list["Payment"]: ...
```

### 6.4 Pydantic v2 Schemas
```python
# apps/api/app/domains/payments/schemas.py
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal

class PaymentStatus(str, Enum):
    PENDING = "PENDING"
    AUTHORIZED = "AUTHORIZED"
    CAPTURED = "CAPTURED"
    PARTIALLY_CAPTURED = "PARTIALLY_CAPTURED"
    REFUNDED = "REFUNDED"
    PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

class PreAuthRequest(BaseModel):
    rental_agreement_id: UUID
    customer_id: UUID
    amount: Decimal = Field(gt=0, description="Pre-auth hold amount in currency minor units as decimal")
    currency_code: str = Field(default="USD", min_length=3, max_length=3)
    stripe_payment_method_id: str
    statement_descriptor: str | None = Field(default=None, max_length=22)
    metadata: dict = Field(default_factory=dict)

class PreAuthResult(BaseModel):
    payment_id: UUID
    stripe_intent_id: str
    status: PaymentStatus
    amount_authorized: Decimal
    currency_code: str
    requires_action: bool = False
    client_secret: str | None = None  # For 3DS challenge

class CaptureRequest(BaseModel):
    payment_id: UUID
    rental_agreement_id: UUID
    # Capture formula inputs:
    base_rental_amount: Decimal
    extras_amount: Decimal
    time_extension_amount: Decimal = Decimal("0")
    fuel_charge_amount: Decimal = Decimal("0")
    mileage_overage_amount: Decimal = Decimal("0")
    damage_charge_amount: Decimal = Decimal("0")
    deposit_already_paid: Decimal = Decimal("0")

class CaptureResult(BaseModel):
    payment_id: UUID
    captured_amount: Decimal
    stripe_charge_id: str
    captured_at: datetime

class RefundRequest(BaseModel):
    payment_id: UUID
    amount: Decimal = Field(gt=0)
    reason: str = Field(max_length=500)
    initiated_by: UUID

class RefundResult(BaseModel):
    refund_id: UUID
    stripe_refund_id: str
    amount: Decimal
    status: str
    created_at: datetime

class WebhookProcessRequest(BaseModel):
    stripe_event_id: str
    event_type: str
    payload: dict
    stripe_signature: str

class PaymentRead(BaseModel):
    model_config = {"from_attributes": True}
    payment_id: UUID
    rental_agreement_id: UUID
    stripe_intent_id: str
    status: PaymentStatus
    amount_authorized: Decimal
    capture_amount: Decimal | None
    currency_code: str
    network_txn_id: str | None
    created_at: datetime
    captured_at: datetime | None
```

### 6.5 Capture Formula
```
capture_amount = (
    base_rental_amount
  + extras_amount
  + time_extension_amount
  + fuel_charge_amount
  + mileage_overage_amount
  + damage_charge_amount
  - deposit_already_paid
)

# Apply ISO 4217 ROUND_HALF_UP
capture_amount = capture_amount.quantize(Decimal("0.01"), ROUND_HALF_UP)

# Must not exceed authorized amount (Stripe constraint)
if capture_amount > payment.amount_authorized:
    # Issue incremental authorization first
    await self.renew_pre_auth(payment_id, new_amount=capture_amount)

# Minimum capture: $0.50 USD (Stripe minimum)
capture_amount = max(capture_amount, Decimal("0.50"))
```

### 6.6 Pre-Auth Renewal (Network Transaction ID Chain)
```
MCC 7512 Extended Windows:
  Visa:  7 days standard; MCC 7512 allows longer with issuer agreement
  MC:    30 days with MCC 7512
  Amex:  30 days with MCC 7512

Renewal Flow (Celery task every 6h for pre-auths expiring within 24h):
  1. Retrieve payment from DB (status=AUTHORIZED, rental still active)
  2. Stripe PaymentIntent.increment_authorization(amount=current_amount)
     OR create new PaymentIntent using network_txn_id for chain
  3. Store new network_txn_id in payments.network_txn_id
  4. Update payments.renewed_at = now()
  5. Acquire/release Redis lock: preauth_lock:{reservation_id} (120s TTL)
     to prevent concurrent renewal attempts
```

### 6.7 Stripe Webhook Idempotency
```python
async def process_webhook(self, req: WebhookProcessRequest) -> None:
    async with self._session.begin():
        # Step 1: Idempotency guard (unique constraint on event_id)
        try:
            await self._session.execute(
                insert(ProcessedWebhook).values(
                    event_id=req.stripe_event_id,
                    processed_at=datetime.utcnow(),
                )
            )
        except UniqueViolationError:
            return  # Already processed — safe to ignore

        # Step 2: Route to handler in SAME transaction
        handler = self._webhook_handlers.get(req.event_type)
        if handler:
            await handler(req.payload)
        # Both the idempotency insert and domain handler commit atomically
```

**Handled webhook events:**
- `payment_intent.succeeded` → mark payment CAPTURED
- `payment_intent.payment_failed` → mark payment FAILED, notify customer
- `payment_intent.canceled` → mark payment CANCELLED
- `charge.refunded` → update refund record status
- `charge.dispute.created` → flag reservation DISPUTED

### 6.8 Business Rules (Testable Assertions)
```python
def test_stripe_webhook_idempotent():
    """Sending same Stripe event_id twice processes it exactly once."""

def test_capture_cannot_exceed_authorized_amount_without_incremental_auth():
    """Capture attempt above authorized amount triggers incremental auth before capture."""

def test_pre_auth_lock_prevents_concurrent_renewal():
    """Two concurrent renewal tasks for same reservation: only one proceeds."""

def test_capture_formula_subtracts_deposit():
    """capture = base + extras - deposit; negative result clamps to 0.50 minimum."""

def test_refund_routed_to_original_payment_method():
    """Refund always uses Stripe Refund against original PaymentIntent."""

def test_pci_dss_no_pan_on_platform():
    """No raw card number or CVV is ever stored in platform DB or logs."""
```

### 6.9 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `PaymentNotFoundError` | 404 | `PAYMENT_NOT_FOUND` |
| `PaymentAlreadyProcessedError` | 409 | `PAYMENT_ALREADY_PROCESSED` |
| `CaptureAmountExceedsAuthError` | 422 | `CAPTURE_EXCEEDS_AUTHORIZATION` |
| `StripeAPIError` | 502 | `STRIPE_API_ERROR` |
| `InvalidWebhookSignatureError` | 400 | `INVALID_WEBHOOK_SIGNATURE` |
| `RefundExceedsCapturedError` | 422 | `REFUND_EXCEEDS_CAPTURED` |

### 6.10 Celery Tasks
```python
@app.task(queue='batch', name='payments.renew_expiring_pre_auths')
async def renew_expiring_pre_auths() -> None:
    """
    Every 6 hours.
    Finds AUTHORIZED payments where rental is still active
    and pre-auth age > (max_auth_days - 1) days.
    Calls PaymentService.renew_pre_auth() for each.
    Uses preauth_lock:{reservation_id} Redis lock (120s) to prevent race.
    """

@app.task(queue='batch', name='payments.reconcile_stripe_payouts')
async def reconcile_stripe_payouts() -> None:
    """
    Nightly at 03:00 UTC.
    Pulls Stripe payout events, reconciles against payments table.
    Flags discrepancies for manual review.
    """

@app.task(queue='batch', name='payments.retry_failed_captures')
async def retry_failed_captures() -> None:
    """
    Every 30 minutes.
    Retries FAILED captures that are < 24h old.
    Max 3 retries with exponential backoff.
    Escalates to ops team on 3rd failure.
    """
```

### 6.11 Integration Points
- **Stripe PaymentIntents API:** All payment operations via `StripeClient`
- **Stripe Webhook endpoint:** `POST /webhooks/stripe` — must be registered with Stripe Dashboard
- **Redis:** `preauth_lock:{reservation_id}` (120s TTL) for concurrent renewal prevention

---

## Domain 7 — Counter Operations

### 7.1 Responsibility
Vehicle checkout and check-in sequences, shift open/close procedures, overdue rental escalation tiers, cash handling reconciliation, and vehicle swap workflow. The counter app is a PWA with 4-hour offline capability via Workbox service worker.

### 7.2 Service Interface
```python
# apps/api/app/domains/counter/service.py
from typing import Protocol
from uuid import UUID
from decimal import Decimal
from .schemas import (
    CheckoutRequest, CheckoutResult, CheckInRequest, CheckInResult,
    ShiftOpenRequest, ShiftCloseRequest, ShiftCloseResult,
    VehicleSwapRequest, VehicleSwapResult,
)

class CounterServiceProtocol(Protocol):
    async def checkout(
        self, req: CheckoutRequest, agent_id: UUID
    ) -> CheckoutResult:
        """
        Atomically:
        1. Verify pre-inspection form complete (22-zone)
        2. Verify CDW disclosure decision recorded
        3. Assign specific vehicle_id to reservation
        4. Transition vehicle: STAGING → ON_RENT
        5. Transition reservation: CONFIRMED → CHECKED_OUT
        6. Capture payment pre-auth (or defer to return)
        7. Generate/sign rental agreement PDF (WeasyPrint)
        8. Dispatch RENTAL_CHECKED_OUT notification
        Raises CheckoutBlockedError if any prerequisite missing.
        """
        ...

    async def check_in(
        self, req: CheckInRequest, agent_id: UUID
    ) -> CheckInResult:
        """
        1. Record actual return datetime
        2. Trigger post-rental inspection creation
        3. Transition vehicle: ON_RENT → RETURNING → READY_FOR_INSPECTION
        4. Transition reservation: CHECKED_OUT → RETURNING
        5. Calculate final charges (fuel, mileage, time extension)
        6. Capture payment (final formula)
        7. Dispatch RENTAL_RETURNED notification
        """
        ...

    async def open_shift(
        self, req: ShiftOpenRequest, agent_id: UUID
    ) -> "ShiftRecord":
        """Record shift start, opening cash count. Only one open shift per agent per location."""
        ...

    async def close_shift(
        self, req: ShiftCloseRequest, agent_id: UUID
    ) -> ShiftCloseResult:
        """Reconcile cash; calculate over/short; flag discrepancies > threshold."""
        ...

    async def swap_vehicle(
        self, req: VehicleSwapRequest, agent_id: UUID
    ) -> VehicleSwapResult:
        """
        1. Close original RA (swapped_to_ra_id set)
        2. Create new RA (swapped_from_ra_id set)
        3. Transfer remaining rental period to new vehicle
        4. Adjust billing for rate differential
        5. Dispatch VEHICLE_SWAPPED notification
        """
        ...

    async def override_rate(
        self, rental_agreement_id: UUID, new_rate: Decimal,
        reason: str, agent_id: UUID, manager_approval_id: UUID
    ) -> None:
        """Manager-approved rate override. Requires MANAGER role."""
        ...
```

### 7.3 Pydantic v2 Schemas
```python
# apps/api/app/domains/counter/schemas.py
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from decimal import Decimal

class CheckoutRequest(BaseModel):
    reservation_id: UUID
    vehicle_id: UUID
    inspection_form_id: UUID
    cdw_disclosure_id: UUID
    customer_signature_hash: str
    odometer_out: int = Field(ge=0)
    fuel_level_out: str = Field(description="FULL|3/4|1/2|1/4|EMPTY")
    payment_method_id: str
    capture_at_checkout: bool = Field(default=False)

class CheckoutResult(BaseModel):
    rental_agreement_id: UUID
    confirmation_number: str
    vehicle_id: UUID
    checkout_at: datetime
    estimated_return_at: datetime
    total_authorized: Decimal
    ra_pdf_url: str

class CheckInRequest(BaseModel):
    rental_agreement_id: UUID
    odometer_in: int = Field(ge=0)
    fuel_level_in: str
    actual_return_at: datetime
    inspection_form_id: UUID
    damage_noted: bool = False
    agent_notes: str | None = Field(default=None, max_length=2000)

class CheckInResult(BaseModel):
    rental_agreement_id: UUID
    returned_at: datetime
    rental_days_actual: Decimal
    base_charge: Decimal
    extras_charge: Decimal
    fuel_charge: Decimal
    mileage_overage_charge: Decimal
    time_extension_charge: Decimal
    damage_charge: Decimal
    total_charged: Decimal
    refund_amount: Decimal
    damage_claim_id: UUID | None

class ShiftOpenRequest(BaseModel):
    location_id: UUID
    opening_cash_amount: Decimal
    shift_notes: str | None = None

class ShiftCloseRequest(BaseModel):
    shift_id: UUID
    closing_cash_amount: Decimal
    credit_card_total: Decimal
    closing_notes: str | None = None

class ShiftCloseResult(BaseModel):
    shift_id: UUID
    cash_over_short: Decimal
    total_transactions: int
    flagged_for_review: bool

class VehicleSwapRequest(BaseModel):
    original_rental_agreement_id: UUID
    replacement_vehicle_id: UUID
    swap_reason: str = Field(min_length=5, max_length=500)
    rate_adjustment: Decimal = Field(default=Decimal("0"))
    new_inspection_form_id: UUID

class VehicleSwapResult(BaseModel):
    original_ra_id: UUID
    new_ra_id: UUID
    swapped_at: datetime
    billing_adjustment: Decimal
```

### 7.4 Overdue Escalation Tiers (FEATURES.md §41.4)
```
Celery beat: counter.check_overdue_rentals — every 15 minutes

Tier 1 — 30 minutes overdue:  SMS/email to customer; event RENTAL_OVERDUE_TIER1
Tier 2 —  2 hours overdue:    Phone-call task created for agent; RENTAL_OVERDUE_TIER2
Tier 3 —  4 hours overdue:    Manager alert, escalation flag on RA; RENTAL_OVERDUE_TIER3
Tier 4 —  1 day   overdue:    Legal/collections notified, vehicle flagged missing; RENTAL_OVERDUE_TIER4
Tier 5 —  3 days  overdue:    Law enforcement report initiated; ADMIN_HOLD on vehicle; RENTAL_OVERDUE_TIER5

State stored in: rental_agreements.overdue_tier (0-5)
A tier fires exactly once; does not re-fire until tier advances.
```

### 7.5 Vehicle Swap Flow
```
Original RA (RA-001, Vehicle A)
  │  Reason: mechanical failure, upgrade, accident
  │
  ├─ Agent: POST /counter/swap-vehicle
  │     └─ CounterService.swap_vehicle():
  │         a. Vehicle A: status → READY_FOR_INSPECTION (or MAINTENANCE)
  │         b. Create RA-002 for Vehicle B
  │            swapped_from_ra_id = RA-001.id on RA-002
  │            RA-001.swapped_to_ra_id = RA-002.id
  │         c. Copy remaining period, extras, customer
  │         d. Apply rate differential (billing_adjustment)
  │         e. New pre-inspection for Vehicle B
  │         f. dispatch VEHICLE_SWAPPED event
  │
  └─ Both RAs remain (audit trail); RA-001 status → COMPLETED
```

### 7.6 Business Rules (Testable Assertions)
```python
def test_checkout_blocked_without_inspection():
    """Checkout without completed inspection_form_id raises CheckoutBlockedError."""

def test_checkout_blocked_without_cdw_decision():
    """Checkout without cdw_disclosure_id decision raises CheckoutBlockedError."""

def test_overdue_tier1_fires_at_30min():
    """Celery task emits RENTAL_OVERDUE_TIER1 at pickup_scheduled + 30min."""

def test_overdue_tiers_do_not_retrofire():
    """Tier already reached is not re-emitted in subsequent task runs."""

def test_vehicle_swap_links_both_ras():
    """RA-001.swapped_to_ra_id and RA-002.swapped_from_ra_id both set after swap."""

def test_shift_close_calculates_cash_over_short():
    """opening_cash + cash_deposits - cash_refunds - closing_cash = over/short."""

def test_offline_checkout_syncs_on_reconnect():
    """Checkout performed offline is queued via Workbox BackgroundSyncPlugin, replays on connection."""
```

### 7.7 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `CheckoutBlockedError` | 422 | `CHECKOUT_BLOCKED` |
| `CheckInBlockedError` | 422 | `CHECKIN_BLOCKED` |
| `ShiftAlreadyOpenError` | 409 | `SHIFT_ALREADY_OPEN` |
| `ShiftNotFoundError` | 404 | `SHIFT_NOT_FOUND` |
| `VehicleSwapError` | 422 | `VEHICLE_SWAP_FAILED` |
| `RateOverrideUnauthorizedError` | 403 | `RATE_OVERRIDE_UNAUTHORIZED` |

### 7.8 Celery Tasks
```python
@app.task(queue='batch', name='counter.check_overdue_rentals')
async def check_overdue_rentals() -> None:
    """Every 15 minutes. Evaluates all CHECKED_OUT/EXTENDED RAs for overdue tiers."""

@app.task(queue='batch', name='counter.auto_extend_pre_auths_for_overdue')
async def auto_extend_pre_auths_for_overdue() -> None:
    """Every 1 hour. Triggers incremental auth for Tier 2+ overdue rentals."""
```

### 7.9 Offline Mode
Counter app (`apps/web-counter`) uses Workbox `BackgroundSyncPlugin`:
- `maxRetentionTime: 24 * 60` (24 hours in minutes)
- Registered on `POST /counter/checkout` and `POST /counter/check-in`
- Minimum offline capability: 4 hours (FEATURES.md §41)

---

## Domain 8 — Customer Management

### 8.1 Responsibility
Customer deduplication, DNR (Do Not Rent) flag management, GDPR erasure, customer merge, and identity verification.

### 8.2 Service Interface
```python
# apps/api/app/domains/customers/service.py
from typing import Protocol
from uuid import UUID
from .schemas import (
    CustomerCreateRequest, CustomerRead, CustomerMergeRequest,
    DNRRequest, DNRCheckResult, GDPRErasureRequest, GDPRErasureResult,
    CustomerSearchQuery,
)

class CustomerServiceProtocol(Protocol):
    async def create_customer(
        self, req: CustomerCreateRequest, created_by: UUID
    ) -> CustomerRead:
        """
        1. Dedup check (email + phone + DL number)
        2. If duplicate found: return existing with dedup_match=True
        3. DNR check across scopes
        4. Create customer record
        """
        ...

    async def check_dnr(
        self, customer_id: UUID, location_id: UUID
    ) -> DNRCheckResult:
        """
        LOCATION: blocks only at this location
        REGIONAL: blocks at all locations in the same region
        NETWORK:  blocks at all tenant locations
        """
        ...

    async def set_dnr(self, req: DNRRequest, set_by: UUID) -> None:
        """Requires MANAGER or ADMIN role."""
        ...

    async def clear_dnr(
        self, customer_id: UUID, cleared_by: UUID, reason: str
    ) -> None:
        """Requires ADMIN role. Audit logged."""
        ...

    async def merge_customers(
        self, req: CustomerMergeRequest, merged_by: UUID
    ) -> CustomerRead:
        """
        Merge source into target. Re-links all reservations, RAs, payments.
        Soft-deletes source. Dispatches CUSTOMER_MERGED audit event.
        """
        ...

    async def gdpr_erase(
        self, req: GDPRErasureRequest, requested_by: UUID
    ) -> GDPRErasureResult:
        """
        GDPR Article 17 right to erasure.
        Replaces PII with anonymized placeholders. Sets anonymized_at.
        Does NOT delete rows. Blocked if active rental or open dispute exists.
        """
        ...

    async def search_customers(self, query: CustomerSearchQuery) -> list[CustomerRead]: ...
    async def get_customer(self, customer_id: UUID) -> CustomerRead: ...
```

### 8.3 Pydantic v2 Schemas
```python
# apps/api/app/domains/customers/schemas.py
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime, date
from enum import Enum

class DNRScope(str, Enum):
    LOCATION = "LOCATION"
    REGIONAL = "REGIONAL"   # Canonical — see GAP-002
    NETWORK = "NETWORK"

class CustomerCreateRequest(BaseModel):
    email: str = Field(pattern=r'^[^@]+@[^@]+\.[^@]+$')
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=30)
    date_of_birth: date | None = None
    driver_license_number: str | None = Field(default=None, max_length=30)
    driver_license_state: str | None = Field(default=None, max_length=10)
    driver_license_expiry: date | None = None
    preferred_language: str = Field(default="en", max_length=5)
    marketing_opt_in: bool = False

class DNRRequest(BaseModel):
    customer_id: UUID
    dnr_scope: DNRScope
    location_id: UUID | None = Field(default=None, description="Required when dnr_scope=LOCATION")
    reason: str = Field(min_length=5, max_length=500)

class DNRCheckResult(BaseModel):
    customer_id: UUID
    is_blocked: bool
    scope: DNRScope | None
    reason: str | None
    set_at: datetime | None
    set_by_location_id: UUID | None

class CustomerMergeRequest(BaseModel):
    target_customer_id: UUID
    source_customer_id: UUID
    merge_reason: str = Field(min_length=5)

class GDPRErasureRequest(BaseModel):
    customer_id: UUID
    reason: str = Field(min_length=5, max_length=500)
    verified_identity: bool

class GDPRErasureResult(BaseModel):
    customer_id: UUID
    anonymized_at: datetime
    fields_anonymized: list[str]
    reservations_retained: int
    blocked_reason: str | None

class CustomerSearchQuery(BaseModel):
    query: str | None = None
    email: str | None = None
    phone: str | None = None
    driver_license_number: str | None = None
    limit: int = Field(default=20, le=100)
    offset: int = Field(default=0, ge=0)

class CustomerRead(BaseModel):
    model_config = {"from_attributes": True}
    customer_id: UUID
    tenant_id: UUID
    email: str | None
    first_name: str
    last_name: str
    phone: str | None
    driver_license_number: str | None
    dnr_flag: bool
    dnr_scope: DNRScope | None
    anonymized_at: datetime | None
    created_at: datetime
```

### 8.4 Deduplication Strategy
```
On create_customer():
  1. Exact email match (case-insensitive LOWER())
  2. driver_license_number + driver_license_state exact match
  3. phone (E.164 normalized) exact match

If duplicate found:
  - Return existing customer with dedup_match=True flag
  - Create DedupReviewRecord for agent queue
  - Do NOT auto-merge (requires explicit agent action via merge_customers())
```

### 8.5 DNR Check Logic
```
Input: customer_id, location_id

1. SELECT dnr_flag, dnr_scope, dnr_location_id FROM customers WHERE customer_id=:cid
2. If dnr_flag = FALSE → NOT BLOCKED
3. Evaluate scope:
   NETWORK:  BLOCKED at all locations for this tenant
   REGIONAL: Lookup region for :location_id; if same region → BLOCKED
   LOCATION: If dnr_location_id == :location_id → BLOCKED; else NOT BLOCKED

DNR check runs at:
  (a) Reservation creation
  (b) Counter checkout (redundant — catches post-booking DNR flags)
```

### 8.6 GDPR Anonymization
```python
ANONYMIZED_FIELDS = {
    "email": "anonymized@gdpr.invalid",
    "first_name": "ANONYMIZED",
    "last_name": "ANONYMIZED",
    "phone": None,
    "date_of_birth": None,
    "driver_license_number": None,
    "driver_license_state": None,
    "driver_license_expiry": None,
}
# Blocking conditions (GDPR legitimate interest):
# - Active CHECKED_OUT or RETURNING rental
# - Open damage claim
# - Pending payment dispute
# - Outstanding balance
```

### 8.7 Business Rules (Testable Assertions)
```python
def test_dnr_network_scope_blocks_all_locations():
    """NETWORK DNR blocks rental at any location under the tenant."""

def test_dnr_location_scope_allows_other_locations():
    """LOCATION DNR for site A does not block rental at site B."""

def test_gdpr_erasure_blocked_with_active_rental():
    """GDPRErasureRequest for customer with CHECKED_OUT reservation raises BlockedError."""

def test_gdpr_anonymization_preserves_reservation_rows():
    """After erasure, reservation rows exist but PII fields are anonymized placeholders."""

def test_customer_merge_relinks_reservations():
    """All reservations belonging to source_customer_id point to target_customer_id after merge."""

def test_dedup_returns_existing_on_email_match():
    """Creating customer with existing email returns dedup_match=True without duplicate row."""

def test_dnr_scope_enum_values():
    """DNRScope has exactly LOCATION, REGIONAL, NETWORK (not BRAND — see GAP-002)."""
```

### 8.8 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `CustomerNotFoundError` | 404 | `CUSTOMER_NOT_FOUND` |
| `CustomerDNRError` | 403 | `CUSTOMER_DO_NOT_RENT` |
| `GDPRErasureBlockedError` | 409 | `GDPR_ERASURE_BLOCKED` |
| `CustomerMergeError` | 422 | `CUSTOMER_MERGE_FAILED` |

---

## Domain 9 — Damage & Inspections

### 9.1 Responsibility
22-zone pre/post rental inspection forms, photo capture with geo-tag and SHA-256, SVG body diagram, damage detection via zone comparison, damage claim lifecycle, CDW determination, and DAMAGE_HOLD block placement.

### 9.2 Service Interface
```python
# apps/api/app/domains/damage/service.py
from typing import Protocol
from uuid import UUID
from decimal import Decimal
from .schemas import (
    InspectionCreateRequest, InspectionRead,
    DamageClaimCreate, DamageClaimRead,
    PhotoUploadRequest, PhotoRecord,
    ZoneComparisonResult,
)

class DamageServiceProtocol(Protocol):
    async def create_inspection_form(
        self, req: InspectionCreateRequest, agent_id: UUID
    ) -> InspectionRead:
        """Create 22-zone inspection record. Raises InspectionAlreadyExistsError if type+RA exists."""
        ...

    async def record_zone_damage(
        self, inspection_id: UUID, zone: str,
        severity: str, description: str, photo_ids: list[UUID]
    ) -> None:
        """Mark zone as damaged. Zone must be one of 22 canonical zones."""
        ...

    async def complete_inspection(
        self, inspection_id: UUID, agent_id: UUID
    ) -> InspectionRead:
        """Finalize form. If POST_RENTAL: triggers compare_with_pre_rental()."""
        ...

    async def compare_with_pre_rental(
        self, post_inspection_id: UUID
    ) -> ZoneComparisonResult:
        """
        New damage zones → auto-create damage claim.
        Returns new_damage_zones, existing_damage_zones, cleared_zones.
        """
        ...

    async def upload_photo(self, req: PhotoUploadRequest) -> PhotoRecord:
        """Generate presigned S3 PUT URL. On upload: verify SHA-256, store PhotoRecord."""
        ...

    async def create_damage_claim(
        self, req: DamageClaimCreate, agent_id: UUID
    ) -> DamageClaimRead:
        """
        Determines CDW applicability.
        Places DAMAGE_HOLD on vehicle (ADMIN VehicleBlock + status → DAMAGE_HOLD).
        """
        ...

    async def adjudicate_claim(
        self, claim_id: UUID, decision: str,
        approved_amount: Decimal, notes: str, adjudicated_by: UUID
    ) -> DamageClaimRead:
        """
        APPROVED: charge customer or CDW covers.
        DENIED: release DAMAGE_HOLD; vehicle → MAINTENANCE or AVAILABLE.
        """
        ...

    async def get_inspection(self, inspection_id: UUID) -> InspectionRead: ...
    async def get_claim(self, claim_id: UUID) -> DamageClaimRead: ...
```

### 9.3 Pydantic v2 Schemas
```python
# apps/api/app/domains/damage/schemas.py
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Literal

VEHICLE_ZONES = [
    "FRONT_LEFT", "FRONT_CENTER", "FRONT_RIGHT",
    "ROOF_FRONT", "ROOF_CENTER", "ROOF_REAR",
    "REAR_LEFT", "REAR_CENTER", "REAR_RIGHT",
    "DOOR_FRONT_LEFT", "DOOR_FRONT_RIGHT",
    "DOOR_REAR_LEFT", "DOOR_REAR_RIGHT",
    "MIRROR_LEFT", "MIRROR_RIGHT",
    "WINDSHIELD_FRONT", "WINDSHIELD_REAR",
    "UNDERBODY_FRONT", "UNDERBODY_REAR",
    "INTERIOR_FRONT", "INTERIOR_REAR",
    "TRUNK",
]  # 22 zones

class DamageSeverity(str, Enum):
    SCRATCH = "SCRATCH"
    DENT = "DENT"
    CRACK = "CRACK"
    BROKEN = "BROKEN"
    MISSING = "MISSING"

class ClaimStatus(str, Enum):
    OPEN = "OPEN"
    UNDER_REVIEW = "UNDER_REVIEW"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    PARTIAL = "PARTIAL"
    CLOSED = "CLOSED"

class InspectionCreateRequest(BaseModel):
    vehicle_id: UUID
    rental_agreement_id: UUID
    inspection_type: Literal["PRE_RENTAL", "POST_RENTAL"]
    location_id: UUID

class ZoneDamageRecord(BaseModel):
    zone: str
    severity: DamageSeverity
    description: str = Field(max_length=500)
    photo_ids: list[UUID] = Field(default_factory=list)
    is_pre_existing: bool = False

class InspectionRead(BaseModel):
    model_config = {"from_attributes": True}
    inspection_id: UUID
    vehicle_id: UUID
    rental_agreement_id: UUID
    inspection_type: str
    agent_id: UUID
    status: Literal["DRAFT", "COMPLETED"]
    zones: list[ZoneDamageRecord]
    completed_at: datetime | None
    svg_diagram_url: str | None

class PhotoUploadRequest(BaseModel):
    inspection_id: UUID
    zone: str
    content_type: str = Field(default="image/jpeg")

class PhotoRecord(BaseModel):
    photo_id: UUID
    inspection_id: UUID
    zone: str
    s3_key: str
    sha256_hash: str
    captured_at: datetime
    latitude: float | None
    longitude: float | None
    device_fingerprint: str | None
    is_verified: bool

class ZoneComparisonResult(BaseModel):
    pre_inspection_id: UUID
    post_inspection_id: UUID
    new_damage_zones: list[str]
    existing_damage_zones: list[str]
    cleared_zones: list[str]
    auto_claim_created: bool

class DamageClaimCreate(BaseModel):
    rental_agreement_id: UUID
    vehicle_id: UUID
    post_inspection_id: UUID
    damage_zones: list[str]
    estimated_repair_cost: Decimal | None = None
    cdw_applies: bool
    notes: str | None = None

class DamageClaimRead(BaseModel):
    model_config = {"from_attributes": True}
    claim_id: UUID
    rental_agreement_id: UUID
    vehicle_id: UUID
    status: ClaimStatus
    damage_zones: list[str]
    estimated_repair_cost: Decimal | None
    approved_amount: Decimal | None
    cdw_applies: bool
    customer_liability: Decimal | None
    created_at: datetime
    adjudicated_at: datetime | None
```

### 9.4 Photo Capture Requirements (FEATURES.md §9.3)
```
Each photo record stores:
  - timestamp (UTC, immutable)
  - latitude + longitude (device GPS geo-tag)
  - device_fingerprint (User-Agent hash + device ID)
  - sha256_hash (computed server-side on S3 upload completion)
  - S3 Object Lock COMPLIANCE mode, 7-year retention

Upload flow:
  1. POST /inspections/photos/upload-url → presigned S3 PUT URL (15-min expiry)
  2. Client uploads directly to S3 (no raw binary through API server)
  3. S3 event → Lambda verify_photo_sha256 → PATCH /internal/photos/{id}/verify
  4. is_verified=False photos cannot be attached to damage claims
```

### 9.5 CDW Applicability
```python
def determine_cdw_applies(ra: RentalAgreement, cdw_declination: CDWDeclinationRecord | None) -> bool:
    if cdw_declination is not None:
        return False   # Customer declined
    if ra.cdw_status == "DECLINED":
        return False
    return True  # Customer accepted; full logic consults coverage_rules table
```

### 9.6 Business Rules (Testable Assertions)
```python
def test_22_zones_canonical():
    """VEHICLE_ZONES list has exactly 22 entries."""

def test_photo_sha256_verified_before_claim():
    """Unverified photo (is_verified=False) cannot be attached to damage claim."""

def test_damage_hold_placed_on_claim_creation():
    """Creating damage claim sets vehicle status=DAMAGE_HOLD and creates ADMIN VehicleBlock."""

def test_new_damage_zones_auto_create_claim():
    """compare_with_pre_rental() creates claim automatically for new_damage_zones."""

def test_cdw_declined_means_customer_liable():
    """CDW declination → cdw_applies=False → customer_liability=estimated_repair_cost."""

def test_pre_rental_inspection_required_for_checkout():
    """checkout() raises CheckoutBlockedError if pre-rental inspection not COMPLETED."""
```

### 9.7 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `InspectionNotFoundError` | 404 | `INSPECTION_NOT_FOUND` |
| `InspectionAlreadyExistsError` | 409 | `INSPECTION_ALREADY_EXISTS` |
| `InspectionAlreadyCompletedError` | 422 | `INSPECTION_ALREADY_COMPLETED` |
| `InvalidZoneError` | 422 | `INVALID_INSPECTION_ZONE` |
| `PhotoVerificationFailedError` | 422 | `PHOTO_VERIFICATION_FAILED` |
| `DamageClaimNotFoundError` | 404 | `DAMAGE_CLAIM_NOT_FOUND` |

### 9.8 Integration Points
- **S3:** Presigned PUT URLs; S3 Object Lock COMPLIANCE mode, 7-year retention
- **Lambda:** `verify_photo_sha256` triggered on S3 PutObject event
- **WeasyPrint:** SVG damage diagram rendered to PDF for claim reports
- **Celery:** `damage.generate_svg_diagram(inspection_id)` — async after inspection completion

---

## Domain 10 — Notification System

### 10.1 Responsibility
Redis Streams at-least-once delivery pipeline, Jinja2 template rendering, multi-channel dispatch (email/SMS/push/webhook), DLQ via Celery, 30 canonical events, and GDPR-compliant logging (body_hash only).

### 10.2 Service Interface
```python
# apps/api/app/domains/notifications/service.py
from typing import Protocol
from uuid import UUID
from .schemas import NotificationEvent, NotificationLog, TemplateRenderResult

class NotificationServiceProtocol(Protocol):
    async def dispatch(self, event: NotificationEvent) -> str:
        """
        XADD notifications:{tenant_id} MAXLEN ~ 10000 * ...fields
        Returns stream entry ID.
        Raises StreamPublishError on Redis failure.
        """
        ...

    async def render_template(
        self, template_key: str, context: dict, tenant_id: UUID, locale: str = "en"
    ) -> TemplateRenderResult:
        """Jinja2 render. Lookup: tenant override → system default."""
        ...

    async def log_notification(
        self, notification_id: UUID, event_type: str, channel: str,
        recipient: str, body: str, status: str, tenant_id: UUID
    ) -> None:
        """Store body_hash=SHA-256(body) only. Never store body text (GDPR)."""
        ...

    async def retry_failed(self, tenant_id: UUID, limit: int = 100) -> int:
        """Move DLQ messages back to active stream. Returns count re-queued."""
        ...
```

### 10.3 Pydantic v2 Schemas
```python
# apps/api/app/domains/notifications/schemas.py
from pydantic import BaseModel, Field
from uuid import UUID, uuid4
from datetime import datetime
from enum import Enum
from typing import Any

class NotificationChannel(str, Enum):
    EMAIL = "EMAIL"
    SMS = "SMS"
    PUSH = "PUSH"
    WEBHOOK = "WEBHOOK"
    IN_APP = "IN_APP"

class NotificationEvent(BaseModel):
    event_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    event_type: str
    customer_id: UUID | None = None
    user_id: UUID | None = None
    rental_agreement_id: UUID | None = None
    channels: list[NotificationChannel]
    context: dict[str, Any] = Field(default_factory=dict)
    locale: str = Field(default="en")
    priority: int = Field(default=5, ge=1, le=10)
    scheduled_at: datetime | None = None

class TemplateRenderResult(BaseModel):
    template_key: str
    subject: str | None
    body_text: str
    body_html: str | None
    locale: str

class NotificationLog(BaseModel):
    model_config = {"from_attributes": True}
    notification_id: UUID
    tenant_id: UUID
    event_type: str
    channel: NotificationChannel
    recipient: str
    body_hash: str  # SHA-256(body) — GDPR compliance; body text NOT stored
    status: str
    sent_at: datetime | None
    error_message: str | None
    retry_count: int
```

### 10.4 Redis Streams Pipeline
```
Producer (any domain service)
  XADD notifications:{tenant_id} MAXLEN ~ 10000 * event_id {uuid} event_type {type} ...

Consumer Group (Celery workers)
  XREADGROUP GROUP notification-workers consumer-{n} COUNT 10 BLOCK 5000
              STREAMS notifications:{tenant_id} >

  For each message:
    a. Render template (Jinja2)
    b. Dispatch via channel adapter
    c. Log to notification_log (body_hash only)
    d. XACK on success

  On 3 consecutive failures:
    XADD notifications:{tenant_id}:dlq * {fields + error}

DLQ recovery: Celery process_dlq task every 5 minutes

Stream Lag Alarm: XLEN notifications:{tenant_id} > 500 → ops alert
```

### 10.5 30 Canonical Notification Events

| # | Event Type | Domain | Primary Channels |
|---|-----------|--------|-----------------|
| 1 | TENANT_PROVISIONED | Tenant | EMAIL |
| 2 | TENANT_SUSPENDED | Tenant | EMAIL |
| 3 | TOS_ACCEPTED | Tenant | EMAIL |
| 4 | RESERVATION_CREATED | Reservations | EMAIL, SMS |
| 5 | RESERVATION_CONFIRMED | Reservations | EMAIL, SMS |
| 6 | RESERVATION_MODIFIED | Reservations | EMAIL, SMS |
| 7 | RESERVATION_CANCELLED | Reservations | EMAIL, SMS |
| 8 | RESERVATION_REMINDER | Reservations | EMAIL, SMS |
| 9 | NO_SHOW | Reservations | EMAIL, SMS |
| 10 | RENTAL_CHECKED_OUT | Counter | EMAIL, PUSH |
| 11 | RENTAL_RETURNED | Counter | EMAIL, PUSH |
| 12 | RENTAL_OVERDUE_TIER1 | Counter | SMS, EMAIL |
| 13 | RENTAL_OVERDUE_TIER2 | Counter | SMS, EMAIL, IN_APP |
| 14 | RENTAL_OVERDUE_TIER3 | Counter | SMS, EMAIL, IN_APP |
| 15 | RENTAL_OVERDUE_TIER4 | Counter | SMS, EMAIL, WEBHOOK |
| 16 | RENTAL_OVERDUE_TIER5 | Counter | SMS, EMAIL, WEBHOOK |
| 17 | VEHICLE_SWAPPED | Counter | EMAIL, PUSH |
| 18 | PAYMENT_AUTHORIZED | Payments | EMAIL |
| 19 | PAYMENT_CAPTURED | Payments | EMAIL |
| 20 | PAYMENT_FAILED | Payments | EMAIL, SMS |
| 21 | PAYMENT_REFUNDED | Payments | EMAIL |
| 22 | DAMAGE_CLAIM_CREATED | Damage | EMAIL, IN_APP |
| 23 | DAMAGE_CLAIM_APPROVED | Damage | EMAIL, SMS |
| 24 | DAMAGE_CLAIM_DENIED | Damage | EMAIL, SMS |
| 25 | VEHICLE_RECALL_FOUND | Fleet | EMAIL, WEBHOOK |
| 26 | CUSTOMER_MERGED | Customers | EMAIL |
| 27 | SUBSCRIPTION_TRIAL_ENDING | SaaS Billing | EMAIL |
| 28 | SUBSCRIPTION_PAYMENT_FAILED | SaaS Billing | EMAIL |
| 29 | SUBSCRIPTION_CANCELLED | SaaS Billing | EMAIL |
| 30 | STAFF_PASSWORD_RESET | Auth | EMAIL |

### 10.6 Business Rules (Testable Assertions)
```python
def test_notification_body_not_stored():
    """notification_log row has body_hash (str) but no body_text column."""

def test_body_hash_is_sha256():
    """body_hash = hashlib.sha256(body.encode()).hexdigest() — 64 hex chars."""

def test_stream_maxlen_10000():
    """Redis stream notifications:{tenant_id} trimmed to MAXLEN 10000."""

def test_dlq_retried_every_5_minutes():
    """Failed notifications land in DLQ stream; re-queued by process_dlq Celery task."""

def test_30_canonical_events_defined():
    """CANONICAL_EVENTS constant has exactly 30 event type strings."""

def test_tenant_scoped_streams():
    """Events for tenant A published to notifications:{tenant_a_id}, not tenant B's stream."""

def test_stream_lag_alarm_at_500():
    """Stream lag > 500 messages triggers ops alert."""
```

### 10.7 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `StreamPublishError` | 503 | `NOTIFICATION_STREAM_UNAVAILABLE` |
| `TemplateNotFoundError` | 404 | `NOTIFICATION_TEMPLATE_NOT_FOUND` |
| `ChannelDeliveryError` | 502 | `NOTIFICATION_DELIVERY_FAILED` |

### 10.8 Celery Tasks
```python
@app.task(queue='notifications', name='notifications.process_stream')
async def process_notification_stream(tenant_id: str) -> None:
    """Continuous consumer. XREADGROUP BLOCK 5000ms. ACKs on success; DLQ on 3 failures."""

@app.task(queue='notifications', name='notifications.process_dlq')
async def process_dlq() -> None:
    """Every 5 minutes. Re-publishes eligible DLQ messages."""

@app.task(queue='notifications', name='notifications.send_email')
async def send_email(notification_id: str, rendered: dict) -> None:
    """SMTP or SendGrid dispatch. Logs result to notification_log."""

@app.task(queue='notifications', name='notifications.send_sms')
async def send_sms(notification_id: str, phone: str, body: str) -> None:
    """Twilio or AWS SNS dispatch."""
```

---

## Domain 11 — SaaS Billing

### 11.1 Responsibility
Subscription tier enforcement, feature gating at API and UI layers, free trial mode, Stripe Billing webhooks, and the operator billing dashboard.

### 11.2 Service Interface
```python
# apps/api/app/domains/saas_billing/service.py
from typing import Protocol
from uuid import UUID
from .schemas import (
    SubscriptionRead, FeatureGateResult, TrialStatus,
    BillingPortalSession, InvoiceRead,
)

class SaaSBillingServiceProtocol(Protocol):
    async def get_subscription(self, tenant_id: UUID) -> SubscriptionRead: ...

    async def check_feature(
        self, tenant_id: UUID, feature_key: str
    ) -> FeatureGateResult:
        """
        Redis cache: feature_gate:{tenant_id}:{feature_key} (5min TTL).
        Returns is_allowed, current_tier, required_tier, upgrade_url.
        """
        ...

    async def check_usage_limit(
        self, tenant_id: UUID, resource: str, current_count: int
    ) -> FeatureGateResult: ...

    async def create_billing_portal_session(
        self, tenant_id: UUID, return_url: str
    ) -> BillingPortalSession:
        """Stripe Customer Portal session for self-service plan management."""
        ...

    async def process_billing_webhook(
        self, event_type: str, payload: dict, stripe_event_id: str
    ) -> None:
        """
        Handles: customer.subscription.updated/deleted,
                 invoice.payment_succeeded/failed
        Uses ProcessedWebhook idempotency (same table as Payments domain).
        """
        ...

    async def upgrade_subscription(
        self, tenant_id: UUID, new_plan_id: str, by: UUID
    ) -> SubscriptionRead: ...

    async def get_invoices(self, tenant_id: UUID, limit: int = 12) -> list[InvoiceRead]: ...
    async def get_trial_status(self, tenant_id: UUID) -> TrialStatus: ...
```

### 11.3 Pydantic v2 Schemas
```python
# apps/api/app/domains/saas_billing/schemas.py
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from enum import Enum

class SubscriptionTier(str, Enum):
    TRIAL = "TRIAL"
    STARTER = "STARTER"
    GROWTH = "GROWTH"
    ENTERPRISE = "ENTERPRISE"

class SubscriptionStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PAST_DUE = "PAST_DUE"
    CANCELLED = "CANCELLED"
    SUSPENDED = "SUSPENDED"
    TRIAL = "TRIAL"

class SubscriptionRead(BaseModel):
    model_config = {"from_attributes": True}
    tenant_id: UUID
    tier: SubscriptionTier
    status: SubscriptionStatus
    stripe_subscription_id: str | None
    current_period_start: datetime
    current_period_end: datetime
    trial_ends_at: datetime | None
    is_trial: bool
    days_remaining_in_trial: int | None
    monthly_amount: Decimal
    currency_code: str

class FeatureGateResult(BaseModel):
    tenant_id: UUID
    feature_key: str
    is_allowed: bool
    current_tier: SubscriptionTier
    required_tier: SubscriptionTier | None
    limit_value: int | None
    current_usage: int | None
    upgrade_url: str | None

class TrialStatus(BaseModel):
    is_trial: bool
    trial_ends_at: datetime | None
    days_remaining: int | None
    is_expired: bool
    features_blocked_after_trial: list[str]

class BillingPortalSession(BaseModel):
    url: str
    expires_at: datetime

class InvoiceRead(BaseModel):
    invoice_id: str
    stripe_invoice_id: str
    amount_due: Decimal
    amount_paid: Decimal
    currency: str
    status: str
    period_start: datetime
    period_end: datetime
    invoice_pdf_url: str | None
    created_at: datetime
```

### 11.4 Subscription Tiers & Feature Matrix

| Feature | TRIAL | STARTER | GROWTH | ENTERPRISE |
|---------|-------|---------|--------|------------|
| Vehicles | ≤10 | ≤25 | ≤100 | Unlimited |
| Locations | 1 | 1 | ≤5 | Unlimited |
| Staff Users | ≤3 | ≤5 | ≤20 | Unlimited |
| Reporting | Basic | Basic | Advanced | Custom |
| API Access | No | No | Yes | Yes |
| OTA Channels | No | No | No | Yes |
| White-label | No | No | No | Yes |
| SLA | None | Business hrs | 4h | 1h |
| Trial Days | 14 | N/A | N/A | N/A |

```python
FEATURE_GATE_MAP = {
    "api_access":          SubscriptionTier.GROWTH,
    "ota_channels":        SubscriptionTier.ENTERPRISE,
    "white_label":         SubscriptionTier.ENTERPRISE,
    "advanced_reporting":  SubscriptionTier.GROWTH,
    "multi_location":      SubscriptionTier.GROWTH,
    "custom_webhooks":     SubscriptionTier.GROWTH,
}
```

### 11.5 Feature Gating FastAPI Dependency
```python
# apps/api/app/dependencies/feature_gate.py
def require_feature(feature_key: str):
    async def _gate(
        billing_service: SaaSBillingService = Depends(get_billing_service),
        claims: TokenClaims = Depends(require_auth),
    ) -> None:
        result = await billing_service.check_feature(claims.tenant_id, feature_key)
        if not result.is_allowed:
            raise FeatureNotAvailableError(
                feature_key=feature_key,
                required_tier=result.required_tier,
                upgrade_url=result.upgrade_url,
            )
    return Depends(_gate)

# Usage:
@router.get("/ota/channels")
async def list_ota_channels(_=require_feature("ota_channels"), ...): ...
```

### 11.6 Free Trial Mode
```
Duration: 14 days from provisioning
During trial: All GROWTH tier features available
Reminders: SUBSCRIPTION_TRIAL_ENDING at T-7, T-3, T-1 days
Expiry: Features downgrade to STARTER limits; data preserved
Stripe: trial_end set at subscription creation; no payment during trial
```

### 11.7 Business Rules (Testable Assertions)
```python
def test_trial_features_available_during_trial():
    """TRIAL tenant can access GROWTH features during active trial period."""

def test_features_downgrade_after_trial_expiry():
    """TRIAL tenant loses GROWTH features after trial_ends_at passes."""

def test_vehicle_limit_enforced_at_create():
    """Creating vehicle beyond tier limit raises FeatureNotAvailableError (HTTP 402)."""

def test_feature_gate_cached_5_minutes():
    """check_feature() uses Redis cache; DB not queried on second call within 5min."""

def test_past_due_tenant_read_only():
    """PAST_DUE tenant cannot create new reservations (read-only access)."""

def test_suspended_tenant_returns_402():
    """All API calls from SUSPENDED tenant return HTTP 402."""

def test_stripe_billing_webhook_idempotent():
    """Same Stripe Billing event_id processed twice has no duplicate effect."""
```

### 11.8 Error Types
| Error Class | HTTP | Code |
|-------------|------|------|
| `FeatureNotAvailableError` | 402 | `FEATURE_NOT_AVAILABLE` |
| `UsageLimitExceededError` | 402 | `USAGE_LIMIT_EXCEEDED` |
| `SubscriptionNotFoundError` | 404 | `SUBSCRIPTION_NOT_FOUND` |
| `TrialExpiredError` | 402 | `TRIAL_EXPIRED` |

### 11.9 Celery Tasks
```python
@app.task(queue='batch', name='saas.check_trial_expirations')
async def check_trial_expirations() -> None:
    """Daily 09:00 UTC. Dispatches SUBSCRIPTION_TRIAL_ENDING at T-7/T-3/T-1. Downgrades expired trials."""

@app.task(queue='batch', name='saas.sync_stripe_subscriptions')
async def sync_stripe_subscriptions() -> None:
    """Every 4 hours. Reconciles local subscription status with Stripe truth."""
```

### 11.10 Integration Points
- **Stripe Billing API:** Subscription management, Customer Portal, Invoice retrieval
- **Stripe Billing Webhooks:** `POST /webhooks/stripe-billing` (separate from payment webhooks)
- **Redis:** `feature_gate:{tenant_id}:{feature_key}` (5min TTL)

---

## ASCII Sequence Diagrams

### 14.1 Booking Creation Sequence

```
Customer/         Rate          Reservation     Fleet          Payment        Notification
Agent             Engine        Service         Service        Service        Service
  |                 |               |               |               |               |
  |  POST /quotes   |               |               |               |               |
  |---------------->|               |               |               |               |
  |                 | Check Redis   |               |               |               |
  |                 | rate_quote:   |               |               |               |
  |                 | {hash} 30s    |               |               |               |
  |                 |               |               |               |               |
  |                 | [MISS] Query  |               |               |               |
  |                 | rate_codes +  |               |               |               |
  |                 | Avalara tax   |               |               |               |
  |                 |               |               |               |               |
  |<----------------|               |               |               |               |
  |  RateQuote +    |               |               |               |               |
  |  quote_token    |               |               |               |               |
  |                 |               |               |               |               |
  |  POST /reservations             |               |               |               |
  |-------------------------------->|               |               |               |
  |                 |               |               |               |               |
  |                 |               | Check Redis   |               |               |
  |                 |               | avail:{loc}:  |               |               |
  |                 |               | {class}:60s   |               |               |
  |                 |               |               |               |               |
  |                 |               | pg_advisory_  |               |               |
  |                 |               | xact_lock()   |               |               |
  |                 |               |               |               |               |
  |                 |               | Re-check DB   |               |               |
  |                 |               | availability  |               |               |
  |                 |               |               |               |               |
  |                 |               | SELECT FOR    |               |               |
  |                 |               | UPDATE promo  |               |               |
  |                 |               | code (if any) |               |               |
  |                 |               |               |               |               |
  |                 |               | INSERT        |               |               |
  |                 |               | VehicleBlock  |               |               |
  |                 |               | [EXCL. CONST] |               |               |
  |                 |               |               |               |               |
  |                 |               | INSERT        |               |               |
  |                 |               | reservation   |               |               |
  |                 |               | (PENDING)     |               |               |
  |                 |               |               |               |               |
  |                 |               | Generate RC-  |               |               |
  |                 |               | XXXXXXXX      |               |               |
  |                 |               |               |               |               |
  |                 |               | COMMIT; release advisory lock |               |
  |                 |               |               |               |               |
  |                 |               | XADD RESERVATION_CREATED----->|               |
  |                 |               |               |               |               |
  |<--------------------------------|               |               |               |
  |  201 ReservationRead            |               |               |               |
  |  confirmation_number            |               |               |               |
```

### 14.2 Checkout Sequence

```
Counter          Counter          Inspection     CDW             Payment        Notification
Agent            Service          Service        Service         Service        Service
  |                 |               |               |               |               |
  |  POST           |               |               |               |               |
  |  /counter/      |               |               |               |               |
  |  checkout       |               |               |               |               |
  |---------------->|               |               |               |               |
  |                 |               |               |               |               |
  |                 | Verify status |               |               |               |
  |                 | =CONFIRMED    |               |               |               |
  |                 | Check DNR     |               |               |               |
  |                 |               |               |               |               |
  |                 | Verify pre-   |               |               |               |
  |                 | inspection -->|               |               |               |
  |                 |<------------- | COMPLETED     |               |               |
  |                 |               |               |               |               |
  |                 | Verify CDW    |               |               |               |
  |                 | decision -------------------->|               |               |
  |                 |<------------------------------ | decision OK  |               |
  |                 |               |               |               |               |
  |                 | BEGIN txn     |               |               |               |
  |                 | VehicleBlock [EXCL. CONST final guard]        |               |
  |                 | vehicle -> ON_RENT            |               |               |
  |                 | reservation -> CHECKED_OUT    |               |               |
  |                 | COMMIT        |               |               |               |
  |                 |               |               |               |               |
  |                 | [capture_at_checkout=True] -->|               |               |
  |                 |               |               | Stripe.capture()              |
  |                 |<--------------------------------------------- |               |
  |                 |               |               |               |               |
  |                 | WeasyPrint RA PDF -> S3       |               |               |
  |                 |               |               |               |               |
  |                 | XADD RENTAL_CHECKED_OUT---------------------------->          |
  |<----------------|               |               |               |               |
  |  201 CheckoutResult             |               |               |               |
  |  ra_pdf_url     |               |               |               |               |
```

### 14.3 Check-In Sequence

```
Counter          Counter          Inspection     Damage          Payment        Notification
Agent            Service          Service        Service         Service        Service
  |                 |               |               |               |               |
  |  POST           |               |               |               |               |
  |  /counter/      |               |               |               |               |
  |  check-in       |               |               |               |               |
  |---------------->|               |               |               |               |
  |                 |               |               |               |               |
  |                 | Verify RA     |               |               |               |
  |                 | =CHECKED_OUT  |               |               |               |
  |                 |               |               |               |               |
  |                 | Verify post   |               |               |               |
  |                 | inspection -->|               |               |               |
  |                 |<------------- | COMPLETED     |               |               |
  |                 |               |               |               |               |
  |                 | Compare zones |               |               |               |
  |                 | pre vs post ----------------->|               |               |
  |                 |<----------------------------- | ZoneComparison|               |
  |                 |               |               |               |               |
  |                 | [new damage found]            |               |               |
  |                 | Create claim ---------------->|               |               |
  |                 |<----------------------------- | DamageClaim   |               |
  |                 |               |               |               |               |
  |                 | Calculate fuel/mileage/time   |               |               |
  |                 |               |               |               |               |
  |                 | BEGIN txn     |               |               |               |
  |                 | vehicle -> RETURNING -> READY_FOR_INSPECTION  |               |
  |                 | reservation -> RETURNING      |               |               |
  |                 | COMMIT        |               |               |               |
  |                 |               |               |               |               |
  |                 | Capture formula -------------------------------->             |
  |                 |               |               |  Stripe.capture()             |
  |                 |<--------------------------------------------- |               |
  |                 |               |               |               |               |
  |                 | [no damage] reservation -> COMPLETED          |               |
  |                 | [damage]    reservation -> ON_HOLD            |               |
  |                 |               |               |               |               |
  |                 | XADD RENTAL_RETURNED -------------------------------->        |
  |<----------------|               |               |               |               |
  |  200 CheckInResult              |               |               |               |
```

### 14.4 Payment Capture Sequence

```
Counter/         Payment          Stripe          DB              Notification
System           Service          API             (PostgreSQL)    Service
  |                 |               |               |               |
  | capture_payment |               |               |               |
  | (CaptureRequest)|               |               |               |
  |---------------->|               |               |               |
  |                 |               |               |               |
  |                 | Fetch payment |               |               |
  |                 | by ID --------------------------->            |
  |                 |<-------------------------- payment record     |
  |                 |               |               |               |
  |                 | Apply capture formula:        |               |
  |                 | base+extras+time+fuel         |               |
  |                 | +mileage+damage-deposit=total |               |
  |                 |               |               |               |
  |                 | [total > authorized]          |               |
  |                 | Incremental auth ------------>|               |
  |                 |<-------------- new auth OK    |               |
  |                 |               |               |               |
  |                 | Acquire Redis preauth_lock:{res_id} 120s      |
  |                 |               |               |               |
  |                 | PaymentIntent.capture() ----->|               |
  |                 |<-------------- charge_id      |               |
  |                 |               |               |               |
  |                 | BEGIN txn     |               |               |
  |                 | UPDATE payment status=CAPTURED ------------->  |
  |                 | capture_amount, captured_at   |               |
  |                 | COMMIT ---------------------------------->     |
  |                 |               |               |               |
  |                 | Release Redis lock            |               |
  |                 |               |               |               |
  |                 | XADD PAYMENT_CAPTURED ----------------------->|
  |<----------------|               |               |               |
  |  CaptureResult  |               |               |               |
```

---

## Appendix A — Redis Key Namespace Summary

| Key Pattern | TTL | Cluster | Domain |
|-------------|-----|---------|--------|
| `avail:{location_id}:{sipp_class}:{week_bucket}` | 60s | avail-cache | Fleet |
| `rate_quote:{sha256_hash}` | 30s | avail-cache | Rate Engine |
| `session:{jti}` | 8h / 30d | sessions | Auth |
| `otp:{customer_id}` | 10min | sessions | Auth |
| `preauth_lock:{reservation_id}` | 120s | celery-broker | Payments |
| `telematics:dedup:{device}:{ts}` | 5min | avail-cache | Telematics |
| `feature_gate:{tenant_id}:{feature_key}` | 5min | avail-cache | SaaS Billing |

Three separate ElastiCache clusters:
- `avail-cache`: allkeys-lru
- `celery-broker`: noeviction (Celery task queues + Redis Streams)
- `sessions`: volatile-lru

---

## Appendix B — Celery Queue & Scheduled Task Summary

| Queue | Tasks |
|-------|-------|
| `notifications` | process_stream, process_dlq, send_email, send_sms |
| `batch` | poll_nhtsa_recalls, refresh_availability_cache, check_no_shows, renew_expiring_pre_auths, reconcile_stripe_payouts, retry_failed_captures, check_overdue_rentals, auto_extend_pre_auths_for_overdue, check_trial_expirations, sync_stripe_subscriptions |
| `reports` | generate_daily_report, generate_fleet_utilization |
| `rate_filing` | file_rate_updates (OTA channels — Phase 2) |

Celery Beat Schedule (8 core tasks):

| Task | Schedule |
|------|----------|
| `fleet.poll_nhtsa_recalls` | Nightly 02:00 UTC |
| `fleet.refresh_availability_cache` | Every 5 minutes |
| `reservations.check_no_shows` | Every 15 minutes |
| `payments.renew_expiring_pre_auths` | Every 6 hours |
| `payments.reconcile_stripe_payouts` | Nightly 03:00 UTC |
| `counter.check_overdue_rentals` | Every 15 minutes |
| `saas.check_trial_expirations` | Daily 09:00 UTC |
| `saas.sync_stripe_subscriptions` | Every 4 hours |

---

## Appendix C — Domain Module Directory Structure

```
apps/api/app/
├── domains/
│   ├── tenant/         (service.py, repository.py, schemas.py, models.py, router.py, tasks.py)
│   ├── fleet/
│   ├── reservations/
│   ├── rates/
│   ├── extras/
│   ├── payments/
│   ├── counter/
│   ├── customers/
│   ├── damage/
│   ├── notifications/
│   └── saas_billing/
├── repositories/
│   └── base.py              # BaseRepository[ModelT]
├── integrations/
│   ├── base.py              # IntegrationClient + CircuitBreaker(threshold=5, recovery=60s)
│   ├── stripe.py            # StripeClient
│   ├── nhtsa.py             # NHTSAClient (vPIC + Recalls)
│   ├── avalara.py           # AvalaraClient (SHA-256 cached 1h)
│   └── sendgrid.py          # SendGridClient
├── middleware/
│   ├── tenant.py            # GUC injection (set_config)
│   ├── auth.py              # JWT validation (httpOnly cookie, SameSite=Strict)
│   └── rls.py               # RLS session setup
├── exceptions.py            # DomainError hierarchy + RFC 7807 handler
└── main.py
```

---

*End of ARCH_DOMAINS.md*
