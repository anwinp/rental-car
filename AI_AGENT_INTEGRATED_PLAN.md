# AI Agent Integrated Implementation Plan
## Critical Review · Debate · Consensus · Execution Roadmap

**Document version:** 2.0  
**Date:** 2026-06-23  
**Status:** Working document — supersedes v1.0 and Phase Roadmaps in both `AI_AGENT_DESIGN.md` and `AI_AGENT_UX_DESIGN.md`

**What changed in v2.0:**
- Orchestrator design fully specified (routing tree, classification model, mid-conversation logic, error recovery) — was a paragraph in v1.0
- Auto-settlement Condition 4 extended to cross-account fraud linkage
- OverdueTracker T+2h message corrected — dark pattern in v1.0 removed
- Counter checkout time target re-grounded with actual bottleneck analysis
- All KPI metrics given denominator definitions and measurement methodology
- Shadow mode exit gate given a reviewer annotation rubric
- Wave 5 OTA data dependency made explicit
- Upgrade suggestion trigger changed from scarcity-based to customer-value-based
- Vision confidence threshold marked as calibration-determined, not preset

---

## Part 1 — Critical Review of AI_AGENT_DESIGN.md

### What the document does well

The agent taxonomy is correct. Nine specialized agents with strict RBAC separation between customer-facing and operational is the right architecture. The debate section (Issues A–G) is honest and the consensus positions are defensible. The priority matrix — BookingConcierge + ReservationManager first, vision-based damage automation last — is sound directionally (though the sequencing was corrected: ReservationManager before BookingConcierge).

The API surface analysis is grounded: the existing endpoints are largely sufficient, and the three identified gaps (agent auth token, trigger webhook, goodwill refund limit) are real and specific.

### Critical problems (addressed in v2.0)

---

**Problem 1: Phase 1 builds the most technically complex agent first.**

BookingConcierge requires Stripe tokenization, PaymentIntent pre-auth, Redis quote token race guard, WhatsApp webhook, concurrent booking advisory lock integration, and a promotion_codes table that may not exist. Putting it first means the entire Phase 1 delivery depends on the hardest component succeeding simultaneously with building all shared infrastructure. If BookingConcierge slips, Phase 1 delivers nothing.

**Resolution:** Flip order. ReservationManager (②) first. It reads existing confirmed reservations, validates availability, patches the return datetime. No payment integration. No new channel. Serves 100% of the existing customer base from day one.

---

**Problem 2: The Orchestrator was a paragraph, not a design.**

The v1.0 orchestrator section listed keyword routing patterns and called it done. It did not answer: what model classifies intent, how does context-aware routing work mid-conversation, what happens with multi-intent messages, what is the tool call timeout strategy, how are agent errors surfaced.

**Resolution:** A full orchestrator design is in Part 3A of this document.

---

**Problem 3: The 26-week timeline includes components that don't exist yet.**

Damage annotation (500+ claim pairs) and vision model calibration require months of coordinator time and evaluation. They cannot be compressed into a 6-week phase that runs simultaneously with building the shared infrastructure.

**Resolution:** 44-week plan. Annotation starts Week 2 and runs in parallel through Wave 3. Wave 4 does not begin until annotation is complete.

---

**Problem 4: The $75 goodwill refund creates a per-session fraud vector.**

A customer who learns the $75 threshold can start a new session after each refund, issuing unlimited cumulative goodwill refunds by splitting across sessions and rental agreements.

**Resolution:** Goodwill refunds tracked per customer in a `customer_goodwill_ledger` table with a 90-day rolling window cap of $75 total, enforced at the DB level via the `goodwill_under` parameter on `/payments/refund`. Not per session — per customer.

---

**Problem 5: Competitor rate scraping is legally and technically fragile.**

Scraping OTA platforms violates ToS, is actively blocked by bot detection, and returns stale data. Exposes the company to CFAA risk.

**Resolution:** Replace "competitor rate scraping" with "OTA channel booking pace analysis" — derived from existing channel integration data (how many OTA bookings in last 48h vs. prior week). No scraping.

---

**Problem 6: No agent evaluation framework beyond synthetic scenarios.**

Synthetic evals catch regressions on known cases. They do not catch the edge cases real customers bring. There was no shadow mode deployment plan, no inter-rater agreement measurement, no model drift strategy.

**Resolution:** Staged shadow mode deployment before every wave goes live. Shadow mode annotation rubric defined in Part 8 of this document.

---

**Problem 7 (new in v2.0): The auto-settlement Condition 4 has a cross-account fraud gap.**

Condition 4 ("customer has zero prior damage claims") checks per `customer_id`. A fraudster creates a new account for each rental. Each account passes Condition 4 automatically. First-time-renter fraud is a real and common rental industry pattern.

**Resolution:** Condition 4 is expanded to cross-account linkage checks. See Part 4, consensus point 13.

---

**Problem 8 (new in v2.0): The OverdueTracker T+2h message is deceptive.**

"An extension has been applied at $XX/hour" implies a charge was made when it wasn't. Misrepresenting a financial transaction to create urgency is the kind of dark pattern that generates chargebacks.

**Resolution:** T+2h message revised to offer, not assert. See Part 5, Wave 3.

---

**Problem 9 (new in v2.0): The upgrade suggestion trigger is scarcity pressure, not customer value.**

The original trigger: "if cheapest class has ≤ 1 available AND next class up has ≥ 3." This optimizes for operator inventory, not customer outcome. Customers who learn the pattern will distrust all agent suggestions.

**Resolution:** Upgrade suggestion trigger changed to customer-value conditions. See Part 5, Wave 2.

---

## Part 2 — Critical Review of AI_AGENT_UX_DESIGN.md

### What the document does well

The surface taxonomy (chat panel / inline contextual / sidebar intelligence / command palette) is architecturally correct and matches the actual user contexts across the three apps. The motion system is detailed and implementable. The tone-of-voice section is excellent — the before/after error message examples alone are worth preserving. The accessibility specification is thorough and correct. The decision not to use three-dot typing indicators is a good call.

### Critical problems (addressed in v2.0)

---

**Problem A: Several cited statistics were fabricated.**

"Stanford HCI Research 2024," "Gartner CX Survey 2024," "Zendesk 2024," "Intercom internal research 2024," specific Grab percentages — none of these are verifiable published studies. They are estimates dressed as data, used to justify product decisions.

**Resolution:** All cited statistics removed. Replaced with principles stated as principles. The AI_AGENT_UX_DESIGN.md document requires a cleanup pass (v1.1) before any design decisions are made from it.

---

**Problem B: "73% mobile" is an assumption, not a measurement.**

web-booking is newly built and has not had production traffic. This figure does not exist. Mobile-first vs. responsive is the single biggest UX architectural decision and it was made on invented data.

**Resolution:** Instrument web-booking with PostHog/Plausible from Week 1 of Foundation. Collect 2–4 weeks of real data before committing to mobile-first component architecture. Until then: build responsively.

---

**Problem C: The handoff card design has no backend.**

web-admin and web-counter have no live chat functionality, no staff chat inbox, and no queue management. The UX design solves a handoff experience problem where the destination does not exist.

**Resolution:** Human handoff defaults to email (existing workflow) until the product makes an explicit decision about live chat infrastructure. The handoff card renders a context summary + email confirmation to the customer. This is listed as an open product question in Part 6.

---

**Problem D: Counter panel has no feedback channel.**

The counter surface is "push-only" — staff cannot tell the agent when its suggestion is wrong. An agent that suggests GPS to a customer who already declined GPS will keep suggesting GPS, because there is no rejection signal.

**Resolution:** Each suggestion card in the counter panel includes a thumbs-down button. Click suppresses that suggestion type for the current checkout session and logs the rejection for agent improvement metrics. This is not a full chat interface — one button per card is sufficient.

---

**Problem E: Design tokens specified but not wired to implementation.**

The mock page at `/agent-preview` uses inline styles. The `--agent-*` token block from the UX doc has not been added to either `globals.css` or `index.css`. Production components built on the mock as a reference will inherit inline styles.

**Resolution:** Adding `--agent-*` tokens to both app stylesheets is a Foundation sprint deliverable. No production agent component development begins until this is done.

---

**Problem F: Cmd+K command palette requires an app shell refactor.**

Adding a global keyboard shortcut to web-admin requires a global event handler at the app root, a full-screen overlay, and state management that is not scoped to any one page. This is a meaningful refactor to the app shell, not a drop-in component. It should not be in Wave 1 scope.

**Resolution:** Cmd+K is a Wave 5 deliverable, built as part of the admin app shell refactor that also adds the sidebar intelligence column.

---

## Part 3 — Debate on Integration Conflicts

Four conflicts exist between the two documents. Resolutions unchanged from v1.0 except where noted.

---

### Conflict I: Phase sequencing mismatch

**Conflict:** Backend doc phased BookingConcierge first. UX doc listed 12 UI components in P0. Neither is executable simultaneously.

**Resolution:** 2-week Foundation sprint for shared infrastructure, then one agent end-to-end per wave. ReservationManager is Wave 1. BookingConcierge is Wave 2.

---

### Conflict II: Session context ownership

**Conflict:** Backend doc said "build a Redis session store" (one line). UX doc implied the front-end might own conversation history.

**Resolution:** Server-side session. Client is stateless — sends only `session_id` + new message. Orchestrator reconstructs full context from Redis.

**Session schema (canonical):**

```json
{
  "session_id": "uuid",
  "customer_id": "uuid | null",
  "active_agent": "ReservationManager",
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

Messages capped at 50 turns (FIFO). When turn count approaches the model's context limit (~40,000 tokens for claude-sonnet-4-6), older turns are summarized into a `handoff_summary` block via a dedicated lightweight Claude call. The summarization adds latency (~800ms) but happens only every ~35–40 turns. Original turns archived to S3 cold storage after summarization.

---

### Conflict III: Streaming vs. batch rendering

**Conflict:** UX doc implies streaming preferred. Backend doc doesn't specify. FastAPI streaming requires SSE or WebSocket — different infrastructure than batch JSON.

**Resolution:** Start with batch. The progress bar + phrase pattern solves perceived latency without streaming infrastructure. Add SSE streaming in Wave 2 after batch system is proven. Front-end component accepts both: if a `streaming_id` is present in the response headers, render progressively at sentence boundaries; if not, render the complete message.

---

### Conflict IV: WhatsApp vs. web chat as first channel

**Conflict:** Backend doc said "deploy on WhatsApp (highest engagement)." UX doc specified a web chat panel as the primary surface.

**Resolution:** Phase 1 deploys on web-booking app only. WhatsApp requires Meta Business API approval, webhook handler, message template registration, and a different message schema for structured cards — none of which should be the first thing a new agent system handles. WhatsApp is Wave 2 scope, after agent behavior is validated on web.

---

## Part 3A — Orchestrator Design (new in v2.0)

The orchestrator is the hardest component in a multi-agent system. It is the first thing to design and the last thing to optimize. This section provides the full design that was missing from v1.0.

---

### Classification model choice

The orchestrator must classify intent on every new session message. Two options:

| Option | Cost | Latency | Accuracy | When to use |
|---|---|---|---|---|
| **Rule-based** (keyword + regex) | Negligible | < 5ms | ~70–75% on ambiguous input | Turn 2+ in a session with established `active_agent` |
| **Claude classification call** | ~$0.002/call | 200–400ms | ~90–94% | First message of a session, or when session context changes significantly |

**Decision:** Hybrid. First message of every session uses Claude. Subsequent messages use rule-based classification as a fast-path *if* the active agent is already set and the message doesn't contain a strong signal for a different domain. Claude is invoked again when:
- Session `active_agent` is null (no agent selected yet)
- Message contains an explicit topic shift keyword ("damage," "cancel," "charge") pointing to a different agent than the current one with confidence > 0.80
- Two consecutive tool calls in the current agent failed

This cuts Claude classification calls by approximately 60–70% once a session is in progress, while maintaining accuracy for the cases that matter.

---

### Intent classification prompt structure

The Claude classification call receives:
- Current session context (active agent, `reservation_id` if set, `rental_agreement_id` if set)
- Last 3 messages (not full history — classification is a routing decision, not a comprehension task)
- The new user message
- The list of agent domains with 2-sentence descriptions

Returns a JSON object: `{"agent": "ReservationManager", "confidence": 0.91, "reason": "customer asking to modify return date on existing booking"}`.

The `reason` field is logged for evaluation, not shown to the customer.

---

### Routing decision tree

```
Inbound message received
│
├─ Is session_id valid and existing?
│   ├─ NO → create new session, active_agent = null, go to Classification
│   └─ YES → retrieve session from Redis, update last_active
│
├─ Is active_agent set AND is this turn 2+?
│   ├─ YES → Fast-path rule check
│   │   ├─ Message contains strong cross-domain signal? (confidence > 0.80)
│   │   │   ├─ YES → Claude classification call → update active_agent if different
│   │   │   └─ NO → continue with current active_agent (no classification call)
│   └─ NO → Claude classification call
│
├─ Classification result
│   ├─ confidence ≥ 0.65 → route to classified agent
│   ├─ confidence 0.50–0.64 → ask clarifying question (stay in current agent or GENERAL)
│   └─ confidence < 0.50 → "I want to make sure I help you with the right thing —
│       are you asking about [Option A] or [Option B]?" (two chips, no free text)
│
├─ Escalation override (checked BEFORE confidence routing)
│   ├─ Message contains: "supervisor", "manager", "complaint", "legal", "lawyer",
│       "lawsuit", "CFPB", "BBB", "attorney", "fraud" → route to ESCALATION
│       regardless of confidence
│   └─ Active agent has made 2+ failed tool calls this turn → route to ESCALATION
│
└─ Route to agent → execute → return response
```

---

### Multi-intent messages

When a customer sends a message that spans two agent domains ("cancel my booking and I also want to know why I was charged for mileage last month"), the orchestrator:

1. Identifies the primary intent (whichever scores higher confidence)
2. Routes to that agent
3. Stores the secondary intent in session context: `"pending_intent": {"text": "mileage charge from last month", "agent": "ReturnAdvisor"}`
4. After the primary intent is resolved, the agent surfaces the pending intent: "I've handled your cancellation. You also mentioned a mileage charge from your last rental — shall I look into that now?"

This avoids splitting one customer message across two agent calls (which would double cost and create response-ordering problems) while ensuring neither intent is dropped.

---

### Tool call error handling

Every tool call has a 5-second timeout. On tool failure:

| Failure type | Retry? | Customer message |
|---|---|---|
| API 5xx (server error) | Yes, once, after 1s | If retry fails: "I'm having trouble reaching that right now — try again in a moment, or I can connect you with our team." |
| API 4xx (client error — bad request) | No | Log the error. Agent responds based on the error body: 404 → "I couldn't find that reservation." 409 → "That change conflicts with an existing block — let me suggest alternatives." |
| Timeout (> 5s) | No | "That's taking longer than expected. Let me try a different approach." + attempt a fallback tool if one exists, or escalate |
| Auth error (401/403) | No | Escalate immediately. An auth error on an AGENT_SERVICE token is a system issue, not a customer issue. Alert engineering on-call. |
| 2 failed tool calls in one turn | No more tools | Escalate to human with full context. Do not attempt a third tool. |

Tool errors are never exposed verbatim to the customer (no "500 Internal Server Error" in chat). All tool call attempts, outcomes, and durations are logged for the observability dashboard.

---

### Agent switching and context handoff

When the orchestrator routes from one agent to another mid-session (e.g., customer transitions from modification query to damage dispute), the outgoing agent generates a `handoff_summary` — a 3–5 sentence natural language summary of what was accomplished and what remains unresolved. This summary is:

- Stored in `session.handoff_summary`
- Included in the incoming agent's system prompt context
- NOT shown to the customer (internal routing artifact)

The incoming agent's first response acknowledges the context continuity without announcing the switch: "I can see you were asking about your booking modification — I can now help with the damage claim you mentioned."

---

### Circuit breaker for Claude API

If the Claude API returns 5xx errors on 5 consecutive calls within 60 seconds, the orchestrator enters degraded mode:

- Degraded mode: only rule-based responses are served. Agents cannot call Claude.
- Customer-facing message: "Our assistant is temporarily unavailable. You can still manage your booking at [URL] or reach our team at [support contact]."
- Chat panel shows a banner: "Limited assistance available right now." Panel remains open; customers can still navigate to their account page.
- Recovery: attempt a health-check Claude call every 30 seconds. Return to normal mode on first success.

This ensures the rest of the web-booking app works normally when the AI layer is down.

---

## Part 4 — Integrated Consensus: What We Agree On

**On architecture:**
1. Server-side session store (Redis, schema in Part 3, Conflict II). Client is stateless.
2. Batch rendering first, SSE streaming as Wave 2 optimization.
3. Single persona (RCM monogram) across all surfaces. No named sub-agents shown to customers.
4. Agent segregation maintained: customer agents cannot call fleet/pricing/admin tools.
5. Channel-agnostic agent logic. Channel (web, WhatsApp, SMS) is a rendering/delivery layer only.
6. Orchestrator uses hybrid classification: Claude for session-start and domain shifts, rule-based fast-path for in-progress sessions.

**On UX:**
7. Four surfaces: chat panel (customer), inline contextual (counter), sidebar intelligence (admin dashboard), command palette (admin power user). Built in that priority order.
8. Mobile-first only after real traffic data confirms mobile majority. Until then: responsive.
9. No fabricated research citations in any production document. Principles stated as principles.
10. Confirmation cards required only for: cancellations, payment captures, damage claim state transitions.
11. Human handoff goes to email (existing workflow) until a live chat inbox is built. Handoff card shows context summary; delivery is email.
12. Counter panel includes thumbs-down feedback on each suggestion card. No text input for counter staff.

**On safety:**
13. Goodwill refunds capped per customer per 90-day rolling window ($75 total across all sessions). Auto-settlement Condition 4 checks cross-account linkage — not just `customer_id`:
    - Same driver's license number
    - Same credit card last-4 + expiry
    - Same email domain (for patterns like user1@domain.com, user2@domain.com)
    - Same device fingerprint (from inspection form photo metadata)
    - Any match on any linkage field = treat as "prior claims exist"
14. BookingConcierge does not bypass the PaymentIntent pre-auth flow under any condition.
15. ClaimsProcessor vision-AI auto-settlement gated by ALL five conditions:
    - Vision confidence ≥ threshold (set by calibration, see Part 5 Wave 4)
    - CDW active and not voided
    - No prior damage claims — verified including cross-account linkage (point 13)
    - Customer liability < $150
    - PRE inspection photo exists with zone metadata
16. Shadow mode deployment before any agent goes live to customers. Annotation rubric in Part 8.
17. PricingStrategist demand signal: OTA booking pace from existing channel data only. No scraping.
18. Upgrade suggestion trigger: customer value conditions only. Not inventory scarcity. Details in Part 5, Wave 2.

---

## Part 5 — Integrated Implementation Plan

### Foundation (Weeks 1–2) — No Agents Yet

Pre-agent infrastructure. Nothing visible to customers. Everything subsequent builds on it.

**Backend deliverables:**

| Item | What | Why First |
|---|---|---|
| `AGENT_SERVICE` role | New RBAC role, separate from COUNTER_AGENT. Each agent class gets its own scoped token. Token expires every 90 days. | Every agent call hits the API as this role. Without it, agents either have no auth or too much auth. Audit logs show which agent took which action. |
| Agent session store | Redis schema (Part 3, Conflict II). Session create/read/update. 24h TTL. Message cap: 50 turns. | Without this, agents have no memory. The session contract defines what both orchestrator and UI agree on. |
| Orchestrator skeleton | FastAPI service: receives `{session_id, message}`, applies routing logic from Part 3A (initially echoes). Returns `{session_id, message, card: null, chips: []}`. | This is the API contract the UI builds against. Define once; build everything else to it. |
| Tool wrapper interface | A typed `AgentTool` class: `name`, `description`, `parameters` (JSON Schema), `call(params) → ToolResult`. Logs every call: agent, session_id, duration, HTTP status. Returns structured `ToolError`, never Python exceptions. | Agents are defined by their tools. The wrapper forces a clean separation between capability and implementation. Tools can be tested independently. |
| `--agent-*` CSS tokens | Add all tokens from `AI_AGENT_UX_DESIGN.md §3.1` to `apps/web-booking/app/globals.css` and `apps/web-admin/src/index.css`. | Establishes the design contract before component development begins. All agent UI uses tokens, not inline styles. |
| Orchestrator health endpoint | `GET /agents/health` returns `{status, redis, claude_api}`. No auth required (load balancer needs it). | Circuit breaker in Part 3A requires a health signal. Ops team needs this from day one. |

**UX deliverables:**

| Item | What | Why First |
|---|---|---|
| Agent component library shell | AgentMonogram, MessageBubble (agent + user), ProgressBar, QuickReplyChip, ChatInput, ChatPanel (layout only). No real data. Passes `axe-core` WCAG 2.2 AA with zero violations. | Primitives everything else composes from. Build once, reuse across all 9 agents. |
| Design token audit | Verify all `--agent-*` tokens in both apps. Fix placeholder text contrast (`rgba(255,255,255,0.30)` → `rgba(255,255,255,0.55)` — fails WCAG AA at 14px). | Accessibility baseline before first user ever sees the UI. |
| Analytics instrumentation | PostHog or Plausible on web-booking. Capture: device type (mobile/tablet/desktop by viewport), page, session duration, chat panel open/close events. | Produces real mobile/desktop split data. 2–4 weeks of collection needed before committing to mobile-first component decisions. |

**Foundation Success Gate (end of Week 2):**
- Orchestrator returns a stubbed response for any message
- Chat panel renders the response correctly
- Session is persisted in Redis and retrieved across page reloads
- All `--agent-*` CSS tokens in place in both apps
- Analytics data is flowing; device split visible in dashboard
- `GET /agents/health` returns 200 with all dependencies green

---

### Wave 1 — ReservationManager + Web Chat (Weeks 3–8)

**Why ReservationManager first:**
All read/write APIs exist today. No payment integration. No new channel. Serves every customer who has already booked. The worst case of a mistake (a date set wrong) is reversible. Validates the entire agent pipeline on a real use case before adding payment complexity.

**Backend deliverables:**
- ReservationManager agent: tools for `GET /reservations/confirmation/{number}`, `PATCH /reservations/{id}`, `GET /reservations/{id}/cancellation-preview`, `POST /reservations/{id}/cancel`, `POST /pricing/quote`, `GET /fleet/search` (availability check for new dates), `GET /pricing/extras`
- On successful reservation lookup: write `reservation_id` to `session.context`
- Orchestrator routing: first message of session routed via Claude classifier. Subsequent messages use fast-path rule (stay with ReservationManager) unless strong cross-domain signal detected
- Goodwill refunds: NOT in this wave. ReservationManager does not issue refunds.
- Shadow mode: 100% of logged-in web-booking users enter shadow mode starting Week 3. Agent generates responses shown only to the reviewer dashboard. No customer sees agent responses until exit gate is passed.

**UX deliverables:**
- `ReservationCard` — confirmation number, class, route, dates, status badge, extras, total
- `CancellationPreviewCard` — refund amount, fee tier explanation, "Yes cancel" + "Keep it" buttons
- `DateModificationCard` — current dates → new dates, price delta with explicit sign (+/−), "Confirm Change" + "Cancel" buttons
- `ConfirmationCard` — green top border, action taken, "Email this summary" chip
- Desktop right panel (400px fixed) wired to live orchestrator API
- Mobile bottom sheet (82vh) wired to live orchestrator API
- "Ask RCM" entry points on: search results, booking confirmation, account/bookings pages
- `HandoffCard` — context summary bullets, estimated response time, case reference number (for escalations)

**Wave 1 Exit Criteria:**
- ReservationManager handles without human intervention: reservation lookup by confirmation number, cancellation fee explanation, cancellation execution with confirmation card, date modification with re-quote, extras add/remove
- Shadow mode gate: > 88% "Correct or Partially Correct" on reviewer annotation rubric (Part 8) across 50+ reviewed turns
- Zero unauthorized actions (agent takes action outside its defined tool set)
- Chat panel passes `axe-core` WCAG 2.2 AA — zero violations
- P95 end-to-end response time < 4s (Claude call + tool call + response rendering)

**Wave 1 does NOT include:** booking creation, payment, damage claims, proactive push messages, WhatsApp.

---

### Wave 2 — BookingConcierge + Payment Integration (Weeks 9–16)

**Why later:**
Payment integration (Stripe tokenization, PaymentIntent pre-auth, 30-second Redis token guard) is the highest-risk component. Building it after Wave 1 means the orchestrator, session store, tool wrappers, and UI components are already proven in production. You're adding payment to a working system.

**Backend deliverables:**
- BookingConcierge agent: tools for `GET /fleet/search`, `POST /pricing/quote`, `GET /pricing/extras`, `POST /reservations/guest`, `POST /customers`
- Orchestrator routing expansion: booking/search intent → BookingConcierge
- Stripe.js token capture: UI collects card details client-side (Stripe Elements iframe). Agent backend receives only `payment_method_id`. Agent never sees, stores, or logs card data.
- Quote TTL enforcement: agent checks `expires_at` before submitting reservation. If expired, re-quotes and shows new QuoteSummaryCard with explicit "Price updated" label if amount changed.
- Promo code application: BookingConcierge applies codes from `promotion_codes` where `is_active = true` and `used_count < max_uses`. It cannot create codes. Revenue manager configures chat-specific incentive codes (e.g., `CHAT5OFF`) with usage limits.
- SSE streaming added in this wave: orchestrator streams at sentence boundaries for responses > 2 sentences. Short tool-call confirmations still delivered as batch.

**Upgrade suggestion — customer-value trigger (revised from v1.0):**

The original trigger (inventory scarcity: Economy ≤ 1 available + Compact ≥ 3) was removed. It optimizes for operator inventory, not customer benefit, and customers who learn the pattern will distrust all agent suggestions.

**New trigger conditions — suggest an upgrade only when ALL of the following are true:**
- Price delta between selected class and next class up is ≤ 15% of the selected class total
- Next class up is objectively meaningfully different (SUV vs. Compact, not Compact vs. Intermediate where the distinction is marginal)
- Customer has not already expressed a preference for the lower class ("I want the cheapest option," "just give me a basic car")
- Availability of the next class is ≥ 3 (not suggesting a scarce upgrade)

When suggested, the agent frames it as genuine value: "For $8 more per day you'd get an SUV with significantly more cargo space — worth considering if you have luggage." Not: "We're running low on Economy — would you like to upgrade?"

**UX deliverables:**
- `VehicleClassCard` — class name, features, per-day rate, trip total, availability count (green > 3, amber ≤ 3), vehicle silhouette SVG, SELECT button
- `QuoteSummaryCard` — line items, 30-second countdown bar, "CONFIRM BOOKING" + "CHANGE OPTIONS" buttons
- `GuestDetailsForm` — inline within chat panel, collapses after submission
- `PaymentCapture` — Stripe Elements iframe inside chat panel, "not charged until you confirm" message, replaced by `•••• XXXX [BRAND]` display after tokenization
- Upgrade suggestion chip (appears between VehicleClassCards when conditions are met)

**Wave 2 Exit Criteria:**
- Full booking flow: search → class select → quote → card entry → confirm → `booking.confirmed` event fires → confirmation email sent
- No double-bookings in load test: 50 concurrent sessions targeting same class + dates + location
- Payment errors handled gracefully: decline → specific error message (not 500), insufficient funds → "try a different card"
- Booking completion rate > 70% for sessions where customer interacted with a VehicleClassCard (denominator: sessions that reached the card display step, not all chat sessions)
- Zero instances of card data appearing in any log line (verified by log scan)

---

### Wave 3 — ReturnAdvisor + Proactive RentalAssistant (Weeks 17–22)

**ReturnAdvisor:**

Tools: `GET /checkout/agreements/{ra_id}`, `GET /payments/reservation/{id}`, `GET /damage/inspections/{ra_id}` (pre/post fuel + mileage context), `POST /payments/refund` (goodwill only, enforced by `goodwill_under` parameter + DB ledger)

Capabilities:
- Explain every receipt line item with the arithmetic shown (mileage overage: shows odometer_in − odometer_out, free miles calculation, rate per mile)
- Fuel charge disputes: retrieves pre-rental vs. return fuel level, shows policy calculation
- For clear operator errors where the math doesn't add up: issues goodwill refund after confirming the discrepancy with the customer
- For ambiguous disputes: creates a formal dispute ticket and escalates to human

The `goodwill_under` parameter on `/payments/refund` is built in this wave alongside the `customer_goodwill_ledger` table. The table records: `customer_id`, `amount`, `rental_agreement_id`, `issued_at`, `session_id`, `issued_by_agent`. Before issuing, the agent endpoint queries the ledger for sum of goodwill refunds for this `customer_id` in the past 90 days. If `sum + new_amount > $75`: reject, agent escalates to human.

When the customer is at the cap, the agent says: "I've reached the limit of what I can adjust directly. Let me connect you with our team to review this." It does not explain the limit to the customer.

**Proactive RentalAssistant (push-only):**

Triggered by Redis stream events. Outbound via existing Twilio SMS + SendGrid email infrastructure.

- `booking.reminder.24h` → SMS + email: pickup location, time, confirmation number, what to bring (license, booking card). SMS ≤ 160 chars; truncate to link if longer.
- `ev.low_soc_alert` (SOC ≤ 20%) → SMS: actual SOC%, nearest available fast charger (name, address, distance) from EV network API. If SOC ≤ 10%: CRITICAL priority, no rate-limiting suppression.
- `rental.overdue_soft` (T+90min past return time) → SMS: "Hi [first name], your rental was due back at [time]. Are you on your way? Reply YES to let us know, or EXTEND if you need more time."

**OverdueTracker T+2h message (revised from v1.0):**

v1.0 said: *"An extension has been applied at $XX/hour."* — This is deceptive. No charge has been captured. Telling a customer "has been applied" when it hasn't is dark pattern territory that generates chargebacks.

**v2.0 message:** "Hi [first name], your rental is now 2 hours overdue. An extension is available at $XX/hour — reply EXTEND to confirm, or call us at [number] to arrange your return. We'll hold your rate until [time]."

The urgency is maintained by the hold deadline, not by misrepresenting a charge.

**Wave 3 Exit Criteria:**
- ReturnAdvisor resolves receipt dispute without human > 55% of cases (denominator: sessions where customer asked about a specific charge that the agent could pull data for — excludes "I just want a refund" with no specific dispute)
- Zero instances of goodwill refund exceeding per-customer-90-day cap (verified in ledger)
- Zero instances of cross-account cap bypass (verified: create two accounts, same DL#, attempt refund on each — second attempt rejected)
- 24h reminder fires correctly for 100% of reservations with contact info on file (verified against reservation log)
- EV alert fires on synthetic `ev.low_soc_alert` event with correct charger data

---

### Wave 4 — DamageMediator + ClaimsProcessor (Weeks 23–34)

**Prerequisites (must be complete before Wave 4 begins):**

1. **Annotated dataset ≥ 500 claim pairs.** Annotation begins Week 2 (Foundation), not Week 23. Each annotated pair: PRE photo, POST photo, zone label, severity grade (GRADE_1–5), damage type, settlement outcome. 80/20 train/test split. Test set locked and not used during calibration. Inter-rater agreement must be ≥ 0.80 (Cohen's kappa) before the dataset is considered reliable. Assign 4–6 hours per week of claims coordinator time starting Week 3.

2. **CDW adjudication rules engine.** A pure function: CDW active? → deductible amount. Void conditions present? → CDW_VOID + reason. Customer liability = estimate − deductible (if active, not voided). 100% unit test coverage. No LLM inside the rules engine. The LLM explains the output; the engine produces it.

3. **Inspection photo infrastructure.** PRE and POST photos stored with zone metadata in the `damage` domain. All zone photos retrievable via the `/damage/inspections/{ra_id}/comparison` endpoint. Verify completeness before Wave 4 starts.

**Vision model calibration (do not preset the threshold):**

v1.0 set confidence > 0.88 as the auto-settlement gate. That number was chosen before any calibration data existed. It is wrong to preset a threshold before seeing calibration curves.

**Correct process:**
1. Run Claude claude-sonnet-4-6 Vision against the annotated test set (held-out 20%)
2. Generate a precision/recall curve at confidence thresholds from 0.60 to 0.99
3. Find the threshold where precision ≥ 0.90 on severity grade agreement with coordinator ground truth
4. Set that as the production threshold — it may be 0.85, 0.90, 0.92, or something else; it will be determined by YOUR data, not by a prior assumption
5. Document the threshold and the precision/recall it achieved; include this in the Wave 4 exit criteria

If no threshold achieves ≥ 0.90 precision on the held-out set, do not enable auto-settlement. Route all claims to ClaimsCoordinator until the model is re-calibrated or additional annotation is done.

**Auto-settlement gate — all five conditions required:**

1. Customer liability < $150 (post CDW-adjudication rules engine)
2. Vision model confidence ≥ calibration-determined threshold
3. PRE inspection photo exists with zone metadata (not null)
4. No prior damage claims — checked via `customer_id` AND cross-account linkage (Part 4, point 13): same DL#, same card last-4, same device fingerprint
5. CDW active and not voided

Any single condition failing routes to ClaimsCoordinator review queue. No exceptions. Claims > $1,500 customer liability always route to Regional Manager regardless of other conditions. GRADE_5 (total loss) sets legal hold, no automated action.

**DamageMediator (customer-facing):**
- Triggered when customer contacts about a damage claim or uses escalation language related to damage
- Fetches: `GET /damage/claims/{id}`, `GET /damage/inspections/{ra_id}/comparison`, `GET /damage/claims/{id}/lou`
- Renders `DamageComparisonCard`: PRE/POST photos side by side on desktop, swipe toggle on mobile
- Explains: severity grade, CDW status and deductible, LOU formula (daily_rate × down_days × utilization_factor — shows the numbers)
- Advances claim to `CUSTOMER_ACKNOWLEDGED` after explanation
- Does NOT reduce estimates or settle. Disputed claims escalate to ClaimsCoordinator via human handoff.

**ClaimsProcessor (internal, staff-facing only):**
- Runs automatically when `damage.claim_opened` event fires
- Tool calls: vision classification, CDW adjudication rules engine, LOU calculation
- Auto-settlement: captures from pre-auth, sends settlement email, advances claim to `SETTLED`
- Non-auto-settlement: populates ClaimsCoordinator review queue with all model outputs and gate failure reasons visible

**Wave 4 Exit Criteria:**
- DamageMediator renders PRE/POST comparison for 100% of claims with existing inspection photos
- Vision model achieves ≥ 80% severity grade agreement with coordinator ground truth on held-out test set (acceptable minimum; production threshold set separately per calibration process above)
- Auto-settlement fires correctly on 10 synthetic test claims meeting all 5 conditions
- Auto-settlement does NOT fire on 10 synthetic test claims each missing exactly one condition (test one missing condition per test case)
- Cross-account fraud check blocks second account with same DL# from passing Condition 4
- ClaimsCoordinator review queue renders correctly in web-admin sidebar

---

### Wave 5 — Operational Agents (Weeks 35–44)

FleetOptimizer, PricingStrategist, OverdueTracker full escalation pipeline, Cmd+K command palette.

These agents serve internal staff only. They require the highest level of operator trust — earned through 6–9 months of proven customer-facing performance. An operator who has watched BookingConcierge handle 10,000 bookings correctly is far more willing to give FleetOptimizer block-creation authority than one seeing agents for the first time.

**Critical dependency for PricingStrategist — OTA data pipeline:**

PricingStrategist's demand signal comes from OTA booking pace: how many OTA-channel bookings arrived in the last 48h vs. the prior week. This requires the Expedia Rapid and Booking.com channel integrations to be live and accumulating data.

Those integrations are Phase 2 work in the core platform BACKLOG.md (OTA-001 through OTA-005). They must be complete and producing booking pace data for at least 8–10 weeks before PricingStrategist has anything useful to analyze.

**Action required:** OTA channel integrations must be completed by Week 25 at the latest (9 weeks before Wave 5 starts at Week 35). This dependency must be tracked in sprint planning. If OTA integrations slip, PricingStrategist scope in Wave 5 is reduced to utilization-only analysis with no channel signal — useful but less powerful.

**Wave 5 deliverables:**

- Admin sidebar intelligence column in web-admin layout (300px collapsible right panel, all admin pages)
- Cmd+K command palette (requires app shell refactor — global event handler, full-screen overlay, state management not scoped to a page)
- FleetOptimizer: demand forecasting (14-day utilization projection by class + location), rebalancing recommendations (surfaced as alert cards, executed only with manager approval), turnaround delay flags, EV charging sequence dispatch
- PricingStrategist: surge detection → DRAFT rate code, dead inventory alert → DRAFT promotional code, promo expiry warnings. DRAFT status only — activation requires REGIONAL_MANAGER role. No live rate changes without human approval.
- OverdueTracker full pipeline: T+90min soft alert (Wave 3) → T+2h extension offer → T+4h Branch Manager task → T+24h Regional Manager escalation → T+48h SYSTEM_ADMIN + FLAGGED_OVERDUE vehicle status
- Counter inline suggestion panel in web-counter: next checkout steps, one upsell suggestion per checkout, DNR/age alerts, thumbs-down feedback per card

---

## Part 6 — Open Questions Product Must Decide

These require a product/business owner decision before the relevant wave begins. They are not engineering questions.

| Question | Blocks | Options and Recommendation |
|---|---|---|
| **Where do human handoffs go?** | Wave 1 UX (handoff card destination) | Build live chat inbox in web-admin (3–4 weeks extra), integrate Intercom/Zendesk (faster, $300–800/mo), or email (simplest, least visibility). **Recommendation: email for Wave 1, revisit after Wave 2.** Don't block Wave 1 on building a live chat inbox. |
| **What is the goodwill refund limit?** | Wave 3 (`goodwill_under` parameter value) | Integrated plan recommends $75 per customer per 90 days cumulative. This value must be confirmed by the revenue team before Wave 3 build begins. |
| **WhatsApp: when?** | Channel expansion timeline | After Wave 2 (agent behavior validated on web). WhatsApp adds channel complexity; agent must be stable first. Template approval process takes 2–6 weeks — start the approval process in Wave 2, deploy in Wave 3. |
| **Voice input for mobile RentalAssistant?** | Wave 3 or 4 mobile UX | **Recommendation: defer to Wave 4.** Wave 3 proactive alerts are outbound (SMS/email) — they don't require voice. Voice is for reactive queries during active rental. Lower frequency than the UX doc implies; don't add STT complexity to Wave 3. |
| **Counter staff fleet alerts?** | Wave 5 counter-facing operational UX | Counter iPad doesn't have the admin sidebar column. Options: push notification, email digest, or a new alert surface in web-counter. Decide before Wave 5 planning. |
| **Chat-incentive promo code strategy?** | Wave 2 BookingConcierge launch | Revenue manager must configure chat-specific codes (e.g., `CHAT5OFF`) with usage limits, max discount %, and qualifying conditions **before** Wave 2 goes live. If not ready, BookingConcierge launches without promo code support (acceptable — add later). |
| **PricingStrategist scope if OTA slips?** | Wave 5 PricingStrategist | If OTA channel integrations aren't complete by Week 25, PricingStrategist in Wave 5 is scoped to utilization-only analysis with no booking pace channel signal. Decide at Week 20 planning. |

---

## Part 7 — KPI Framework with Measurement Methodology

Every metric requires a denominator definition and a measurement method. Metrics without these are unauditable.

### Customer-Facing Agent KPIs

| Metric | Baseline | Target | Denominator | Measurement |
|---|---|---|---|---|
| Intent classification accuracy | n/a | > 90% | All turns in the shadow mode reviewer sample | Reviewed turns rated Correct or Partially Correct ÷ total reviewed turns. Measured weekly on a random 10% sample of shadow sessions. |
| Booking completion rate (agent) | 62% (web form) | > 70% | Sessions where the customer interacted with a VehicleClassCard (i.e., reached the selection step) | Reservations created ÷ sessions that rendered at least one VehicleClassCard. Excludes sessions that ended before a card was shown. |
| First-contact resolution rate | ~34% (phone/email historical) | > 65% | Sessions where the customer asked a question that the agent had tools to address | Sessions where the customer's question was resolved without escalation ÷ addressable sessions. "I just want to complain" is not addressable — exclude from denominator. |
| Customer CSAT | 3.8/5 | > 4.2/5 | Post-interaction survey responses | Sampled at 15% of closed sessions (session where customer stopped typing for > 10 minutes after last agent response). Sent via email if email on file. |
| Escalation rate | n/a | < 20% | All sessions that reached at least 2 turns (excludes sessions abandoned after first message) | Sessions escalated to human ÷ 2+ turn sessions |
| Agent P95 response time | n/a | < 4s | All turns | Time from customer message sent to agent response fully rendered in UI. Measured at the client, not the server. |

### Operational Agent KPIs (Wave 5+)

| Metric | Baseline | Target | Denominator | Measurement |
|---|---|---|---|---|
| Fleet utilization % | 71% | > 75% | Available fleet-days (vehicle marked AVAILABLE) | ON_RENT days ÷ AVAILABLE days × 100. Measured weekly per location, aggregated to regional and fleet level. |
| Overdue resolution rate | 55% | > 70% | All overdue agreements that received a T+90min soft alert | Rentals returned within 4h of first contact ÷ all alerted rentals |
| Damage claim first-response | 3.2 days | < 4h | All claims where DamageMediator was triggered | Timestamp of `damage.claim_opened` event to timestamp of customer first receiving explanation (DamageMediator response delivered) |
| Auto-settled claims % | 0% | > 60% of eligible | Claims meeting all 5 auto-settlement conditions | Auto-settled ÷ claims that passed all 5 conditions. Track condition failure reasons separately to identify which conditions block the most claims. |
| ADR improvement (PricingStrategist) | Baseline at Wave 5 start | +5–8% | Locations with PricingStrategist active vs. control locations | A/B comparison: locations with PricingStrategist active vs. matched control locations without it. Run for 8+ weeks before declaring significance. |

---

## Part 8 — Shadow Mode Annotation Rubric

Shadow mode accuracy ("88% correct") is meaningless without a defined rubric. Two reviewers on the same session will rate it differently without annotation guidelines. This is the rubric.

### Rating scale

Every agent turn is rated on two dimensions independently:

**Factual correctness**
- `CORRECT` — All facts stated are accurate (prices, dates, policies, calculations). Agent took the right action or correctly declined to act.
- `INCORRECT` — Any material factual error, wrong calculation, fabricated data, or unauthorized action taken.
- `PARTIAL` — Mostly correct but missing a key piece of information or stating one fact imprecisely (e.g., giving the right cancellation fee but the wrong processing time).

**Action appropriateness**
- `APPROPRIATE` — Agent's action or non-action was right for the situation. (Asking for confirmation before cancelling is appropriate. Taking action without confirmation is not.)
- `INAPPROPRIATE` — Agent took an action it should not have, or escalated when it could have handled it, or failed to escalate when it should have.
- `NEUTRAL` — Information-only turn; no action to evaluate.

**Combined score:**
- `CORRECT + APPROPRIATE` → Pass
- `CORRECT + NEUTRAL` → Pass
- `PARTIAL + APPROPRIATE` → Partial (counts as 0.5 toward the accuracy numerator)
- `INCORRECT` (any action score) → Fail
- `CORRECT + INAPPROPRIATE` → Fail (right answer, wrong move)

### What counts as CORRECT

- If the agent says "Your cancellation fee is $47": correct if the fee calculation matches what `GET /reservations/{id}/cancellation-preview` returns. Incorrect if the amount is fabricated or wrong.
- If the agent says "I can't waive that fee — let me connect you with our team": correct if the customer asked for a fee waiver (which is outside agent authority). Incorrect if the customer asked something the agent could have handled.
- If the agent asks a clarifying question when the intent was ambiguous: correct (being cautious is right). Incorrect only if the intent was clear and the agent manufactured ambiguity.
- Tone is NOT a correctness criterion. An overly cautious or slightly formal response on an otherwise correct turn is still CORRECT.

### What counts as INCORRECT (even if no harm done)

- Agent states a price, date, policy, or calculation that doesn't match API data
- Agent takes a mutation action (PATCH, POST to cancel, POST to refund) without the customer confirming
- Agent references a feature or tool it doesn't have ("I've updated your payment method" — it cannot do this)
- Agent fails to escalate after 2 failed resolution attempts on the same topic in one session

### Inter-rater agreement requirement

Before shadow mode data is used to gate a wave launch, inter-rater agreement must be measured:
- Two reviewers each rate a random 20-turn sample independently
- Compute Cohen's kappa on the combined factual + action rating
- Kappa ≥ 0.75 (substantial agreement) required before ratings from a single reviewer are trusted
- If kappa < 0.75: hold a calibration session, review disagreements, update the rubric if needed, re-measure

### Shadow mode exit gate

Exit gate: ≥ 88% Pass rate (counting Partial as 0.5) on a minimum of 50 reviewed turns by a single reviewer, after inter-rater kappa ≥ 0.75 is established.

Separate tracking: zero `INCORRECT + INAPPROPRIATE` turns regardless of overall accuracy score. A single case of an agent taking an unauthorized action is a hard block on going live, even if overall accuracy is 95%.

---

## Part 9 — Counter Checkout: Honest Impact Analysis

v1.0 claimed: "Counter checkout time: 12 minutes → under 4 minutes (agent pre-fills everything)." This claim is not grounded.

**Where the 12 minutes actually goes (estimated from counter workflow analysis):**

| Step | Estimated time | AI can reduce? |
|---|---|---|
| Customer approaches, agent greets, finds reservation | 1–2 min | Yes — instant lookup eliminates manual search. Save ~1.5 min |
| Identity verification (license scan, name match, expiry check) | 1.5–2 min | Partial — barcode scan pre-fills fields. Save ~45 sec |
| CDW disclosure + acknowledgment (legally required) | 2–3 min | No — disclosure must be read and signed. No AI shortcut. |
| Customer reads RA before signing | 1–2 min | No — some customers read it. Some don't. |
| Extras review + upsell discussion | 1–2 min | Partial — AI suggestion shows correct extras. Agent still talks to customer. Save ~30 sec |
| Payment pre-auth + terminal roundtrip | 1–2 min | No — network latency + terminal interaction |
| Vehicle assignment, key handover, directions | 1.5–2 min | Partial — vehicle pre-assigned. Save ~30–45 sec |

**Realistic agent-assisted checkout time:** 9–10 minutes. Not 4. The 4-minute target requires eliminating steps that cannot be eliminated (CDW disclosure, signature, payment terminal).

**The honest target:** The counter agent handles more checkouts per hour, not each checkout in 4 minutes. With pre-fill and pre-assignment, one agent can handle 6–7 checkouts per hour instead of 4–5. That's a 30–40% throughput improvement — meaningful, but different from "checkout in 4 minutes."

This framing should replace the executive summary claim in `AI_AGENT_DESIGN.md` to avoid setting false expectations with operators.

---

## Part 10 — What the Mock Page `/agent-preview` Demonstrates vs. What It Doesn't

**Accurately represents:**
- Component designs: monogram, message anatomy, all card types, dispute tracker
- Interaction patterns: quick reply chips, progress bar with phrase, desktop split layout, mobile bottom sheet with drag-to-dismiss
- Design language: Ferrari dark canvas, Rosso Corsa red, zero border radius, Inter type

**Does not represent:**
- **Phase sequencing:** Mock shows damage flows (Wave 4) alongside booking (Wave 2). This is the full vision, not what launches first.
- **Payment flow:** Mock skips card collection entirely. The real booking flow embeds Stripe Elements inside the chat panel — a harder UX problem than the mock implies.
- **Streaming:** Mock reveals pre-scripted messages after a 1.6s fake delay. Real responses vary in length and will eventually stream.
- **Context persistence:** Mock resets on page refresh. Real system persists session across page navigations and browser sessions for 24h.
- **Multi-agent routing:** Mock has no orchestrator. Real system routes between agents mid-conversation.

The mock is the right artifact to communicate the vision to stakeholders. It is not an implementation specification.

---

## Part 11 — Immediate Next Actions (Before Wave 1 Begins)

In priority order:

1. **Product decision on human handoff destination** — gates UX for Wave 1 handoff card. Recommendation: email for Wave 1, revisit at Wave 2 planning.
2. **`AGENT_SERVICE` RBAC role added to the API** (Week 1) — gates all agent authentication.
3. **Orchestrator design reviewed and committed by engineering** (Week 1) — the routing decision tree and session schema in Part 3A are proposals; engineering must validate and commit before Foundation sprint ends.
4. **Analytics added to web-booking** (Week 1) — 2–4 weeks of data needed before mobile/desktop architectural commitment.
5. **Historical damage claim annotation begins** (Week 2) — annotate 4–6 hours/week starting now. Wave 4 is blocked on 500+ annotated pairs; 24 weeks of annotation time is available (Weeks 2–26), which is achievable but cannot slip.
6. **Remove fabricated statistics from `AI_AGENT_UX_DESIGN.md`** (this sprint) — replace with principles-stated-as-principles before any design decisions are made from the document.
7. **Add `--agent-*` CSS tokens to both app stylesheets** (Week 2) — must exist before any production component development begins.
8. **Confirm OTA channel integration timeline** with the core platform team — PricingStrategist in Wave 5 requires OTA data from at least Week 25. If OTA slips past Week 25, PricingStrategist Wave 5 scope must be reduced at planning.
9. **Revenue manager configures chat promo codes** — must be ready before Wave 2 launches. If not ready, Wave 2 launches without promo support (acceptable; add in Wave 2 tail).

---

*Document version: 2.0*  
*Supersedes: AI_AGENT_INTEGRATED_PLAN.md v1.0, Phase Roadmaps in AI_AGENT_DESIGN.md §6 and AI_AGENT_UX_DESIGN.md §5*  
*Status: Approved for Wave 1 planning*
