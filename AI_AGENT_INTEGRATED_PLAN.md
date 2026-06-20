# AI Agent Integrated Implementation Plan
## Critical Review · Debate · Consensus · Execution Roadmap

**Status:** Working document — supersedes Phase Roadmaps in both `AI_AGENT_DESIGN.md` and `AI_AGENT_UX_DESIGN.md`  
**Date:** 2026-06-20  
**Process:** Five reviewers, adversarial review of each original document, consensus integration

---

## Part 1 — Critical Review of AI_AGENT_DESIGN.md

### What the document does well

The agent taxonomy is correct. Nine specialized agents with strict RBAC separation between customer-facing and operational is the right architecture. The debate section (Issues A–G) is honest and the consensus positions are defensible. The priority matrix at the end — BookingConcierge + ReservationManager first, vision-based damage automation last — is sound.

The API surface analysis is grounded: the existing endpoints are largely sufficient, and the three identified gaps (agent auth token, trigger webhook, goodwill refund limit) are real and specific.

### Critical problems

---

**Problem 1: Phase 1 builds the most technically complex agent first.**

The document phases BookingConcierge (①) in weeks 1–6. BookingConcierge requires:
- Stripe.js payment tokenization on the client side
- PaymentIntent pre-authorization (async, 3-second Stripe roundtrip)
- Redis quote token management with 30-second TTL race guard
- WhatsApp webhook handler — a complete new channel integration
- Concurrent booking advisory lock integration (from the agent)
- Customer record create-or-find logic
- Promotional code validation against a table that may not exist yet

This is the highest-risk agent in the system. Putting it first means the entire Phase 1 delivery depends on getting the hardest component right simultaneously with building all the shared infrastructure (tool wrappers, session store, orchestrator). If BookingConcierge slips, Phase 1 delivers nothing.

**The ReservationManager (②) is a safer, equally valuable Phase 1 candidate.** It reads existing confirmed reservations, validates availability for new dates, and patches the return datetime. No payment tokenization. No race guard complexity. No new channel to build. It directly serves every customer who has already booked — which is the entire existing customer base.

**Verdict: flip the Phase 1 order. ReservationManager first. BookingConcierge second.**

---

**Problem 2: The Orchestrator is a paragraph, not a design.**

The document gives half a page to the Orchestrator, which is the hardest component in a multi-agent system. The listed routing logic is a sketch:

```
"book / find a car" → ① BookingConcierge
```

This doesn't answer:
- What model runs intent classification? Is it Claude, a smaller classifier, or rule-based?
- What is the context window limit per session, and what happens when conversation history exceeds it?
- How does context pass between agents when routing changes mid-session?
- What is the schema of the Redis session store?
- What happens to in-flight tool calls when the agent switches?
- If confidence < 0.65, what does the "human escalation" actually look like — which staff queue does it route to?

Without answers to these, Phase 1 cannot start. The Orchestrator is the first thing to design and the last thing to optimize. It cannot be a footnote.

---

**Problem 3: The 26-week timeline includes components that don't exist yet.**

Phase 3 (weeks 13–18) delivers "DamageMediator + ClaimsProcessor (partial)" and requires:
- Vision API trained on rental damage photos with >85% severity classification accuracy
- "1,000-claim ground truth dataset from the existing claims coordinator team" (mentioned in §10 conclusion)
- CDW adjudication rules engine
- PRE/POST inspection photo comparison infrastructure

These are not "technical work items." The 1,000-claim ground truth dataset alone requires months of coordinator time to annotate. Vision model fine-tuning for a specialized domain (automotive damage severity) has a realistic timeline of 3–6 months with proper evaluation. Packing this into 6 weeks (weeks 13–18) is not a plan — it's a wish.

**The 26-week plan as written cannot be executed by any team of realistic size without collapsing phases 3 and 4 into a multi-year effort.** The integrated plan below re-scopes this honestly.

---

**Problem 4: The $75 goodwill refund creates a systematic fraud vector.**

Issue F in the debate section addresses PCI compliance correctly. But the goodwill refund authority ($75 limit, no manager approval) has a fraud pattern the document doesn't address:

A customer who discovers the $75 threshold can:
1. Dispute a mileage charge: "$74 please" — issued automatically
2. End conversation, start new session (new conversation ID)
3. Dispute a fuel charge: "$74 please" — issued automatically
4. Repeat across different rental agreements

Each transaction is below threshold, each looks legitimate in isolation, but they aggregate. The mitigation in the risk register ("requires RA match + prior purchase history") doesn't explicitly address cross-session cumulative limits.

**Required addition:** goodwill refunds must be tracked per-customer, not per-session. Total goodwill refunds issued per customer in a rolling 90-day window must be capped (suggested: $75 total across all sessions, not per session). The `/payments/refund` goodwill endpoint must enforce this via a customer-level ledger, not just a per-call limit.

---

**Problem 5: Competitor rate scraping is legally and technically fragile.**

PricingStrategist (⑦) lists "External: competitor rate scraping (OTA APIs, Kayak, Google Flights)" as a tool. Scraping OTA platforms:
- Violates most OTA terms of service
- Is actively blocked by anti-scraping infrastructure (Kayak, Expedia employ aggressive bot detection)
- Returns stale data (cached pages, not real-time availability)
- Exposes the company to legal risk under CFAA or equivalent

The right path is either: (a) official rate parity API relationships (DHISCO, OAG, or direct OTA partner API programs), or (b) accepting that PricingStrategist's competitor signal comes from OTA-reported booking pace and ADR trends from existing channel data, not scraping.

**Replace "competitor rate scraping" with "OTA channel booking pace analysis" as the signal source.**

---

**Problem 6: No agent evaluation framework beyond synthetic scenarios.**

§6 mentions "500 synthetic booking scenarios to validate intent classification accuracy." This is necessary but insufficient:

- Synthetic scenarios are written by the same team that built the system — they mirror the builder's mental model of the problem, not the customer's. Synthetic evals catch regressions on known cases; they don't catch the edge cases that real customers bring.
- There's no mention of: shadow mode deployment (agent proposes, human approves, compare), human-preference annotation for edge cases, regression test suite structure, or how to handle cases where the model updates (model drift).
- "Intent classification accuracy > 94%" is a metric but the measurement methodology — how are the 500 scenarios generated, who annotates them as ground truth, how are they refreshed — is unspecified.

**Required addition:** A staged deployment model. Agents run in shadow mode first (generating responses that are reviewed by staff but not shown to customers) before going live. Shadow mode gives real distribution data and catches systematic failure modes before they affect customers.

---

## Part 2 — Critical Review of AI_AGENT_UX_DESIGN.md

### What the document does well

The surface taxonomy (chat panel / inline contextual / sidebar intelligence / command palette) is architecturally correct and matches the actual user contexts across the three apps. The motion system is detailed and implementable. The tone-of-voice section is excellent — the before/after error message examples alone are worth preserving. The accessibility specification is thorough and correct.

The decision not to use three-dot typing indicators (replacing with a progress bar + phrase) is a good call backed by real reasoning.

### Critical problems

---

**Problem A: Several cited statistics appear to be fabricated.**

The document makes specific empirical claims with citations:

- "Stanford HCI Research, 2024" — streaming text rated 4.1/5 vs 3.2/5
- "Gartner CX Survey 2024" — emotional language reduces task completion by 8%
- "Zendesk 2024" — context summary in handoff increases FCR by 34%
- "Intercom internal research, 2024" — confirmation cards increase CSAT by 1.2 points
- "Grab's booking assistant" — quick replies reduced time-to-booking by 38%

None of these appear to be real published studies with verifiable sources. They are the right order of magnitude and directionally plausible, which is what makes them dangerous — they look like research but they are estimates dressed as data. A document used to justify product decisions should be honest about the difference between "research shows" and "industry experience suggests."

**Required correction:** Remove all cited statistics. Replace with principles stated as principles: "We believe quick replies reduce input friction for structured tasks — this is consistent with how Apple Business Chat, Shopify Inbox, and similar systems are designed." Remove the fabricated percentages.

---

**Problem B: "73% mobile" is an assumption, not a measured fact.**

The document says "Our analytics (from the booking flow data) show 73% of sessions on web-booking arrive on mobile." The web-booking app is newly built and has not had production traffic. There is no analytics data yet. This is a projection, not a measurement.

This matters because mobile-first vs. desktop-first is the single biggest UX architectural decision — it determines layout, navigation patterns, touch target sizes, and animation physics. Making it on fabricated analytics is risky.

**Required action:** Before committing to mobile-first architecture, instrument the web-booking app (Plausible, PostHog, or similar) and let 2–4 weeks of real traffic inform the decision. In the interim, build responsively — do not hard-code mobile-first assumptions into the component architecture. The mock page already does this correctly (bottom sheet on mobile, right panel on desktop).

---

**Problem C: No live agent chat infrastructure exists for human handoff.**

The handoff card design (Part 2, Debate 7) is excellent conceptually. The problem: it assumes a human agent will receive the briefing card "in their staff portal before they type their first message." The existing staff portal (`web-admin`, `web-counter`) has no live chat functionality. There is no staff chat inbox. There is no queue management system. There is no staff availability signal.

The UX design for handoff is solving a UX problem that has no backend. The "connecting you with our team" experience currently delivers the customer to... nothing.

**Decision required (product, not UX):** Before the handoff UX can be implemented, the company must decide: (a) build a live chat inbox in web-admin, (b) integrate a third-party live chat tool (Intercom, Zendesk) as the handoff destination, or (c) accept that "human handoff" means an email notification to staff who respond via email. Each option has different UX implications. The UX design assumes option (a) but does not say so.

---

**Problem D: Counter "push-only" panel has no feedback channel.**

The counter surface design specifies that staff receive agent suggestions but cannot communicate back to the agent: "Staff acts through the form, not the chat — no text input." This creates a one-way pipe with no correction mechanism.

When the agent's suggestion is wrong ("Suggest GPS add-on" for a customer who explicitly declined GPS), the staff member has no way to tell the agent "stop suggesting this." The agent will continue generating suggestions based on its model of the checkout context, which is now wrong.

**Required addition:** The counter panel needs a minimal feedback affordance — a thumbs-down on individual suggestions that (a) suppresses that suggestion type for this checkout session and (b) logs the rejection for agent improvement. This doesn't need to be a full chat interface. One button per suggestion card is sufficient.

---

**Problem E: Design tokens are specified but not used by the actual implementation.**

The UX document defines 20+ `--agent-*` CSS custom properties. The mock page built at `/agent-preview` uses inline styles. The production agent UI, when built, needs to use the design tokens — not inline styles — so that theme changes and dark mode adjustments propagate uniformly.

This is not a flaw in the document; it's a gap between document and implementation. But it needs to be explicitly called out so the first engineer to build the real agent UI doesn't default to inline styles (as the mock does) and create a token drift problem.

**Required action:** Before building any production agent components, add the `--agent-*` token block to `apps/web-booking/app/globals.css` and `apps/web-admin/src/index.css`. Mock uses inline styles — that's appropriate for a demo. Production must not.

---

**Problem F: The Cmd+K palette is on the wrong surface for its audience.**

The command palette is specified for fleet managers and pricing managers ("power users"). But the only staff with fleet and pricing authority work in `web-admin`. The existing `web-admin` app is a page-router SPA. Adding a global `Cmd+K` listener requires:
- A global keyboard event handler registered at the app root
- A full-screen overlay that appears over whatever page is active
- State management that's not scoped to any one page
- Results that render from the same command palette regardless of which admin page you're on

None of this architecture exists in web-admin yet. It's a meaningful refactor to the app shell, not a component you can drop into a page. This is worth building, but it should not be in Phase 1 scope.

---

## Part 3 — Debate on Integration Conflicts

Four conflicts exist between the two documents where the integration requires explicit resolution.

---

### Conflict I: Phase sequencing mismatch

**Backend doc position (AI_AGENT_DESIGN.md §6):** Phase 1 = BookingConcierge + ReservationManager, deployed on WhatsApp.

**UX doc position (AI_AGENT_UX_DESIGN.md §5):** P0 includes 12 UI component builds across all agent surfaces.

**The conflict:** Building 12 production-quality UI components simultaneously with building the WhatsApp webhook, payment integration, and concurrent booking protection is not possible in 6 weeks for any realistic team. The two documents were written independently and their Phase 1 scope does not align.

**Resolution:** A shared Foundation sprint (2 weeks) before any agent-specific work begins, establishing shared infrastructure that both backend and UI work can build on. Phase 1 then delivers exactly one agent end-to-end, with its full UX. ReservationManager is selected as the first agent because it requires no payment integration, no new channel, and the read/write APIs already exist. This makes Phase 1 success achievable.

---

### Conflict II: Session context design (who owns it, what's in it)

**Backend doc:** "Build session context store (Redis, 24h TTL per customer session)" — one line.

**UX doc (Debate 4, Ryo):** "We need to build the context-passing protocol first, or users will experience the jarring 'I'm sorry, I don't have context' moment."

**The conflict:** The context store design affects both the agent (what context each agent instance receives) and the UX (whether the front-end needs to send conversation history with each request, or whether the session is server-side). If the session is purely server-side (Redis), the front-end just sends a session_id. If it's client-side (conversation history in each request), the front-end owns more state. These are architecturally different systems.

**Resolution:** Server-side session, client is stateless. Each customer session has a server-side context object containing: full message history (agent + user, last 50 turns), active reservation_id (if any), current agent type, customer_id (if authenticated), and a "hand-off summary" string that gets populated when routing between agents. The client sends only session_id + new user message. The orchestrator server reconstructs context from Redis. This means the client doesn't need to manage conversation history — it just renders what the server returns.

Session schema:

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

---

### Conflict III: The streaming vs. batch rendering question

**UX doc (§1.2):** "Stream at sentence boundaries, not token boundaries, for rental contexts (short responses)."

**Neither doc specifies:** whether the agent backend streams at all, what the front-end WebSocket protocol looks like, or whether the current FastAPI setup supports streaming responses.

**The conflict:** If we use streaming, the API must use Server-Sent Events (SSE) or WebSocket to push partial responses. If we use batch, the agent generates the full response and sends it once — simpler backend, but no streaming UX. The UX doc implies streaming is preferred but doesn't commit.

**Resolution:** Start with batch (simpler). The progress bar + phrase pattern already solves the perceived latency problem: the user sees activity during the agent's thinking period, then the full response arrives. Streaming is a Phase 2 optimization, not a Phase 1 requirement. Add `EventSource` streaming support after the batch system is proven. The front-end component should be built to accept both: if a streaming_id is present in the response, render progressively; if not, render the complete message.

---

### Conflict IV: Which surface ships in Phase 1?

**Backend doc:** "Deploy on WhatsApp channel (highest engagement for this customer segment)"

**UX doc:** Specifies web chat panel (right panel on desktop, bottom sheet on mobile) as the primary surface.

**The conflict:** WhatsApp and in-app web chat require completely different delivery infrastructure. WhatsApp requires a Meta Business API account, a webhook handler, message template approval, and a different message format (structured messages use different schema than web chat cards). You cannot build both simultaneously in Phase 1.

**Resolution:** Phase 1 deploys on the web-booking app only (in-app chat panel). This is the surface we can build and iterate on without external API dependencies. WhatsApp is Phase 2, after the agent's core behavior is validated and the system is stable. This is the correct priority: validate the agent logic first, then expand to additional channels. WhatsApp channel complexity (template approval, rate limiting, 24-hour conversation windows) should not be the first thing a new agent system has to handle.

---

## Part 4 — Integrated Consensus: What We Agree On

Before the implementation plan, the following are settled.

**On architecture:**
1. Server-side session store (Redis, schema defined above). Client is stateless.
2. Batch rendering first, streaming as Phase 2 optimization.
3. Single persona (RCM monogram) across all surfaces. No named sub-agents shown to customers.
4. Agent segregation maintained: customer agents cannot call fleet/pricing/admin tools.
5. Channel-agnostic agent logic. Channel (web, WhatsApp, SMS) is a rendering/delivery layer only.

**On UX:**
6. Four surfaces: chat panel (customer), inline contextual (counter), sidebar intelligence (admin dashboard), command palette (admin power user). Built in that priority order.
7. Mobile-first only after real traffic data confirms mobile majority. Until then: responsive.
8. No fabricated research citations in any production document. Principles stated as principles.
9. Confirmation cards required only for: cancellations, payment captures, damage claim state transitions.
10. Human handoff goes to email (existing workflow) until a live chat inbox is built. The handoff card still shows context summary; delivery method is email.

**On safety:**
11. Goodwill refunds capped per customer per 90-day rolling window, not per session.
12. BookingConcierge does not bypass the PaymentIntent pre-auth flow under any condition.
13. ClaimsProcessor vision-AI auto-settlement gated by: confidence > 0.88 AND CDW active AND no prior claims AND liability < $150. All five conditions required.
14. Shadow mode deployment before any agent goes live to customers.
15. Competitor rate signal: OTA booking pace from channel data, not scraping.

---

## Part 5 — Integrated Implementation Plan

### Foundation (Weeks 1–2) — No Agents Yet

This sprint is pre-agent infrastructure. Nothing visible to customers. Everything subsequent builds on it.

**Backend deliverables:**

| Item | What | Why First |
|---|---|---|
| `AGENT_SERVICE` role | New RBAC role, separate from COUNTER_AGENT. Scoped permissions per endpoint. | Every agent call hits the API as this role. Without it, agents either have no auth or too much auth. |
| Agent session store | Redis schema (see §Part 3, Conflict II). Session create/read/update. 24h TTL. | Without this, agents have no memory. The session contract defines what both orchestrator and UI need to agree on. |
| Orchestrator skeleton | FastAPI service: receives `{session_id, message}`, routes to agent, returns `{message, card, chips, session_id}`. Initially routes all messages to a no-op echo agent. | This is the API contract the UI will build against. Define it once, build everything else to it. |
| Tool wrapper interface | A typed `AgentTool` class that wraps each API endpoint. Maps tool name → endpoint → response schema. Allows tools to be tested independently. | Agents are defined by their tools. The wrapper forces a clean separation between "what can an agent do" and "how does it call the API." |
| `--agent-*` CSS tokens | Add agent design tokens to both `globals.css` (web-booking) and `index.css` (web-admin). | Establishes the design contract before component development begins. All agent UI uses tokens, not inline styles. |

**UX deliverables:**

| Item | What | Why First |
|---|---|---|
| Agent component library shell | AgentMonogram, MessageBubble (agent + user), ProgressBar, QuickReplyChip, ChatInput, ChatPanel (layout only). No real data. | These are the primitives everything else composes from. Build once, reuse across all 9 agents. |
| Design token audit | Verify all `--agent-*` tokens render correctly in both apps. Fix any contrast failures (placeholder text issue identified in §Part 2, Problem A). | Accessibility baseline before first user ever sees the UI. |
| Analytics instrumentation | Add PostHog or Plausible to web-booking to capture session type (mobile vs. desktop), page time, device. | Produces the real mobile/desktop split data to replace the assumed "73% mobile" figure. 2-week collection before making final mobile/desktop architectural call. |

**Foundation Success Gate (end of Week 2):**
- Orchestrator returns a stubbed response for any message
- Chat panel renders the response in the correct UI
- Session is persisted in Redis and retrieved correctly across page reloads
- All agent CSS tokens are in place
- Analytics data is flowing

No agents. No real routing. Just the pipe and the primitive components, proven to work together.

---

### Wave 1 — ReservationManager + Web Chat (Weeks 3–8)

**Why ReservationManager first:**
- All read APIs exist today. PATCH `/reservations/{id}` and `POST /{id}/cancel` exist today.
- No payment integration required (that's BookingConcierge complexity).
- Serves 100% of existing customers — anyone who has already booked.
- Handles the most common post-booking requests: "change my dates," "what's my cancellation fee," "cancel my booking."
- Lowest risk of a mistake causing financial harm (the worst case is a date gets set wrong — fixable).
- Validates the entire agent pipeline (session store, orchestrator, tool wrappers, UI) on a real use case before adding payment complexity.

**Backend deliverables:**
- ReservationManager agent implementation: tools for `GET /reservations/confirmation/{number}`, `PATCH /reservations/{id}`, `GET /reservations/{id}/cancellation-preview`, `POST /reservations/{id}/cancel`, `POST /pricing/quote`
- Orchestrator routing: any message containing "booking," "reservation," "cancel," "change," "modify" → ReservationManager
- Context: on successful lookup of a reservation, write `reservation_id` to session context
- Goodwill refund: NOT in this wave (add only with ReturnAdvisor). ReservationManager does not issue refunds.
- Shadow mode: deploy to 5% of logged-in web-booking users. Agent generates responses shown only to a reviewer dashboard. No customer sees agent responses yet.

**UX deliverables:**
- ReservationCard component (shows confirmed booking details)
- CancellationPreviewCard (shows fee tiers before confirming cancel)
- DateModificationCard (shows new dates + delta price before confirming)
- ConfirmationCard (green top border — used after any successful action)
- Desktop right panel wired to live orchestrator API
- Mobile bottom sheet wired to live orchestrator API
- "Ask RCM" entry point on: search results page, booking confirmation page, account page

**Wave 1 Exit Criteria:**
- ReservationManager handles the following without human: look up by confirmation number, explain cancellation fee, execute cancellation (with confirmation card), modify dates (with re-quote), add/remove extras
- Shadow mode: agent responses rated "correct and complete" by reviewer on >88% of sampled sessions
- Zero cases of agent taking action it wasn't authorized to take
- Chat panel WCAG 2.2 AA audit passed (use `axe-core` in CI)

**Wave 1 does NOT include:** booking creation, payment, damage, proactive SMS/WhatsApp.

---

### Wave 2 — BookingConcierge + Payment Integration (Weeks 9–16)

**Why later:**
Payment integration (Stripe tokenization, PaymentIntent pre-auth, 30-second Redis token guard) is the highest-risk component. Building it after Wave 1 means the orchestrator, session store, tool wrappers, and UI components are already proven. You're adding payment to a working system, not building a working system with payment.

**Backend deliverables:**
- BookingConcierge agent: tools for `GET /fleet/search`, `POST /pricing/quote`, `GET /pricing/extras`, `POST /reservations/guest`, `POST /customers`
- Orchestrator routing expansion: "book / find a car / rent / price" → BookingConcierge
- Stripe.js token capture: the UI collects card details and tokenizes client-side. The agent receives only a `payment_method_id` to pass to the reservation endpoint. The agent never sees card data.
- Promo code application: BookingConcierge can apply codes from `promotion_codes` where `is_active = true`. Cannot create codes. Uses `CHAT5OFF` (or equivalent) code category for chat-specific incentives.
- Rate quote TTL: agent must check `expires_at` on the quote token before submitting reservation. If expired, re-quote.

**UX deliverables:**
- VehicleClassCard (with live availability count, low-stock indicator)
- QuoteSummaryCard (with 30-second countdown bar)
- GuestDetailsForm — inline within chat panel (name, email, phone — not a page navigation)
- PaymentCapture — Stripe Elements embedded in chat panel (card input inside the chat flow)
- Upgrade suggestion UI (if economy is last 1 available and compact has 3+, show comparison chip)

**Key UX challenge — payment in a chat panel:**
Taking card details inside a chat panel is uncommon but not unprecedented (Apple Pay, Klarna, Stripe Payment Element all embed in non-standard contexts). The implementation must:
- Never show card fields until the customer explicitly intends to pay (not on every message)
- Use Stripe Elements for PCI-safe card collection (iframe, not custom input)
- Show a clear "your card is not charged until you confirm" message
- After tokenization, the card fields disappear. Only `•••• •••• •••• 4521` and card brand are shown.

**Wave 2 Exit Criteria:**
- BookingConcierge completes a full booking flow: search → select → quote → card entry → confirm → `booking.confirmed` email triggers
- No double-bookings produced in load test (50 concurrent sessions, same class, same dates, single location)
- Payment errors (decline, insufficient funds) handled gracefully — agent response, not 500 error
- Shadow mode → live traffic: deploy to 100% of web-booking users as the right-panel entry point
- Booking completion rate via agent >70% for sessions where the customer engaged with a vehicle card

---

### Wave 3 — ReturnAdvisor + Proactive RentalAssistant (Weeks 17–22)

**ReturnAdvisor:**
- Tools: `GET /checkout/agreements/{ra_id}`, `GET /payments/reservation/{id}`, `GET /damage/inspections/{ra_id}`, `POST /payments/refund` (goodwill, $75 per-customer-90-day limit enforced at DB level)
- Handles: receipt line-item explanation, mileage overage calculation, fuel charge dispute triage, goodwill gesture for clear operator errors
- The `goodwill_under` parameter on the refund endpoint is built in this wave, with a `customer_goodwill_ledger` table that tracks cumulative goodwill refunds per customer_id per 90-day window

**Proactive RentalAssistant (push-only, no UI chat surface):**
- Triggered by Redis events: `booking.reminder.24h`, `ev.low_soc_alert`, `rental.overdue_soft`
- Outbound SMS (Twilio) and Email (SendGrid) — these already exist via the notification domain
- The agent composes the message based on rental state (reads `GET /checkout/agreements/{ra_id}`) and dispatches via existing notification infrastructure
- No in-app chat needed. The customer's chat session can optionally appear if they reply via the web app.

**Wave 3 does NOT include:** OverdueTracker escalation pipeline (that requires manager approval workflow — Wave 5), EV charger network API (third-party dependency, scoped separately), vehicle swap automation (requires fleet state validation — Wave 5).

**Wave 3 Exit Criteria:**
- ReturnAdvisor resolves receipt dispute without human in >55% of cases
- Goodwill refund fraud check: zero instances of per-customer limit exceeded
- 24h pre-rental SMS/email sends correctly for 100% of upcoming reservations with phone/email on file
- EV low-SOC alert fires correctly when SOC drops below threshold (tested with synthetic telematics event)

---

### Wave 4 — DamageMediator + ClaimsProcessor (Weeks 23–34)

**Prerequisites that must exist before Wave 4 begins:**
1. **Ground truth dataset:** 500+ annotated damage claim pairs (PRE/POST photos + inspector severity grade + final settlement amount). This annotation work must begin in Wave 1, not Wave 4. Assign claims coordinator time to annotate historical claims starting from Week 3.
2. **Inspection photo infrastructure:** All PRE and POST inspection photos must be stored as structured data in the `damage` domain with zone metadata. Verify this is complete before starting.
3. **CDW adjudication rules engine:** Built and unit-tested independently of the AI agent. The rules (CDW active?, void condition present?, deductible amount) are deterministic — they should not be inside the LLM. The LLM explains the rules; the engine calculates the numbers.

**DamageMediator (customer-facing):**
- Tools: `GET /damage/claims/{id}`, `GET /damage/inspections/{ra_id}/comparison`, `GET /damage/claims/{id}/lou`, `POST /damage/claims/{id}/status`
- Shows PRE/POST photo comparison in the chat panel (DamageComparisonCard)
- Explains CDW coverage, deductible, LOU formula
- Advances claim to CUSTOMER_ACKNOWLEDGED state after explanation
- Does NOT auto-settle. Escalates all disputed claims to human ClaimsCoordinator.

**ClaimsProcessor (internal, staff-facing only):**
- Runs automatically when a claim is created
- Vision model call: classify damage zone, type, severity (GRADE_1–5)
- Auto-settlement gate: ALL five conditions (§Part 1, Problem 3 revised consensus) must be true
- Below threshold: auto-settle, capture from pre-auth, send settlement email
- Above threshold: populate a ClaimsCoordinator review queue in web-admin

**The vision model decision:**
Use Claude claude-sonnet-4-6 Vision (or the latest multimodal model available at build time) for initial severity classification. This avoids building a custom training pipeline and significantly compresses the timeline. Confidence thresholds are calibrated against the annotated dataset (minimum 500 claims). A custom fine-tuned model can be evaluated in parallel; adopt it only if it outperforms the prompted model on the held-out test set.

**Wave 4 Exit Criteria:**
- DamageMediator correctly shows PRE/POST comparison for 100% of claims where inspection photos exist
- Vision model severity classification accuracy >80% vs. coordinator ground truth (lower than the original 85% target — 85% may not be achievable without custom training; 80% with human-in-the-loop on >$150 claims is sufficient)
- Auto-settlement fires correctly on test claims meeting all 5 conditions
- No auto-settlement fires on test claims with any one condition missing
- ClaimsCoordinator review queue surfaces correctly in web-admin sidebar

---

### Wave 5 — Operational Agents (Weeks 35–44)

FleetOptimizer, PricingStrategist, OverdueTracker, full ClaimsProcessor (high-value claims).

These agents serve internal staff, not customers. They require:
- Demand forecasting model (historical reservation data is their training input — this data accumulates with each prior wave)
- OTA booking pace channel data (requires OTA channel integrations to be built first)
- Admin sidebar intelligence column built into web-admin layout
- Cmd+K command palette added to web-admin app shell (a standalone front-end sprint)
- OverdueTracker escalation pipeline with manager approval workflow
- PricingStrategist DRAFT rate code workflow with REGIONAL_MANAGER approval gate

**Why last:** These agents affect fleet operations and revenue strategy. They require the highest level of operator trust. That trust is earned through 6–9 months of proven customer-facing agent performance. An operator who has watched BookingConcierge handle 10,000 bookings correctly is much more willing to give FleetOptimizer the authority to create vehicle blocks than one who is being asked to trust agents on day one.

---

## Part 6 — The Open Questions Product Must Decide

These are not engineering or UX questions. They require a product/business owner decision before the relevant wave begins.

| Question | Blocks | Options |
|---|---|---|
| **Where do human handoffs go?** Live chat inbox (build in web-admin), integrate Intercom/Zendesk, or email? | Wave 1 UX for handoff card | Build inbox (3–4 weeks), use Intercom (faster, costs money), or email handoff (simplest, no queue visibility) |
| **What is the goodwill refund limit?** $75 per session was in the original doc; integrated plan changes to per-customer-90-day. What number? | Wave 3 build | Recommendation: $75 cumulative per customer per 90 days |
| **WhatsApp channel: when?** Wave 1 is web-only. WhatsApp is an independent channel build. Should it follow Wave 1 (Wave 2 timeline) or Wave 3? | Channel expansion | Recommendation: after Wave 2 (after agent behavior is validated on web). WhatsApp adds channel complexity, not agent complexity — but it needs a proven agent first. |
| **Voice input: is it required for Wave 3 or Wave 5?** The UX doc says voice input is required for the RentalAssistant on mobile (customer driving). This requires STT integration (Web Speech API or Whisper). | Wave 3 mobile UX | Recommendation: defer voice input to Wave 4. SMS-based proactive alerts don't require voice. Voice is for reactive customer queries during active rental — lower frequency than the doc implies. |
| **How are operational agents' recommendations surfaced when staff are on the counter?** The counter iPad doesn't have the sidebar intelligence column. Urgent fleet alerts need to reach counter staff somehow. | Wave 5 operational agent UX | Options: push notification (iOS/Android), email digest, or a new alert surface in web-counter. |
| **What is the CHAT5OFF equivalent promo code strategy?** Who owns creation, what are the discount limits, how many uses are allowed? | Wave 2 BookingConcierge | Revenue manager must configure before Wave 2 launch, not after. |

---

## Part 7 — Revised Timeline Summary

| Period | Weeks | Deliverable | Customer-visible? |
|---|---|---|---|
| Foundation | 1–2 | Infrastructure, session store, component library shell, analytics | No |
| Wave 1 | 3–8 | ReservationManager, web chat panel, shadow mode → live | Week 7 (shadow week 3–6, live week 7–8) |
| Wave 2 | 9–16 | BookingConcierge, payment in chat, promo codes | Week 13 (shadow weeks 9–12, live weeks 13–16) |
| Wave 3 | 17–22 | ReturnAdvisor, proactive SMS/email push | Week 19 (ReturnAdvisor week 19, push week 17) |
| Wave 4 | 23–34 | DamageMediator, ClaimsProcessor (requires annotated dataset from Wave 1) | Week 27 (DamageMediator customer-facing) |
| Wave 5 | 35–44 | FleetOptimizer, PricingStrategist, OverdueTracker, Cmd+K | Week 40 (staff-facing only) |

**Total: 44 weeks.** This is 18 weeks longer than the original 26-week estimate. The additional time accounts for: shadow mode deployment (4 weeks across 3 waves), realistic damage annotation timeline, payment integration complexity, and the live-agent-handoff architecture decision that was missing from the original plan.

The original 26-week figure is achievable only if the team is large (8+ engineers), annotation is parallel-tracked from week 1, and every wave runs without significant re-work. For a team of 3–4 engineers, 44 weeks is the honest estimate.

---

## Part 8 — What the Mock Page `/agent-preview` Accurately Demonstrates vs. What It Doesn't

The existing mock page is correct for the following:

- Component designs: monogram, message anatomy, vehicle cards, quote card, confirmation card, fuel comparison card, dispute tracking card are all accurate representations of the target UX
- Interaction patterns: quick reply chips, progress bar with phrase, desktop split layout, mobile bottom sheet — all correct
- Design language: matches the web-booking brand tokens (Ferrari dark canvas, Rosso Corsa red, zero border radius, Inter type)

The mock page should not be interpreted as accurate for:

- **Phase sequencing:** The mock shows damage comparison and dispute flows (Wave 4 features) alongside booking flows (Wave 2). This is the full vision, not Wave 1.
- **Booking flow payment step:** The mock skips card collection entirely. The real booking flow must include Stripe Elements for card capture inside the chat panel — a harder UX problem than the mock suggests.
- **Streaming:** The mock uses pre-scripted messages revealed all-at-once after a 1.6s fake delay. Real responses will vary in length and should eventually stream.
- **Context persistence:** The mock resets on page refresh. The real system persists session state in Redis across page navigations and browser sessions (up to 24h).

The mock is the right artifact to communicate the vision to stakeholders. It is not an implementation specification.

---

## Part 9 — Immediate Next Actions (Before Wave 1 Begins)

In priority order:

1. **Product decision on human handoff destination** (this week) — gates UX for Wave 1 shadow mode
2. **`AGENT_SERVICE` RBAC role added to the API** (Week 1) — gates everything
3. **Agent session schema agreed and documented** (Week 1) — the schema in §Part 3, Conflict II is a proposal; engineering must validate and commit to it
4. **Analytics added to web-booking** (Week 1) — 2 weeks of real data needed to validate mobile/desktop split before Wave 1 component decisions
5. **Historical damage claim annotation begins** (Week 2) — takes 8–12 weeks to produce 500 annotated pairs; must start immediately or Wave 4 will be blocked on data regardless of agent readiness
6. **Remove fabricated statistics from AI_AGENT_UX_DESIGN.md** (this sprint) — replace with principles-stated-as-principles
7. **Add `--agent-*` tokens to both app CSS files** (Week 2) — before any component development begins

---

*Integrated by: cross-team critical review*  
*Supersedes: Phase Roadmaps in AI_AGENT_DESIGN.md §6 and AI_AGENT_UX_DESIGN.md §5*  
*Status: Approved for Wave 1 planning*
