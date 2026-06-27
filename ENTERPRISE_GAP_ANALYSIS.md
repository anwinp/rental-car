# Enterprise-Readiness Gap Analysis — Issue List

**Prepared by:** Engineering audit (multi-agent code review)
**Date:** 2026-06-27
**Scope:** `apps/api`, `apps/web-admin`, `apps/web-booking`, `apps/web-counter`, `packages/*`, `infra/`, `.github/workflows/`
**Purpose:** Engineering/operational readiness (distinct from the product-requirements [`GAP_ANALYSIS.md`](GAP_ANALYSIS.md)). Each entry is formatted as a fileable issue.

> ⚠️ **Verdict:** Feature-rich, well-architected MVP — **not production-deployable as-is.** Tenant-isolation and financial-correctness defects can cause cross-tenant data breaches and double-charges; the entire infrastructure/deploy layer is unimplemented stubs.

Findings are from a deep, file-referenced code review. Treat the **Critical** items as high-confidence and verify each before/while fixing.

---

## Severity index

| Severity | Count | IDs |
|---|---|---|
| 🔴 Critical | 13 | SEC-01, SEC-02, SEC-03, SEC-04, REL-01, REL-02, REL-03, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, AGENT-01 |
| 🟠 High | 19 | SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, REL-04, REL-05, REL-06, REL-07, REL-08, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10, OPS-11, TEST-01, TEST-02, AGENT-02 |
| 🟡 Medium | 30 | SEC-10…16, REL-09…18, OPS-12…18, TEST-03…09, AGENT-03…06 |

(Cross-cutting issues are listed once under their primary area and cross-referenced.)

---

## Suggested sequencing

1. **Phase 1 — Security correctness (1–2 wks):** SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, AGENT-01, REL-04.
2. **Phase 2 — Financial correctness (1 wk):** REL-01, REL-02, REL-03, REL-05, REL-06, REL-07, REL-08.
3. **Phase 3 — Make it deployable (3–4 wks):** OPS-01…06, SEC-06, SEC-07.
4. **Phase 4 — Observability + tests (2–3 wks):** OPS-07…11, TEST-01…09, AGENT-02…06.

---

# 🔒 Security & Multi-Tenancy

### SEC-01 — 🔴 Critical — Row-Level Security is inert at runtime
**Files:** `apps/api/app/core/database.py:39,50`, `apps/api/.env:4`, `apps/api/alembic/versions/002_create_schemas_roles.py:43`, `apps/api/app/core/repository.py:22`
**Problem:** RLS policies exist but provide zero protection: the app connects as the table-owner role `rcm` (owners bypass RLS), the intended non-owner `app_user` is never used, and the GUC-setting dependency `get_db` (which runs `set_config('app.current_tenant_id', …)`) is imported by **zero** routers — all use the bare `get_session`. Tenant isolation rests entirely on hand-written `WHERE tenant_id` filters.
**Fix:** Connect as non-owner, non-BYPASSRLS `app_user`; wire the `get_db` GUC dependency into every request so RLS engages.
**Acceptance:** Integration test proves a cross-tenant `SELECT` returns 0 rows with the GUC set.

### SEC-02 — 🔴 Critical — Unauthenticated endpoints trust the `X-Tenant-ID` header
**Files:** `apps/api/app/domains/agents/router.py:38`, `apps/api/app/domains/reservations/router.py:140`, `apps/api/app/domains/locations/router.py:44`, `apps/api/app/domains/agents/service.py:142`
**Problem:** Agent chat, guest booking, and public endpoints derive `tenant_id` from the spoofable `X-Tenant-ID` header with no auth. For the agent, this mints a real `AGENT_SERVICE` JWT for an attacker-chosen tenant and selects that tenant's BYOK LLM key.
**Fix:** For unauthenticated surfaces, resolve tenant server-side from a host/origin allowlist; never trust the header for guests. Derive tenant from verified claims when authenticated.
**Acceptance:** Setting an arbitrary `X-Tenant-ID` on a guest request cannot read/write another tenant's data or mint its token.

### SEC-03 — 🔴 Critical — Public confirmation lookup has no tenant scoping (cross-tenant exposure / enumeration)
**Files:** `apps/api/app/domains/reservations/router.py:516-569`
**Problem:** `GET /reservations/public/{confirmation_number}` queries by confirmation number with **no `tenant_id` filter** and no auth. With RLS inert (SEC-01), guessing/enumerating confirmation numbers returns any tenant's customer name, email, dates, totals.
**Fix:** Scope to a verified tenant, require an email-match or signed token, and rate-limit.
**Acceptance:** Lookup requires a second factor and is tenant-scoped; brute-force is throttled.

### SEC-04 — 🔴 Critical — No-auth guest booking abuse (spoofable tenant, no throttle)
**Files:** `apps/api/app/domains/reservations/router.py:133-318`
**Problem:** Guest booking takes tenant from the header (fallback all-zeros UUID), with no CAPTCHA/rate limit/auth. An attacker can mass-create customers + reservations under any tenant (resource exhaustion, inventory lockup via holds, confirmation emails to arbitrary addresses on the tenant's behalf).
**Fix:** Bind the public funnel to a server-side host/origin→tenant map; add per-IP rate limiting + CAPTCHA; cap guest writes.
**Acceptance:** Automated bulk booking is blocked; tenant cannot be chosen by the client.

### SEC-05 — 🟠 High — No rate limiting (global)
**Files:** `apps/api/app/main.py:82-93` (only RequestID/Logging/CORS), `apps/api/app/domains/auth/service.py` (login lockout only)
**Problem:** Only login lockout + OTP send are throttled. Guest booking, confirmation lookup, public locations, agent chat, and password/OTP flows are unthrottled — enabling enumeration, scraping, DoS, and LLM-spend abuse. (See also AGENT-02, OPS-04.)
**Fix:** Add global per-IP + per-tenant rate-limiting middleware (slowapi/Redis) with stricter buckets on unauthenticated routes.
**Acceptance:** Unauthenticated routes return 429 past a configured threshold.

### SEC-06 — 🟠 High — Tenant BYOK / SendGrid secrets stored plaintext at rest
**Files:** `apps/api/app/domains/tenants/models.py:72,79`, `apps/api/app/domains/agents/service.py:97,187`
**Problem:** `anthropic_api_key` and `sendgrid_api_key` are plain `Text` columns; the LLM key is also copied into the 24h Redis session blob. A DB/Redis read (or a cross-tenant read via SEC-01) leaks every tenant's provider credentials.
**Fix:** Encrypt at rest (KMS envelope / Fernet / pgcrypto) or store in a secrets manager by reference; never place secrets in the session blob — pass transiently per call.
**Acceptance:** Secrets are unreadable from a raw DB/Redis dump.

### SEC-07 — 🟠 High — No security headers
**Files:** `apps/api/app/core/middleware.py`, `apps/api/app/main.py`
**Problem:** No HSTS, X-Frame-Options/`frame-ancestors`, X-Content-Type-Options, CSP, or Referrer-Policy. With cookie auth this exposes clickjacking / MIME-sniffing.
**Fix:** Add a security-headers middleware (or at the edge/WAF).
**Acceptance:** Responses carry the standard hardening headers.

### SEC-08 — 🟠 High — Public locations endpoint enables tenant enumeration
**Files:** `apps/api/app/domains/locations/router.py:44-55`
**Problem:** Returns up to 200 active locations for whatever tenant is in the header; iterating tenant IDs enumerates any tenant's branches/addresses, unthrottled.
**Fix:** Resolve tenant from request host/origin server-side; rate-limit.
**Acceptance:** Location list cannot be retrieved for an arbitrary header-supplied tenant.

### SEC-09 — 🟠 High — CORS reflects credentials; env override can widen origins
**Files:** `apps/api/app/main.py:86-93`, `apps/api/app/core/config.py:37-41,107-113`, `apps/api/.env:16`
**Problem:** `allow_credentials=True` paired with an env-overridable origin list. A misconfigured deploy with a broad/wildcard origin exposes the httpOnly session cookie cross-origin.
**Fix:** Fail startup if `allow_credentials=True` is paired with `*` or non-allowlisted origins.
**Acceptance:** Startup rejects unsafe CORS configs.

### SEC-10 — 🟡 Medium — `AGENT_SERVICE` role unseeded / over-broad
**Files:** `apps/api/app/domains/agents/service.py:152`, `apps/api/app/core/rbac.py:55-62`, `apps/api/alembic/versions/20260624_042_agent_service_role.py:27`
**Problem:** Tokens are minted with `roles=["AGENT_SERVICE"]`, but the role grants `customers:read`, `reservations:[read,update]`, etc. — broad privileges on an anonymous-reachable surface. The seed/permission matrix is inconsistent across migration vs `rbac.py`.
**Fix:** Define a minimal, explicitly scoped guest-agent permission set; treat the agent token as an untrusted principal; enforce row-level ownership (AGENT-01) instead of coarse role grants.
**Acceptance:** The agent token cannot read other customers' PII or modify arbitrary reservations.

### SEC-11 — 🟡 Medium — SQL `INTERVAL` built via f-string
**Files:** `apps/api/app/domains/payments/repository.py:119`
**Problem:** `text(f"NOW() + INTERVAL '{within_hours} hours'")` — injection-shaped (currently fed an internal int, so not exploitable today).
**Fix:** Bind a parameter: `NOW() + make_interval(hours => :h)`.
**Acceptance:** No string-interpolated SQL literals remain.

### SEC-12 — 🟡 Medium — JWT lacks `iss`/`aud`, token-type assertion; weak dev secret
**Files:** `apps/api/app/core/security.py:106,116-151`, `apps/api/.env:12`
**Problem:** `decode_token` validates only signature/expiry — no `iss`/`aud`, no per-endpoint token-type assertion (refresh tokens not rejected on access paths). HS256 with a single shared secret signs user *and* service/agent tokens; the dev secret is a committed placeholder with no enforced entropy.
**Fix:** Set/verify `iss` + `aud`, assert token `type` per endpoint, enforce strong secret length/entropy (consider RS256 for service tokens).
**Acceptance:** A refresh token is rejected on access-only routes; tokens with wrong `aud` fail.

### SEC-13 — 🟡 Medium — MFA optional/unenforced for privileged roles
**Files:** `apps/api/app/domains/auth/` (TOTP/OTP present but ungated)
**Problem:** No requirement that `SYSTEM_ADMIN`/finance roles enroll in MFA.
**Fix:** Gate privileged-role login on MFA enrollment.
**Acceptance:** A privileged user without MFA is forced to enroll before access.

### SEC-14 — 🟡 Medium — Logout is single-session; no "log out everywhere"
**Files:** `apps/api/app/domains/auth/` (logout blacklists current jti only)
**Problem:** A compromised account's other live sessions persist until expiry (counter TTL is 8h, SEC-15).
**Fix:** Support all-session revocation on password change / suspected compromise (reuse `USER_SESSIONS_KEY`).
**Acceptance:** Password reset invalidates all active sessions.

### SEC-15 — 🟡 Medium — Counter token 8h TTL, no idle timeout
**Files:** `apps/api/app/core/config.py:32`
**Problem:** `jwt_access_token_ttl_counter_seconds=28800`; on a shared kiosk a walk-up has up to 8h of valid session.
**Fix:** Add idle timeout / refresh-on-activity; shorten access TTL for shared devices.
**Acceptance:** Idle kiosk session expires within a short window.

### SEC-16 — 🟡 Medium — WebSocket token skips revocation check
**Files:** `apps/api/app/core/security.py:275-290`
**Problem:** `verify_ws_token` decodes only — skips the Redis `REVOKED_TOKENS_SET` check the HTTP paths use, so a revoked token still opens a WS.
**Fix:** Run the same revocation check in the WS dependency.
**Acceptance:** A revoked token cannot open a WebSocket.

### SEC-17 — 🟡 Medium — Real-looking secrets in working-tree `.env`
**Files:** `apps/api/.env` (gitignored, but contains `GOOGLE_CLIENT_SECRET=GOCSPX-…`)
**Problem:** `.env` is untracked (good) but holds a real-looking OAuth secret; developer-shared plaintext secrets risk leakage.
**Fix:** Rotate if live; move developer secrets out of plaintext; confirm CI/images never bake `.env`.
**Acceptance:** No live secret sits in a shared plaintext file.

---

# 🧱 Reliability & Data Integrity

### REL-01 — 🔴 Critical — Non-deterministic Stripe idempotency keys → double charge/refund
**Files:** `apps/api/app/domains/payments/service.py:89,191,202,273,376,410`, `apps/api/app/worker/celery_app.py:54`, `apps/api/app/worker/tasks/payment_tasks.py:27,242`
**Problem:** Every Stripe call passes `idempotency_key=str(uuid.uuid4())` generated inline. With Celery `acks_late=True` + `autoretry_for=(Exception,)`, a worker that captures/refunds then dies before commit re-runs and **charges/refunds twice**.
**Fix:** Derive deterministic keys from the operation (`capture:{payment_id}:{ra_id}`, `refund:{payment_id}:{hash}`) and persist them.
**Acceptance:** Replaying a payment task does not create a second Stripe charge.

### REL-02 — 🔴 Critical — Booking creation is not atomic (mid-flow commits; Celery before commit)
**Files:** `apps/api/app/domains/reservations/service.py:139-327` (commit at :323, separate session at :299), `apps/api/app/domains/reservations/repository.py:210`
**Problem:** Advisory lock + `FOR UPDATE SKIP LOCKED` are released at the first inner commit, **before** the final status update and request-level commit — collapsing the overbooking guard. Promo counter and auto-created task commit independently, leaving orphaned state on later failure.
**Fix:** One transaction per booking; remove inner commits; move side-effects to after-commit hooks.
**Acceptance:** A failure after vehicle selection rolls back promo/task changes; overbooking is prevented under concurrency.

### REL-03 — 🔴 Critical — Checkout writes never commit; Celery side-effects fire before commit
**Files:** `apps/api/app/domains/checkout/service.py:141,216,227,234,296,344,424`
**Problem:** `checkout`/`check_in`/`swap_vehicle`/`open_shift`/`close_shift` end with `flush()` (no commit) and rely on the router's commit — but `check_in` enqueues `process_bond_release.delay(...)` and auto-creates tasks via a separate committed session **before** the main transaction commits. An outer rollback leaves a bond-release job firing against a rental never marked RETURNED.
**Fix:** Enqueue Celery side-effects only after the owning transaction commits (FastAPI `BackgroundTasks` / transactional outbox).
**Acceptance:** A rolled-back check-in enqueues no bond-release job.

### REL-04 — 🟠 High — `agent_tasks.py` import bug breaks scheduled jobs
**Files:** `apps/api/app/worker/tasks/agent_tasks.py:42,90`, `apps/api/app/core/database.py:25`, `apps/api/app/worker/celery_app.py:208-217`
**Problem:** Imports `async_session_maker` which doesn't exist (only `AsyncSessionLocal`). `scan_ev_alerts` and `scan_overdue_rentals` (beat every 5/30 min) raise `ImportError` and dead-end — overdue/EV alerting is entirely non-functional.
**Fix:** `from app.core.database import AsyncSessionLocal as async_session_maker` (or rename usages).
**Acceptance:** Both beat jobs run without ImportError.

### REL-05 — 🟠 High — Payment capture not atomic with gateway; no reconcile before re-capture
**Files:** `apps/api/app/domains/payments/service.py:148-228`
**Problem:** incremental-auth → update → capture → status-update → single commit. If Stripe captures but the DB commit fails, money is captured with the row still `AUTHORIZED`; the retry (REL-01) captures again. No re-fetch of gateway state before acting.
**Fix:** Deterministic idempotency keys (REL-01) + re-fetch gateway state before capture; record the charge id before calling.
**Acceptance:** A mid-capture failure does not double-capture on retry.

### REL-06 — 🟠 High — `renew_expiring_preauths` re-renews on retry
**Files:** `apps/api/app/worker/tasks/payment_tasks.py:39-80`, `apps/api/app/domains/payments/service.py:262,273`
**Problem:** Batch task with retry; dying after renewing N of M re-renews already-renewed pre-auths with fresh idempotency keys → duplicate incremental auths. The Redis SETNX lock only guards concurrent runs, not cross-retry replays.
**Fix:** Deterministic idempotency keyed on `(payment_id, expiry_window)`.
**Acceptance:** Re-running the task does not duplicate incremental auths.

### REL-07 — 🟠 High — Stripe webhooks drop events without tenant metadata; no DLQ
**Files:** `apps/api/app/domains/payments/router.py:144-155`, `apps/api/app/domains/payments/service.py:454`
**Problem:** Missing `metadata.tenant_id` → returns 200 and drops the event (charges/disputes often lack metadata). Stripe stops retrying. Unhandled event types are also dropped.
**Fix:** Persist raw unresolved webhooks to a DLQ table for replay; resolve tenant via `gateway_payment_id` lookup.
**Acceptance:** No webhook is acked-and-dropped; unresolved events are replayable.

### REL-08 — 🟠 High — Refund webhook overwrites totals non-idempotently
**Files:** `apps/api/app/domains/payments/service.py:488-504`
**Problem:** `_on_charge_refunded` sets `refunded_amount = <absolute from Stripe>`, clobbering a concurrent local partial refund's running total.
**Fix:** Treat webhooks as source-of-truth via per-refund-id ledger rows, not a single mutable column.
**Acceptance:** Concurrent local + webhook refunds reconcile without corrupting totals.

### REL-09 — 🟡 Medium — PgBouncer transaction-mode vs advisory `xact` lock
**Files:** `apps/api/app/core/database.py:14,39`, `apps/api/app/domains/reservations/router.py:47`
**Problem:** Transaction-mode pooling + mid-flow commits (REL-02) means later statements may land on a different backend without the advisory lock.
**Fix:** Guarantee one transaction per booking (fixes alongside REL-02).
**Acceptance:** Lock is held for the whole booking unit of work.

### REL-10 — 🟡 Medium — No idempotency on reservation/guest-booking creation; quote token not consumed
**Files:** `apps/api/app/domains/reservations/router.py:133,328`, `apps/api/app/domains/reservations/service.py:161`
**Problem:** Double-click creates two reservations (two vehicles consumed); the rate-quote token is only TTL-expiring, not consumed on use.
**Fix:** Require a client idempotency key; delete the quote token from Redis on successful consumption.
**Acceptance:** A duplicate submit returns the same reservation; a used quote token cannot be reused.

### REL-11 — 🟡 Medium — Goodwill cap TOCTOU + broken interval literal
**Files:** `apps/api/app/domains/payments/service.py:366,383,567-580`
**Problem:** `INTERVAL ':days days'` string-built (invalid literal); cap read and write are not atomic, so two concurrent agent refunds both pass.
**Fix:** `NOW() - make_interval(days => :days)`; enforce the cap atomically (single conditional insert or row lock).
**Acceptance:** Concurrent refunds cannot exceed the cap.

### REL-12 — 🟡 Medium — `handle_no_show` transaction scoping
**Files:** `apps/api/app/domains/reservations/service.py:501-545`
**Problem:** Lock-and-update is only atomic if the caller session is a single transaction; the Celery path using `AsyncSessionLocal` must commit or the update is discarded.
**Fix:** Wrap in an explicit `async with session.begin()` like the webhook handler.
**Acceptance:** No-show status persists when run from the worker.

### REL-13 — 🟡 Medium — Cancellation never voids/refunds the pre-auth (TODO)
**Files:** `apps/api/app/domains/reservations/service.py:392-465` (returns `refund_payment_id=None`)
**Problem:** Computes a refund amount shown to the customer but never calls the payments domain; the held pre-auth is never voided.
**Fix:** Integrate the payments void/refund into the cancel flow (outbox-safe).
**Acceptance:** Cancelling a paid reservation voids/refunds and records the payment id.

### REL-14 — 🟡 Medium — `close_shift` cash variance is meaningless
**Files:** `apps/api/app/domains/checkout/service.py:316-320`
**Problem:** `expected_cash = opening_cash` hardcoded; cash-method takings are never summed, so the reconciliation control is a no-op.
**Fix:** Sum cash-method payments since shift open.
**Acceptance:** Variance reflects actual cash transactions.

### REL-15 — 🟡 Medium — Notification DLQ delivery-count logic mis-reads attempts
**Files:** `apps/api/app/worker/tasks/payment_tasks.py:316-330`
**Problem:** `times_delivered` read incorrectly → messages either loop forever or get dropped past attempt 3; `render_and_send` is not idempotent, so redelivery re-sends email/SMS.
**Fix:** Track attempts in the message payload / claim-retry counter; make send idempotent per `msg_id`.
**Acceptance:** A failing message reaches the DLQ after N attempts without duplicate sends.

### REL-16 — 🟡 Medium — No catch-all exception handler (stack-trace leak)
**Files:** `apps/api/app/main.py:96-103`
**Problem:** Only `AppError` + `IntegrityError` handlers registered; any other unhandled exception hits FastAPI's default 500 and may surface internals.
**Fix:** Add a generic `Exception` handler returning sanitized `problem+json`; log the trace server-side.
**Acceptance:** Unhandled errors return a generic body with no stack trace.

### REL-17 — 🟡 Medium — `mark_webhook_processed` rolls back inside a `begin()` block
**Files:** `apps/api/app/domains/payments/repository.py:150-153`, `apps/api/app/domains/payments/service.py:438`
**Problem:** `session.rollback()` on duplicate inside an enclosing `async with session.begin()` breaks the context manager and can raise on exit.
**Fix:** Use `begin_nested()` (SAVEPOINT) for the idempotency insert, or pre-check existence.
**Acceptance:** Duplicate webhook does not abort the enclosing transaction.

### REL-18 — 🟡 Medium — Stripe SDK blocks the event loop; per-process breaker; no timeout
**Files:** `apps/api/app/integrations/stripe_client.py`, `apps/api/app/integrations/base.py:34`
**Problem:** Synchronous Stripe SDK called without `run_in_executor` (slow Stripe stalls the worker); circuit-breaker state is in-memory per process (no cluster-wide protection, resets on deploy); no explicit per-call timeout.
**Fix:** Set SDK timeout/retries, run calls in a thread, back the breaker with Redis.
**Acceptance:** A slow Stripe does not block unrelated requests; breaker state survives deploys.

### REL-19 — 🟢 Low — Float used in checkout mileage/fuel charge calc
**Files:** `apps/api/app/domains/checkout/router.py:360-371`
**Problem:** Billed charges computed in float (money elsewhere is correctly `Numeric(10,2)`).
**Fix:** Route billed amounts through `Decimal`.
**Acceptance:** No float arithmetic on billed money.

---

# 📡 Observability, Deployment & Operations

### OPS-01 — 🔴 Critical — Terraform modules are empty stubs (no real infra)
**Files:** `infra/terraform/modules/*/main.tf` (rds/secrets/alb/ecs-api/elasticache/monitoring/cloudfront/iam/ecs-workers all 1–3 lines), `infra/terraform/environments/prod/main.tf:27`
**Problem:** No RDS, ECS, ALB, Secrets Manager, WAF, or autoscaling actually exists. All infra claims are comment-text.
**Fix:** Implement the modules.
**Acceptance:** `terraform plan` produces real, reviewable resources for a prod environment.

### OPS-02 — 🔴 Critical — Deploy pipeline is non-functional stubs
**Files:** `.github/workflows/deploy.yml:42-44,88-99`
**Problem:** Task-def registration, CodeDeploy, prod migration, and Slack notify are `echo "Stub"`. No real deploy or rollback.
**Fix:** Implement ECS task-def + CodeDeploy blue/green; run real `alembic upgrade head` for prod.
**Acceptance:** A merge to main deploys an immutable image with a tested rollback path.

### OPS-03 — 🔴 Critical — No secrets management
**Files:** `docker-compose.yml:75`, `infra/terraform/modules/secrets/main.tf`, `apps/api/app/core/config.py`
**Problem:** Secrets injected via plaintext compose/env; Secrets Manager + KMS module is a stub; no Vault/SSM integration.
**Fix:** Implement the secrets module; inject prod secrets via ECS `secrets` (valueFrom SSM/Secrets Manager); never bake `.env`.
**Acceptance:** No secret appears in env files or images in prod.

### OPS-04 — 🔴 Critical — No edge protection (WAF / rate-limit / DDoS)
**Files:** `infra/terraform/modules/alb/main.tf` (WAF stub)
**Problem:** No WAFv2, AWS Shield, or edge rate limiting. App-level limits exist only on OTP. (See SEC-05.)
**Fix:** WAFv2 (rate-based + managed rules) on the ALB + global limiter middleware.
**Acceptance:** Abusive traffic is throttled at the edge.

### OPS-05 — 🔴 Critical — No backup / PITR / DR
**Files:** `infra/terraform/modules/rds/main.tf`, `rds/variables.tf:7`
**Problem:** Only comments; no implemented snapshots, multi-AZ, PITR, cross-region copy, or documented RPO/RTO.
**Fix:** Implement RDS with backup retention, multi-AZ, deletion protection, automated + cross-region snapshots; document RPO/RTO.
**Acceptance:** A restore drill recovers to a point in time.

### OPS-06 — 🟠 High — Frontends have no prod Dockerfile / not in pipeline
**Files:** `apps/web-{admin,booking,counter}/Dockerfile` (absent), `.github/workflows/build-push.yml`, `infra/terraform/modules/cloudfront/main.tf`
**Problem:** Only API + worker images are built; the 3 frontends aren't containerized or deployed. (web-counter PWA offline support *is* built — `apps/web-counter/src/service-worker.ts`.)
**Fix:** Add prod build/containerization (or S3 + CloudFront static) for all three; wire into CI/CD.
**Acceptance:** Each frontend has a reproducible prod artifact in the pipeline.

### OPS-07 — 🟠 High — Sentry configured but never initialized
**Files:** `apps/api/app/core/config.py:104`, `apps/api/app/main.py`
**Problem:** `sentry_dsn` defined but no `sentry_sdk.init()` anywhere — errors are not captured.
**Fix:** `sentry_sdk.init(...)` in `create_app()` with FastAPI + Celery integrations (or remove dead config).
**Acceptance:** A raised exception appears in Sentry.

### OPS-08 — 🟠 High — No tracing in worker or LLM/agent path
**Files:** `apps/api/app/core/observability.py`, `apps/api/app/worker/celery_app.py`, `apps/api/app/domains/agents/`
**Problem:** `init_tracing` only runs in API `main.py`; Celery has no `CeleryInstrumentor`; the agent path has zero spans. Distributed traces break at API→worker and API→LLM.
**Fix:** Instrument Celery via `worker_process_init`; wrap LLM calls in spans.
**Acceptance:** A booking trace spans API → worker → LLM.

### OPS-09 — 🟠 High — No metrics layer
**Files:** repo-wide (no Prometheus/StatsD/`/metrics`)
**Problem:** No RED/USE metrics, no `/metrics` endpoint, no SLO instrumentation. CloudWatch alarms module is a stub.
**Fix:** Add `prometheus-fastapi-instrumentator` or OTel metrics + a monitoring module with alarms.
**Acceptance:** Latency/error/throughput metrics are scrapeable and alarmed.

### OPS-10 — 🟠 High — Single health check; no liveness/readiness split
**Files:** `apps/api/app/core/dependencies.py:18`, `apps/api/app/Dockerfile:34`, `apps/api/app/main.py:27-30`
**Problem:** One `/health` pings DB + 2 Redis clusters (skips broker) and is used as both probe — a transient Redis blip 503s and kills the task instead of draining. Startup also fails open on Redis errors.
**Fix:** Add `/livez` (process) + `/readyz` (deps); classify hard-fail vs degraded; include broker.
**Acceptance:** A transient dep blip drains, not kills, the task.

### OPS-11 — 🟠 High — PII written to logs
**Files:** `apps/api/app/domains/reservations/router.py:120`, `apps/api/app/integrations/smtp_client.py:43`, `apps/api/app/domains/auth/service.py:330` (raw OAuth token body), `apps/api/app/core/middleware.py:16-22`
**Problem:** Emails, recipient addresses, and raw OAuth token responses are logged; no redaction processor.
**Fix:** Add a structlog redaction processor; scrub email/phone/token fields.
**Acceptance:** Logs contain no raw PII/tokens.

### OPS-12 — 🟡 Medium — No centralized log shipping
**Files:** Dockerfiles / (stub) ECS task defs, `infra/terraform/modules/monitoring/main.tf`
**Problem:** structlog JSON goes to stdout with no log driver/log group in prod.
**Fix:** Configure `awslogs`/FireLens + log group with retention.
**Acceptance:** Prod logs are queryable centrally.

### OPS-13 — 🟡 Medium — No SAST/dep/secret scanning; frontend coverage unenforced
**Files:** `.github/workflows/test.yml:91,115,120-140`
**Problem:** No CodeQL/Trivy/`pip-audit`/`npm audit`/gitleaks; Codecov `fail_ci_if_error: false`; frontend job has no coverage threshold.
**Fix:** Add a security-scan job; enforce frontend coverage.
**Acceptance:** A known-vulnerable dep or leaked secret fails CI.

### OPS-14 — 🟡 Medium — Deploy decoupled from the tested SHA
**Files:** `.github/workflows/build-push.yml:4-7`, `.github/workflows/deploy.yml:4-7`
**Problem:** `workflow_run` chaining; the deploy never receives/pins the build's image tag (only echoed) — risk of `:latest` race or wrong SHA.
**Fix:** Pass the immutable image tag through to deploy; pin task defs (never `:latest`).
**Acceptance:** Deploy uses the exact tested image digest.

### OPS-15 — 🟡 Medium — No autoscaling / prod connection pooling
**Files:** `infra/terraform/modules/{rds,ecs-api}/main.tf` (stubs)
**Problem:** No ECS autoscaling policies or prod pooling (RDS Proxy/PgBouncer sidecar).
**Fix:** Target-tracking autoscaling + a real pooling layer.
**Acceptance:** Service scales on CPU/req-count; pool survives connection storms.

### OPS-16 — 🟡 Medium — `request_id` not propagated to traces/worker/downstream
**Files:** `apps/api/app/core/middleware.py:58-72`, `apps/api/app/core/config.py:96`
**Problem:** Request ID is bound to logs/response only — not into Celery headers, OTel span attributes, or outbound httpx/agent-internal calls. Correlation breaks across hops.
**Fix:** Propagate request_id into Celery task headers, span attributes, and outbound headers.
**Acceptance:** One request_id correlates API → worker → LLM logs/traces.

### OPS-17 — 🟡 Medium — Health fails open at startup, masking Redis outages
**Files:** `apps/api/app/main.py:27-30`
**Problem:** Redis init errors are swallowed ("continue without cache"); `/health` doesn't check the broker, so a degraded broker won't fail the ALB check.
**Fix:** Make broker reachability a readiness signal; alarm on degraded startup.
**Acceptance:** A down broker marks the instance not-ready.

### OPS-18 — 🟡 Medium — Prod migrations have no guard/rollback
**Files:** `.github/workflows/deploy.yml:36-44,88`, `.github/workflows/test.yml:99`
**Problem:** Staging runs `alembic upgrade head`; prod is a stub. Lock-safety check exists in CI but no backout if a deploy fails post-migration.
**Fix:** Expand-contract migrations + lock-safety gate applied to prod + documented rollback.
**Acceptance:** A failed deploy leaves the DB on a backward-compatible schema.

---

# 🧪 Testing & Code Quality

### TEST-01 — 🟠 High (launch-blocking for confidence) — Frontend CI test step is a no-op; zero FE tests
**Files:** `.github/workflows/test.yml:140`, `apps/web-{admin,booking,counter}` (no `*.test.*`/`*.spec.*`)
**Problem:** `vitest run` with no tests exits 0 → CI passes green at 0% frontend coverage.
**Fix:** Add component tests for critical pages; run with `--passWithNoTests=false`.
**Acceptance:** An empty frontend suite fails CI; critical pages have tests.

### TEST-02 — 🟠 High — Coverage threshold never enforced; missing setup file
**Files:** `apps/web-admin/vite.config.ts:22-37`
**Problem:** 70% thresholds only apply under `--coverage` (CI runs plain `vitest run`); `setupFiles: ['./src/test-setup.ts']` references a non-existent file.
**Fix:** Run `test:coverage` in CI; create the setup file.
**Acceptance:** Frontend coverage gate runs and the suite loads.

### TEST-03 — 🟡 Medium — OpenAPI schema + typed client absent; drift unguarded
**Files:** `apps/api/openapi.json` (absent), `turbo.json:10-15` (generate-client/drift-check targets with no scripts)
**Problem:** No generated `schema.d.ts`; frontend isn't typed from the API; drift is unguarded.
**Fix:** Generate `openapi.json` in CI; emit `schema.d.ts` via `openapi-typescript`; add a drift gate.
**Acceptance:** API/client drift fails CI.

### TEST-04 — 🟡 Medium — `apiClient` untyped/undefined in web-admin
**Files:** `apps/web-admin/src/App.tsx:128` (`(apiClient as any).POST('/auth/login', …)`)
**Problem:** `apiClient` has no definition; the cast bypasses all typing on the auth path.
**Fix:** Define a typed `openapi-fetch` client from `schema.d.ts`; drop the cast.
**Acceptance:** Login call is fully typed; no `as any`.

### TEST-05 — 🟡 Medium — Agents domain (LLM) has zero tests
**Files:** `apps/api/app/domains/agents/` (~2,490 LOC, incl. `agents/llm_agent.py`, `service.py` fast-path)
**Problem:** The LLM-driven booking fast-path that mutates reservations is completely untested.
**Fix:** Unit-test `_booking_fast_path` with a stubbed LLM; test `tool_wrapper` authorization.
**Acceptance:** Booking fast-path and tool auth have passing unit tests.

### TEST-06 — 🟡 Medium — No e2e funnel test; Playwright suite referenced but absent
**Files:** `.github/workflows/deploy.yml:55` (runs `e2e/tests/smoke/` — directory absent), no `playwright.config.*` / dep
**Problem:** The smoke-test step has nothing to run; no cross-stack booking→checkout→pre-auth test.
**Fix:** Commit a Playwright project with a booking-funnel smoke test; add the dep.
**Acceptance:** `playwright test` runs a green booking smoke against staging.

### TEST-07 — 🟡 Medium — Multiple domains have no tests
**Files:** `apps/api/tests/` (none for `admin`, `agents`, `billing`, `corporate`, `maintenance`; 1 touch for `reporting`/`tasks`/`channels`/`dashboard`)
**Problem:** Billing and maintenance (revenue/asset paths) are entirely untested.
**Fix:** Add unit suites for billing and maintenance at minimum.
**Acceptance:** Each revenue/asset service has meaningful tests.

### TEST-08 — 🟡 Medium — Coverage gate measures unit only; integration uncounted
**Files:** `.github/workflows/test.yml:90-97,108` (no `.coveragerc`)
**Problem:** `--cov-fail-under=80` runs over `tests/unit/` only; assertion-dense integration suites don't count, so the number may be loose or gamed.
**Fix:** Measure combined coverage (unit + integration) or document the split; add `.coveragerc`.
**Acceptance:** The reported number reflects all executed tests.

### TEST-09 — 🟡 Medium — Unit tests fully mock the DB; thin constraint coverage
**Files:** `apps/api/tests/unit/payments/test_service.py:1-46`, `apps/api/tests/integration/test_db_constraints.py`
**Problem:** Unit tests mock session + Stripe (no real mapping/constraint exercise); DB-constraint integration is thin relative to size.
**Fix:** Strengthen DB-constraint integration assertions (FK/unique/check per table).
**Acceptance:** Key constraints are asserted in integration tests.

### TEST-10 — 🟡 Medium — `as any` across critical admin paths
**Files:** `apps/web-admin/src/pages/ReturnProcessingPage.tsx:74,84,94`, `InspectionsPage.tsx:123,137`, `FleetPage.tsx:48,59`, `TaskBoardPage.tsx:60,244`
**Problem:** Error-parsing and mutation payloads are untyped, defeating response typing on failure branches.
**Fix:** Define a typed `ApiError`; type mutation payloads from schema.
**Acceptance:** No `as any` on these paths.

### TEST-11 — 🟡 Medium — web-booking routes typed `any`
**Files:** `apps/web-booking/app/components/Navbar.tsx:66,79,108,116,154,162,180,184`, `Footer.tsx:32`, `booking/[id]/page.tsx:191`
**Problem:** Next.js typed-routes bypassed wholesale.
**Fix:** Enable `typedRoutes`; remove casts.
**Acceptance:** No `as any` on hrefs.

### TEST-12 — 🟡 Medium — CI ruff runs a weaker ruleset than configured
**Files:** `.github/workflows/test.yml:84` (`--select E,W,F`) vs `apps/api/pyproject.toml` (full E,W,F,I,B,C4,UP,N,S,T20,RUF)
**Problem:** Security (`S`/bandit), bugbear (`B`), naming (`N`) lints are configured but not enforced in CI.
**Fix:** Run config-driven `ruff check apps/api/app/`.
**Acceptance:** CI ruff matches `pyproject.toml` select set.

### TEST-13 — 🟡 Medium — No load/performance testing
**Files:** repo-wide (no k6/locust)
**Problem:** High-concurrency paths (availability calendar, pre-auth) have no load coverage.
**Fix:** Add a k6 script for availability + booking-create.
**Acceptance:** A load profile runs in CI/nightly with thresholds.

### TEST-14 — 🟡 Medium — No Python formatter gate
**Files:** `.github/workflows/test.yml` (no `ruff format --check`)
**Problem:** Formatting drift is unguarded.
**Fix:** Add `ruff format --check apps/api/`.
**Acceptance:** Misformatted Python fails CI.

### TEST-15 — 🟡 Medium — Frontend eslint config appears absent
**Files:** `apps/*` (no `.eslintrc*`/`eslint.config.*` found)
**Problem:** `eslint src` may run with default/zero rules.
**Fix:** Commit an explicit eslint flat config per app.
**Acceptance:** Lint enforces a real ruleset.

### TEST-16 — 🟡 Medium — `test` depends on `build` (fragility)
**Files:** `turbo.json:17`
**Problem:** A build failure blocks tests from reporting; combined with the no-op test, the FE job effectively verifies only build+lint+typecheck.
**Fix:** Decouple `test` from `build`.
**Acceptance:** Tests run/report independent of build success.

---

# 🤖 AI Agent Subsystem

> SEC-02 (tenant header), SEC-05 (rate limit), SEC-06 (BYOK plaintext), SEC-10 (`AGENT_SERVICE` scope), and OPS-08/09 (tracing/metrics) also apply to the agent. Listed here are agent-specific issues.

### AGENT-01 — 🔴 Critical — No ownership check on agent lookup/cancel
**Files:** `apps/api/app/domains/reservations/service.py:392`, `apps/api/app/domains/agents/agents/llm_agent.py:554,612`
**Problem:** `cancel_reservation` checks only `status==CONFIRMED`, never ownership. The agent looks up any reservation by confirmation number and can cancel it — a guest who learns/guesses a number (or prompts "cancel RCM-…") cancels a stranger's booking.
**Fix:** Bind sessions to an authenticated `customer_id`; enforce `reservation.customer_id == session.customer_id` on lookup/cancel; require an email second-factor for guest sessions.
**Acceptance:** The agent cannot read/cancel a reservation the session doesn't own.

### AGENT-02 — 🟠 High — No rate limit / token budget on `POST /agents/chat`
**Files:** `apps/api/app/domains/agents/router.py:20,31-42`, `apps/api/app/domains/agents/agents/llm_agent.py:17`
**Problem:** Unauthenticated; no per-IP/session/tenant limit, no `message` length cap, no daily token/cost ceiling. Each call triggers up to 6 LLM round-trips — scriptable to burn LLM spend (system key or a victim tenant's BYOK key via SEC-02).
**Fix:** Per-IP + per-session + per-tenant sliding-window limits; cap message length (~2KB); enforce a daily token/cost budget per tenant before calling the model.
**Acceptance:** Excess chat requests return 429; a tenant's daily token budget is enforced.

### AGENT-03 — 🟡 Medium — Prompt injection can drive state-changing tools
**Files:** `apps/api/app/domains/agents/agents/llm_agent.py:222-234`
**Problem:** The loop executes whatever `tool_calls` the model emits, args verbatim. With the over-privileged token (SEC-10) and missing ownership checks (AGENT-01), a crafted message steers `lookup`/`cancel`/`create` against arbitrary targets.
**Fix:** Gate state-changing tools behind deterministic server-side ownership + explicit user confirmation; validate/whitelist tool args against session context.
**Acceptance:** A prompt-injected "cancel RCM-X" cannot cancel a non-owned reservation.

### AGENT-04 — 🟡 Medium — LLM call has no timeout/retry/circuit-breaker; SPOF
**Files:** `apps/api/app/domains/agents/agents/llm_agent.py:179`, `apps/api/app/core/config.py:92`
**Problem:** `chat.completions.create` has no `timeout=`, retry, or breaker (the AgentTool HTTP timeout doesn't cover it); the model endpoint (NVIDIA NIM / local LM Studio) is a hard, often-unauthenticated, non-HA dependency.
**Fix:** Explicit per-call timeout + bounded retries + circuit breaker; run the model behind an authenticated, redundant gateway.
**Acceptance:** A slow/down model returns a fast graceful error, not a hung request.

### AGENT-05 — 🟡 Medium — No agent observability / cost ledger
**Files:** `apps/api/app/domains/agents/agents/llm_agent.py:179` (`resp.usage` discarded)
**Problem:** No structured logs/spans per turn; token usage, tool calls, latency, and per-tenant cost are not recorded — abuse and BYOK billing can't be tracked.
**Fix:** Emit per-turn structured logs/spans (session_id, tenant_id, tool+args redacted, `resp.usage`, latency); persist a per-tenant cost ledger.
**Acceptance:** Each chat turn produces a queryable record with token usage.

### AGENT-06 — 🟡 Medium — Misc agent hardening (grouped)
**Files:** `apps/api/app/domains/tenants/router.py:146-157`; `apps/api/app/domains/agents/agents/llm_agent.py:252-396,626`; `apps/api/app/domains/agents/session_store.py`; `apps/api/app/domains/agents/router.py:67`; `apps/api/app/domains/agents/tool_wrapper.py:59`
**Problem (sub-items):**
- `get_llm_settings` requires only any-authenticated-user and isn't tenant-scoped → reads another tenant's LLM config/key suffix (require `admin:config` + `tenant_id==claims.tenant_id`).
- Booking fast-path `_parse_kv` trusts unvalidated user-typed `__rcm_book__`/`Book:` fields (no allowlist/types) — a user can inject fields directly in the chat box.
- Quote token can expire (30s) mid-flow; fast-path never re-quotes → opaque booking failure.
- Redis session-store ops have no try/except → unhandled 500 on `/chat`; SSE error event leaks `str(exc)` to the client.
- Tool error text (`HTTP {status}: {resp.text[:300]}`, validation `detail`) leaks internal details to the user/model.
- System Anthropic key fallback spends the shared key for any tenant with no budget; orchestrator agent `jti` is non-revocable; frontend trusts `data.card` shape unchecked.
**Fix:** Per sub-item above — permission+scope on settings, allowlist/validate parsed fields and authenticate the structured channel, re-quote on expiry, graceful session-store degradation + sanitized SSE errors, map tool errors to safe messages, require explicit per-tenant key/budget, validate card shape client-side.
**Acceptance:** Each sub-item closed (track as subtasks).

---

## What's already solid (calibration — shortens the path)
Bcrypt + httpOnly/Secure/SameSite cookies; refresh rotation with reuse detection; Stripe webhook signature verification; no PAN/CVV stored; money as `Numeric(10,2)`; reversible migrations on a linear chain; `strict: true` across all TS configs + mypy strict; assertion-dense backend *integration* tests on real Postgres/Redis; a real PWA offline layer (web-counter); a thoughtful (if unimplemented) observability/blue-green design; alembic lock-safety gate wired in CI.
