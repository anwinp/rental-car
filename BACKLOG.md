# Rental Car Management System — Product Backlog

> **Source:** Synthesized from 5-agent review of FEATURES.md (Sections 1–43) and ARCHITECTURE.md  
> **Phasing:** Phase 0 (Technical Foundation) → Phase 1 (MVP) → Phase 2 (Commercial Launch) → Phase 3 (Scale)  
> **Sizing:** XS = 0.5d · S = 1d · M = 3d · L = 5d · XL = 8d · XXL = 13d+

---

## Phase Summary

| Phase | Goal | Duration Estimate | Items |
|---|---|---|---|
| **Phase 0** | Technical foundation — nothing deployable, everything runnable | Sprints 1–4 (~8 weeks) | ~120 items |
| **Phase 1 — MVP** | First rental to first receipt; one operator, one location, one counter agent | Sprints 5–16 (~24 weeks) | ~180 items |
| **Phase 2 — Commercial Launch** | Multi-location, OTA channels, damage/claims, loyalty, compliance, self-service portal | Sprints 17–28 (~24 weeks) | ~220 items |
| **Phase 3 — Scale** | GDS filing, telematics, mobile apps, advanced reporting, partner API, EV | Sprints 29+ | ~100 items |

**MVP Definition:** System can create a tenant, onboard one location, add a vehicle, create a reservation, process a Stripe pre-auth, complete a counter checkout, record a return, capture payment, and generate a receipt — with full audit trail and no data leaks between tenants.

---

## Table of Contents

- [Phase 0 — Technical Foundation](#phase-0--technical-foundation)
- [Phase 1 — MVP](#phase-1--mvp)
- [Phase 2 — Commercial Launch](#phase-2--commercial-launch)
- [Phase 3 — Scale & Advanced Features](#phase-3--scale--advanced-features)
- [Backlog Item Index by Epic](#backlog-item-index-by-epic)

---

# Phase 0 — Technical Foundation

> Everything in Phase 0 must be complete before any feature work begins. None of these items are user-visible. All are prerequisites.

---

## EPIC: Project Scaffolding

| ID | Size | Title | Dependencies |
|---|---|---|---|
| SCAFFOLD-001 | M | Initialize Turborepo monorepo root (turbo.json, workspaces, .nvmrc, .gitignore, README) | — |
| SCAFFOLD-002 | S | Scaffold apps/api directory (app structure, requirements.txt pinned, pyproject.toml with ruff + mypy) | SCAFFOLD-001 |
| SCAFFOLD-003 | S | Scaffold apps/web-booking (Next.js 14, App Router, TypeScript, Tailwind, next.config.ts) | SCAFFOLD-001 |
| SCAFFOLD-004 | S | Scaffold apps/web-counter (Vite + React + TypeScript, vite-plugin-pwa configured) | SCAFFOLD-001 |
| SCAFFOLD-005 | S | Scaffold apps/web-admin (Vite + React + TypeScript, no PWA) | SCAFFOLD-001 |
| SCAFFOLD-006 | S | Create packages/ui (shadcn/ui + Radix UI, Tailwind config, ESM + CJS build) | SCAFFOLD-001 |
| SCAFFOLD-007 | S | Create packages/api-client (openapi-typescript + openapi-fetch, apiClient factory with httpOnly cookie + X-Tenant-ID middleware) | SCAFFOLD-001 |
| SCAFFOLD-008 | XS | Create packages/shared-types (UserRole, TenantTier, ReservationStatus, VehicleStatus) | SCAFFOLD-001 |
| SCAFFOLD-009 | XS | Create packages/eslint-config (extends next/core-web-vitals + @typescript-eslint/recommended) | SCAFFOLD-001 |
| SCAFFOLD-010 | S | Dockerfile for API service (multi-stage, Python 3.12-slim, non-root uid 1000, HEALTHCHECK, arm64-compatible) | SCAFFOLD-002 |
| SCAFFOLD-011 | S | Dockerfile for Celery workers (same base as API, CMD driven by WORKER_QUEUES env var) | SCAFFOLD-002 |
| SCAFFOLD-012 | XS | docker-compose.yml for local dev (api, 3 workers, beat, postgres:16, redis:7, pgbouncer) | SCAFFOLD-010, SCAFFOLD-011 |
| SCAFFOLD-013 | XS | turbo.json pipeline config (build→^build, test→build, lint parallel, dev no cache) | SCAFFOLD-001 |

---

## EPIC: Database Foundation

| ID | Size | Title | Dependencies |
|---|---|---|---|
| DB-001 | XS | Install PostgreSQL extensions (uuid-ossp, btree_gist, pgcrypto, pg_partman, pg_cron) | SCAFFOLD-002 |
| DB-002 | S | Create all 15 enum types (reservation_status, vehicle_status, vehicle_block_type, damage_severity, claim_status, payment_method, payment_status, user_role, rate_type, fleet_type, depreciation_method, fuel_type, transmission_type, kyc_status, audit_action) | DB-001 |
| DB-003 | XS | Create public, audit, archive schemas; REVOKE on audit/archive; create app_service role | DB-001 |
| DB-004 | S | Create tenants table with idx_tenants_slug partial index | DB-003 |
| DB-005 | S | Create locations table with RLS policy (tenant_isolation) | DB-004 |
| DB-006 | M | Create vehicles table (50+ columns), 5 partial indexes, RLS | DB-005, DB-002 |
| DB-007 | S | Create vehicle_status_log table with indexes | DB-006 |
| DB-008 | S | Create vehicle_blocks table with btree_gist exclusion constraint (no_overlapping_vehicle_blocks), GiST index, RLS | DB-006, DB-001 |
| DB-009 | M | Create customers table (PII columns, anonymized_at, GIN fulltext index, partial unique on email), RLS | DB-005, DB-002 |
| DB-010 | M | Create reservations table (all pricing snapshot columns, 6 indexes, uq_confirmation_number, CHECK constraints), RLS | DB-009, DB-006, DB-002 |
| DB-011 | S | Create reservation_versions table (FK to reservations, uq_res_version) | DB-010 |
| DB-012 | M | Create rental_agreements table (self-ref FKs for swap pair, 4 indexes), RLS | DB-010, DB-006, DB-009 |
| DB-013 | S | Create payments table (CHECK on payment_type + gateway, 3 indexes), RLS | DB-012, DB-002 |
| DB-014 | M | Create damage_claims table (uq_claim_reference_tenant, 4 indexes), RLS | DB-012, DB-006, DB-009, DB-002 |
| DB-015 | S | Create rate_codes table (uq_rate_code_tenant, chk_valid_range, GDS fields), RLS | DB-005, DB-002 |
| DB-016 | S | Create rate_schedule_items table (FK to rate_codes ON DELETE CASCADE, idx_rsi_rate_code) | DB-015 |
| DB-017 | S | Create vehicle_classes table (tenant_id nullable for system reference classes) | DB-006 |
| DB-018 | S | Create extras_catalog table (tenant_id nullable, code UNIQUE) | DB-003 |
| DB-019 | S | Create tax_templates table (tenant_id nullable, jurisdictions JSONB), FK from locations | DB-005 |
| DB-020 | S | Create notification_templates table (UNIQUE on tenant_id + event_code + channel) | DB-003 |
| DB-021 | S | Create staff_roles and staff_users tables; add FKs from vehicle_status_log and vehicle_blocks | DB-005, DB-002 |
| DB-022 | S | Create processed_webhooks table for Stripe idempotency (event_id TEXT PK) | DB-003 |
| DB-023 | M | Create audit.audit_events partitioned table (PARTITION BY RANGE event_time, compound PK); REVOKE UPDATE/DELETE/TRUNCATE from all roles | DB-003, DB-002 |
| DB-024 | S | Configure pg_partman for audit.audit_events (monthly, premake=3, pg_cron maintenance at 02:30 UTC) | DB-023 |
| DB-025 | S | Create telematics_events partitioned table; configure pg_partman (monthly, 12-month retention, auto-drop) | DB-003 |
| DB-026 | S | Create notification_log partitioned table; configure pg_partman (monthly, 12-month retention, body_hash only for GDPR) | DB-003 |
| DB-027 | M | Implement audit.log_changes() SECURITY DEFINER trigger function; install on 7 tables (reservations, rental_agreements, payments, vehicles, damage_claims, customers, rate_codes) | DB-023, DB-010–DB-015 |
| DB-028 | S | Create archive schema mirror tables (LIKE public.X INCLUDING ALL + archived_at column); create archive.object_registry | DB-012, DB-010, DB-013, DB-014, DB-009 |
| DB-029 | S | Implement archive.run_archive_job() stored procedure; pg_cron at 02:00 UTC daily | DB-028 |
| DB-030 | M | Create all 10 critical indexes from §7 of DATABASE_ARCHITECTURE.md (all via CREATE INDEX CONCURRENTLY) | DB-008–DB-015, DB-023 |
| DB-031 | M | Configure Alembic env.py (async SQLAlchemy, naming conventions, include_schemas=True, transaction_per_migration=True) | SCAFFOLD-002, DB-001 |
| DB-032 | M | Implement seed data migration (12 SIPP vehicle classes, 9 extras catalog, CA-Airport tax template, 30 notification template placeholders, all staff roles with permissions_json) — idempotent (ON CONFLICT DO NOTHING) | DB-017–DB-021 |
| DB-033 | S | Configure PgBouncer sidecar (transaction-mode pooling, pool_size=20, listen 5432) | SCAFFOLD-012 |
| DB-034 | S | Create RLS policies for remaining domain tables (vehicle_classes, extras_catalog, rate_schedule_items, reservation_versions, notification_log, telematics_events) | DB-016–DB-026 |

---

## EPIC: FastAPI Application Foundation

| ID | Size | Title | Dependencies |
|---|---|---|---|
| API-001 | S | Implement app factory (create_app(), CORSMiddleware, 15 domain router registration, init_tracing) | SCAFFOLD-002 |
| API-002 | S | Implement app/core/config.py (pydantic-settings BaseSettings, all secrets as SecretStr) | SCAFFOLD-002 |
| API-003 | S | Implement app/core/database.py (create_async_engine, asyncpg, get_session generator with 5 GUC injections) | API-002 |
| API-004 | M | Implement JWT auth: login/refresh/logout/me endpoints; httpOnly Secure SameSite=Strict cookies; jti in Redis revoked_tokens | API-003 |
| API-005 | S | Implement get_current_user dependency (httpOnly cookie decode, Redis revocation check, TokenClaims dataclass) | API-004 |
| API-006 | S | Implement require_permission RBAC dependency factory (permission matrix cached from DB at startup) | API-005 |
| API-007 | S | Implement BaseRepository[ModelT] (generic, tenant-isolated _tenant_filter, get/list/create/update/soft_delete) | API-003 |
| API-008 | S | Implement RFC 7807 error handler (AppError base class + domain subclasses, Content-Type: application/problem+json) | API-001 |
| API-009 | S | Implement GET /health (DB ping + Redis ping, 503 on failure); request ID middleware (UUID4 injection) | API-003 |
| API-010 | XS | Domain stub: auth module (router/service/repository, LoginRequest/TokenResponse/UserProfile schemas) | API-001 |
| API-011 | XS | Domain stub: fleet module (VehicleBlock ORM model with ExcludeConstraint, ConnectionManager WebSocket) | API-007 |
| API-012 | XS | Domain stub: reservations module (Reservation model, CRUD endpoints, require_permission) | API-007 |
| API-013 | XS | Domain stub: checkout module (POST /checkout, POST /check-in stubs) | API-007 |
| API-014 | XS | Domain stub: customers module (Customer model, CustomerRepository extends BaseRepository) | API-007 |
| API-015 | XS | Domain stub: pricing module (RateCode + RateScheduleItem models, GET /quote stub) | API-007 |
| API-016 | XS | Domain stub: payments module (Payment model, ProcessedWebhook model, stripe_webhook.py structure) | API-007 |
| API-017 | XS | Domain stub: damage module (DamageClaim model) | API-007 |
| API-018 | XS | Domain stub: maintenance module (WorkOrder model, work-orders CRUD stubs) | API-007 |
| API-019 | XS | Domain stub: corporate module (CorporateAccount model, CRUD stubs) | API-007 |
| API-020 | XS | Domain stub: reporting module (GET /dashboard, POST /generate stubs) | API-007 |
| API-021 | XS | Domain stub: notifications module (dispatch_notification via redis.xadd to notifications:{tenant_id} stream) | API-007 |
| API-022 | XS | Domain stub: channels module (OTAChannelAdapter ABC with 4 abstract methods) | API-007 |
| API-023 | XS | Domain stub: admin module (outbound webhook HMAC delivery function) | API-007 |
| API-024 | XS | Domain stub: billing module (subscription management stubs) | API-007 |
| API-025 | S | Configure OpenAPI spec (stable operation IDs, servers array, all domain tags, TypeScript client generation verified) | API-001 |

---

## EPIC: Redis Setup

| ID | Size | Title | Dependencies |
|---|---|---|---|
| REDIS-001 | S | Availability cache cluster config (REDIS_AVAIL_URL, allkeys-lru, avail:{loc}:{class}:{bucket} namespace, 60s TTL, invalidation function) | API-002 |
| REDIS-002 | S | Celery broker cluster config (REDIS_BROKER_URL, noeviction, isolated pool) | API-002 |
| REDIS-003 | S | Session store cluster config (REDIS_SESSION_URL, volatile-lru, all key TTLs: session 8h/1h, otp 10min, preauth_lock 120s, dedup 5min, rate_quote 30s) | API-002 |
| REDIS-004 | XS | Redis key namespace constants and TTL constants module (redis_keys.py, no magic strings) | REDIS-001–003 |
| REDIS-005 | XS | Redis pub/sub channel conventions (fleet:{tenant}:{location}, notifications:{tenant} stream) | REDIS-001, API-011 |

---

## EPIC: Celery Infrastructure

| ID | Size | Title | Dependencies |
|---|---|---|---|
| CELERY-001 | S | Celery app config (5 queues: notifications/rate_filing/reports/batch/toll_processing, task routing, JSON serializer, result_expires=3600, worker_prefetch_multiplier=1) | REDIS-002 |
| CELERY-002 | S | Beat scheduler with RedBeat (8 scheduled tasks registered: renew_preauths/no_show/nhtsa_poll/doc_expiry/toll_batch/avail_rebuild/depreciation/preauth_report) | CELERY-001, REDIS-002 |
| CELERY-003 | XS | Task stub: renew_expiring_preauths (rate_filing queue, Stripe incremental auth placeholder, exponential backoff retry) | CELERY-001 |
| CELERY-004 | XS | Task stub: no_show_transition (notifications queue, SELECT FOR UPDATE SKIP LOCKED, dispatch notification) | CELERY-001, API-021 |
| CELERY-005 | XS | Task stub: nhtsa_recall_poll (batch queue, per-VIN NHTSA call, RECALL_HOLD block creation) | CELERY-001 |
| CELERY-006 | XS | Task stub: document_expiry_alerts (notifications queue, license_expiry < now+30d, per-customer notification) | CELERY-001 |
| CELERY-007 | XS | Task stub: toll_charge_batch (toll_processing queue, preauth_lock distributed lock) | CELERY-001 |
| CELERY-008 | XS | Task stub: availability_cache_rebuild (batch queue, all class×location permutations, must complete < 4 min) | CELERY-001, REDIS-001 |
| CELERY-009 | XS | Task stub: depreciation_journal_entries (batch queue, crontab day_of_month=1, idempotent) | CELERY-001 |
| CELERY-010 | XS | Task stub: pre_auth_expiry_report (reports queue, finance team notification) | CELERY-001 |

---

## EPIC: AWS Infrastructure

| ID | Size | Title | Dependencies |
|---|---|---|---|
| AWS-001 | L | Terraform module: vpc (VPC 10.0.0.0/16, 6 subnets across 2 AZs, IGW, 2 NAT GWs, VPC Flow Logs to S3 90d) | SCAFFOLD-001 |
| AWS-002 | M | Terraform module: alb (ALB, HTTPS listener, HTTP→HTTPS redirect, target group /health, WAF with OWASP+SQLi+rate limit 2000/5min) | AWS-001 |
| AWS-003 | M | Terraform module: ecs-api (ECS cluster, API task def cpu=1024/mem=2048, PgBouncer sidecar, all secrets from SM, auto-scaling CPU 60% target, min=3/max=20 prod) | AWS-002, AWS-001 |
| AWS-004 | M | Terraform module: ecs-workers (3 worker services: notifications/rate-filing/reports with correct CPU/mem/concurrency; Beat service desiredCount=1 no-scale) | AWS-003 |
| AWS-005 | M | Terraform module: rds (PostgreSQL 16.3, multi_az=true, gp3, 100GB→1TB auto, 35d PITR, deletion protection, parameter group tuning, read replica for reports) | AWS-001 |
| AWS-006 | M | Terraform module: elasticache (3 separate replication groups: avail-cache cluster-mode 3 shards, celery-broker 1+1, sessions 1+1; TLS+encryption) | AWS-001 |
| AWS-007 | S | Terraform module: s3-storage (4 buckets: documents/photos/reports/frontend, versioning, SSE, lifecycle Glacier, CORS, SSL-only policy) | AWS-001 |
| AWS-008 | S | Terraform module: cloudfront (SPA distribution via OAC, API distribution /api/* → ALB, HTTPS-only, TLSv1.2_2021, Brotli+GZIP) | AWS-007, AWS-002 |
| AWS-009 | S | Terraform module: secrets (all 7 secrets, auto-rotation for db-credentials 30d and jwt 90d, KMS CMKs per data classification) | AWS-001 |
| AWS-010 | S | Terraform module: iam (execution role + 3 task roles with least-privilege S3/SQS/KMS, no wildcard ARNs) | AWS-009 |

---

## EPIC: CI/CD Pipeline

| ID | Size | Title | Dependencies |
|---|---|---|---|
| CICD-001 | M | GitHub Actions test job (pytest + real postgres:16 + redis:7, ruff, mypy --strict, alembic upgrade --sql | check_lock_safety.py, coverage threshold 80%) | SCAFFOLD-002, DB-031 |
| CICD-002 | S | scripts/check_lock_safety.py (rejects SET NOT NULL without concurrent validation, CREATE INDEX without CONCURRENTLY, DROP COLUMN; exits 1 on violation) | SCAFFOLD-002 |
| CICD-003 | S | GitHub Actions build-push job (Docker Buildx arm64, ECR login via OIDC, sha-tagged image, outputs image URI) | CICD-001, SCAFFOLD-010 |

---

## EPIC: Integration Foundations

| ID | Size | Title | Dependencies |
|---|---|---|---|
| INT-001 | M | IntegrationClient base class (CircuitBreaker failure_threshold=5 recovery_timeout=60, @retry tenacity exponential+jitter, structlog on success, IntegrationCircuitOpenError) | API-002 |
| INT-002 | S | Stripe integration client (create/confirm/capture/cancel PaymentIntent, incremental auth; Stripe SDK not raw HTTP) | INT-001 |
| INT-003 | S | Stripe webhook handler with ProcessedWebhook idempotency (sig verification, event_id check, same-transaction commit) | INT-002, API-016, DB-022 |

---

## EPIC: Frontend Foundation

| ID | Size | Title | Dependencies |
|---|---|---|---|
| FE-001 | S | Shared UI package (shadcn/ui + Tailwind tokens, Radix components: Button/Input/Select/Dialog/Table/Badge/Card/Spinner, Storybook) | SCAFFOLD-006 |
| FE-002 | S | OpenAPI TypeScript client generation pipeline (openapi-typescript → schema.d.ts, apiClient with credentials:include + X-Tenant-ID, CI drift check) | SCAFFOLD-007, API-025 |
| FE-003 | S | AuthProvider + RouteGuard (httpOnly cookie /auth/me check, AuthContext, useAuth(), roles prop, FullPageSpinner) | FE-001, SCAFFOLD-008 |
| FE-004 | S | TanStack Query v5 setup in all 3 apps (staleTime=30s, retry=2 exponential, useApiQuery + useApiMutation hooks, ReactQueryDevtools in dev) | FE-002, FE-003 |
| FE-005 | S | Zustand stores (counter: modalState/currentStep/offlineQueue persist; admin: sidebarCollapsed/activeFilters/selectedItems) | SCAFFOLD-004, SCAFFOLD-005 |
| FE-006 | S | Scaffold Next.js 14 booking app pages (layout, home, search/page with ISR revalidate=60, booking/[id], confirmation, login; Suspense + skeletons) | FE-004, SCAFFOLD-003 |

---

## EPIC: Testing Infrastructure

| ID | Size | Title | Dependencies |
|---|---|---|---|
| TEST-001 | S | pytest async test database fixture (test engine, metadata.create_all, per-test transaction rollback, GUC set for test tenant, asyncio_mode=auto) | DB-031, API-003 |
| TEST-002 | S | pytest Redis mock fixture (fakeredis.aioredis.FakeRedis, patches get_redis, reset between tests) | API-005, REDIS-001 |
| TEST-003 | S | Celery eager mode fixture (task_always_eager=True, task_eager_propagates=True, stubs run synchronously) | CELERY-001 |
| TEST-004 | M | factory-boy model factories for all 12 core tables (SubFactory for FKs, Faker realistic data, async_session fixture) | TEST-001, DB-004–DB-016 |
| TEST-005 | XS | Coverage thresholds and reporting (fail_under=80, branch coverage, Codecov upload, HTML artifact, per-domain minimum 60%) | TEST-001 |

---

# Phase 1 — MVP

> Goal: One operator, one location, one counter agent processes the first rental to receipt. All items below must be shipped before any revenue.

---

## EPIC: Tenant & System Foundation

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| TNT-001 | MVP | M | Tenant CRUD + provisioning API (slug, legal name, currency, timezone, subscription tier, trial_ends_at) | Create/read/update/suspend; slug unique system-wide; first admin user created atomically with tenant | DB-004 |
| TNT-002 | MVP | L | Operator onboarding wizard (7 steps: company profile → location → payment gateway → rate code → RA template → staff invite → readiness gate) | All 7 steps must complete; wizard state persists across sessions; Step 7 gate enforces all 8 checklist items before first rental | TNT-001, PAY-001 |
| TNT-003 | MVP | M | Day-zero readiness gate enforcement (8 checks, real-time status, block rental creation until all green) | Each check links to the blocking configuration screen; gate recalculated on page load | TNT-002 |
| TNT-004 | MVP | M | Operator ToS / DPA acceptance flow (mandatory checkbox, stored with timestamp/IP/version, re-acceptance on version update) | Cannot proceed without acceptance; custom DPA for Enterprise; re-acceptance modal blocks login on ToS version update | TNT-001 |

---

## EPIC: Authentication & RBAC

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| AUTH-001 | MVP | M | JWT auth endpoints (POST /auth/login, /auth/refresh, /auth/logout, GET /auth/me) — httpOnly Secure SameSite=Strict cookies | Access 8h counter / 1h web; refresh 30d rotating; jti revoked in Redis on logout | API-004 |
| AUTH-002 | MVP | S | RBAC permission matrix (12 roles × resource/action matrix loaded from DB at startup, cached in memory) | Enforced at FastAPI dependency AND PostgreSQL RLS layers; no JWT payload permission claims | API-006, DB-021 |
| AUTH-003 | MVP | M | Staff account lifecycle (create/invite/activate/suspend/offboard with GDPR anonymization) | Activation email 24h expiry; suspension terminates sessions within 30s; offboard anonymizes PII | AUTH-001, AUTH-002 |
| AUTH-004 | MVP | S | Password reset (self-service 24h single-use link; admin-initiated force reset; bcrypt hash; complexity policy) | Self-service and admin paths; password never visible in admin UI | AUTH-001 |
| AUTH-005 | MVP | S | MFA enrollment (TOTP Google Authenticator compatible; required for admin roles; recovery codes at enrollment) | Failed MFA → lockout per policy; bypass only for explicitly exempt roles | AUTH-001 |
| AUTH-006 | MVP | M | Location scope assignment (staff_locations junction: staff_id × location_id × role_at_location) | Regional manager scope tied to region entity; RBAC checks combine role permissions with location scope | AUTH-002, LOC-001 |
| AUTH-007 | MVP | S | Session list and force logout (admin views all active sessions; terminate individual or all sessions for a user; logs in audit trail) | Next request receives 401; forced logout logged | AUTH-001, REDIS-003 |
| AUTH-008 | MVP | S | Failed login lockout (N consecutive failures within Y minutes → lock Z minutes; email alert to user + admin) | Lockout configurable; manual unlock by admin with audit entry | AUTH-001 |
| AUTH-009 | MVP | S | Audit trigger GUC injection per request (tenant_id, user_id, role, client_ip, request_id set via SET app.*) | All 5 GUCs set within get_session before any query; audit trigger reads all 5 | API-003, DB-027 |

---

## EPIC: Location Management

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| LOC-001 | MVP | L | Location CRUD (all fields: identity, GPS, hours/holiday schedule, timezone, financial, turnaround buffers, tax template, payment methods, security deposit rules) | short_code unique per tenant; time_zone used for all local time calcs; airport_code required for AIRPORT type | TNT-001 |
| LOC-002 | MVP | M | Hours of operation enforcement (hard block vs. soft warning on pickup outside hours; last rental out time < close) | Booking engine enforces per location policy; after-hours key drop instructions shown on RA | LOC-001 |
| LOC-003 | MVP | S | Tax template assignment to location (link to tax_template_id; inherit from tenant default if not set) | Tax calculation uses location's template; new rates create new records for history | LOC-001, DB-019 |
| LOC-004 | MVP | S | Payment methods accepted per location (credit/debit/cash/digital wallet toggles; security deposit formula per method) | Debit: higher deposit; Cash: 1.5× estimated total + buffer, minimum configurable | LOC-001 |

---

## EPIC: Fleet & Vehicle Inventory

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| FLT-001 | MVP | L | Vehicle CRUD (full spec: VIN, plate, make/model/year, SIPP code, class, fuel type, transmission, seats, bags, fleet type, financial/depreciation fields, photos JSONB) | VIN unique per tenant; uq_vehicle_vin_tenant enforced; all 50+ fields from DB schema | LOC-001, DB-006 |
| FLT-002 | MVP | M | Vehicle entry wizard — 5-step (Step 1: identity + VIN decode via NHTSA vPIC; Step 2: spec + photos; Step 3: classification + class/SIPP; Step 4: financial/depreciation; Step 5: operational setup + PDI work order) | NHTSA auto-fills make/model/year/body/transmission/fuel; wizard blocks activation until PDI WO closed | FLT-001, INT-NHTSA |
| FLT-003 | MVP | M | Vehicle status state machine — 14 states (STAGING → AVAILABLE → ON_RENT → RETURNING → READY_FOR_INSPECTION → CLEANING → MAINTENANCE → IN_REPAIR → DAMAGE_HOLD → ADMIN_HOLD → PENDING_DISPOSAL → DISPOSED → PENDING_DELIVERY → CHARGING) | DB trigger rejects invalid transitions; every transition logged in vehicle_status_log with actor and reason | FLT-001, DB-007 |
| FLT-004 | MVP | M | Vehicle blocks CRUD (create/read/soft-delete blocks; exclusion constraint prevents overlap; half-open range [) for back-to-back) | VehicleNotAvailableError (RFC 7807 409) on exclusion constraint violation; block types enforced | FLT-001, DB-008 |
| FLT-005 | MVP | M | Vehicle class & SIPP code configuration (system-level classes seeded; operator can add custom classes; upgrade matrix: each class auto-upgrades to next) | All 12 SIPP codes seeded from DB-032; upgrade matrix stored as configurable per tenant | FLT-001, DB-017 |
| FLT-006 | MVP | S | Vehicle availability calculation (available_count per class per location = total_available − active_blocks − overbooking_buffer; cached in Redis 60s) | Cache invalidated on any reservation state change or vehicle status mutation | FLT-004, REDIS-001 |
| FLT-007 | MVP | M | Vehicle photo management (S3 upload via presigned URL; primary photo designation; inspection photo types: pre/post/damage/exterior/interior) | Photos stored immutably with SHA-256 hash; S3 presigned URL 15min TTL; primary photo shown in booking engine | FLT-001, AWS-007 |
| FLT-008 | MVP | M | Bulk vehicle import (CSV template download; pre-validation row-by-row before any import; VIN decode per row; duplicate VIN detection; import report: created/error/skipped counts) | Import is transactional; all-or-nothing per batch; error report with row numbers | FLT-001 |
| FLT-NHTSA | MVP | S | NHTSA vPIC VIN decode integration (decode_vin endpoint, maps to make/model/year/body/transmission/fuel_type; no auth) | Called at Step 1 of vehicle entry wizard; populates spec fields; non-blocking (manual override if NHTSA unavailable) | INT-001 |

---

## EPIC: Reservations & Booking Engine

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| RES-001 | MVP | XL | Availability search API (GET /fleet/availability: class × location × date range; filters by class/features; checks vehicle_blocks with GiST range query; respects overbooking buffer; Redis cached 60s; p95 < 300ms) | Availability cache miss falls back to direct DB query with warning banner; cache invalidated on write | FLT-006, REDIS-001 |
| RES-002 | MVP | XL | Booking creation flow (POST /reservations: class selection, extras, rate quote, taxes via Avalara, total calculation, confirmation number generation, availability re-check at commit with advisory lock) | Confirmation number globally unique (uq_confirmation_number); race condition protected by Redis rate_quote:{hash} 30s TTL; exclusion constraint on vehicle_blocks as final guard | RES-001, RTE-001, PAY-001 |
| RES-003 | MVP | M | Reservation confirmation (CONFIRMED status, block created in vehicle_blocks, pre-auth initiated, confirmation email sent) | Reservation → CONFIRMED atomically with vehicle block creation; pre-auth initiated within 60s; email sent | RES-002, PAY-002 |
| RES-004 | MVP | M | Guest checkout (complete booking without account; required: first/last name, email, phone; post-booking account creation prompt) | Guest booking gets "Manage My Booking" token in email; no account required; conversion tracked | RES-002 |
| RES-005 | MVP | L | Reservation modification (date change, class change, extras change: availability re-check, re-quote, new version created in reservation_versions, notification sent) | New version row for every confirmed modification; old version immutable; pre-auth adjusted | RES-002, DB-011 |
| RES-006 | MVP | M | Cancellation flow (cancellation policy applied, refund calculated and previewed, payment voided/refunded, block soft-deleted, status → CANCELLED, email sent) | Cancellation fee calculated correctly per policy; block deleted releases exclusion constraint | RES-005, PAY-005 |
| RES-007 | MVP | M | "Manage My Booking" token-based portal (time-limited signed token in confirmation email; view, cancel, download PDF, add extras T-24h before pickup — no login required) | Token valid 72h after pickup; token-based access logged in audit trail; expired token → login redirect | RES-002 |
| RES-008 | MVP | M | No-show handling (Celery task at grace period end transitions CONFIRMED → NO_SHOW; no-show fee charged; email sent; vehicle block released) | Grace period configurable per location (default 120 min); no-show fee applied per rate code policy; SELECT FOR UPDATE SKIP LOCKED for idempotency | RES-002, CELERY-004 |
| RES-009 | MVP | S | Walk-up (no reservation) counter flow — distinct from advance reservation (real-time availability check, walk-up rate auto-applied, single uninterrupted flow, RA emailed immediately) | Walk-up rate code configurable per location; available with manager override | RES-002, CTR-001 |

---

## EPIC: Rate Engine

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| RTE-001 | MVP | XL | Rate quote engine (base rate from rate_schedule_items per class/duration, day-of-week modifiers, advance booking restrictions, extras pricing, location fees: ACRF/CFC/VLF, Avalara tax calculation, total with ISO 4217 half-up rounding) | Rate calculation deterministic; intermediate values 6 decimal places; final line-items rounded; rate_quote cached 30s in Redis | DB-015, DB-016, RTE-002 |
| RTE-002 | MVP | L | Rate code creation wizard — 7 steps (Step 1: identity/type; Step 2: validity dates/blackout; Step 3: applicability scope; Step 4: restrictions/booking windows; Step 5: cancellation policy; Step 6: rate schedule per class per duration; Step 7: review/activate) | Rate codes land in DRAFT; activation requires no active validation errors; GDS fields required if gds_eligible=true | DB-015, DB-016 |
| RTE-003 | MVP | M | Corporate rate (CDP code): enter CDP code at booking → look up matching active rate code → apply corporate pricing | CDP code unique system-wide; PC code companion supported; error shown if CDP not found or expired | RTE-002, CORP-001 |
| RTE-004 | MVP | M | Promotional codes (promo code CRUD, max uses total/per-customer, combinability flag, validation at booking, uses_count increment) | Single-use enforcement via uses_count with SELECT FOR UPDATE; combinability checked before applying | RTE-002 |
| RTE-005 | MVP | M | Extras pricing (extras_catalog CRUD, per-day/per-rental pricing types, per-location overrides, physical extras inventory tracking) | Disabled extras not shown in booking engine; physical extras availability checked (GPS units, child seats) | DB-018, LOC-001 |
| RTE-006 | MVP | S | Avalara AvaTax integration — tax calculation with SHA-256 cache (cache key = hash of location + line items + address; 1h TTL) | Cached result returned on hit; Avalara API called on miss; tax result stored on reservation in taxes_snapshot JSONB | INT-001, RTE-001 |
| RTE-007 | MVP | S | Location fees configuration (ACRF: % of base or flat; CFC: flat/day; VLF: % or flat/day with cap; all mandatory at airport/ConRAC locations; distinct line items on invoice) | Fee schedule versioned with effective dates; historical fee preserved on existing reservations | LOC-001, RTE-001 |

---

## EPIC: Extras & Ancillaries

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| EXT-001 | MVP | M | Extras catalog (CDW/LDW/SLI/PAI/RSA, GPS/CSS/TOLL/PPFP seeded; CRUD for custom extras; per-day vs per-rental pricing; tax treatment) | All 9 extras seeded from DB-032; operator can add custom extras; extras linked to reservations via extras_snapshot | DB-018 |
| EXT-002 | MVP | M | CDW/LDW product configuration (deductible amount, coverage terms, full exclusions list, mandatory disclosure screen before accept/decline) | Disclosure screen shown before CDW presentation; customer acknowledgement logged with timestamp; declination workflow creates signed declination record | EXT-001 |
| EXT-003 | MVP | S | Protection product disclosure acknowledgment (scroll-to-bottom + "I have read the disclosure" required before accept/decline; logged with timestamp/channel/customer/RA) | Logged to audit trail; compliance for California § 1936 | EXT-002 |
| EXT-004 | MVP | S | Upsell at counter (extras selection screen in checkout with running total; counter agent can add/remove extras; extras locked on RA post-checkout) | Extras prices shown per day and total for rental duration; locked post-checkout except via modification | EXT-001, CTR-001 |

---

## EPIC: Payments & Billing

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| PAY-001 | MVP | L | Stripe pre-authorization (CreatePaymentIntent capture_method=manual, MCC 7512, amount=deposit; PaymentIntent ID stored; auth_expiry_at computed; payment row AUTHORIZED) | Pre-auth within 60s of confirmation; pre-auth amount = deposit_amount from rate quote; VehicleBlock created atomically | INT-002, RES-002 |
| PAY-002 | MVP | M | Stripe payment capture at return (CapturePaymentIntent amount=final_total; payment row → CAPTURED; receipt email sent; rental_agreement → CLOSED) | Final total computed at return (base + extras + time extension + fuel + mileage overage − paid deposit); overage charged | PAY-001, CTR-002 |
| PAY-003 | MVP | M | Stripe pre-auth renewal (Celery task every 6h queries AUTHORIZED payments where auth_expiry_at < now+24h; IncrementalAuthorizationRequest; Network Transaction ID stored for chaining) | Network Transaction ID (NTI) stored on payment for incremental auth chain; failed renewal alert to agent | PAY-001, CELERY-003 |
| PAY-004 | MVP | M | Stripe webhook handler with ProcessedWebhook idempotency (payment_intent.succeeded, .payment_failed, charge.dispute.created, charge.refunded; idempotency via event_id check) | Same transaction as domain handler; 200 on already_processed; 400 on invalid signature | INT-003, DB-022 |
| PAY-005 | MVP | M | Refund processing (void on pre-auth; partial/full refund on captured; refunded_amount tracked; refund reason code required; approval routing for amounts above threshold) | Cancellation policy determines refund amount; approval for refunds > $500 | PAY-002 |
| PAY-006 | MVP | M | Invoice generation (sequential invoice number, line items: base rental/extras/fees/taxes, payments, net due; PDF generated via WeasyPrint; S3 storage; emailed to customer) | Invoice generated at return and on demand; PDF accessible for 3 years; presigned URL 15min TTL | PAY-002, AWS-007 |
| PAY-007 | MVP | M | Cash payment handling (deposit collection at checkout, deposit receipt, refund = deposit − charges at return, shift reconciliation, variance > $5 requires note) | Vehicle not releasable until cash deposit recorded; petty cash fund with disbursement log | PAY-001, CTR-001 |
| PAY-008 | MVP | M | PCI DSS SAQ A controls (Stripe.js hosted fields in iframe, API receives only pm_xxx token, DB stores last4/brand/expiry/token only, no raw PAN path) | CSP headers prevent unauthorized scripts; Stripe Terminal P2PE for counter readers; nothing in CDE scope | INT-002, FE-001 |
| PAY-009 | MVP | S | GL journal entries — 23 transaction types (ASC 606: pre-auth memo-only, deposit → Liability, capture → Revenue daily straight-line, refund reversal, toll/fee recognition, damage charge, LOU) | All 23 entry types auto-posted on triggering event; GL account codes configurable; entries posted within 60s | PAY-001–PAY-006 |
| PAY-010 | MVP | S | EOD financial reconciliation checklist (7 steps: processor settlement CSV match, cash reconciliation, pre-auth orphan detection, ASC 606 confirmation, tax accrual, AR update, open exceptions) | EOD report: transactions by payment method, revenue by category, tax collected, pre-auth outstanding, cash variance, unmatched processor items | PAY-009, CTR-003 |

---

## EPIC: Counter Operations

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| CTR-001 | MVP | M | Counter checkout flow (customer lookup by name/email/phone/DL → DNR check → vehicle assignment → extras selection → pre-auth confirm → digital RA generation → key handover) | DNR check at checkout blocks if network-scope DNR flag; vehicle cannot be dispatched until pre-auth confirmed | RES-002, CUS-001, PAY-001 |
| CTR-002 | MVP | M | Counter check-in / return flow (odometer/fuel in, time extension charges, vehicle inspection form, payment capture, receipt email, vehicle → READY_FOR_INSPECTION) | Running late fee calculated in real time; vehicle cannot be returned without inspection form completion; receipt sent within 60s | CTR-001, PAY-002, INS-INSP-001 |
| CTR-003 | MVP | M | Shift open procedure (mandatory at first login: cash drawer balance, fleet lot count, pending pickups for 4h, overdue returns; all logged: time/agent/opening cash/fleet count snapshot) | Checklist cannot be skipped; shift start logged | AUTH-001 |
| CTR-004 | MVP | M | Shift close + EOD (cash count reconciliation, shift-end report emailed to manager, daily settlement summary after last shift) | Variance > $5 requires required note; shift-end report: rentals in/out, cash/card totals, discounts, extras, damage incidents | CTR-003, PAY-010 |
| CTR-005 | MVP | M | Overdue return escalation (overdue dashboard on branch manager home; automated comms at 4 configurable thresholds: 30min/2h/4h/1d/3d; incremental auth on near-expiry pre-auth; 3d threshold → Potential Missing Vehicle flag) | Thresholds configurable per location; agent phone contact logged; running late fee total visible on rental | PAY-003, NOTIF-001 |
| CTR-006 | MVP | M | Driver's license validation — barcode scan / manual entry (PDF417 barcode scan auto-populates DL fields; expiry hard-block; underage hard-block; DNR match on license number) | Barcode scan via USB scanner or camera; manual entry fallback for foreign licenses; IDP required flag shown for non-English countries | CUS-001 |
| CTR-007 | MVP | M | Vehicle swap mid-rental (reason dropdown, partial charge for original vehicle, replacement vehicle selection with availability check, abbreviated pre-delivery inspection, new RA linked as swap pair, pre-auth transferred) | Two RAs permanently linked; single invoice combining both; charges shown per vehicle | CTR-001, FLT-004 |

---

## EPIC: Customer Management

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| CUS-001 | MVP | L | Customer profile CRUD (PII: name/email/phone/DOB/nationality; driver's license fields; KYC status; account_status; account_type; preferred class; communication preferences; GDPR anonymized_at) | Email unique per tenant (case-insensitive partial index); anonymization replaces PII with placeholders; cannot be undone | DB-009 |
| CUS-002 | MVP | M | DNR (Do Not Rent) flag management (add/remove/review: reason code, scope [LOCATION/REGIONAL/NETWORK], expiry, documentation; checked at reservation creation and counter checkout; customer not notified) | DNR check at booking blocks silently (no reason shown to customer); counter checkout shows specific DNR reason to agent | CUS-001, AUTH-002 |
| CUS-003 | MVP | M | Customer service tools for agents (rental history, payment history, complaint log, loyalty balance, outstanding claims, "Book on behalf of customer" quick-create) | Accessible to Counter Agent and above; PII visible per role; customer merge for duplicate detection | CUS-001, AUTH-002 |
| CUS-004 | MVP | S | GDPR right to erasure (check legal holds first; if clear: anonymize PII columns, set anonymized_at; transactional records retained; operation logged; cannot be undone) | Legal hold (active dispute, unpaid claim, within retention period) blocks erasure | CUS-001, DB-028 |
| CUS-005 | MVP | M | Customer login portal (email + password, Google Sign-In, Apple Sign-In, magic link; social login email dedup; guest booking linked on first login if same email) | WCAG 2.1 AA compliant; accounts locked after failed attempts per AUTH-008 | CUS-001, AUTH-001 |

---

## EPIC: Damage & Inspections (MVP)

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| INS-INSP-001 | MVP | M | Pre-rental inspection form (22-zone structured data entry: condition per zone, damage type if damaged, severity 1–5; form linked to RA; required before checkout completes) | All 18 damage types from spec available; Grade 5 triggers total-loss workflow flag; form cannot be skipped | CTR-001, DB-014 |
| INS-INSP-002 | MVP | M | Post-rental inspection form with pre/post comparison panel (system shows pre-rental baseline alongside post-rental entry; zone discrepancies auto-flagged; new damage creates damage_claims record) | Pre-existing damage zones highlighted for agent; only new zones flagged; comparison panel side-by-side | INS-INSP-001 |
| INS-INSP-003 | MVP | M | Photo capture with geo-tag and device fingerprint (each photo: timestamp, lat/lng, device fingerprint, SHA-256 hash; immutable after upload; S3 storage) | Minimum 1 photo per damaged zone; photos stored with content hash for integrity | INS-INSP-001, AWS-007 |
| INS-INSP-004 | MVP | M | SVG vehicle diagram with interactive damage marking and customer e-signature (customer sees pre-existing highlights; new damage marked; customer signs digitally with IP/GPS/device fingerprint/document hash) | Signature required before rental agreement is finalized; signature stored as exhibit | INS-INSP-001, INS-INSP-003 |
| DMG-001 | MVP | M | Damage claim record creation (auto-created on post-rental damage discovery; system-generated CLM-YYYYMMDD-XXXXX; links RA/vehicle/customer/inspector/photos/CDW status) | Claim links all relevant records; CDW status read from RA extras snapshot | INS-INSP-002, DB-014 |
| DMG-002 | MVP | S | Damage claim state machine (OPEN → ESTIMATE_SENT → CUSTOMER_ACKNOWLEDGED → REPAIR_IN_PROGRESS → REPAIR_COMPLETE → INVOICED → PAID / DISPUTED / IN_LITIGATION / WRITTEN_OFF; DB trigger enforces valid transitions) | All transitions audited with actor/timestamp/reason; Grade 4 escalates to regional; Grade 5 triggers total-loss | DMG-001 |
| DMG-003 | MVP | M | CDW/LDW coverage determination on claim creation (checks RA for CDW; auto-determines claim type; flags CDW void conditions: DUI/unauthorized driver/off-road/wrong fuel/excluded damage types) | Coverage determination logged on claim; void conditions shown clearly to claims coordinator | DMG-001, EXT-002 |
| DMG-004 | MVP | S | Automatic vehicle status → Damage Hold on new damage discovery (any post-rental damage creates hard DAMAGE_HOLD vehicle block; cannot be bypassed without claim resolution; vehicle removed from availability cache) | Block created within 60s of claim creation; cache invalidated immediately | DMG-001, FLT-004, REDIS-001 |

---

## EPIC: Notification System (MVP)

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| NOTIF-001 | MVP | L | Redis Streams notification pipeline (dispatch_notification → xadd to notifications:{tenant_id} stream; worker group with at-least-once delivery; maxlen=10,000; DLQ via Celery; stream lag alarm if > 500) | All notifications flow through this pipeline; no direct SendGrid/Twilio calls from business logic | REDIS-001, CELERY-001 |
| NOTIF-002 | MVP | M | Email dispatch via SendGrid (Jinja2 HTML template render, SendGrid transactional API v3, delivery events via SendGrid webhook → notification_log, DKIM/SPF configured) | All transactional emails go through SendGrid; delivery status tracked per notification | NOTIF-001, INT-NOTIF-SG |
| NOTIF-003 | MVP | M | SMS dispatch via Twilio (Twilio API, delivery status webhook → notification_log, E.164 formatting enforced, error codes mapped to failure reasons) | SMS for overdue return alerts, pre-auth expiry, damage notifications | NOTIF-001, INT-NOTIF-TW |
| NOTIF-004 | MVP | M | 30 canonical notification templates seeded and working (all 30 events from FEATURES.md §40.7 seeded, triggers wired, all merge variables resolved at send time, all 30 testable via admin test-send) | All 30 templates seeded from DB-032; operator can customize via template editor | NOTIF-002, NOTIF-003 |
| NOTIF-005 | MVP | M | Notification template management UI (WYSIWYG editor, merge variable insertion, preview with sample data, test send, versioning, Draft → Preview → Publish) | Located in admin settings; changes logged in audit trail | NOTIF-004, AUTH-002 |
| NOTIF-006 | MVP | M | Delivery tracking in notification_log (event_code, recipient_id, channel, body_hash SHA-256 only, sent_at, delivery_status, failure_reason; partitioned monthly, 12-month retention) | Body not stored (GDPR); hash for integrity verification; partitioned per DB-026 | NOTIF-001, DB-026 |

---

## EPIC: System Configuration

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| SYS-001 | MVP | L | System configuration admin UI (Operator Profile, Locations, Vehicle Classes, Extras Catalog, Cancellation Policies, Turnaround Buffers, Tax Templates, Password/Session Policy; all changes logged in audit) | All configuration requires System Admin or Super Admin role; all changes logged | AUTH-002 |
| SYS-002 | MVP | M | Approval queue engine (item types: refund/discount override/damage auth/work order/account credit/DNR/rate activation; auto-routing; approve/reject/return; SLA timers; audit trail) | Refund > $500 auto-routes to Branch Manager; SLA breach escalates; submitter notified within 5min | AUTH-002 |
| SYS-003 | MVP | S | Training mode per location (Super Admin toggle; TRAINING MODE red non-dismissible banner; simulated payment gateway; no real notifications; training data excluded from reports; Reset button) | Training rental agreements watermarked "TRAINING — NOT A VALID AGREEMENT"; training mode flag on all records | SYS-001 |

---

## EPIC: Audit & Security (MVP)

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| AUD-001 | MVP | M | Audit log viewer (search by date/actor/action type/resource type/resource ID/location/IP; before/after diff for updates; < 2s for 90-day range) | System Admin role required; immutable (no edit/delete in UI) | DB-023, AUTH-002 |
| AUD-002 | MVP | M | Audit log CSV/PDF export (async for > 10,000 rows, email notification on completion; every export logged in audit trail) | Sensitive exports generate security alert visible in admin | AUD-001 |

---

## EPIC: Branch Dashboard (MVP)

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| RPT-DASH-001 | MVP | M | Branch manager home dashboard (today's pickups/returns, on-rent count, overdue returns, fleet availability by class, revenue today/week/month, open damage claims, staff on shift; read replica; WebSocket 30s refresh) | Role determines visible panels; read replica for all queries; < 5s load | AUTH-002, DB-005 |
| RPT-CORE-001 | MVP | M | Core revenue and utilization reports (Revenue by Category/Location/Class/Channel; Fleet Utilization: rental days / available fleet days × 100, ADR, RevPACD; read replica; CSV + PDF export) | Utilization and ADR calculated correctly; accessible by Branch Manager and above | DB-010, DB-012 |

---

## EPIC: SaaS Billing (MVP)

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| SAAS-001 | MVP | M | Stripe Billing subscription management (Starter/Professional/Enterprise; per-plan limits; self-serve upgrade/downgrade with prorated billing; operator Stripe Billing account separate from rental Stripe account) | Annual vs. monthly toggle; plan limits enforced via feature flags | TNT-001 |
| SAAS-002 | MVP | M | 14-day free trial mode (no credit card required; trial banner; automated emails at T-7/T-3/T-1; after expiry: soft-lock with upgrade prompt; trial = Enterprise-level access) | Trial banner visible on all pages; cannot be dismissed | SAAS-001 |
| SAAS-003 | MVP | S | Feature gating by subscription tier (disabled features visible but grayed out with upgrade CTA; gate enforced at API layer not only UI; flags per tenant in DB) | Trials bypass all gates; gating not a security boundary (RBAC is) | SAAS-001 |
| SAAS-004 | MVP | M | Operator billing dashboard (plan, renewal date, usage metrics with limits, invoice history downloadable PDF, update payment method, cancellation retention prompt) | Usage: locations/vehicles/reservations/API calls vs. plan limits | SAAS-001 |

---

## EPIC: Technical Completions (MVP)

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| TECH-001 | MVP | M | Full CI/CD pipeline (test → build-push → deploy-staging → smoke-tests → approval gate → deploy-prod; CodeDeploy blue/green; auto-rollback on health check failure; Terraform plan as PR comment) | Blue fleet retained 15 min after cutover; migration expand-phase only at deploy; CICD-002 lock-safety gate in CI | CICD-001–CICD-003, AWS-003 |
| TECH-002 | MVP | M | SLA monitoring and measurement (CloudWatch custom metrics per SLA target: API p95 < 800ms, counter checkout p95 < 500ms, avail search p95 < 300ms, notification delivery < 60s; monthly SLA report; PagerDuty on breach) | Planned maintenance excluded if posted to status page ≥ 48h prior | AWS-011, OBS-001 |
| TECH-003 | MVP | S | Database constraint integration tests (pytest tests: exclusion constraint blocks overlap, state machine trigger rejects invalid transitions, VIN uniqueness, confirmation number uniqueness, audit table rejects UPDATE/DELETE) | Real PostgreSQL in GitHub Actions; all 5 constraint tests must pass | TEST-001, DB-008–DB-027 |
| TECH-004 | MVP | M | AWS Secrets Manager and monitoring (CloudWatch alarms for 7 metrics from §9.3, SNS → PagerDuty, Datadog APM, structlog JSON, OTel tracing) | All 7 alarms active; Datadog traces spans from FastAPI/SQLAlchemy/Redis | AWS-009–AWS-011, OBS-001–OBS-002 |

---

# Phase 2 — Commercial Launch

> Goal: Multi-location operation, full damage/claims lifecycle, loyalty, compliance, OTA channels, customer self-service portal, counter operations completions, financial/regulatory readiness.

---

## EPIC: Damage Claims — Full Lifecycle

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| DMG-011 | P2 | M | Repair estimate entry (multiple estimates, comparison view, tiered authorization routing per threshold: agent/$0, manager/$500, coordinator/$2,500, regional/$10k) | Estimate above threshold auto-routes to correct approval queue; repair authorization doc generated on approval | DMG-002, SYS-002 |
| DMG-012 | P2 | M | Loss-of-use calculation (LOU = daily rate × down days × utilization factor; full if util ≥ 80%, pro-rated below; running LOU visible on claim; LOU summary doc generated) | LOU calculated from damage_hold_date to available_date; utilization factor from fleet reports | DMG-001 |
| DMG-013 | P2 | S | Admin fee / handling fee (configurable flat fee added to claim total; shown as line item on demand letter) | Fee configurable per operator | DMG-001 |
| DMG-014 | P2 | M | Customer damage notification workflow (initial notice, estimate notice, demand letter pre-populated from claim; all notifications logged; customer response status tracked) | Method: email + certified mail for large claims; acknowledgement signature captured | DMG-001, NOTIF-001 |
| DMG-015 | P2 | M | Damage claim invoicing (separate damage invoice: repair + LOU + admin fee + deductible; charged to card on file; receipt issued; claim → INVOICED → PAID) | Damage invoice distinct from rental invoice; payment linked to claim | DMG-011, PAY-002 |
| DMG-016 | P2 | M | Third-party insurance claim processing (carrier/policy/claim number/adjuster; correspondence log; documentation package one-click export; settlement offer tracking) | Documentation package: pre/post photos + RA + estimate + LOU | DMG-001 |
| DMG-017 | P2 | M | Chargeback handling (auto-create on Stripe webhook; 8-document evidence package PDF; response deadline countdown 7/3/1d alerts; win/loss recording with GL entries) | Evidence package: signed RA, pre/post inspection + photos, CDW waiver, repair estimate, notification timeline | DMG-001, PAY-004 |
| DMG-018 | P2 | M | Damage reports (open claims aging 0–30/31–60/61–90/90+; recovery rate; LOU report; chargeback win/loss; incident frequency per 100 rentals; regional manager rollup) | All reports on read replica; CSV + PDF export | DMG-001–DMG-015 |

---

## EPIC: Maintenance Management

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| MNT-001 | P2 | L | Work order data model (WO type: SCHEDULED/UNSCHEDULED/RECALL/PDI/RECONDITIONING; atomically creates MAINTENANCE vehicle block; status state machine; parts/labor/sublet; vendor assignment; warranty claim flag) | WO creation atomic with vehicle block; WO completion releases block; total_cost = labor + parts + sublet | FLT-001, DB-008 |
| MNT-002 | P2 | M | PM scheduling (templates: Oil Change/Tire Rotation/Brake/Safety Inspection/Emissions/Detail; trigger types: mileage/days/calendar; alert lead times; safety-critical flag hard-blocks dispatch past due) | Safety-critical overdue → hard block within 24h; mileage trigger within 24h of crossing threshold | MNT-001 |
| MNT-003 | P2 | M | Maintenance alert system (Upcoming/Due/Overdue levels; notifications to maintenance + location managers; Overdue + Available → auto status → Requires Maintenance; Celery daily evaluation) | Dismissed alert does not re-fire for same service instance | MNT-002, NOTIF-001, CELERY-001 |
| MNT-004 | P2 | M | NHTSA Recall polling + management (nightly Celery task per VIN; new recalls auto-imported; safety-critical → RECALL_HOLD vehicle block; block cannot be removed without completed recall WO) | RECALL_HOLD is hard block; no manager override; block released only when recall WO is completed and signed off | MNT-001, INT-001 |
| MNT-005 | P2 | S | Maintenance reporting (cost per vehicle/class/period; downtime days; vendor performance: avg cost/cycle time/repeat-repair rate) | Read replica for all maintenance reports | MNT-001 |

---

## EPIC: Corporate Accounts

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| CORP-001 | P2 | L | Corporate account CRUD (CDP code unique system-wide; payment terms; credit limit; travel policy: max class/CDW waived/required cost center/supervisor approval; allowed classes; spending limits) | CDP code auto-generates as C+6 digits; enters booking to apply negotiated rate | DB-004 |
| CORP-002 | P2 | M | Travel policy enforcement (max class at booking; required cost center field; supervisor approval routing for bookings > threshold; BLOCK/JUSTIFY/ALLOW_AND_FLAG behavior) | Policy compliance badge on corporate booking; individual compliance report | CORP-001, RES-002 |
| CORP-003 | P2 | M | Direct billing lifecycle (charges accumulate to corporate account; monthly consolidated invoice; email to billing contact; PO matching workflow; credit limit enforcement at 80% alert) | Ghost card routing for centrally-billed accounts; credit limit blocks at 80% + 100% thresholds | CORP-001, PAY-006 |
| CORP-004 | P2 | M | Corporate invoice (EDI 210 export, T&E receipt push to Concur/SAP Expense/Oracle Expense on rental close) | Field mapping configurable per account; PO number required before invoice release if PO matching enabled | CORP-003 |

---

## EPIC: Loyalty Program

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| LOY-001 | P2 | M | Loyalty accounts + points transactions (loyalty_number unique; 5 tiers configurable; points_balance = sum of transactions; points_expiry_date 12–18 months after last activity) | Points history: EARNED/REDEEMED/EXPIRED/ADJUSTED/MIGRATION_BALANCE; tier_override_flag prevents auto-downgrade | CUS-001, DB-004 |
| LOY-002 | P2 | M | Points earning engine (base rate pts/$; class multipliers; promotional bonuses; points posted within 24h of rental CLOSED; free day/points+cash/airline transfer/upgrade redemption at booking) | Points calculated to 6 decimal, rounded to integer; redemption creates $0-charge line | LOY-001, RES-002 |
| LOY-003 | P2 | S | Tier calculation (rolling 12-month qualifying activity; nightly Celery job; upgrade notification; downgrade warning email 30d before period end) | Tier effective_date/expiry_date tracked; tier_override_flag prevents auto-calculation | LOY-001, CELERY-001 |
| LOY-004 | P2 | S | Loyalty admin tools (points balance adjustment with authorized-by and logged transaction; manual tier override temp/permanent; promotional campaign config; program reporting) | Breakage report shows expired points as liability reduction | LOY-001, AUTH-002 |
| LOY-005 | P2 | S | Counter recognition (loyalty tier prominent on agent checkout screen; tier-based greeting script; Chairman tier shows account manager name) | Tier badge (Silver/Gold/Platinum/Chairman) displayed at CUS lookup | LOY-001, CTR-001 |

---

## EPIC: Multi-Location Operations

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| MLOC-001 | P2 | M | Inter-location vehicle transfer workflow (Requested → Approved → Assigned → In Transit → Received; odometer/fuel at departure; receiving branch confirms; cost tracked) | Vehicle status → IN_TRANSIT during transfer (blocked at both locations); transfer cost breakdown | LOC-001, FLT-001 |
| MLOC-002 | P2 | M | One-way rental (pickup/dropoff as separate locations; per-pair one-way fee; receiving branch dashboard alert and email on reservation creation; inbound panel at receiving branch; failed arrival alert after 2h) | One-way fee added to rate quote; receiving branch gets advance notice | LOC-001, RES-002 |
| MLOC-003 | P2 | M | Region / district management (create regions, assign locations; regional manager RBAC scope tied to region; regional reports aggregate across all locations) | Regional manager sees only their region locations | LOC-001, AUTH-002 |
| MLOC-004 | P2 | M | Branch closure management (temporary: date range, blocks new bookings, flags affected reservations, fleet hold; permanent: all reservations resolved before date, fleet redistribution, OTA deactivated) | Permanent closure date enforced; OTA deactivation propagated within 24h | LOC-001, RES-002 |

---

## EPIC: Insurance Products & Compliance

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| INS-001 | P2 | M | CDW declination workflow (declination record generated; California-compliant disclosure text; separate digital signature or initial; stored as chargeback defense exhibit) | Declination record permanently linked to RA; used as evidence in chargeback response | EXT-002, CTR-001 |
| INS-002 | P2 | M | SLI compliance by state (NY: mandatory min liability in base rate, no separate charge; Florida: PIP disclosure before SLI; state compliance overlay enforced at counter checkout) | State overlays configurable per location from jurisdiction matrix | EXT-001, LOC-001 |
| INS-003 | P2 | M | Insurance replacement rental handling (insurer as corporate account; flat rate from master contract; direct billing to insurer; extension via adjuster workflow; claimant type on reservation) | Insurer billing separate from customer; adjuster contact tracked on reservation | CORP-001, RES-002 |
| INS-004 | P2 | S | MGA integration workflow (protection product sold → API call to MGA; policy number returned and printed on RA; monthly commission reconciliation report) | Failure fallback: manual policy number entry; MGA API client per IntegrationClient pattern | EXT-001, INT-001 |

---

## EPIC: Toll & Fine Management

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| TOL-001 | P2 | M | Toll transponder inventory (bulk import; authority/tag ID/vehicle assignment/status; monthly reconciliation tool) | Transponder statuses: Active/Unassigned/Missing/Deactivated | FLT-001 |
| TOL-002 | P2 | M | Toll event ingestion (PlatePass or state authority batch file; plate+datetime matched to active rental; unmatched → manual resolution queue) | Matched events queued for charging; unmatched events listed for agent | TOL-001 |
| TOL-003 | P2 | M | Toll event charging (Celery batch daily/weekly; toll + admin fee charged to card on file; customer email notification with toll details; billing batch ID on charge) | Admin fee configurable per location; receipt issued per charge | TOL-002, PAY-002, NOTIF-001 |

---

## EPIC: Staff Training Mode

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| STF-TRAIN-001 | P2 | M | Training scenario library (6 pre-loaded scenarios: Standard Checkout/Return with Damage/Customer Dispute/Walk-In/CDW Declination/No-Show; step-by-step instructions in side panel during live UI) | Completion tracked per scenario per agent in staff profile | SYS-003 |
| STF-TRAIN-002 | P2 | S | Staff certification path (required scenario set configured by branch manager; agent marked Certified after completion; branch manager can gate live-mode access to certified agents only) | Certification date and certifying manager logged | STF-TRAIN-001 |

---

## EPIC: Customer Self-Service Portal

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| CUST-001 | P2 | L | Customer account login portal (email + password, Google Sign-In, Apple Sign-In, magic link 15-min; authenticated: all reservations, modify/cancel, receipts, loyalty, saved cards, support tickets) | WCAG 2.1 AA compliant; social login dedup; guest booking linked on first login same email | CUS-005, RES-005 |
| CUST-002 | P2 | M | Rental history and invoice download (all closed rentals, download invoice PDF via presigned S3 URL 15-min TTL; available 3 years from rental date) | PDF accessible to authenticated customer without additional auth | CUST-001, PAY-006 |
| CUST-003 | P2 | M | Loyalty dashboard in customer portal (tier badge, points balance, qualifying activity, next tier threshold, points history, redeem button) | Points redemption initiates booking flow | CUST-001, LOY-001 |
| CUST-004 | P2 | M | Communication preferences management (opt in/out per category per channel; propagated to SendGrid/Twilio suppression within 15 min; legally required notices cannot be opted out) | Preference changes logged with timestamp/IP in audit trail | CUST-001, NOTIF-001 |
| CUST-005 | P2 | M | Post-rental NPS survey (email 24h after rental close; embedded 0–10 NPS scale; follow-up form captures score/reason/"contact me"; detractors with contact-me create complaint record; promoters → Google Reviews) | Survey token time-limited 7 days; suppressed if customer opted out of marketing | NOTIF-004, RES-008 |
| CUST-006 | P2 | M | NPS dashboard (per-location score, trend, response rate, verbatim feed filterable by score/location/period, detractor queue) | NPS = Promoters% − Detractors%; verbatim linked to rental context | CUST-005 |

---

## EPIC: OTA Channels

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| OTA-001 | P2 | XL | OTA channel adapter base + dispatcher (OTAChannelAdapter ABC: check_availability/confirm_booking/file_rates/cancel_booking; dispatcher routes inbound webhooks to correct adapter; shared IntegrationClient retry + circuit breaker) | Adapter pattern: new OTA integration without touching business logic | INT-001, RES-002 |
| OTA-002 | P2 | XL | Expedia Rapid adapter (availability response maps SIPP → ACRISS; booking ingest creates CONFIRMED reservation; cancellation propagates; booking ref stored; response time p95 < 800ms) | OTA_VehAvailRateRQ/RS, OTA_VehResRQ/RS OTA Alliance schemas | OTA-001, RES-001 |
| OTA-003 | P2 | XL | Booking.com adapter (OAuth 2.0; availability delta push within 60s of reservation event; booking webhook ingest; signature verified; idempotency key prevents duplicate processing) | Push failures retried with exponential backoff; 200 returned on success | OTA-001, RES-001 |
| OTA-004 | P2 | M | Centralized availability channel sync (SQS rcm-rate-filing event on any reservation write; channel sync workers update all active OTA channels; per-channel inventory allocation % enforced) | Allocation: Expedia gets max 60% of Economy at ORD (configurable); aggregate ≤ total − buffer | OTA-001, RES-001 |
| OTA-005 | P2 | M | OTA commission tracking (commission % per channel; stored on reservation; monthly payable report; reconciliation vs. OTA statements) | Commission posted as GL entry at rental close | OTA-001 |

---

## EPIC: Reporting — Full Suite

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| RPT-001 | P2 | M | Revenue by corporate account / traveler, class mix, channel mix, policy compliance rate | Comparison to contracted volume; exportable Excel/PDF for QBR | CORP-001, RPT-CORE-001 |
| RPT-002 | P2 | M | Yield analysis dashboard (ADR trend, RevPACD trend, utilization trend; forward reservation pace vs. prior year; filter by location/class) | Multi-axis chart; comparison panel | RPT-CORE-001 |
| RPT-003 | P2 | M | Fleet availability heatmap (calendar view: date × class; color gradient low→high utilization; hover shows exact counts; accessible pattern overlay in addition to color) | Accessibility: pattern overlay for color-blind users | RPT-CORE-001 |
| RPT-004 | P2 | M | Loyalty program reporting (enrollment/activity/earn+redemption/breakage/tier distribution/financial impact/points liability) | Breakage = expired points × redemption value; feeds loyalty liability accounting | LOY-001 |
| RPT-005 | P2 | M | Scheduled reports (select report/params/format/schedule/recipients; enable/disable without deletion; delivery log with retry) | External email recipients (non-system users) supported | RPT-CORE-001, NOTIF-001 |
| RPT-006 | P2 | M | Regional manager rollup dashboard (same KPIs as branch aggregated per region; location comparison table sortable; anomaly alerts for >15% deviation; drill-down) | Role-gated to Regional Manager and above | RPT-DASH-001, MLOC-003 |
| RPT-007 | P2 | S | PDF + Excel export for all reports (WeasyPrint server-side PDF with logo/title/page numbers; openpyxl Excel with headers/formatting/summary row; large exports > 10k rows async Celery with email notification) | Export logs the export action in audit trail; sensitive exports generate security alert | RPT-CORE-001 |

---

## EPIC: Compliance

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| COMP-001 | P2 | L | State-specific regulatory overlay config UI (per-location "State Compliance" tab; pre-populated for CA/NY/FL/MA; mandatory disclosures/fee limits/insurance requirements/prohibited practices; overlays version-controlled) | Overlays appear as prompts at correct steps in counter checkout; annually reviewable | LOC-001, CTR-001 |
| COMP-002 | P2 | M | GDPR/CCPA Data Subject Access Request (DSAR) export (aggregate all data for customer: profile/rentals/payments/loyalty/claims/comms/audit; JSON + readable PDF; 30-day turnaround tracked) | Export logged in audit trail; turnaround countdown visible in admin UI | CUS-001, AUD-001 |
| COMP-003 | P2 | L | Vehicle compliance document management (Insurance/Registration/Safety Inspection/Emissions/Recall Completion; upload with issue/expiry dates; expiry alerts at configurable thresholds; hard block on expired registration/insurance) | Alert thresholds: Insurance 90/60/30/14/7d; Registration 60/30/14/7d; Safety 30/14/7d | FLT-001, NOTIF-001 |
| COMP-004 | P2 | M | Data retention schedule enforcement (pg_cron nightly: RAs 7yr, PII 3yr post-inactive, damage claims 5yr, telematics 12mo, notification logs 12mo; legal hold prevents deletion; S3 Glacier tiering) | Archive → Parquet → S3 Glacier after DB archive; legal hold flag checked before delete | DB-028, DB-029, AWS-007 |
| COMP-005 | P2 | S | SOC 2 event categories in audit log (login success/fail, logout, password change, MFA enroll/remove, permission change, data export, config change, API key create/revoke, role assignment, forced logout) | All events include actor/IP/session/resource/result; query pattern for SOC 2 auditor | AUD-001 |

---

## EPIC: Financial & Regulatory

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| FIN-001 | P2 | L | AR dunning workflow (corporate accounts: automated emails +7d/+15d/+30d/+45d/+60d/+75d; each references invoice(s)/amount/payment link; status: Overdue → Collections; write-off with GL entry at +75d) | Write-off: Dr Allowance for Doubtful / Cr AR; collections export in CSV format | CORP-003, NOTIF-001, PAY-009 |
| FIN-002 | P2 | M | Invoice dispute handling (customer flags line items; dispute form: invoice#/items/reason/attachment; AR queue ticket; SLA 5d < $500 / 10d > $500; credit note if accepted: PDF with sequential number, GL entry Dr Revenue/Cr AR) | Credit balance applied to next invoice if already paid; dispute logged in audit trail | CORP-003, PAY-006 |
| FIN-003 | P2 | M | 3DS2 Strong Customer Authentication (SCA) for EU/UK card-not-present (Stripe 3DS2; all outcomes handled: success/fail/frictionless; auth result + network_authentication_id stored; US optional for liability shift) | Booking engine handles all 3 outcomes without breaking flow | PAY-001, INT-002 |
| FIN-004 | P2 | M | Tax remittance report per jurisdiction (per filing period and jurisdiction; format matches CA BOE-531/NY DTF-802 where possible; admin verifies against Tax Payable GL before filing; filing history retained) | Payment confirmation entry (Dr Tax Payable / Cr Cash) posted after filing | PAY-009, RTE-006 |
| FIN-005 | P2 | S | Multi-currency rounding rules enforcement (half-up at final line-item step; 6 decimal intermediate; EU invoices: net/VAT/total separated; Canadian GST/HST stacking; QST registration number) | All monetary calculations verified by test suite | RTE-001, PAY-009 |

---

## EPIC: Counter Operations — Completions

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| CTR-010 | P2 | M | AAMVA driver's license validation integration (US license barcode scan PDF417 → DMV query; suspension/revocation hard block; IDP required for non-English countries; AAMVA client per IntegrationClient pattern) | Foreign licenses: manual entry fallback; under-minimum-age hard block; AAMVA results logged | CTR-006, INT-001 |
| CTR-011 | P2 | M | Lot audit (agent walks lot via counter app; scan per vehicle; Not Located → Lot Discrepancy flag + manager notification; Unexpected Vehicle record; audit report with agent ID + completion time stored per location per day) | Physical extras inventory counted during lot audit | CTR-003 |
| CTR-012 | P2 | S | Accident reporting flow — customer (5-step: incident basics/third-party info/police report/4+ photos/witness; safety disclosures shown at start; creates mid-rental damage claim; counter check-in checks for existing mid-rental report) | Created as Mid-Rental damage claim; does not block ongoing rental but flags for inspection at return | INS-INSP-001, DMG-001 |
| CTR-013 | P2 | M | Roadside breakdown flow (RSA button on active rental status; two options: one-tap RSA call, or "Report a Problem" form with GPS + photo + problem type; creates incident record; branch + fleet manager notified by push + email) | RSA provider phone number in confirmation email and RA; incident reference returned to customer | NOTIF-001, FLT-001 |

---

## EPIC: Infrastructure — Phase 2

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| AWS-011 | P2 | M | Terraform module: monitoring (CloudWatch log groups 90d retention, all 7 alarms, SNS→PagerDuty+Slack, CloudWatch dashboard) | All 7 alarms: API p95, 5xx rate, RDS CPU, Redis memory, SQS depth, Celery failures, pre-auth renewal failures | AWS-003–AWS-006 |
| AWS-012 | P2 | S | Terraform environment configs (dev/staging/prod with env-specific sizes; S3 remote state with DynamoDB locking; provider pinned ~> 5.0) | Each environment completely independent; no shared state | AWS-001 |
| AWS-013 | P2 | M | SQS queues (2 FIFO + 3 standard + 5 DLQs; SSE-KMS; maxReceiveCount=3; 4d message retention; 14d DLQ retention) | Queue URLs injected into ECS task definitions as environment variables | AWS-010 |
| SEC-001 | P2 | M | WAF rules in Terraform (OWASP CommonRuleSet + SQLiRuleSet + KnownBadInputs; rate limit 2000/5min; geo-blocking configurable; WAF logging full request sampling) | COUNT mode first, switch to BLOCK after baseline; CloudFront prefix list on ALB inbound | AWS-002 |
| SEC-002 | P2 | S | VPC security groups least-privilege (ALB from CF prefix list only; API from ALB only; RDS from API+Workers only; Redis from API+Workers only; no 0.0.0.0/0 inbound on private resources) | All security group IDs output for cross-module reference | AWS-001 |
| SEC-003 | P2 | S | KMS keys per data classification (rcm-rds-key, rcm-elasticache-key, rcm-s3-key; rotation enabled; key policy limits to ECS task roles) | All key aliases created; keys referenced in RDS/ElastiCache/S3 modules | AWS-009 |
| SEC-004 | P2 | S | CloudTrail + GuardDuty + AWS Config (CloudTrail all regions + S3 Object Lock COMPLIANCE 7yr; GuardDuty → SNS → PagerDuty; Config managed rules enforced) | All 4 managed Config rules active from day one | AWS-007, AWS-009 |
| CICD-004 | P2 | M | GitHub Actions deploy-staging job (CodeDeploy blue/green; alembic upgrade head before ECS deploy; wait for health check; fail and stop-deployment on failure) | Blue retained 60 min after cutover | CICD-003, AWS-003 |
| CICD-005 | P2 | S | GitHub Actions smoke-tests job (Playwright chromium; smoke suite: health/login/availability/booking; upload HTML report artifact) | Must pass before production approval gate opens | CICD-004 |
| CICD-006 | P2 | XS | Production approval gate (GitHub environment: production; required reviewer minimum 1; 5-min wait timer; CICD-005 must pass before approval) | Approval request notification sent via GitHub | CICD-005 |
| CICD-007 | P2 | M | Deploy-prod job with auto-rollback (health check loop 10×30s; stop-deployment --auto-rollback-enabled on failure; post result to Slack) | Auto-rollback triggers within 5 min of failed health check | CICD-006, AWS-003 |

---

## EPIC: Integration Completions — Phase 2

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| INT-004 | P2 | S | Avalara AvaTax client (create_transaction, get_tax_codes, void_transaction; caching per tax_service.py SHA-256 hash pattern) | Tax caching prevents duplicate Avalara charges for same inputs | INT-001, RTE-006 |
| INT-005 | P2 | S | Twilio SMS client (send_sms with E.164 formatting; delivery status webhook → notification_log) | Circuit breaker on Twilio failures | INT-001, NOTIF-003 |
| INT-006 | P2 | S | SendGrid email client (send_email via v3 API; delivery events webhook → notification_log; DKIM/SPF config guide) | DKIM/SPF setup required for operator sending domain | INT-001, NOTIF-002 |
| INT-011 | P2 | S | NHTSA vPIC VIN decode client (decode_vin, maps to VinDecodeResult; no auth; used in vehicle entry wizard Step 1) | Non-blocking at wizard Step 1; failure allows manual entry | INT-001 |
| INT-012 | P2 | S | NHTSA Recalls client (get_recalls_for_vin, returns list[RecallResult]; used by nhtsa_recall_poll Celery task) | Idempotent — no duplicate recall records per campaign_id | INT-001, MNT-004 |

---

## EPIC: Frontend — Phase 2

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| FE-007 | P2 | S | Counter app availability grid (useQuery refetchInterval=30s; WebSocket subscription /ws/fleet/{locationId}; applyAvailabilityPatch on WS message; CSS grid class rows × time-slot columns) | Loading skeleton and error state; WebSocket reconnects automatically | FE-004, API-011 |
| FE-008 | P2 | S | Counter app offline mode (Workbox BackgroundSyncPlugin maxRetentionTime=24h for POST /checkout and /check-in; CacheFirst for static; NetworkFirst for API GETs; offline queue drains on reconnect; OFFLINE banner) | Counter operates ≥ 4h without connectivity; hard-dependency operations clearly communicate offline requirement | SCAFFOLD-004 |
| FE-009 | P2 | S | Admin app core pages (fleet/reservations/customers/pricing/reports/settings; RouteGuard per section; sidebar navigation with active state; responsive) | Role-appropriate navigation; admin users see only their permitted sections | FE-004, SCAFFOLD-005 |
| FE-010 | P2 | S | WCAG 2.1 AA accessibility (accessible stepper with role=tablist/aria-selected/arrow-key nav; form error role=alert aria-live=polite; focus trap in modals; skip-to-content; 44×44px touch targets; axe-core CI scan zero violations) | axe-core integrated in GitHub Actions; zero violations block merge | FE-001 |
| TEST-006 | P2 | S | Playwright E2E test config (staging URL, chromium + webkit, retries=2, globalSetup auth, authenticated + unauthenticated fixtures) | Smoke tests cover critical paths | CICD-005 |
| TEST-007 | P2 | S | E2E smoke test suite (health check, login flow, search availability, book reservation end-to-end; full suite < 2 min) | Retries=2 for flakiness tolerance | TEST-006, FE-006 |
| TEST-008 | P2 | S | MSW handlers for frontend integration tests (all API endpoints mocked; typed per generated schema; frontend tests use Testing Library + MSW; coverage for AvailabilityGrid and booking flow) | No real API calls in unit/integration tests | FE-002, FE-007 |
| OBS-003 | P2 | S | CloudWatch Logs Insights saved queries (5 queries: slow API calls, 5xx by path, Celery failure rate, pre-auth renewal failures, Stripe webhook timing) | All queries in Terraform; immediately runnable | AWS-011, OBS-001 |
| OBS-004 | P2 | S | SLA measurement hooks (CloudWatch custom metric RCM/API/ResponseTime per endpoint type; p95 per endpoint vs. target in dashboard; Celery task duration metric) | SLA breach alerts routed to PagerDuty | AWS-011, OBS-001 |

---

## EPIC: API Partner Program

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| PART-001 | P2 | M | API key issuance and management (create with name/scope/expiry/IP allowlist; shown once; stored as bcrypt hash; last-used timestamp; rotate with grace period; immediate revoke) | API_PARTNER RBAC role; per-key rate limiting | AUTH-002 |
| PART-002 | P2 | M | Webhook subscription CRUD + HMAC signing (endpoint URL, shared secret, event type subscriptions, test delivery, delivery log, retry schedule: 1m/5m/30m/2h up to 24h) | X-RCM-Signature: sha256={hex} header on all outbound; Dead-letter after 24h failures → admin alert | PART-001, NOTIF-001 |
| PART-003 | P2 | S | API rate limiting per key (60 req/min / 1000 req/hr default; configurable per key; Redis sliding window; 429 with Retry-After + X-RateLimit-Remaining headers) | Rate limit stats visible in API key detail view | PART-001, REDIS-003 |
| PART-004 | P2 | M | Sandbox environment (dedicated sandbox tenant per partner; Stripe test mode; no real notifications; reset on demand; same API endpoints, separate data partition) | Training mode pattern applied; sandbox tenant created via partner onboarding | PART-001, SYS-003 |

---

# Phase 3 — Scale & Advanced Features

> Goal: GDS rate filing, telematics, mobile apps, EV fleet, advanced analytics, multi-region readiness.

---

## EPIC: GDS Rate Filing

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| GDS-001 | P3 | XL | Sabre OTA XML rate filing Celery task (valid OTA Alliance XML for all GDS-eligible rate codes; SOAP over HTTPS; acknowledgement parsed; filed/rejected status per rate code; error queue in Integration Admin) | OTA_VehAvailRateRQ format; gds_description max 24 chars per Sabre spec | OTA-001, INT-001 |
| GDS-002 | P3 | XL | Amadeus rate filing (OAuth 2.0, Amadeus Rate Loader REST API; per-rate filing status; error surfaced in Integration Admin) | Token auto-refresh; errors logged with response payload | OTA-001, INT-001 |
| GDS-003 | P3 | M | GDS availability sync (near-real-time < 5 min availability updates to Sabre and Amadeus on reservation create/cancel; batch fallback; deduplication) | Push failures retried 3× before DLQ; DLQ alerts admin | GDS-001, GDS-002 |

---

## EPIC: Telematics Integration

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| TEL-001 | P3 | L | Geotab integration (poll every 5 min, OAuth 2.0, event ingestion: dedup via Redis 5-min TTL; insert to telematics_events; update vehicle odometer/soc_pct/fuel_pct; Redis pub/sub for WebSocket) | telematics:dedup:{device_id}:{timestamp} prevents duplicate processing; circuit breaker on 5 failures | INT-001, DB-025 |
| TEL-002 | P3 | L | Samsara integration (same pipeline as Geotab; separate provider adapter; VIN-to-device mapping shared infrastructure) | TEL-001 and TEL-002 use same pipeline; provider registered in provider_registry dict | INT-001, DB-025 |
| TEL-003 | P3 | M | Real-time fleet map WebSocket (fleet:{tenant_id}:{location_id} Redis pub/sub bridge; ConnectionManager; live vehicle positions with status/speed/SOC; counter app subscribes on load) | Dead connection cleanup without memory leak; 30s polling fallback | TEL-001, API-011 |
| TEL-004 | P3 | M | Geofencing (circle + polygon zones; types: Return Area/Home Lot/State Limit/Restricted/EV Charging; alerts on entry/exit; CDW void flag if state boundary breached; alert within 5 min) | Geofence events linked to rental agreement or vehicle record | TEL-001 |
| TEL-005 | P3 | M | Stolen vehicle workflow (fleet manager flags vehicle; telematics switches to 1-min polling interval; police relay document with last known location/speed/direction; case notes log) | Polling interval configurable; document includes all tracking data | TEL-001 |

---

## EPIC: Mobile Apps — Customer

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| MOB-001 | P3 | XXL | Customer mobile app foundation (React Native, iOS + Android; JWT auth via secure storage equivalent of httpOnly cookie; operator branding from tenant config; push token registration) | Builds and deploys to App Store and Google Play | AUTH-001, NOTIF-001 |
| MOB-002 | P3 | L | Search and book in mobile app (full funnel: search → select → extras → driver details → Stripe payment sheet → confirmation; push notification on confirm) | PCI SAQ A maintained via Stripe mobile SDK | MOB-001, RES-002 |
| MOB-003 | P3 | M | Manage reservation in mobile app (view/modify/cancel; push notifications for modification/cancellation confirmation) | Same API as web portal | MOB-001, RES-005 |
| MOB-004 | P3 | M | Live rental status screen (vehicle info, return countdown, GPS position on map from telematics, SOC% for EV; return deadline red < 2h) | Telematics required for GPS position | MOB-001, TEL-001 |
| MOB-005 | P3 | M | Digital key / QR code express pickup (QR provisioned at T-2h; time-limited valid T-2h to T+4h; revoked on cancellation; presented in app to unlock) | Digital key provisioning service required | MOB-001, RES-002 |
| MOB-006 | P3 | M | Mobile receipt history and PDF download (rental history tab; Download Receipt fetches presigned S3 URL; cached offline if previously downloaded) | Available without connectivity if cached | MOB-001, PAY-006 |
| MOB-007 | P3 | M | Loyalty dashboard in mobile app (tier badge, points balance, tier progress, points history, redeem button, tier upgrade push notification) | Real-time tier change notification via push | MOB-001, LOY-001 |

---

## EPIC: Mobile Apps — Staff

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| SMOB-001 | P3 | XL | Staff mobile app foundation (React Native, iOS + Android; Counter Agent/Fleet Manager/Maintenance Tech roles; role-appropriate navigation) | Shared auth with web counter app | AUTH-001, AUTH-002 |
| SMOB-002 | P3 | L | Lot audit in staff mobile app (Lot Audit session; vehicle QR/barcode scan; Not Located + Unexpected Vehicle discrepancy handling; audit report stored per location per day) | Offline-capable; syncs on connectivity restore | SMOB-001, CTR-011 |
| SMOB-003 | P3 | L | Damage capture in staff mobile app (zone-by-zone inspection; SVG diagram; damage type/severity/photo per zone; customer digital signature on screen; offline sync) | Completed inspection syncs to damage domain; offline-capable | SMOB-001, INS-INSP-001 |

---

## EPIC: EV Fleet Management

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| EV-001 | P3 | M | EV SOC management (dispatch policy per class/location: min dispatch SOC, target SOC, low-SOC alert threshold; SOC below min dispatch → vehicle blocked; SOC below alert → push to customer) | Policy configurable per class per location; EV-specific vehicle fields: battery_capacity_kwh, epa_range_miles, charge_port_type | FLT-001, TEL-001 |
| EV-002 | P3 | M | Post-return EV charging workflow (SOC check on return; if below min dispatch: status → Charging Required; charger assignment; estimated charge time calculated; telematics ChargingEnd → status → Available) | Charger assignment record tracks which charger is in use | EV-001, TEL-001 |
| EV-003 | P3 | M | Fleet-level EV SOC dashboard (all EVs at location with SOC%/range estimate/charging status/next reservation/time to dispatch readiness; WebSocket real-time; sorted by urgency) | Urgency = closest next reservation × lowest SOC | EV-002, TEL-003 |

---

## EPIC: Advanced Reporting

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| RPT-ADV-001 | P3 | M | Vehicle-level TCO and utilization report (rental days/idle days/maintenance days/revenue/TCO breakdown; TCO = acquisition + fuel + maintenance + insurance + depreciation − revenue; projected rotation date) | Sortable by net contribution | RPT-CORE-001, MNT-005 |
| RPT-ADV-002 | P3 | M | Real-time fleet map in admin (all vehicles on Mapbox map at current GPS; color-coded by status; vehicle popup with VIN/class/status/SOC/active RA; updates every 60s) | Telematics required | TEL-003, RPT-DASH-001 |
| RPT-ADV-003 | P3 | M | Custom report builder (drag-and-drop field picker; AND/OR filter builder; grouping/sorting/chart type; save as named report personal or shared; PII exports require auth prompt) | Export logged in audit trail | RPT-CORE-001 |

---

## EPIC: Infrastructure — Phase 3

| ID | Phase | Size | Title | AC Summary | Dependencies |
|---|---|---|---|---|---|
| AWS-014 | P3 | M | Datadog APM integration (Datadog agent ECS sidecar in API and worker task defs; DD_APM_ENABLED; metric collection for ECS/RDS/ElastiCache; APM service map API→postgres→redis) | Datadog AWS integration IAM role in Terraform | AWS-003, AWS-004 |
| OBS-005 | P3 | S | Datadog dashboards and monitors (dashboard: API p95/error rate/Celery queue depth/RDS/Redis/ECS task count; monitors for all 7 alert conditions with PagerDuty; APM service map) | Managed via Terraform Datadog provider | AWS-014 |
| CICD-008 | P3 | S | Frontend CI jobs (lint/build/Vitest/Chromatic; turbo run in parallel; Vitest coverage 70%; Chromatic visual regression on packages/ui) | Fails PR on any step failure | SCAFFOLD-003–005 |
| TECH-P3-001 | P3 | M | Multi-region expansion design (architecture doc: Aurora Global vs active-active RDS; cross-region Redis; CloudFront origin routing; tenant-to-region affinity; design only, no infra changes) | Design review and approval required before implementation | AWS-001–008 |
| INTG-001 | P3 | M | CarTrawler OTA adapter (airline-ancillary white-label; REST API; location/rate mapping; channel=OTA_CARTRAWLER on inbound bookings) | Same abstract adapter pattern; new channel without touching business logic | OTA-001 |
| INT-013 | P3 | S | AAMVA DLDV integration (SOAP/XML; state-issued credentials; validate_license returns is_valid/status/expiry; suspension/revocation result hard-blocks checkout) | AAMVA provider contract required; client extends IntegrationClient | INT-001, CTR-006 |
| INT-014 | P3 | S | Telematics integration clients (Geotab + Samsara clients implementing get_recent_events; TelematicsEvent dataclass with to_db(); provider registry dict; CELERY-011 task uses registry) | Both clients tested with real provider API tokens | INT-001, TEL-001–002 |
| TEST-009 | P3 | S | Factory-boy factories for partitioned tables (TelematicsEventFactory, NotificationLogFactory, AuditEventFactory; partition-aware insert; audit trigger verified by AuditEventFactory) | Quarterly archive restorability test: restore Parquet file, validate row counts | TEST-004, DB-024–026 |
| SEC-007 | P3 | S | VPC Flow Logs with alerting (enabled on all subnets, REJECT logging, CloudWatch 90d retention, rejected connections > 1000/min alarm, Athena table over S3 export) | Terraform manages all resources | AWS-001 |

---

# Backlog Item Index by Epic

| Epic | Phase | Item Count | IDs |
|---|---|---|---|
| Project Scaffolding | P0 | 13 | SCAFFOLD-001–013 |
| Database Foundation | P0 | 34 | DB-001–034 |
| FastAPI Application Foundation | P0 | 25 | API-001–025 |
| Redis Setup | P0 | 5 | REDIS-001–005 |
| Celery Infrastructure | P0 | 10 | CELERY-001–010 |
| AWS Infrastructure | P0 | 10 | AWS-001–010 |
| CI/CD Pipeline | P0 | 3 | CICD-001–003 |
| Integration Foundations | P0 | 3 | INT-001–003 |
| Frontend Foundation | P0 | 6 | FE-001–006 |
| Testing Infrastructure | P0 | 5 | TEST-001–005 |
| Tenant & System Foundation | MVP | 4 | TNT-001–004 |
| Authentication & RBAC | MVP | 9 | AUTH-001–009 |
| Location Management | MVP | 4 | LOC-001–004 |
| Fleet & Vehicle Inventory | MVP | 9 | FLT-001–NHTSA |
| Reservations & Booking Engine | MVP | 9 | RES-001–009 |
| Rate Engine | MVP | 7 | RTE-001–007 |
| Extras & Ancillaries | MVP | 4 | EXT-001–004 |
| Payments & Billing | MVP | 10 | PAY-001–010 |
| Counter Operations | MVP | 7 | CTR-001–007 |
| Customer Management | MVP | 5 | CUS-001–005 |
| Damage & Inspections (MVP) | MVP | 7 | INS-INSP-001–004, DMG-001–004 |
| Notification System (MVP) | MVP | 6 | NOTIF-001–006 |
| System Configuration | MVP | 3 | SYS-001–003 |
| Audit & Security (MVP) | MVP | 2 | AUD-001–002 |
| Branch Dashboard | MVP | 2 | RPT-DASH-001, RPT-CORE-001 |
| SaaS Billing | MVP | 4 | SAAS-001–004 |
| Technical Completions (MVP) | MVP | 4 | TECH-001–004 |
| Damage Claims — Full Lifecycle | P2 | 8 | DMG-011–018 |
| Maintenance Management | P2 | 5 | MNT-001–005 |
| Corporate Accounts | P2 | 4 | CORP-001–004 |
| Loyalty Program | P2 | 5 | LOY-001–005 |
| Multi-Location Operations | P2 | 4 | MLOC-001–004 |
| Insurance Products & Compliance | P2 | 4 | INS-001–004 |
| Toll & Fine Management | P2 | 3 | TOL-001–003 |
| Staff Training Mode | P2 | 2 | STF-TRAIN-001–002 |
| Customer Self-Service Portal | P2 | 6 | CUST-001–006 |
| OTA Channels | P2 | 5 | OTA-001–005 |
| Reporting — Full Suite | P2 | 7 | RPT-001–007 |
| Compliance | P2 | 5 | COMP-001–005 |
| Financial & Regulatory | P2 | 5 | FIN-001–005 |
| Counter Operations Completions | P2 | 4 | CTR-010–013 |
| Infrastructure Phase 2 | P2 | 17 | AWS-011–014, SEC-001–004, CICD-004–007, FE-007–010, TEST-006–008, OBS-003–004 |
| Integration Completions P2 | P2 | 5 | INT-004–006, INT-011–012 |
| API Partner Program | P2 | 4 | PART-001–004 |
| GDS Rate Filing | P3 | 3 | GDS-001–003 |
| Telematics Integration | P3 | 5 | TEL-001–005 |
| Mobile Apps — Customer | P3 | 7 | MOB-001–007 |
| Mobile Apps — Staff | P3 | 3 | SMOB-001–003 |
| EV Fleet Management | P3 | 3 | EV-001–003 |
| Advanced Reporting | P3 | 3 | RPT-ADV-001–003 |
| Infrastructure Phase 3 | P3 | 8 | AWS-014, OBS-005, CICD-008, TECH-P3-001, INTG-001, INT-013–014, TEST-009, SEC-007 |

---

## Critical Path Dependencies

The following items form the critical path. Nothing else can proceed until these are complete.

```
DB-001 → DB-002 → DB-003 → DB-004–DB-034 (all database foundation)
         ↓
API-001 → API-002 → API-003 → API-004 → AUTH-001
                              ↓
                        REDIS-001–003 → CELERY-001
                              ↓
                         TNT-001 → LOC-001 → FLT-001 → FLT-004 (exclusion constraint)
                                                ↓
                              RES-001 → RES-002 → PAY-001 → CTR-001 → CTR-002 → PAY-002
                                                                              ↓
                                                               INS-INSP-001 → DMG-001
                                                                              ↓
                                                                        PAY-006 (receipt)
                                                                        = FIRST RENTAL ✓
```

**Shared infrastructure items that multiple epics depend on — build once:**
- `SYS-002` Approval queue engine — consumed by damage claims, refunds, rate activation, DNR
- `NOTIF-001` Redis Streams pipeline — consumed by every domain notification
- `INT-001` IntegrationClient base class — consumed by all 14 integration adapters
- `DB-027` Audit trigger — must be live before any audited table is used in production
- `DB-008` Exclusion constraint — must be tested (TECH-003) before first reservation is possible
