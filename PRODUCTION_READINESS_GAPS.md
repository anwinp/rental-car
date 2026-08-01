# Production Readiness — Multi-Tenancy & User Management Gap Register

Consolidated from a five-agent audit (tenant lifecycle, isolation/RLS, RBAC, auth/sessions,
operations), deduplicated and severity-ranked. Findings marked **[reproduced]** were verified
independently against the running local stack, not taken from an agent report.

Scope: local instance. Production was read-only throughout — nothing was changed there.

---

## The one-paragraph version

The isolation *design* is good — tenant resolution order of authority, transaction-scoped GUC
stamping, PgBouncer handling, and the invitation/verification token model are all correct and
worth keeping. The gap is that almost none of it is **enforced** where it matters. Every deploy
template connects to Postgres as the owning superuser, which makes all 28 `FORCE ROW LEVEL
SECURITY` policies decorative in any deployed environment. On top of that, several surfaces
bypass RLS even locally, identity can be minted across tenants, account recovery does not
actually recover an account, and production cannot send the emails the signup flow depends on.
Nothing here is unfixable, but the system is not currently safe to put a second paying customer on.

---

## Blocker class A — Isolation is not enforced in any deployed environment

These invert the severity of everything in class B. Locally most cross-tenant reads fail closed;
in production, as configured, they return every tenant's rows.

### A1. Every deploy template connects as the DB owner (superuser) — CRITICAL
`deploy/.env.prod.example` and `deploy/docker-compose.prod.yml` both set the app's `DATABASE_URL`
user to `rcm`, the database owner. Superusers and owners bypass row-level security. All 28 tables'
policies are inert in production, including a fresh deploy from a clean checkout.

Local `apps/api/.env` was migrated to the non-owner `app_user`; the deploy layer was not.

Not a one-line env change: PgBouncer's own `DATABASE_URL` is built from `POSTGRES_USER`/`PASSWORD`
with `AUTH_TYPE: scram-sha-256` and no `auth_user`/`auth_query`/userlist, so pointing the app at
`app_user` fails authentication at the pooler until that is configured too.

### A2. `app_user`'s password is hardcoded in a committed migration — CRITICAL
`alembic/versions/20260801_052_app_user_runtime_role.py` falls back to `"rcm_app_dev_password"`
when `APP_DB_PASSWORD` is unset. That variable appears nowhere outside the migration — not in
`.env.prod.example`, `docker-compose.prod.yml`, `init-data.sh`, or `README-DEPLOY.md`, and
`init-data.sh` runs `alembic upgrade head` without it in scope. The migration then grants the role
full DML on all tables plus default privileges on future ones.

Result: a login-capable Postgres role with a public password and cross-tenant read/write, which
cannot be rotated by changing an env var. Blast radius is currently limited only by `rcm_internal`
publishing no ports.

### A3. Security lint that would have caught A2 is switched off — HIGH
`test.yml` narrows ruff to `--select E,W,F`, discarding the `S` (bandit) ruleset that `pyproject.toml`
configures. There is no secret scanning, no `pip-audit`/`npm audit`, no dependabot, no CODEOWNERS.

---

## Blocker class B — Live data exposure

### B1. Cross-tenant PII leak on the public reservation lookup — CRITICAL **[reproduced]**
`GET /reservations/public/{confirmation}` queries with no tenant predicate. For anonymous requests
the `X-Tenant-ID` header *is* the tenant selector, so supplying any tenant UUID returns another
workspace's reservation:

```
no header               → {"detail":"Reservation not found"}
X-Tenant-ID: <any uuid> → Michael Young | michael0b1d4e@example.com | $3,222.91
```

Confirmation numbers are `RCM-YYYYMMDD-XXXXXX` under a **globally unique** index (`idx_res_confirmation`),
so they are enumerable across all tenants at once. Tenant UUIDs are not secrets.

### B2. `audit.audit_events` has no RLS — CRITICAL
11,605 rows spanning 17 tenants, readable by `app_user`. The table stores full before/after row
snapshots, making it a superset of the PII that RLS elsewhere protects. Also missed by tenant
deletion (see D2), so it retains data after a customer is offboarded.

### B3. Partitioned tables bypass RLS entirely — CRITICAL
RLS was enabled on partition parents only. Querying a partition directly
(e.g. `notification_log_p20260801`) returns every tenant's rows.

### B4. `tenants` and `email_verifications` have no RLS, with full DML granted — CRITICAL
Any tenant's connection can read and rewrite the tenant registry itself, including subscription
tier and status. (`staff_invitations` is deliberately exempt — see the note in migration 058 — but
`tenants` is not.)

### B5. Shared catalogues can be wiped or hijacked — CRITICAL **[reproduced]**
Migration 053's asymmetric policy permits `tenant_id IS NULL` in `USING`. Because `DELETE` is
filtered by `USING` only, a tenant can delete all global rows:

```
notification_templates: before 35 → DELETE 35 → after 0
```

`UPDATE ... SET tenant_id = <mine>` additionally lets one tenant *claim* the 12 global vehicle
classes as its own, removing them from everyone else.

**My regression test for this is vacuous.** `tests/isolation_suite.py:227` claims to prove an
unscoped DELETE cannot reach shared rows, but the statement it runs is
`DELETE FROM extras_catalog WHERE tenant_id = $1` — explicitly scoped. It passes without testing
anything.

### B6. The isolation suite reports 19/19 green while B1 is live — HIGH
It only exercises the no-header case, which was already safe. Header-forgery coverage exists for
authenticated routes but not for the anonymous public ones.

### B7. Cross-tenant FKs, unscoped money movement, broken webhook idempotency — HIGH
- Foreign keys exist that can point across tenant boundaries.
- `process_bond_release` moves money with no tenant predicate.
- `processed_webhooks` idempotency is broken where `tenant_id IS NULL`.

---

## Blocker class C — Identity and session integrity

### C1. `POST /auth/agent-token` takes `tenant_id` from the request body — CRITICAL
`auth/router.py:467` does `tenant_id=_uuid.UUID(payload.tenant_id)` with no check against the
caller's own tenant: a cross-tenant identity mint. Separately the endpoint is currently broken
(`HTTPException` is not imported in that module, so the authorisation branch raises `NameError`
and returns 500 for everyone). It fails closed today, but the design is wrong and the denial is
indistinguishable from a crash. The intended 90-day token also mints with the 1-hour web TTL.

### C2. Password reset and change do not revoke refresh tokens — CRITICAL
Only *access* JTIs are indexed in `user_sessions:{uid}`; `refresh:{jti}` keys are never deleted,
and `change_password` revokes nothing at all. Demonstrated: after a completed reset the old access
token 401s but the old refresh token still rotates 200 and mints fresh access tokens — for the
remaining 30 days.

A stolen session survives the single control users and support staff reach for.

### C3. Refresh-reuse detection revokes nothing, and is attacker-triggerable — CRITICAL
On detecting a replayed refresh token the code deletes `user_sessions:{uid}` — the *index*, not the
sessions. No JTI is deny-listed, no session key removed; the live session keeps working. Because
that index is also the only input to C2's partial cleanup, an attacker can replay a rotated token
to pre-emptively disable the victim's future "reset kills my sessions" behaviour. No logging or
alerting on the branch.

### C4. MFA is unenforceable — CRITICAL
`AuthService.login` never consults `user.is_mfa_enabled` (confirmed: no reference anywhere in the
login path). With MFA enabled on an account, password-only login still returns a full-privilege
session. The 10 backup codes are written with a 24h TTL and consumed by no endpoint. `/auth/mfa/verify`
has no attempt counter and `valid_window=1` widens the target to ~3 live codes.

MFA that exists in the UI and changes nothing is worse than no MFA.

### C5. OTP login accepts any six digits — HIGH
When `TWILIO_VERIFY_SERVICE_SID` is unset — which it is — the live branch is
`verified = len(body.code) == 6 and body.code.isdigit()`. Any deployment that configures Twilio for
SMS but not Verify ships a total authentication bypass for every staff account with a phone number.
The handler also skips `is_active` and `locked_until`, bypassing disablement and lockout.

Currently masked only by a 500 from a join against a table that does not exist (`user_locations`).
`/auth/otp/send` is also a phone-number oracle (400 vs 202) rate-limited per-phone only.

### C6. Reset and invitation links are built from an attacker-controlled header — HIGH
`auth/router.py:240` takes `Origin` (falling back to `Host`) with no allow-list and passes it to
`reset_base_url`. An attacker POSTs a reset for a victim with `Origin: https://attacker.example`;
the victim receives a genuine, correctly-branded email from the real system whose button carries a
valid 24h token to the attacker's host. Same pattern in `team_router.py:247` for invitations.

### C7. Google OAuth `state` is not bound to the browser — HIGH
The authorize redirect sets no cookie (confirmed: 302 with no `Set-Cookie`), so `state` is a bearer
ticket anyone can mint and redeem — textbook login CSRF, landing the victim inside the attacker's
account. The tenant is taken from a query parameter, so a session can be minted for any workspace
from anywhere. Additionally: `redirect_uri` is echoed from the request body to Google, the exchange
endpoint is unauthenticated, and account linking matches an existing customer by email without
checking `verified_email`.

### C8. No rate limiting on login; lockout is an enumeration oracle and a DoS — HIGH
The unknown-user path is careful (real bcrypt dummy hash, indistinguishable body and timing), but
the fourth attempt returns a distinct `account-locked` problem type with an `unlock_at` timestamp —
so four requests reliably answer "does this account exist". `LOGIN_FAIL_KEY` is declared and never
used; there is no IP or tenant dimension. An attacker can enumerate a workspace's staff roster and
then lock every administrator out on a 15-minute loop from a single IP. Lockout also fires on the
4th failure, not the documented 5th.

### C9. Revocation is deny-list only — a Redis wipe un-revokes everything — HIGH
`get_current_user` checks `SISMEMBER revoked_tokens` but never that `session:{jti}` still exists.
`revoked_tokens` is one unbounded, TTL-less SET on a `volatile-lru` cluster (a policy that never
evicts TTL-less keys, so it grows until writes fail). Any restart without persistence, failover, or
flush restores every logged-out, rotated, stolen, or reset-invalidated token to full validity —
up to 8h for counter sessions.

### C10. WebSocket auth ignores revocation and takes JWTs in the URL — HIGH
`verify_ws_token` decodes and stops — no revocation or session check. A logged-out token still opens
`/fleet/ws/fleet/{location_id}` and streams live fleet data. The intended one-time `ws_token:` key is
issued but can never validate (the verifier tries to JWT-decode a random UUID), leaving the query-string
JWT as the only working path — into proxy logs, browser history, and `Referer` headers.

---

## Blocker class D — Tenant lifecycle

### D1. Provisioning creates zero `rate_schedule_items` — a new tenant cannot quote — CRITICAL **[reproduced]**
`coastline-car-hire`, `bayview`, and `harbor-rentals` each have 1 rate code and **0 schedule items**
(the hand-built `test-rental-co` has 4/70). Every self-service signup lands in a workspace that
cannot produce a price, which is the first thing the onboarding checklist asks them to do.

### D2. Deletion misses 11 tenant-bearing tables — CRITICAL
Including `audit.audit_events` and six `archive.*` tables. Customer data survives offboarding — a
GDPR/CCPA erasure problem, not just a tidiness one.

### D3. Deletion fails partially and silently — CRITICAL
Errors on individual tables are swallowed; the caller is told the tenant was removed.

### D4. Both `pg_cron` jobs have been failing since 15 July — CRITICAL **[reproduced]**
Partition creation and archival have not run in over two weeks. Nothing surfaces this.

### D5. No backup, restore, or export path — CRITICAL
No per-tenant backup, no point-in-time restore procedure, and no data export for a departing
customer. There is no tested answer to "restore this one tenant to yesterday".

### D6. Tenant status is enforced only at login and refresh — HIGH
A suspended workspace's already-issued access tokens keep working until natural expiry (up to 8h
on counter). Suspension for non-payment or abuse is not immediate.

---

## Blocker class E — Operations

### E1. Production cannot send email at all — CRITICAL **[reproduced]**
`deploy/.env.prod.example` sets no `SMTP_*` block, and its `SENDGRID_API_KEY=SG.xxx` matches
`_is_placeholder`. Both transports are skipped and `mailer` falls through to logging.

```
SENDGRID_API_KEY  SG.xxx  → placeholder=True
SMTP_HOST present in .env.prod.example: False
```

Signup verification, password reset, and staff invitations all silently no-op while returning HTTP
201/202. Because login refuses unverified workspaces, **no account can ever be activated in
production**. The same placeholder trap silently disables Stripe, Avalara, and Twilio.

### E2. Production workspace URLs point at `localtest.me` — HIGH
`public_booking_host` / `public_admin_host` / `public_url_scheme` default to `localtest.me:3400`,
`localtest.me:3002`, `http`, and prod sets none of them. The signup success screen and
`/public/config` — fetched by every frontend at boot — hand customers a `localtest.me` URL.

Worse structurally: `Caddyfile.rcm.snippet` defines only flat hosts, with no wildcard block, no
`*.ceez.ai` cert, and no DNS for per-tenant subdomains. On `rcm-admin.ceez.ai` the derived slug is
`"rcm-admin"` (no match); on `rcm.ceez.ai` it is `"rcm"`, which is in `RESERVED_SLUGS`. **Hostname-based
tenant resolution cannot resolve any tenant in the deployed topology.**

### E3. `tenant_id` is null on every log line — CRITICAL **[reproduced]**
`request.state.tenant_id` is set in exactly one place — the legacy `get_tenant_id` dependency, which
nothing uses. The multi-tenancy rework publishes to a ContextVar instead and never writes back to
request state, so the access log's `tenant_id` field is always null.

At 3am with an error spike you cannot tell whether one tenant is melting down or all of them, cannot
scope a rollback, and cannot tell a customer whether they were affected.

### E4. `/health` is green while all background work is dead — HIGH **[reproduced]**
```
{"status":"healthy","checks":{"database":"ok","redis_avail":"ok","redis_sessions":"ok"}}
```
`redis_broker` is a separate container and is not checked. If it dies, Caddy keeps routing and no
notification, report, or scheduled job runs, with no signal anywhere. The check also interpolates
raw exception text (host, port, user) into an unauthenticated, publicly-routed response body.

### E5. Four of thirteen scheduled jobs have no consumer — HIGH **[reproduced]**
`rate_filing.py` and `toll_processing.py` are 1-line empty files with zero registered tasks, yet beat
targets them; `agent_tasks.scan_ev_alerts` and `scan_overdue_rentals` are registered but no prod
worker consumes the `agents` queue. Pre-auth renewals and toll batching never run.

Because the broker is `--maxmemory 512mb --maxmemory-policy noeviction`, messages into the three
consumerless queues accumulate indefinitely (~300/day from the 5-minute EV scan alone). When it
fills, **every** task publish system-wide starts failing.

### E6. No error tracking, no metrics, no tracing — HIGH **[reproduced]**
Sentry is configured and never initialised (0 references in `app/`, `sentry-sdk` not in
requirements). No `prometheus-client`, no `/metrics` (404). `observability.py` imports an OTLP
exporter that is not installed, so tracing raises `ImportError` and is swallowed at startup.

An unhandled 500 produces one JSON log line with a null tenant id. No alert, no dashboard movement.

### E7. No React error boundary in any frontend — CRITICAL **[reproduced]**
Zero matches for `componentDidCatch` / `getDerivedStateFromError` / `ErrorBoundary` / `error.tsx`
across all apps and packages. Reachable today: `StaffDailyTaskListPage` maps over `data.sections`
without an `res.ok` check, so one 500 blank-screens the entire admin app.

### E8. Counter offline queue is write-only — HIGH
`CheckoutPage` queues offline checkouts to localStorage and tells the operator they will sync.
`removeFromQueue`/`clearQueue` are never called from anywhere and nothing ever POSTs the queue; the
service worker's `'online'` listener does not fire in that scope. Revenue-bearing data loss reported
to the user as success.

### E9. Stripe idempotency key is a fresh UUID per call — HIGH
`payment_tasks.py:242` generates a new key on every attempt. With `task_acks_late` and
`task_reject_on_worker_lost`, a worker killed between a successful capture and its DB commit
re-captures the charge. Derive it from `payment_id`.

### E10. CI gates the wrong artifact; the release gate is `echo` — HIGH
- `deploy.yml`'s production deploy and migration jobs are `echo` stubs that always succeed.
- `deploy/` is entirely untracked, as are all three frontend Dockerfiles; CI builds only API and worker.
- `deploy.yml` runs `npx playwright test e2e/tests/smoke/` — `e2e/` does not exist, and `deploy-prod`
  needs it, so the pipeline is hard-stopped.
- `isolation_suite.py` and `tenant_sql_lint.py` are untracked, not pytest-collectable, and referenced
  nowhere. `tenant_sql_lint.py` needs no database and could be a CI step today.
- Integration tests cannot run in CI (wrong env var, wrong Redis ports, no uvicorn); `-m integration`
  deselects 164 of 214 tests.
- Zero frontend tests exist while `turbo run test` invokes `vitest run` without `--passWithNoTests`;
  the `typecheck` task no package implements; all three turbo filters exclude a package that does
  not exist.

### E11. No per-tenant resource quota — MEDIUM
Ten of thirteen worker modules set no `soft_time_limit`/`time_limit` and there is no global default.
Combined with `worker_prefetch_multiplier=1` and the reports worker at concurrency 1, **one hung
report for one tenant indefinitely blocks the availability cache rebuild, OTA polling, depreciation,
archival, and the unverified-tenant sweep for every tenant on the platform.** PgBouncer runs a single
shared pool of 25 with no per-tenant cap. Plan limits cover only staff, vehicles, and locations.

### E12. Circuit breaker is per-process and global across tenants — MEDIUM
Well-built three-state breaker, but state is in-memory per instance (≥6 independent copies in prod,
so the effective threshold is 6×) and keyed on integration name, not tenant — one tenant's bad
Stripe credentials trip the breaker for everyone. `redis.py` already defines a per-tenant
`agent_circuit:{tenant_id}` pattern the HTTP layer does not use.

---

## Blocker class F — RBAC and user management

### F1. `FINANCE_ANALYST` is invitable with zero permissions — HIGH **[reproduced]**
The only enum role with no `staff_roles` row. Hire someone into it from the team page and every
action they take 403s.

### F2. Damage endpoints are gated on the wrong resource — HIGH
Permission checks reference a different resource than the one being mutated.

### F3. No separation of duties — HIGH
The same identity can create, approve, and settle financial adjustments.

### F4. Unauthenticated `POST /api/v1/tenants` creates an ENTERPRISE tenant with a SUPER_ADMIN — MEDIUM
The internal provisioning route was never gated once the public signup path was added.

### F5. No role change, reactivation, or deletion — MEDIUM
`TeamPage` can invite, revoke, and deactivate. There is no way to change someone's role, reactivate
them, or remove them — a promotion requires direct SQL.

### F6. No privilege ceiling on invitations — MEDIUM
`BRANCH_MANAGER` is in `ADMIN_ROLES` and `SYSTEM_ADMIN` is in `INVITABLE_ROLES`, so a branch manager
can invite themselves an administrator account and accept it.

### F7. Location scoping is decorative — MEDIUM **[reproduced]**
`location_id_param` is referenced by **zero** routes. A branch manager at one location has the same
data reach as one at every location.

### F8. Two password policies; the weaker guards the first admin — MEDIUM
Change/reset requires 12 chars with a special character; registration and invitation acceptance
require 10 with a capital and a digit — and that is the rule that creates a new tenant's SYSTEM_ADMIN.
No breached-password check, no reuse history.

### F9. TOTP secrets stored in plaintext, contrary to the model's own comment — MEDIUM **[reproduced]**
`models.py` says the secret is "encrypted at rest via pgcrypto". It is not — `AXHKRK…` reads out in
clear. pgcrypto is installed but unused here.

### F10. Session management is not usable for its purpose — MEDIUM
`GET /auth/sessions` returns bare JTIs — no device, IP, location, created-at, or last-seen — so a
user cannot tell which session to kill. There is no "sign out everywhere". `user_sessions:{uid}` has
no TTL and grows unbounded.

---

## Lower severity

- Email comparison is case-sensitive on login and reset while registration stores lowercase — a user
  who capitalises their address silently gets no reset email, forever.
- Session lifetime is chosen by the client (`app_context` from the request body/header selects 8h vs
  1h), so any caller can grant itself the long-lived counter session.
- Refresh does not re-check `locked_until`, so a locked-out account keeps rotating tokens.
- bcrypt silently truncates at 72 bytes while schemas accept 128.
- The booking site's "magic link" tab is a facade — a 700ms timeout and a success message, no email.
- No `iss`/`aud`/`kid` claims; one shared HS256 secret across all surfaces, so rotation means logging
  everyone out.
- Frontends have no request timeout, no 401 interceptor, and never call the refresh endpoint they mint
  a cookie for; `retry: 2` with no `Retry-After` handling triples load on a 429; several mutations
  report failed writes as successes.
- `web-admin` ships 33 pages as one eager chunk; frontend images run as root with no healthcheck, and
  `web-booking`'s image copies the entire build stage including all source.
- OpenAPI advertises `api.rcm.app`; actual production is `rcm-api.ceez.ai`.

---

## What is genuinely solid — do not rewrite these

1. **Tenant resolution order of authority** (`core/tenancy.py`) — JWT → hostname → header, raising
   `TenantMismatch` on disagreement rather than silently preferring one; explicit no-fallback policy;
   server-side `RESERVED_SLUGS`; documented threat model.
2. **Transaction-scoped tenant stamping** (`core/database.py`) — the `after_begin` hook re-stamps the
   GUC on every transaction, so the binding survives intermediate commits without any call site
   knowing. This is the single change that made 20 routers tenant-aware.
3. **PgBouncer transaction-pooling handling** — all three asyncpg prepared-statement caches disabled
   plus `NullPool`, with a comment explaining which error each one causes.
4. **JWT cryptography** — `alg=none`, tampered signatures, and expired-but-valid tokens all rejected;
   algorithms pinned; no unverified decode on an auth path.
5. **The unknown-user login path** — a real bcrypt dummy hash, with timing and body indistinguishable.
6. **Verification and invitation tokens** — 256-bit, SHA-256 hashed at rest, expiring, single-use,
   superseded on re-issue, role fixed at invite time, non-disclosing responses. Acceptance adopts the
   tenant from the token, not the caller.
7. **Platform-admin gating** — hangs on `staff_users.is_platform_admin` re-read from the database on every
   request rather than trusted from the token, adopting each tenant in turn instead of bypassing RLS.
8. **Cookies** — HttpOnly, SameSite=Strict, host-only, refresh scoped to its own path, and no token
   ever written to `localStorage` by any frontend.
9. **The integration client** — correct three-state breaker, retry with jitter, 4xx excluded, split
   timeouts, correlation-ID propagation. The gaps are scope, not design.
10. **Redis hygiene** — three separated clusters with eviction policies matched to content; every key
    pattern a named constant with a documented TTL.
11. **Request IDs end-to-end** — honoured or generated, echoed on responses, propagated into Postgres
    GUCs and outbound calls. The plumbing just needs `tenant_id` bound to it (E3).
12. **The isolation suite is the right test** — probes as the runtime role, asserts not-superuser and
    not-BYPASSRLS, tests colliding natural keys and header forgery. It needs the B5/B6 gaps closed and
    needs to be committed and wired into CI.

---

## Suggested order

**Before a second tenant exists on the system**
A1, A2 (deploy role + password — these invert everything else), B1 (public PII leak), B2/B3/B4 (RLS
coverage), B5 + B6 (shared catalogues + fix the vacuous test), C1 (agent-token), E1 (email — nothing
works without it), E2 (public hosts, wildcard DNS/cert).

**Before real users depend on it**
C2 + C3 (credential epoch and real token-family revocation — nothing else matters while recovery does
not recover), C4 (enforce MFA or remove the UI claiming it), C5 (delete the OTP bypass today), C6, C8,
C9, C10, D1 (new tenants cannot quote), D4 (`pg_cron`).

**Before it can be operated**
E3 (tenant in logs — one line), E4 (broker in healthcheck — one line), E6 (Sentry — a dependency and
three lines), E5 (missing worker + dead beat targets), E7 (error boundaries).

**Then**
D2/D3/D5 (deletion completeness, backup/restore, export), F1–F7 (RBAC), E9, E10, E11.
