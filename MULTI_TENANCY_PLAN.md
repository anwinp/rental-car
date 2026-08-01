# Multi-Tenant SaaS Plan

How to take RCM from "one tenant per deployment" to "any org can self-register and
get an isolated instance". Analysis is of the **local repo + local database only** —
nothing here has been applied to the server.

---

## 0. TL;DR

The data model is already multi-tenant. The **enforcement** is not.

Isolation today rests on a single mechanism: the application-layer
`_tenant_filter()` in `app/core/repository.py`. The database-level backstop (RLS)
exists in migrations but is **completely inert** — two independent reasons, either
of which alone disables it. And 62 raw-SQL call sites bypass the repository filter
entirely, so the one working mechanism has holes.

Nothing here requires a rewrite. It is roughly: make RLS real, stop trusting a
client header for identity, provision new tenants with usable reference data, and
make the frontends resolve their tenant at runtime instead of at build time.

---

## 1. What already exists (the good news)

| Capability | Status | Evidence |
|---|---|---|
| Tenant-scoped data model | ✅ Strong | Every table carries `tenant_id` except `alembic_version`, `staff_roles`, `processed_webhooks` |
| Repository auto-filters by tenant | ✅ | `TenantRepository._tenant_filter()`, `app/core/repository.py:46` |
| JWT carries `tenant_id` | ✅ | `UserClaims.tenant_id`, `app/core/security.py:29` |
| Authenticated routes use JWT tenant | ✅ | `claims.tenant_id` throughout domain routers |
| Tenant provisioning endpoint | ✅ Exists | `POST /api/v1/tenants` — creates tenant + first SUPER_ADMIN atomically, auto-generates unique slug |
| Onboarding scaffolding | ✅ | Readiness gate (9 checks), ToS acceptance, per-tenant LLM BYOK settings |
| Per-tenant object storage keys | ✅ | `signatures/{tenant_id}/...`, `inspections/{tenant_id}/...` |
| Tenant-scoped unique constraints | ⚠️ Mostly | 14 of 17 are `(tenant_id, x)`; 3 are global — see §2.4 |
| RLS policies written | ⚠️ Written, inert | `ENABLE`/`FORCE ROW LEVEL SECURITY` + `tenant_isolation` policies on all tenant tables |

The schema work — the part that is genuinely expensive to retrofit — is done.

---

## 2. Blocking defects

### 2.1 RLS is inert — two independent causes 🔴

**Cause A — the app connects as a superuser.** PostgreSQL superusers bypass RLS
unconditionally, `FORCE ROW LEVEL SECURITY` included. Proven against the local DB:

```sql
SELECT current_user, usesuper FROM pg_user WHERE usename = current_user;
--  rcm | t

SELECT set_config('app.current_tenant_id','99999999-…-999999999999', false);
SELECT count(*) FROM customers;
--  629      ← every row of every tenant, under a tenant that does not exist
```

`app_user` (no bypass) and `app_service` (BYPASSRLS) are created by migration 002
but are `NOLOGIN` and unused. The app should run as `app_user`.

**Cause B — the GUC is never set on the web request path.** `get_db()` in
`app/core/database.py` injects the five `app.*` GUCs, and `get_session()` is
documented as *"Bare session — no GUC injection"*. Actual usage:

```
get_db      → 0 domain routers
get_session → 20 domain routers
```

Only Celery tasks call `set_config('app.current_tenant_id', …)`. So even after
fixing Cause A, every web request would read `app.current_tenant_id = NULL` and
RLS would return **zero rows** — the app would break loudly rather than leak. Both
must be fixed together, and Cause B is what makes this a migration rather than a
one-line change.

### 2.2 Raw SQL bypasses the only working isolation 🔴

62 `text()` call sites across domain code. The repository filter does not apply to
them, and RLS is not backstopping them. Files where raw SQL appears with no
`tenant_id` predicate nearby:

- `app/domains/payments/repository.py`
- `app/domains/tasks/router.py`
- `app/domains/agents/agents/reservation_manager.py`

Each needs an individual audit. This is the highest-risk item after 2.1, because a
missing `WHERE tenant_id = …` here is a silent cross-tenant data leak today.

### 2.3 Tenant identity comes from a client-controlled header 🔴

`X-Tenant-ID` is supplied by the browser, and several public endpoints fall back to
a **hardcoded tenant** when it is absent:

```python
# app/domains/locations/router.py:49
tenant_id_str = request.headers.get("X-Tenant-ID", "00000000-…-000000000001")
# app/domains/pricing/router.py:55, app/domains/reservations/router.py:140
tenant_id_str = request.headers.get("X-Tenant-ID", "00000000-…-000000000000")
```

For anonymous traffic (public booking) the header is the *only* signal, so any
visitor can browse any tenant's public catalogue by changing one header. Tenant
identity for anonymous requests must come from the **hostname**, which the client
cannot forge past the proxy.

For authenticated traffic the JWT is used, which is correct — but there is no check
that a presented header *matches* the JWT tenant. Add one and reject mismatches.

### 2.4 Three globally-unique columns collide across tenants 🟠

```
customers.loyalty_number         UNIQUE (loyalty_number)
rental_agreements.ra_number      UNIQUE (ra_number)
reservations.confirmation_number UNIQUE (confirmation_number)
```

Two problems: tenant B's booking can fail because tenant A already used that
confirmation number, and sequential numbers leak cross-tenant volume. Must become
`(tenant_id, …)`.

### 2.5 A newly provisioned tenant gets an unusable app 🔴

`TenantService.create_tenant()` creates exactly two things: the tenant row and the
first SUPER_ADMIN. It creates **no** vehicle classes, extras, tax templates,
notification templates, rate codes, or locations — all of which the seeds attach to
tenant `…0001`. A newly registered org logs in to an application that cannot quote
a price or send an email. This is the single biggest functional gap for
self-service.

### 2.6 Frontends are compiled for one tenant 🔴

```
apps/web-admin/src/pages/SettingsPage.tsx:5
  const TENANT_ID = '00000000-0000-0000-0000-000000000001'   // hardcoded in source
apps/web-admin/src/components/AdminIntelligencePanel.tsx:14  // hardcoded in source
apps/web-admin/src/pages/CorporatePage.tsx:4
  const TENANT = import.meta.env.VITE_TENANT_ID ?? '00000000-…-000000000001'
```

`VITE_TENANT_ID` / `NEXT_PUBLIC_TENANT_ID` are **build-time** — baked into the
bundle. One image per tenant is not SaaS. Tenant must be resolved at runtime from
the hostname and the session.

### 2.7 Smaller but real 🟡

- **No tenant status check at login.** `status` exists on `tenants` (`ACTIVE`), but
  auth never reads it — a SUSPENDED or non-paying tenant still authenticates.
- **`processed_webhooks` has no `tenant_id`.** Stripe webhook idempotency is shared
  across tenants; one tenant's event id can suppress another's.
- **`otp_rate:{phone}` Redis key is not tenant-namespaced** (`app/domains/auth/router.py:306`).
  The same phone number at two tenants shares a rate-limit budget.
- **`staff_roles` is global** (no `tenant_id`). Fine as a shared catalogue, but it
  means no per-tenant custom roles — decide deliberately.
- Availability cache `avail:{loc}:{cls}:{bucket}` keys on location UUID, which is
  globally unique, so it is safe today — but it is safe by accident, not design.

---

## 3. Target architecture

### 3.1 Isolation model — recommendation: **pooled (shared DB, shared schema) + RLS**

| Model | Isolation | Cost/tenant | Ops burden | Fit |
|---|---|---|---|---|
| **Pooled + RLS** | Logical, DB-enforced | Near zero | One schema, one migration run | ✅ **Recommended** |
| Schema-per-tenant | Stronger | Moderate | N schemas × 49 migrations | Later, for enterprise tier |
| DB-per-tenant | Strongest | High | N databases, N backups | Only for a regulated whale |

The codebase is already built for pooled — every table has `tenant_id`, policies are
written, the repository filters. Choosing anything else discards that work. The
"exclusive instance" the org experiences should be delivered as an **exclusive
view** (own subdomain, own data, own branding), not an exclusive database.

Keep the door open: because every query is already tenant-filtered, promoting a
single large tenant to its own database later is a routing change, not a rewrite.

### 3.2 Tenant resolution — order of authority

```
1. JWT claim  (authenticated)   ← authoritative, signed
2. Hostname   (anonymous)       ← acme.rcm.ceez.ai → tenants.slug = 'acme'
3. X-Tenant-ID header           ← ONLY for service-to-service, never from a browser
```

Rules:
- If both JWT and host resolve, they **must match** or the request is rejected.
- Remove every hardcoded tenant default. Unresolvable tenant → `400`, never a
  silent fallback to tenant 1.
- Cache `slug → tenant_id` in Redis (`tenant_slug:{slug}`, TTL 300s); it is on
  every anonymous request.

### 3.3 Routing

- **Production shape:** wildcard `*.rcm.ceez.ai` → one Caddy vhost. Note this
  requires a **wildcard certificate, which needs DNS-01** (an API credential for
  GoDaddy), unlike the per-host HTTP-01 in use today. That is a real prerequisite,
  not a detail.
- **Local shape:** `*.localtest.me` resolves to 127.0.0.1 with zero setup — use
  `acme.localtest.me:3400`. No `/etc/hosts` editing, works for every dev.
- Reserve `www`, `api`, `admin`, `app`, `static`, `files`, `mail`, `support` as
  non-tenant slugs, enforced at registration.

---

## 4. Phased plan (local only)

### Phase 0 — Make isolation real 🔴 *do this before anything else*

Everything after this phase multiplies the number of tenants sharing one database.
Doing it in this order means a bug leaks one org's data to nobody, rather than to
paying customers.

1. **Switch the app to a non-superuser role.**
   - Migration: `ALTER ROLE app_user LOGIN PASSWORD …`, grant table privileges,
     confirm `NOT usesuper` and no `BYPASSRLS`.
   - Keep migrations/seeding on the owner role (DDL needs it); only the *runtime*
     connection drops to `app_user`.
2. **Route every request through a GUC-setting session.** Replace `get_session`
   with `get_db` across all 20 domain routers, deriving tenant from `claims`.
   Keep `get_session` for `/health` and genuinely tenant-less work.
3. **Audit all 62 raw `text()` sites**; add explicit `tenant_id = :tid` predicates.
   With RLS live these become defence-in-depth rather than the only defence.
4. **Add the isolation test suite** (§5). This is the acceptance gate for Phase 0.

*Expected shape of failure while doing this: queries return 0 rows, not wrong rows.
That is the desired failure mode and makes the migration debuggable.*

### Phase 1 — Tenant resolution & routing

5. Rewrite `get_tenant_id()` to implement the §3.2 order of authority.
6. Delete every hardcoded tenant fallback (`locations`, `pricing`, `reservations`).
7. Add `slug → tenant_id` resolution + Redis cache; reserved-slug list.
8. Reject JWT/host mismatch with `403`.
9. Enforce `tenants.status` at login and on every token refresh — SUSPENDED
   authenticates to nothing.

### Phase 2 — Self-service registration & provisioning

10. **`POST /api/v1/public/register`** — company name, admin name/email/password,
    desired slug. Rate-limited, email-verified, ToS recorded. Wraps the existing
    `create_tenant`.
11. **Tenant provisioning service** — the critical missing piece from §2.5. In one
    transaction, seed the new tenant with:
    - 12 SIPP vehicle classes, 9 extras, a default tax template
    - 30 notification templates, a default RACK rate code
    - one starter location (from the signup form)
    - the SUPER_ADMIN user
    Extract these from `seed_inventory.sql` / migration 033 into a
    `provision_tenant_defaults(tenant_id)` service used by *both* the seeds and
    registration, so they cannot drift.
12. **Verification-driven activation** — tenant starts `PENDING_VERIFICATION`,
    becomes `ACTIVE` on email confirmation. Reuse the readiness gate to drive an
    onboarding checklist.
13. Idempotent + transactional: a failed provision must leave no half-built tenant.

### Phase 3 — Runtime-tenant frontends

14. Delete hardcoded tenant constants from `web-admin` source.
15. Add `GET /api/v1/public/tenant-config?host=…` returning tenant id, display
    name, logo, colours, feature flags. Frontends fetch it at boot from
    `window.location.hostname`.
16. Replace `VITE_TENANT_ID` / `NEXT_PUBLIC_TENANT_ID` with that runtime config, so
    **one image serves all tenants**.
17. For Next.js booking, resolve tenant in middleware and pass through context;
    `next/image` `remotePatterns` must allow tenant logo hosts.

### Phase 4 — Commercial layer

18. Plans & entitlements (`plan_limits`: vehicles, locations, staff seats, API
    calls); enforce at write time with a clear `402`/`409`.
19. Usage metering off existing `audit_events`; Stripe subscriptions per tenant.
20. Add `tenant_id` to `processed_webhooks`; namespace `otp_rate` by tenant.
21. Platform-admin console (cross-tenant, `app_service` + `BYPASSRLS`, heavily
    audited) for support impersonation with explicit consent trails.

### Phase 5 — Tenant lifecycle

22. Per-tenant export (GDPR/portability), suspend, and hard-delete.
23. Per-tenant metrics/log labels; per-tenant rate limits.
24. Backup/restore of a single tenant — non-trivial in a pooled model; design it
    before you need it.

---

## 5. Acceptance gate: the cross-tenant isolation suite

Phase 0 is not "done" on inspection; it is done when this passes. Build two tenants
with deliberately colliding data, then assert:

- Tenant A's JWT reading `/reservations`, `/customers`, `/fleet/vehicles`,
  `/locations` returns **only** A's rows — for every list endpoint.
- Fetching a known **B** object id with an **A** token returns 404/403, never 200.
- `X-Tenant-ID: B` presented alongside an **A** JWT is rejected.
- Anonymous requests to `a.localtest.me` never return B's catalogue.
- The same confirmation number, RA number, loyalty number, VIN, staff email and
  location code can exist in both tenants simultaneously.
- With RLS live: a session with no `app.current_tenant_id` returns **0 rows**.
- A direct `psql` as `app_user` with a bogus GUC returns 0 rows (the §2.1 test,
  inverted — this is the regression test for superuser bypass).

Run it in CI. Every new endpoint gets a case.

---

## 6. Sequencing and effort

| Phase | Outcome | Rough effort |
|---|---|---|
| 0 — Real isolation | Safe to host two orgs at all | 3–5 days |
| 1 — Resolution & routing | Tenant identity unforgeable | 2–3 days |
| 2 — Registration & provisioning | An org can self-serve a *working* instance | 4–6 days |
| 3 — Runtime frontends | One build serves all tenants | 3–4 days |
| 4 — Commercial layer | Chargeable product | 5–8 days |
| 5 — Lifecycle | Operable at scale | 3–5 days |

Phases 0–3 are the minimum for "an org registers and gets an exclusive view".
Phases 4–5 are what make it a business rather than a demo.

**Do not reorder 0.** Every other phase increases the number of orgs whose data
shares one database.

---

## 7. Local verification setup

```bash
docker compose up -d postgres redis-avail redis-broker redis-sessions
./app.sh start
# tenants resolve by hostname with zero DNS setup:
#   http://acme.localtest.me:3400      → booking for tenant "acme"
#   http://globex.localtest.me:3400    → booking for tenant "globex"
#   http://acme.localtest.me:3002      → admin for tenant "acme"
```

`*.localtest.me` resolves to 127.0.0.1 publicly, so hostname-based resolution can be
developed and tested locally exactly as it will behave in production.
