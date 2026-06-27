# AI Agent Implementation Guide
## Codebase-Grounded Consensus · Foundation Through Wave 5

**Date:** 2026-06-23  
**Process:** Three independent codebase audits (backend, frontend, infrastructure) synthesized into a single build guide  
**Companion documents:** `AI_AGENT_INTEGRATED_PLAN.md` (what to build), this document (how to build it in this codebase)

---

## Critical Findings That Override the Plan

Three things the plan assumed that do not exist in the codebase. Building without fixing these first will cause failures.

**1. AGENT_SERVICE role does not exist.**  
The `user_role` PostgreSQL enum (migration 003) has 13 values. `AGENT_SERVICE` is not one of them. Every agent API call will return 403 until migrations 042 and 043 are applied. This is the first thing to do.

**2. The API only accepts cookie auth — agents cannot authenticate.**  
`get_current_user()` in `core/security.py` reads only `Cookie(alias="rcm_access")`. Agents call the API over HTTP with a Bearer token, not a browser cookie. A parallel dependency `get_current_user_or_bearer` must be added before any agent tool call can authenticate.

**3. Orchestrator MUST call the API over HTTP — not by importing services directly.**  
If the orchestrator imports and calls `ReservationService.modify_reservation()` directly, the PostgreSQL GUC injection in `get_db()` is bypassed. The audit trigger (migration 027) reads these GUC values (`app.current_role`, `app.current_user_id`, etc.) on every mutation. Direct calls log `NULL` as the actor in audit events — this breaks compliance. All agent tool calls must go through `httpx.AsyncClient` to `http://localhost:8000/api/v1/...`.

**4. The agent session schema is missing `tenant_id`.**  
The plan's session schema (Part 3, Conflict II) defines `session_id`, `customer_id`, `active_agent`, `messages`, `context`, `handoff_summary` — but not `tenant_id`. The codebase is pervasive multi-tenant: every table, every query, every RLS policy uses `tenant_id`. Without it in the session, the orchestrator cannot enforce tenant isolation, and the goodwill ledger check has no tenant binding. **Add `tenant_id` to the session schema before anything is built.**

---

## Part 1 — Gaps Between the Plan and the Codebase

### Missing endpoints (plan references these as if they exist)

| Plan reference | Status | What to build | Wave |
|---|---|---|---|
| `GET /fleet/search?pickup_dt&dropoff_dt&location_id` | Does not exist. Closest is `GET /fleet/classes` + `GET /fleet/availability` separately. | New route in `fleet/router.py` (~40 lines). Combines availability count + class data in one response. | Foundation |
| `goodwill_under` param on `POST /payments/refund` | `RefundRequest` schema has no such field. `process_refund()` has no ledger check. The `customer_goodwill_ledger` table does not exist. | Schema extension + service logic + migration. | Wave 3 |
| `GET /damage/claims/{id}/lou` | `LOUCalculation` schema exists in `damage/schemas.py` but there is no GET endpoint for it. | New route in `damage/router.py` (~25 lines) + `DamageService.calculate_lou()` method. | Wave 4 |
| `POST /auth/agent-token` | No machine-to-machine token issuance endpoint exists. | New endpoint in `auth/router.py` (~40 lines). | Foundation |
| `POST /agents/chat` + `GET /agents/health` | Domain does not exist. | New `domains/agents/` module. | Foundation |
| `SETTLED` claim status | `claim_status` enum has `PAID` but not `SETTLED`. ClaimsProcessor auto-settlement cannot advance to this state. | Migration to add enum value, or decision to reuse `PAID`. | Wave 4 (product decision before building) |
| `GET /checkout/agreements/{ra_id}/receipt-breakdown` | `GET /checkout/agreements/{ra_id}` exists but returns RA fields, not arithmetic breakdown. | New endpoint that computes mileage overage, fuel steps, etc. server-side. ReturnAdvisor then explains the numbers. | Wave 3 |

### Missing infrastructure

| Plan reference | Status | What to build |
|---|---|---|
| `booking.reminder.24h` Celery beat entry | No beat entry in `celery_app.py` for the 24h reminder. `send_pre_rental_reminders` exists as a name in `notifications.py` re-export but is not scheduled. | Add beat entry + verify task implementation in Wave 3. |
| `ev.low_soc_alert` pipeline | No Celery task, no beat entry, no SOC monitoring logic anywhere. Telematics table exists but has no alert path. | Full pipeline: `scan_ev_alerts` task + beat entry every 5min. Wave 3. |
| `rental.overdue_soft` trigger | `GET /checkout/overdue` endpoint exists. `CheckoutService.list_overdue_rentals()` is a known stub — it compares against `created_at + 24h`, not `reservation.return_datetime`. No beat entry. | Fix `list_overdue_rentals()` to JOIN on `reservations.return_datetime`. Add beat entry every 30min. Wave 3. |
| `damage.claim_opened` triggers ClaimsProcessor | No async event fired when a claim is created. `DamageService.create_claim()` inserts to DB only. | Add `dispatch_agent_task.delay(...)` call at end of `create_claim()`. Wave 4. |
| Notification templates for agent events | `BOOKING_REMINDER_24H`, `EV_LOW_SOC_ALERT`, `RENTAL_OVERDUE_SOFT` event codes have no rows in `notification_templates`. `render_and_send()` silently returns on missing template. | Seed migration with three system-wide templates. Wave 3. |

### Existing bugs found that affect the agent

| Bug | Location | Impact on agent |
|---|---|---|
| `promotion_codes` column is `usage_limit` in DB (migration 039) but code references `max_uses` (reservations/service.py line 320) | `reservations/service.py` | BookingConcierge promo code validation will fail or error |
| `asyncio.get_event_loop().run_until_complete()` deprecated in Python 3.10+, fails in 3.12+ | `notifications.py` line 66, `payment_tasks.py` line 36 | All new agent Celery tasks must use `asyncio.run()`. Fix existing tasks before Python 3.12 upgrade. |
| `revoked_tokens` SET has no TTL — grows unbounded on `volatile-lru` cluster | `core/redis.py` | Under memory pressure, agent sessions (which have TTLs) are evicted before this set. Monitor cluster memory before adding agent session load. |
| `CheckoutService.list_overdue_rentals()` uses `created_at + 24h` proxy instead of `reservation.return_datetime` | `checkout/service.py` | OverdueTracker would fire on wrong rentals. Must be fixed before Wave 3 overdue tasks run. |
| CORS `allow_headers` does not include `Authorization` | `main.py` lines 89–93 | Not a blocker (orchestrator calls API server-side, not from browser). But if the plan ever adds browser-direct Bearer auth, CORS will block it. |

---

## Part 2 — Revised Session Schema

Add `tenant_id` to every session (required, not optional):

```json
{
  "session_id": "uuid",
  "tenant_id": "uuid",
  "customer_id": "uuid | null",
  "active_agent": "ReservationManager | null",
  "created_at": "ISO8601",
  "last_active": "ISO8601",
  "messages": [
    {"role": "user", "content": "...", "ts": "ISO8601"},
    {"role": "assistant", "content": "...", "ts": "ISO8601", "agent": "ReservationManager"}
  ],
  "context": {
    "reservation_id": "uuid | null",
    "rental_agreement_id": "uuid | null",
    "damage_claim_id": "uuid | null",
    "resolved_issues": []
  },
  "handoff_summary": "string | null"
}
```

On every message after session creation, the orchestrator validates that `request.tenant_id == session.tenant_id`. Mismatched tenant = 403.

---

## Part 3 — Foundation Sprint: Exact Changes

**Strict order. Each step unblocks the next.**

---

### Step 1 — Migration 042: Add AGENT_SERVICE to user_role enum

File: `apps/api/alembic/versions/20260624_042_agent_service_role.py`

```python
"""add agent_service role

Revision ID: 20260624_042
Revises: 20260618_041
"""
from alembic import op

def upgrade() -> None:
    # ALTER TYPE ADD VALUE cannot run inside a transaction block in PostgreSQL.
    # Alembic's default wraps migrations in a transaction — use execute_if to bypass.
    # This is safe: the value is additive and harmless if the migration is re-run.
    op.execute("COMMIT")  # end alembic's implicit transaction
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'AGENT_SERVICE'")
    op.execute("BEGIN")   # restart for subsequent statements

    op.execute("""
        INSERT INTO public.staff_roles (role_key, display_name, permissions_json)
        VALUES (
            'AGENT_SERVICE',
            'AI Agent Service Account',
            '{"reservations":["read","update"],"pricing":["read"],"fleet":["read"],
              "customers":["read"],"payments":["read"],"checkout":["read"],"damage":["read"]}'
        )
        ON CONFLICT (role_key) DO UPDATE SET permissions_json = EXCLUDED.permissions_json
    """)

def downgrade() -> None:
    op.execute("DELETE FROM public.staff_roles WHERE role_key = 'AGENT_SERVICE'")
    # Cannot remove enum values in PostgreSQL without DROP + recreate.
    # The AGENT_SERVICE value is harmless if unused — downgrade leaves it in the enum.
```

> **Risk note:** The `COMMIT`/`BEGIN` sandwich is required because PostgreSQL does not allow `ALTER TYPE ADD VALUE` inside a transaction. Test this migration in staging before production. The migration must not share a transaction with any other migration.

---

### Step 2 — Migration 043: customer_goodwill_ledger table

File: `apps/api/alembic/versions/20260624_043_customer_goodwill_ledger.py`

```python
"""create customer_goodwill_ledger

Revision ID: 20260624_043
Revises: 20260624_042
"""
from alembic import op

def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS public.customer_goodwill_ledger (
            ledger_id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id           UUID        NOT NULL,
            customer_id         UUID        NOT NULL,
            rental_agreement_id UUID        NOT NULL,
            amount              NUMERIC(10,2) NOT NULL CHECK (amount > 0),
            issued_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            session_id          TEXT         NOT NULL,
            issued_by_agent     TEXT         NOT NULL,
            notes               TEXT
        )
    """)
    # Primary query: rolling 90-day sum per customer
    op.execute("""
        CREATE INDEX idx_goodwill_customer_90d
            ON public.customer_goodwill_ledger (tenant_id, customer_id, issued_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_goodwill_ra
            ON public.customer_goodwill_ledger (rental_agreement_id)
    """)

def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.customer_goodwill_ledger")
```

No FK to `customers` or `rental_agreements` — customers can be anonymized post-rental; the ledger must survive the anonymization.

---

### Step 3 — core/config.py: Add two settings

File: `apps/api/app/core/config.py`

Add alongside existing settings (after `stripe_secret_key`):

```python
# AI Agent
anthropic_api_key: SecretStr = Field(default=..., description="Anthropic API key for agent LLM calls")
agent_session_ttl_seconds: int = Field(default=86400, description="Agent session TTL in Redis (24h)")
agent_goodwill_cap_usd: float = Field(default=75.0, description="Max goodwill refunds per customer per 90 days")
agent_goodwill_window_days: int = Field(default=90, description="Rolling window for goodwill cap enforcement")
```

Add to `.env.example` and AWS Secrets Manager (as `anthropic_api_key`).

---

### Step 4 — core/redis.py: Add agent namespace constants

File: `apps/api/app/core/redis.py`

Add after the existing key constants:

```python
# Agent session store (on session cluster, volatile-lru)
AGENT_SESSION_KEY    = "agent_session:{session_id}"   # TTL = settings.agent_session_ttl_seconds
AGENT_CIRCUIT_KEY    = "agent_circuit:{tenant_id}"    # Circuit breaker, TTL 60s
```

No new Redis cluster. `get_session_redis()` is the correct cluster for both keys (compatible `volatile-lru` eviction — sessions with TTL are correctly evictable under memory pressure).

---

### Step 5 — core/security.py: Add Bearer token dependency

File: `apps/api/app/core/security.py`

Add this dependency **alongside** the existing `get_current_user` (do not modify the existing function):

```python
async def get_current_user_or_bearer(
    cookie_token: Optional[str] = Cookie(default=None, alias="rcm_access"),
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_session),
) -> UserClaims:
    """Accepts either httpOnly cookie (browser users) or Authorization: Bearer (agent service accounts)."""
    token = cookie_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return await _resolve_token(token, db)  # reuse existing token resolution logic

async def get_optional_current_user(
    cookie_token: Optional[str] = Cookie(default=None, alias="rcm_access"),
    authorization: Optional[str] = Header(default=None),
) -> Optional[UserClaims]:
    """Returns None for unauthenticated users (for public endpoints that agents call)."""
    try:
        return await get_current_user_or_bearer(cookie_token, authorization)
    except HTTPException:
        return None
```

Endpoints that agent tools call should be updated to use `get_current_user_or_bearer` instead of `get_current_user`. This is done incrementally — only endpoints touched by each wave's agent tools need to be updated.

---

### Step 6 — auth/router.py: Add agent token endpoint

File: `apps/api/app/domains/auth/router.py`

```python
class AgentTokenRequest(BaseModel):
    agent_name: str       # e.g. "ReservationManager"
    tenant_id: UUID

class AgentTokenResponse(BaseModel):
    access_token: str
    agent_name: str
    expires_in: int       # seconds

@router.post("/agent-token", response_model=AgentTokenResponse)
async def issue_agent_token(
    payload: AgentTokenRequest,
    claims: UserClaims = Depends(require_permission("auth", "admin")),  # SUPER_ADMIN only
    db: AsyncSession = Depends(get_db),
) -> AgentTokenResponse:
    """Issues a long-lived Bearer token for an AI agent service account."""
    token = await AuthService(db).create_agent_token(
        agent_name=payload.agent_name,
        tenant_id=payload.tenant_id,
        ttl_seconds=settings.agent_token_ttl_seconds,  # 90 days
    )
    return AgentTokenResponse(
        access_token=token,
        agent_name=payload.agent_name,
        expires_in=settings.agent_token_ttl_seconds,
    )
```

`AuthService.create_agent_token()` creates a JWT with `primary_role="AGENT_SERVICE"`, `app_context=agent_name`, `tenant_id=tenant_id`. JTI stored in Redis with 90-day TTL on the session cluster.

---

### Step 7 — domains/agents/: New domain (Foundation stub)

Create the directory structure:

```
apps/api/app/domains/agents/
  __init__.py
  router.py          # /agents/chat, /agents/health
  service.py         # AgentOrchestrator — stub returns echo in Foundation
  session_store.py   # Redis read/write for agent sessions
  tool_wrapper.py    # AgentTool base class
  agents/
    __init__.py
    base.py          # BaseAgent abstract class
    echo.py          # EchoAgent — stub for Foundation gate
```

**router.py** (Foundation — echo only):

```python
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import Optional
from app.core.security import get_optional_current_user, UserClaims
from app.domains.agents.service import AgentOrchestrator

router = APIRouter()

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str

class ChatResponse(BaseModel):
    session_id: str
    message: str
    card: Optional[dict] = None
    chips: list[str] = []
    agent: str = "echo"

@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    claims: Optional[UserClaims] = Depends(get_optional_current_user),
) -> ChatResponse:
    tenant_id = request.headers.get("X-Tenant-ID", "")
    orchestrator = AgentOrchestrator(tenant_id=tenant_id, customer_claims=claims)
    return await orchestrator.handle(payload.session_id, payload.message)

@router.get("/health")
async def agents_health() -> dict:
    from app.core.redis import get_session_redis
    try:
        redis = get_session_redis()
        await redis.ping()
        redis_status = "ok"
    except Exception:
        redis_status = "error"
    # Claude API health: attempt minimal check without spending tokens
    claude_status = "ok"  # expand in Wave 1 with actual Anthropic client ping
    overall = "ok" if redis_status == "ok" and claude_status == "ok" else "degraded"
    return {"status": overall, "redis": redis_status, "claude_api": claude_status}
```

**session_store.py**:

```python
import json
from datetime import datetime, timezone
from uuid import uuid4
from app.core.redis import get_session_redis, AGENT_SESSION_KEY
from app.core.config import settings

class AgentSessionStore:
    async def create(self, tenant_id: str, customer_id: str | None) -> dict:
        session_id = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        session = {
            "session_id": session_id,
            "tenant_id": tenant_id,
            "customer_id": customer_id,
            "active_agent": None,
            "created_at": now,
            "last_active": now,
            "messages": [],
            "context": {
                "reservation_id": None,
                "rental_agreement_id": None,
                "damage_claim_id": None,
                "resolved_issues": [],
            },
            "handoff_summary": None,
        }
        redis = get_session_redis()
        key = AGENT_SESSION_KEY.format(session_id=session_id)
        await redis.set(key, json.dumps(session), ex=settings.agent_session_ttl_seconds)
        return session

    async def get(self, session_id: str) -> dict | None:
        redis = get_session_redis()
        key = AGENT_SESSION_KEY.format(session_id=session_id)
        raw = await redis.get(key)
        if not raw:
            return None
        return json.loads(raw)

    async def update(self, session: dict) -> None:
        session["last_active"] = datetime.now(timezone.utc).isoformat()
        redis = get_session_redis()
        key = AGENT_SESSION_KEY.format(session_id=session["session_id"])
        await redis.set(key, json.dumps(session), ex=settings.agent_session_ttl_seconds)
```

**tool_wrapper.py**:

```python
import httpx
from dataclasses import dataclass
from typing import Any

@dataclass
class ToolResult:
    success: bool
    data: dict
    error_message: str | None = None

class AgentTool:
    def __init__(self, agent_token: str, tenant_id: str):
        self._client = httpx.AsyncClient(
            base_url="http://localhost:8000",
            headers={
                "Authorization": f"Bearer {agent_token}",
                "X-Tenant-ID": tenant_id,
            },
            timeout=5.0,
        )

    async def get(self, path: str, **params) -> ToolResult:
        return await self._call("GET", path, params=params)

    async def post(self, path: str, body: dict) -> ToolResult:
        return await self._call("POST", path, json=body)

    async def patch(self, path: str, body: dict) -> ToolResult:
        return await self._call("PATCH", path, json=body)

    async def _call(self, method: str, path: str, **kwargs) -> ToolResult:
        try:
            resp = await self._client.request(method, path, **kwargs)
            if resp.is_success:
                return ToolResult(success=True, data=resp.json())
            return ToolResult(success=False, data={}, error_message=f"{resp.status_code}: {resp.text[:200]}")
        except httpx.TimeoutException:
            return ToolResult(success=False, data={}, error_message="TIMEOUT")
        except Exception as e:
            return ToolResult(success=False, data={}, error_message=str(e))
```

---

### Step 8 — main.py: Register agents router

File: `apps/api/app/main.py`

```python
from app.domains.agents.router import router as agents_router
# ... in create_app():
app.include_router(agents_router, prefix=f"{PREFIX}/agents", tags=["agents"])
```

One line. No existing router touched.

---

### Step 9 — worker/celery_app.py: Add agents queue

File: `apps/api/app/worker/celery_app.py`

```python
# Add to task_queues
Queue("agents", routing_key="agents"),

# Add to task_routes
"app.worker.tasks.agent_tasks.*": {"queue": "agents"},

# Add to includes
"app.worker.tasks.agent_tasks",

# Add to beat_schedule (stubs — implementations in Wave 3)
"ev-alert-poll": {
    "task": "app.worker.tasks.agent_tasks.scan_ev_alerts",
    "schedule": crontab(minute="*/5"),
    "options": {"queue": "agents", "expires": 300},
},
"overdue-tracker-scan": {
    "task": "app.worker.tasks.agent_tasks.scan_overdue_rentals",
    "schedule": crontab(minute="*/30"),
    "options": {"queue": "agents", "expires": 1800},
},
```

Isolating agent tasks in their own queue prevents Claude API latency (200-400ms per call) from saturating the `notifications` queue, which handles time-sensitive SendGrid/Twilio delivery.

---

### Step 10 — fleet/router.py: Add combined search endpoint

File: `apps/api/app/domains/fleet/router.py`

```python
@router.get("/search")
async def search_fleet(
    pickup_location_id: UUID,
    pickup_datetime: datetime,
    dropoff_datetime: datetime,
    db: AsyncSession = Depends(get_session),
    request: Request = None,
) -> list[dict]:
    """Combined availability + class data for agent tool calls. No auth required."""
    tenant_id = request.headers.get("X-Tenant-ID")
    return await FleetService(db).search_with_classes(
        tenant_id=tenant_id,
        location_id=pickup_location_id,
        pickup_dt=pickup_datetime,
        dropoff_dt=dropoff_datetime,
    )
```

`FleetService.search_with_classes()` joins the existing availability query with `vehicle_classes` to return class name, features, price estimate, and availability count in one response. Reuses existing service methods.

---

### Foundation Gate Validation

Before Wave 1 begins, verify all ten steps:

```bash
# 1. Migrations applied
alembic upgrade head

# 2. AGENT_SERVICE in enum
psql $DATABASE_URL -c "SELECT 'AGENT_SERVICE'::user_role"  # should not error

# 3. staff_roles row exists
psql $DATABASE_URL -c "SELECT role_key FROM staff_roles WHERE role_key='AGENT_SERVICE'"

# 4. Orchestrator health endpoint
curl http://localhost:8000/api/v1/agents/health

# 5. Echo response
curl -X POST http://localhost:8000/api/v1/agents/chat \
  -H "X-Tenant-ID: 00000000-0000-0000-0000-000000000001" \
  -H "Content-Type: application/json" \
  -d '{"session_id": null, "message": "hello"}'
# Expected: {"session_id": "<uuid>", "message": "hello", "card": null, "chips": [], "agent": "echo"}

# 6. Session persists in Redis
# Run step 5, then: redis-cli -u $REDIS_SESSION_URL GET "agent_session:<session_id from step 5>"

# 7. Agent token endpoint works
curl -X POST http://localhost:8000/api/v1/auth/agent-token \
  -H "Cookie: rcm_access=<super_admin_token>" \
  -d '{"agent_name": "ReservationManager", "tenant_id": "00000000-..."}'

# 8. Fleet search endpoint
curl "http://localhost:8000/api/v1/fleet/search?pickup_location_id=...&pickup_datetime=...&dropoff_datetime=..."
```

---

## Part 4 — Wave 1: ReservationManager — Exact Changes

### Backend changes

**New file: `domains/agents/agents/reservation_manager.py`**

Implements `ReservationManager` agent class. Tools: five `AgentTool` calls (get reservation by confirmation, PATCH reservation, get cancellation preview, POST cancel, POST pricing quote). Uses the `get_current_user_or_bearer` path.

**Update `reservations/router.py`:** Three endpoints need to accept Bearer tokens from agents:
- `PATCH /reservations/{id}` — change `Depends(get_current_user)` → `Depends(get_current_user_or_bearer)`
- `POST /reservations/{id}/cancel` — same change
- `GET /reservations/{id}/cancellation-preview` — already has no auth check, no change needed

**Update `service.py` (AgentOrchestrator):** Implement Claude classification call for session-start routing. For Wave 1, route only: messages on sessions with no `active_agent` → run classification → if `ReservationManager` with confidence ≥ 0.65, set `active_agent = "ReservationManager"`. Otherwise ask clarifying question.

**Fix `promotion_codes` bug before Wave 2:**
In `reservations/service.py` line 320, the column reference `max_uses` does not match the migration 039 DDL column name `usage_limit`. Fix the raw SQL reference before BookingConcierge attempts to validate promo codes. This is a pre-existing bug that must be fixed before Wave 2 regardless.

### Frontend changes (web-booking)

**Step 1: Add `--agent-*` CSS tokens to `globals.css`**

File: `apps/web-booking/app/globals.css`

Add after the existing `--p-*` token block:

```css
/* ── Agent UI tokens ────────────────────────────── */
--agent-panel-width: 400px;
--agent-panel-bg: #161616;
--agent-msg-user-bg: rgba(218, 41, 28, 0.12);
--agent-msg-user-border: rgba(218, 41, 28, 0.20);
--agent-chip-bg: rgba(255, 255, 255, 0.04);
--agent-chip-border: rgba(255, 255, 255, 0.10);
--agent-chip-bg-hover: rgba(218, 41, 28, 0.10);
--agent-chip-border-hover: rgba(218, 41, 28, 0.35);
--agent-input-bg: #1e1e1e;
--agent-input-border: rgba(255, 255, 255, 0.10);
--agent-input-border-focus: rgba(218, 41, 28, 0.35);
--agent-input-placeholder: rgba(255, 255, 255, 0.55); /* WCAG AA minimum at 14px */
--agent-progress-bar: var(--p-brand);
--agent-sheet-height: 82vh;
--agent-sheet-handle: rgba(255, 255, 255, 0.15);
--agent-handoff-border: rgba(255, 255, 255, 0.14);
```

**Step 2: Add `AgentChatPanel` component**

New file: `apps/web-booking/app/components/agent/AgentChatPanel.tsx`

This is a `'use client'` component. It renders:
- On desktop (≥ 1200px): the fixed 400px right panel
- On mobile (< 1200px): the "Ask RCM" floating bar at the bottom and a fixed overlay bottom sheet (82vh)

It manages its own state (`sessionId` in `sessionStorage`, `messages` array, `thinking` boolean). It calls `POST /api/v1/agents/chat` with `X-Tenant-ID` header.

**`sessionStorage` vs. cross-browser-session persistence:** The plan says "persisted across page navigations and browser sessions (up to 24h)" — but `sessionStorage` clears on tab close. Resolve this:
- Use `sessionStorage` for `session_id` as the primary store (covers same-tab page navigations)
- On component mount, check `localStorage.getItem('rcm_agent_session')` — if found and `last_active` is within 24h, restore it into `sessionStorage` and continue
- On every message, write `{session_id, last_active}` to `localStorage`
- This gives: same-tab navigation ✓ + return-to-site within 24h ✓ + tab close resets within-tab scrollback (but server-side context is preserved)

**Step 3: Update `layout.tsx` (6-line diff)**

File: `apps/web-booking/app/layout.tsx`

Before:
```tsx
<Providers>
  <Navbar />
  <main id="main-content" className="flex-1">{children}</main>
  <Footer />
</Providers>
```

After:
```tsx
<Providers>
  <div className="flex h-screen overflow-hidden">
    <div className="flex flex-1 flex-col overflow-auto">
      <Navbar />
      <main id="main-content" className="flex-1">{children}</main>
      <Footer />
    </div>
    <AgentChatPanel />  {/* hidden on mobile, 400px panel on desktop */}
  </div>
</Providers>
```

**Step 4: Fix home page booking-grid media query (regression prevention)**

File: `apps/web-booking/app/page.tsx`

The inline `<style>` at lines 688–719 defines the booking grid at `@media (min-width: 1024px)`. With a 400px panel added, a 1440px viewport becomes 1040px effective width — barely above the 1024px threshold. The 5-column grid will be too narrow.

Change: `@media (min-width: 1024px)` → `@media (min-width: 1440px)` for the 5-column grid. The 2-column breakpoint below it stays as-is.

**Step 5: `AgentProvider` placement**

File: `apps/web-booking/app/providers.tsx`

The `AgentChatPanel` needs agent state available. But agents must work for **unauthenticated customers** (guest users browsing before booking). `AgentProvider` (which provides `session_id`, `messages`, `thinking`) must wrap `AuthProvider`, not be inside it:

```tsx
// providers.tsx
return (
  <QueryProvider>
    <AgentProvider>        {/* outermost — guest users need agent context */}
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </AgentProvider>
  </QueryProvider>
)
```

**Step 6: Add shared types to packages/shared-types**

File: `packages/shared-types/src/index.ts`

Add the types defined by the frontend analyst (`AgentMessage`, `AgentSession`, `AgentChatRequest`, `AgentChatResponse`, `AgentCard`, `AgentCardKind`, `AgentName`, `CounterSuggestion`). The current file contains only enums — these are the first interface/type exports.

---

## Part 5 — Wave 2: BookingConcierge — Specific Additions

**Fix `promotion_codes` column name bug first** (see Wave 1 notes above — this must be done before Wave 2 launches BookingConcierge promo code handling).

**Backend:**
- `BookingConcierge` agent class with tools: `GET /fleet/search` (built in Foundation), `POST /pricing/quote`, `GET /pricing/extras`, `POST /reservations/guest` (public endpoint — no auth change needed), `POST /customers` (verify auth requirements)
- Add SSE streaming to orchestrator: `GET /api/v1/agents/chat/stream` endpoint using FastAPI's `EventSourceResponse`. The batch `POST /agents/chat` stays unchanged. The streaming endpoint is an alternative path, not a replacement.
- Stripe Elements: the card collection happens client-side in the `AgentChatPanel`. The Stripe `PaymentElement` renders as an iframe inside the chat flow when the agent sends a card with `kind: "payment_capture"`. Client sends `payment_method_id` in the next user message; the agent uses it to call `POST /payments/pre-auth`.

**Frontend:**
- `VehicleClassCard`, `QuoteSummaryCard` (with 30s countdown), `GuestDetailsForm` (inline), `PaymentCapture` (Stripe Elements iframe) — all in `apps/web-booking/app/components/agent/cards/`
- SSE: the `AgentChatPanel` checks for `streaming_id` in the response. If present, switches to `EventSource` for that session turn. Both paths render into the same `messages` array. The `apiClient` from `@rcm/api-client` cannot be used for SSE — use a separate `fetch` with `ReadableStream`.
- Upgrade suggestion: rendered as a chip between VehicleClassCards when the customer-value conditions are met. Not when inventory is low.

---

## Part 6 — Wave 3: ReturnAdvisor + Proactive Triggers — Specific Additions

### Goodwill ledger enforcement

**File: `apps/api/app/domains/payments/schemas.py`**

Add to `RefundRequest`:
```python
is_goodwill: bool = False
goodwill_under: Optional[Decimal] = None   # max amount allowed for goodwill path
```

**File: `apps/api/app/domains/payments/service.py`**

Add to `process_refund()` before the existing `$500` approval threshold check:

```python
if payload.is_goodwill and payload.goodwill_under:
    # Check rolling 90-day customer cap
    window_total = await self._get_goodwill_total(tenant_id, customer_id)
    if window_total + payload.amount > settings.agent_goodwill_cap_usd:
        raise ForbiddenError("Goodwill refund cap exceeded for this customer in the past 90 days")
    if payload.amount > payload.goodwill_under:
        raise ForbiddenError("Refund amount exceeds goodwill authority limit")
    # Proceed without manager approval
    ...
    # Record in ledger
    await self._record_goodwill(tenant_id, customer_id, ra_id, payload.amount, session_id, agent_name)
```

### Fix checkout/service.py overdue logic

File: `apps/api/app/domains/checkout/service.py`

The `list_overdue_rentals()` method currently uses `created_at + 24h` as a proxy. Fix to JOIN against `reservations.return_datetime`:

```python
# Replace existing proxy query with:
WHERE ra.status IN ('ACTIVE', 'EXTENDED')
  AND r.return_datetime < NOW()   -- past the scheduled return time
```

This fix must happen before the `scan_overdue_rentals` beat entry is enabled, or the task fires on wrong rentals.

### New notification templates (seed migration)

**File: `apps/api/alembic/versions/20260624_044_agent_notification_templates.py`**

Insert three system-wide templates (`tenant_id IS NULL`) for:
- `BOOKING_REMINDER_24H` (SMS + EMAIL channels)
- `EV_LOW_SOC_ALERT` (SMS only)  
- `RENTAL_OVERDUE_SOFT` (SMS only)

The `RENTAL_OVERDUE_SOFT` SMS template: `"Hi {{ first_name }}, your rental was due back at {{ return_time }}. Are you on your way? Reply YES to confirm, or EXTEND if you need more time."` (Corrected from the plan's dark-pattern v1.0 wording.)

### New receipt breakdown endpoint

File: `apps/api/app/domains/checkout/router.py`

```python
@router.get("/agreements/{ra_id}/receipt-breakdown")
async def get_receipt_breakdown(ra_id: UUID, ...) -> ReceiptBreakdownResponse:
    """Returns arithmetic components for ReturnAdvisor to explain charges."""
```

`ReceiptBreakdownResponse` includes: `miles_driven`, `free_miles_included`, `overage_miles`, `overage_rate`, `mileage_charge`, `fuel_level_out_pct`, `fuel_level_in_pct`, `contracted_fuel_level_pct`, `fuel_steps_below_contract`, `fuel_charge_per_step`, `fuel_surcharge`, `late_return_minutes`, `late_fee_rate`, `late_return_charge`. The ReturnAdvisor calls this endpoint and explains the numbers; it does not compute arithmetic itself.

### New Celery tasks

File: `apps/api/app/worker/tasks/agent_tasks.py` (new file)

```python
from celery import shared_task
import asyncio

@shared_task(name="app.worker.tasks.agent_tasks.scan_ev_alerts", bind=True, max_retries=3)
def scan_ev_alerts(self):
    """Poll telematics_events for SOC ≤ 20%, dispatch EV alerts via notification pipeline."""
    asyncio.run(_async_scan_ev_alerts())

@shared_task(name="app.worker.tasks.agent_tasks.scan_overdue_rentals", bind=True, max_retries=3)
def scan_overdue_rentals(self):
    """Scan active RAs past their return_datetime, dispatch T+90min and T+2h alert SMS."""
    asyncio.run(_async_scan_overdue_rentals())
```

Use `asyncio.run()` — not `asyncio.get_event_loop().run_until_complete()` (deprecated in 3.10+, fails in 3.12+). This is also the pattern to adopt when fixing the existing tasks in `notifications.py` and `payment_tasks.py`.

---

## Part 7 — Wave 4: Damage — Specific Additions

### Product decision required before building

The `claim_status` enum has `PAID` but not `SETTLED`. The ClaimsProcessor plan describes advancing auto-settled claims to `SETTLED` to distinguish them from human-processed `PAID` claims. Decision:
- **Option A:** Add `SETTLED` enum value (new migration, same `ALTER TYPE ADD VALUE IF NOT EXISTS` pattern as the AGENT_SERVICE migration)
- **Option B:** Reuse `PAID` with a `settled_by_agent: bool` column on `damage_claims`

Make this decision before Wave 4 build begins. Recommendation: Option B — avoids another enum migration, and a boolean flag is queryable without enum extension.

### LOU endpoint

File: `apps/api/app/domains/damage/router.py`

```python
@router.get("/claims/{claim_id}/lou")
async def get_loss_of_use(claim_id: UUID, ...) -> LOUCalculationResponse:
    """Returns LOU components: daily_rate, down_days, utilization_factor, total_lou."""
```

`LOUCalculationResponse` schema already exists in `damage/schemas.py` — just needs the endpoint and `DamageService.calculate_lou()` implementation.

### Vision model call

The ClaimsProcessor calls the Anthropic client directly (not via the tool wrapper pattern, since it's an AI call not an API call):

```python
import anthropic

async def classify_damage(pre_photo_url: str, post_photo_url: str) -> VisionClassificationResult:
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key.get_secret_value())
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "url", "url": pre_photo_url}},
                {"type": "image", "source": {"type": "url", "url": post_photo_url}},
                {"type": "text", "text": DAMAGE_CLASSIFICATION_PROMPT},
            ]
        }]
    )
    # Parse structured JSON from response
```

`DAMAGE_CLASSIFICATION_PROMPT` is a constant defined in the ClaimsProcessor — it requests structured JSON output with `zone`, `damage_type`, `severity` (GRADE_1–5), `confidence` (0.0–1.0), `reasoning`.

---

## Part 8 — Wave 5: Admin Surfaces — Specific Additions

### web-admin Layout.tsx: Intelligence column

**Do not add the right column to `Layout.tsx` before Wave 5.** The FleetCalendar page (a Gantt layout) will clip horizontally at 1280px. When the time comes:

1. Add `intelligencePanelOpen: boolean` + `toggleIntelligencePanel()` to `useAdminStore` in `store/adminStore.ts`
2. Add the collapsible 300px right column to `Layout.tsx` as the third child of the existing flex row
3. Add a `data-compact` attribute to the `<main>` element when the panel is open — `FleetCalendarPage.tsx` uses this to switch to horizontal scroll mode via CSS

**CSS tokens for web-admin** (`apps/web-admin/src/index.css`):

```css
/* ── Agent tokens (admin palette) ────────────────── */
--agent-panel-width: 300px;
--agent-panel-bg: var(--elevated);
--agent-card-bg: var(--card-bg);
--agent-alert-danger: var(--danger);
--agent-alert-warn: var(--warn);
--agent-alert-info: var(--info);
--agent-chip-bg: rgba(139, 92, 246, 0.08);
--agent-chip-border: var(--border);
--agent-chip-hover: var(--accent-sub);
```

### web-admin Cmd+K: Fix the existing decorative handler

`Layout.tsx` line 177 renders a search input with a `⌘K` badge that is currently decorative (no handler). When the Cmd+K palette is added in Wave 5:
- Add `keydown` handler in the `useEffect` at line 133 of `Layout.tsx`
- The handler calls `toggleCommandPalette()` from `useAdminStore`
- The handler must call `event.preventDefault()` before toggling, to prevent the search input from receiving focus simultaneously

### web-counter: CheckoutPage only

**Do not touch `AppLayout` in `App.tsx`.** The suggestion panel lives only in `CheckoutPage.tsx`.

Change `CheckoutPage.tsx` root div from single-column to a 2-column grid:

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '32px' }}>
  <div>{/* existing 6-step stepper — unchanged */}</div>
  <AgentSuggestionPanel checkoutSessionId={checkoutSessionId} />
</div>
```

`AgentSuggestionPanel` is a `useQuery` with 8-second `refetchInterval` calling `GET /api/v1/agents/counter-suggestions?session={checkoutSessionId}`. By Wave 5, SSE exists — consider switching to an `EventSource` for this panel since the counter agent stays on the checkout page for 5–10 minutes.

**web-counter has no CSS token system.** The `AgentSuggestionPanel` must use the Ferrari `T` object pattern (inline style constants) consistent with how the rest of the app is styled. Do not import a CSS token file that doesn't exist.

---

## Part 9 — Risk Mitigations (Codebase-Specific)

| Risk | Mitigation |
|---|---|
| `ALTER TYPE ADD VALUE` for AGENT_SERVICE enum blocks transactions | Migration 042 uses explicit `COMMIT`/`BEGIN` sandwich outside Alembic's implicit transaction. Run in a maintenance window. Test on staging first. |
| Orchestrator imports services directly (bypasses audit) | Code review gate: no import from `app.domains.*.service` in `app.domains.agents.*`. Tool wrapper uses `httpx.AsyncClient` exclusively. |
| Agent session key collides with JWT session key | Key prefix `agent_session:` does not match any existing pattern (`session:`, `refresh:`, etc.). Verified by namespace audit. |
| Notification stream `maxlen=10000` too small for 24h reminder volume | Set `maxlen=50000` on the XADD call in `dispatch_notification()` for event codes prefixed `AGENT_`. Or add a separate `agent_notifications:{tenant_id}` stream. |
| `revoked_tokens` SET grows unbounded — evicts agent sessions under memory pressure | Add a cleanup Celery task (daily, `batch` queue) that removes JTIs older than the refresh token TTL from the set using `SSCAN` + `SREM`. |
| Clock skew causes overdue task to fire on wrong rentals | Use `NOW() AT TIME ZONE 'UTC'` in all overdue queries. Reservations store `return_datetime` in UTC. |
| Session has no `tenant_id` — cross-tenant exploit | Session creation writes `tenant_id` from the request JWT. Every subsequent message validates `request.tenant_id == session.tenant_id`. 403 on mismatch. |
| Promo code `max_uses` vs `usage_limit` column name bug | Fix in `reservations/service.py` SQL before BookingConcierge goes live. Add a test that creates a promo code and validates it through the booking flow. |
| Python 3.12 breaks existing `get_event_loop()` in Celery tasks | New agent tasks use `asyncio.run()`. Existing tasks in `notifications.py` and `payment_tasks.py` flagged for fix before Python version upgrade. |
| AgentProvider inside AuthProvider blocks guest users | `AgentProvider` wraps `AuthProvider` in `providers.tsx`. Guest users get `customer_id: null` in their session. |

---

## Part 10 — Implementation Order Summary

```
FOUNDATION (Weeks 1–2)
├── Migration 042: AGENT_SERVICE enum value
├── Migration 043: customer_goodwill_ledger table
├── core/config.py: anthropic_api_key + agent TTL settings
├── core/redis.py: AGENT_SESSION_KEY + AGENT_CIRCUIT_KEY constants
├── core/security.py: get_current_user_or_bearer + get_optional_current_user
├── auth/router.py: POST /auth/agent-token
├── domains/agents/: full directory, stub orchestrator, session store, tool wrapper
├── main.py: register agents router
├── worker/celery_app.py: agents queue + beat stubs
├── fleet/router.py: GET /fleet/search combined endpoint
├── web-booking globals.css: --agent-* tokens
├── web-admin index.css: --agent-* tokens
├── packages/shared-types: AgentMessage, AgentSession, AgentChatRequest/Response types
└── web-booking layout.tsx + providers.tsx: AgentChatPanel wiring (chat panel component)

WAVE 1 (Weeks 3–8)
├── domains/agents/agents/reservation_manager.py: ReservationManager agent
├── reservations/router.py: PATCH + cancel → get_current_user_or_bearer
├── domains/agents/service.py: intent classification (Claude) + ReservationManager routing
├── web-booking: ReservationCard, CancellationPreviewCard, DateModificationCard, ConfirmationCard
├── web-booking page.tsx: Fix booking-grid media query breakpoint
└── Shadow mode deployment + annotation rubric

WAVE 2 (Weeks 9–16)
├── Fix promotion_codes column name bug (reservations/service.py)
├── domains/agents/agents/booking_concierge.py
├── payments/router.py + service.py: goodwill_under param (partially — schema only, Wave 3 enforces)
├── GET /agents/chat/stream: SSE endpoint
├── web-booking: VehicleClassCard, QuoteSummaryCard, GuestDetailsForm, PaymentCapture

WAVE 3 (Weeks 17–22)
├── Migration 044: agent notification templates seed
├── Fix checkout/service.py list_overdue_rentals() overdue logic
├── payments/schemas.py + service.py: goodwill enforcement + ledger write
├── checkout/router.py: GET /agreements/{ra_id}/receipt-breakdown
├── domains/agents/agents/return_advisor.py
├── worker/tasks/agent_tasks.py: scan_ev_alerts, scan_overdue_rentals (real implementations)
└── Beat schedule entries for 24h reminder, EV alert, overdue scan

WAVE 4 (Weeks 23–34)
├── Product decision: SETTLED vs PAID for auto-settlement
├── damage/router.py: GET /claims/{id}/lou endpoint
├── domains/agents/agents/damage_mediator.py
├── domains/agents/agents/claims_processor.py (with vision model + CDW rules engine)
├── web-booking: DamageComparisonCard

WAVE 5 (Weeks 35–44)
├── web-admin useAdminStore: intelligencePanelOpen, commandPaletteOpen
├── web-admin Layout.tsx: 300px right intelligence column + Cmd+K handler
├── web-admin index.css: --agent-* tokens
├── web-counter CheckoutPage.tsx: 2-column grid + AgentSuggestionPanel
├── Operational agents: FleetOptimizer, PricingStrategist, OverdueTracker
└── OTA channel data dependency: must be live by Week 25 for PricingStrategist
```

---

*Document produced by: Backend (auth/API), Frontend (UI integration), and Infrastructure (events/data) specialists*  
*Companion: AI_AGENT_INTEGRATED_PLAN.md v2.0*  
*Status: Ready for Foundation sprint planning*
