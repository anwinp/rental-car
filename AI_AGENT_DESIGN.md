# AI Agent System Design
## Rental Car Manager — Customer & Operational Automation

**Document version:** 1.0  
**Date:** 2026-06-20  
**Scope:** End-customer self-service, counter operations, fleet management, damage claims

---

## 1. Executive Summary

This document defines a team of AI agents that automate the rental car customer lifecycle — from conversational search through damage dispute resolution — using the existing FastAPI/PostgreSQL platform as the operational backbone. 

The core premise: **most routine interactions across the customer journey can be fully automated; the remainder can be AI-assisted with a human confirming the last step.** The agents do not replace staff — they absorb the high-volume, low-judgement work so staff focus on exceptions, high-touch upsells, and complex disputes.

**Key outcomes targeted:**
- 60–70% reduction in inbound customer service contacts (handled by agent without human)
- Counter checkout time: 12 minutes → under 4 minutes (agent pre-fills everything)
- Damage claim first-response time: 3 days → under 2 hours (automated triage + template)
- Fleet utilization improvement: +4–6 percentage points (agent-driven rebalancing)
- Overdue rental recovery rate: +18% (proactive AI outreach vs. manual calling)

---

## 2. System Context

The platform exposes 17 business domains across a FastAPI backend with clear service/repository boundaries. Every customer touchpoint maps to a concrete API endpoint:

| Journey Phase | API Domain | Key Endpoints |
|---|---|---|
| Search & Quote | `pricing`, `fleet` | `POST /pricing/quote`, `GET /fleet/search` |
| Booking | `reservations` | `POST /reservations/guest` |
| Modify / Cancel | `reservations` | `PATCH /reservations/{id}`, `POST /{id}/cancel` |
| Pre-Arrival | `notifications`, `reservations` | Event triggers + `GET /reservations/{id}` |
| Counter Checkout | `checkout` | `POST /checkout/checkout` |
| Active Rental | `fleet`, telematics | WebSocket `/fleet/ws`, telematics stream |
| Extension / Swap | `checkout`, `reservations` | `POST /checkout/swap`, `PATCH /reservations/{id}` |
| Return & Check-In | `checkout` | `POST /checkout/check-in` |
| Damage Assessment | `damage` | `POST /damage/inspections`, `POST /damage/claims` |
| Payment Settlement | `payments` | `POST /payments/capture`, `POST /payments/refund` |
| Dispute Resolution | `damage`, `payments` | `/damage/claims/{id}/status`, `/payments/refund` |

The platform already fires structured notification events (`booking.confirmed`, `return.receipt`, `damage.claim_opened`, etc.) via Redis streams and supports multi-channel delivery (Email/SMS/WhatsApp via SendGrid + Twilio). Agents can consume these events as triggers.

---

## 3. The Agent Team

Nine specialized agents, one orchestrator. Agents call the existing REST API; they do not have direct DB access. Every action that creates or mutates data goes through the established service layer (which enforces RBAC, advisory locks, exclusion constraints, and audit trails).

```
┌─────────────────────────────────────────────────────────────┐
│                    MASTER ORCHESTRATOR                       │
│   (intent classification + context routing + escalation)    │
└──────────┬──────────────────────────────────────────────────┘
           │
   ┌───────┴────────────────────────────────────────────┐
   │  CUSTOMER-FACING AGENTS                            │
   │                                                    │
   │  ① BookingConcierge                                │
   │  ② ReservationManager                              │
   │  ③ RentalAssistant (active rental)                 │
   │  ④ ReturnAdvisor                                   │
   │  ⑤ DamageMediator                                  │
   └───────┬────────────────────────────────────────────┘
           │
   ┌───────┴────────────────────────────────────────────┐
   │  OPERATIONAL AGENTS (internal / staff-facing)      │
   │                                                    │
   │  ⑥ FleetOptimizer                                  │
   │  ⑦ PricingStrategist                               │
   │  ⑧ OverdueTracker                                  │
   │  ⑨ ClaimsProcessor                                 │
   └────────────────────────────────────────────────────┘
```

### Agent Profiles

---

### ① BookingConcierge
**Role:** Handles all pre-booking interactions — from conversational search to confirmed reservation.

**Tools available:**
- `GET /fleet/search?pickup_location_id&pickup_date&dropoff_date` — availability + pricing
- `POST /pricing/quote` — generate rate quote token
- `GET /pricing/extras` — fetch add-on catalog
- `POST /reservations/guest` — create reservation
- `POST /customers` — create/find guest customer profile
- Knowledge base: cancellation policies, CDW coverage terms, cross-border rules, age surcharge schedule

**Decision authority:**
- Can apply a promotional promo_code if it matches an active rate code
- Can suggest alternative dates (±3 days) if requested class unavailable
- Can suggest class upgrade if price delta < 20% and availability is low
- Cannot override pricing, waive fees, or bypass payment

**Conversation capability:**
```
Customer: "I need a midsize car in LA from July 4 to 7, budget around $150 total"
Agent:  → Calls GET /fleet/search for LAX01, July 4–7
        → Returns Economy ($108 total) and Intermediate ($126 total)
        → "I found two options within your budget: Economy at $36/day ($108 total)
           or step up to Intermediate for $42/day ($126 total). Both include A/C,
           Bluetooth, and backup camera. Economy is the last one at this price —
           shall I hold it for you?"
```

**Fully automated (no human needed):**
- Full booking flow for any class where `available_count > 0`
- Quote generation and token management
- Customer record creation (new guest) or lookup (returning customer)
- Confirmation email dispatch via `booking.confirmed` event
- Promo code validation and application

**Requires escalation:**
- Walk-up rate negotiation (no valid rate code for the dates)
- Corporate CDP code not in system
- Customer is flagged on DNR list

---

### ② ReservationManager
**Role:** Handles modification, cancellation, and pre-arrival queries after booking is confirmed.

**Tools available:**
- `GET /reservations/confirmation/{number}` — load reservation by confirmation #
- `PATCH /reservations/{id}` — modify dates, class, location
- `GET /reservations/{id}/cancellation-preview` — fee preview
- `POST /reservations/{id}/cancel` — execute cancellation
- `POST /pricing/quote` — re-quote for modified parameters
- `GET /fleet/search` — validate availability for new dates
- Notification trigger: `booking.modified`, `booking.cancelled`

**Decision authority:**
- Full modification authority for date changes where availability exists
- Full cancellation authority (policy-bound refund calculation is automatic)
- Can proactively suggest alternative dates if new dates unavailable
- Cannot waive cancellation fees (escalates to BranchManager role)

**Automation coverage:**

| Request | Automated? | Notes |
|---|---|---|
| "Move my pickup to Friday" | ✅ Full | Re-quotes, checks availability, patches reservation |
| "Add GPS to my rental" | ✅ Full | Patches extras_snapshot via modify endpoint |
| "What's my cancellation fee?" | ✅ Full | Calls cancellation-preview, explains tiers |
| "Cancel my reservation" | ✅ Full (with confirmation step) | Calls cancel after customer confirms |
| "Waive the cancellation fee, I had a death in the family" | ⬆️ Escalate | Requires BRANCH_MANAGER role to waive_fee |
| "Upgrade me to a premium car at no extra charge" | ⬆️ Escalate | Complimentary upgrade = manager discretion |

---

### ③ RentalAssistant
**Role:** Supports customers during the active rental period. Triggered by customer inbound contact OR proactive events (low SOC, return reminder, overdue alert).

**Tools available:**
- `GET /checkout/agreements/{ra_id}` — active rental status
- `PATCH /reservations/{id}` — extend return date
- `POST /checkout/swap` — trigger mid-rental vehicle swap (emergency)
- Telematics WebSocket — vehicle location, SOC, engine faults (if tenant has telematics configured)
- `GET /fleet/search` — find available vehicle for extension or swap
- EV charging network APIs — nearest charger, availability

**Proactive triggers (Redis event stream):**
- `ev.low_soc_alert` → SMS: "Your battery is at 18%. The nearest fast charger is 2.3 miles at [address]."
- `booking.reminder.24h` → Email/SMS: rental details + location map + what to bring
- Rental 90 minutes past scheduled return → "Are you on your way back? Let us know if you need more time."

**Decision authority:**
- Can extend return date up to 48 hours if same vehicle class has no conflicting block
- Can initiate a vehicle swap if customer reports breakdown (triggers roadside assist referral)
- Cannot authorize toll pass after checkout (must have been added at booking or checkout)
- Cannot waive extension charges

**Scenarios handled autonomously:**
```
Customer: "My car is making a strange noise, what should I do?"
Agent:  → Checks telematics for engine fault codes on vehicle
        → "We're showing a minor engine alert on your vehicle (code P0128 — 
           coolant thermostat). This isn't dangerous to drive short distances,
           but we recommend visiting the nearest service station. Alternatively,
           I can arrange a vehicle swap — there's a Compact available at our 
           West Hollywood location 4 miles from you. Want me to set that up?"
```

---

### ④ ReturnAdvisor
**Role:** Handles post-return queries — receipt explanation, charge disputes, loyalty point reconciliation.

**Tools available:**
- `GET /checkout/agreements/{ra_id}` — final RA with all charges
- `GET /payments/reservation/{reservation_id}` — full payment history
- `GET /damage/inspections/{ra_id}` — inspection photos and zone data
- `POST /payments/refund` — issue refund (within agent's authority limit)
- Knowledge base: fuel policy, mileage tiers, toll charge timeline, tax breakdown

**Decision authority:**
- Can authorize refunds up to $75 without manager approval (goodwill gesture)
- Can explain every line item on the invoice using structured data
- Can initiate a formal dispute ticket for damage charges
- Cannot waive damage charges above deductible without ClaimsProcessor involvement

**Automation examples:**

```
Customer: "I was charged a $47 fuel fee but I returned it full."
Agent:  → Fetches RA: fuel_level_in_pct = 75%, contracted level = 100%
        → "According to our records, your fuel level on return was 75% 
           (7/8 tank). Our policy charges $5 per 12.5% below the contracted 
           level, which results in a $20 charge for 2 steps. However, I see 
           you were charged $47 — that appears to be an error. I've initiated 
           a $27 refund to your card. It should appear in 3–5 business days."
```

```
Customer: "Why was I charged for mileage? I barely drove."
Agent:  → Fetches RA: odometer_out=45,210, odometer_in=45,897 → 687 miles
        → Rate plan: 100 free miles/day × 3 days = 300 free miles
        → Overage: 387 miles × $0.25 = $96.75
        → "You drove 687 miles over 3 days. Your rate included 300 free miles 
           (100/day), so the remaining 387 miles were charged at $0.25/mile, 
           totaling $96.75. This is correct per your rental agreement."
```

---

### ⑤ DamageMediator
**Role:** Customer-facing agent for damage disputes. Explains severity grading, CDW coverage, loss-of-use charges, and manages the claim acknowledgement process.

**Tools available:**
- `GET /damage/claims/{id}` — full claim with zone photos, severity, estimate
- `GET /damage/inspections/{ra_id}/comparison` — PRE vs POST zone diff
- `GET /damage/claims/{id}/lou` — LOU calculation breakdown
- `POST /damage/claims/{id}/status` — advance claim to CUSTOMER_ACKNOWLEDGED
- Knowledge base: CDW terms, deductible schedule, severity grade definitions, third-party insurer contacts

**Decision authority:**
- Can mark claim CUSTOMER_ACKNOWLEDGED after explaining terms
- Can explain LOU formula and daily rate basis
- Cannot reduce damage estimate (requires CLAIMS_COORDINATOR)
- Cannot void a claim (escalates to ClaimsCoordinator)
- Cannot determine CDW voiding (DUI, unauthorized driver — escalates)

**Automation example:**
```
Customer: "I got a damage claim for $840 — I didn't damage the car!"
Agent:  → Fetches comparison: Zone 7 (Right Rear Door) — PRE: ACCEPTABLE, POST: MODERATE
        → Photos: 3 images showing 15cm scrape + dent
        → CDW: YES, deductible: $500
        → "Our post-rental inspection found damage on the right rear door that 
           wasn't present when you picked up the car. I'm sharing the comparison 
           photos here. The repair estimate is $840. Since you had CDW coverage, 
           your liability is capped at the $500 deductible. If you believe this 
           damage wasn't caused by you, you can formally dispute the claim and 
           we'll review with our claims coordinator. What would you like to do?"
```

---

### ⑥ FleetOptimizer (Internal / Staff-Facing)
**Role:** Continuous fleet intelligence — availability forecasting, rebalancing recommendations, turnaround optimization.

**Tools available:**
- `GET /fleet/vehicles` — full fleet with status by location
- `GET /fleet/availability` — class-level availability by date
- `GET /checkout/active-rentals` — all active agreements with return times
- `POST /fleet/vehicles/{id}/status` — transition vehicle status
- `POST /fleet/blocks` — create maintenance/hold blocks
- Historical reservation data — demand patterns by class/location/date

**Capabilities:**
- **Demand forecasting:** "This Friday, LAX will be 94% utilized on Economy. You have 3 Economy cars at Burbank with no reservations. Recommend transfer by Thursday noon."
- **Turnaround optimization:** "12 vehicles are in READY_FOR_INSPECTION status > 90 minutes. Average turnaround is 2h18m vs target of 45m. Flag to Branch Manager."
- **Cleaning/maintenance scheduling:** Predict optimal maintenance windows based on reservation gaps; create vehicle blocks autonomously for windows > 4 hours with no conflict.
- **EV charging dispatch:** "3 EVs returning tonight with <30% SOC. Dispatch charging sequence: Unit 47 → Station A (6.6kW), Unit 52 → Station B (50kW DC fast)."

**Decision authority:**
- Can create vehicle blocks for maintenance/cleaning autonomously
- Can flag rebalancing opportunities (executes only if manager approves in dashboard)
- Cannot physically move vehicles (recommendation only)
- Cannot take vehicles out of AVAILABLE without manager confirmation

---

### ⑦ PricingStrategist (Internal / Staff-Facing)
**Role:** Yield management — analyzes demand signals and recommends rate adjustments.

**Tools available:**
- `GET /pricing/rate-codes` — all active rates
- `GET /fleet/availability` — real-time utilization
- External: competitor rate scraping (OTA APIs, Kayak, Google Flights)
- Historical ADR/RevPACD data from `dashboard` domain

**Capabilities:**
- **Weekend surge detection:** "This Saturday at LAX: only 2 Economy cars left, ADR $36. Kayak showing Hertz at $58/night. Recommend bumping to $52 (+44%)."
- **Dead inventory alerts:** "Luxury class at SFO has 8 cars with 0 bookings for the next 14 days. Recommend PROMOTIONAL rate: 30% off to stimulate demand."
- **Promo code expiry warnings:** "SUMMER25 promo code expires July 31 — still 847 searches using it. Consider extending or replacing with a lower-discount code."

**Decision authority:**
- Can draft rate code changes (status = DRAFT)
- Cannot activate rate codes (requires REGIONAL_MANAGER or SYSTEM_ADMIN to approve)
- All recommendations logged with supporting data for accountability

---

### ⑧ OverdueTracker (Internal / Staff-Facing)
**Role:** Manages overdue rentals proactively — contacts customers, negotiates extensions, escalates to recovery.

**Tools available:**
- `GET /checkout/overdue` — all overdue active agreements
- `PATCH /reservations/{id}` — extend return date (authorized)
- `GET /customers/{id}` — customer contact info, history
- `POST /notifications/dispatch` — send SMS/Email to customer
- Payment hold status via `GET /payments/reservation/{id}`

**Workflow:**
```
T+0    → Vehicle not returned (grace period = 1 hour)
T+1h   → Agent sends SMS: "Your rental was due back at 10am. Are you on your way?
          Reply YES to confirm, or call us at [number] to arrange an extension."
T+2h   → If no response: Email + SMS: "Your rental is now 2 hours overdue.
          An extension has been applied at $XX/hour. Reply to confirm or 
          call immediately."
T+4h   → Escalate to Branch Manager: create task, log attempt history
T+24h  → Escalate to Regional Manager: flag for potential theft/recovery
T+48h  → Escalate to SYSTEM_ADMIN: initiate recovery protocol, contact authorities
```

**Decision authority:**
- Can autonomously send Tier 1 and Tier 2 contact messages
- Can apply extension charges (based on hourly rate = daily_rate / 24)
- Cannot waive overdue charges
- Cannot flag vehicle as stolen (human decision at T+24h escalation)

---

### ⑨ ClaimsProcessor (Internal / Staff-Facing)
**Role:** Automates the damage claim workflow — severity assessment, CDW adjudication, LOU calculation, settlement.

**Tools available:**
- `GET /damage/claims` — all open claims
- `GET /damage/inspections/{ra_id}/comparison` — PRE/POST comparison
- `POST /damage/claims/{id}/status` — state machine transitions
- `GET /damage/claims/{id}/lou` — LOU calculation
- Vision API — analyze damage photos for severity classification
- `GET /customers/{id}` — CDW coverage, loyalty tier

**Automated workflow:**

```
OPEN → (auto) Agent reads inspection comparison
     → (vision API) Classify damage: zone, type (scrape/dent/crack/glass), area cm²
     → (rules engine) Determine severity grade (GRADE_1 → GRADE_5)
     → (rules engine) Check CDW coverage in extras_snapshot
     → (rules engine) Check CDW void conditions (DUI, unauthorized driver, off-road)
     → Calculate customer_liability = max(estimate - cdw_deductible, 0)
     → Calculate LOU = daily_rate × lou_days × utilization_factor
     → Draft ESTIMATE_SENT email with claim details, liability, photos, next steps
     → If customer_liability < $200: auto-approve claim, capture from pre-auth
     → If $200–$1,500: send to CLAIMS_COORDINATOR for human review
     → If >$1,500 or CDW void condition: escalate to REGIONAL_MANAGER
```

**Decision authority (by claim size):**

| Claim | Auto-action |
|---|---|
| < $200 customer liability | Fully automated: settle, capture, close |
| $200–$1,500 customer liability | Draft settlement + human approval (CLAIMS_COORDINATOR) |
| > $1,500 OR CDW void | Regional Manager review required |
| Total loss (GRADE_5) | Legal hold, no auto-action |

---

### Master Orchestrator
**Role:** Routes every incoming customer interaction to the right agent. Maintains session context across turns. Decides when to escalate to human staff.

**Routing logic:**
```
Inbound message / event
    ↓
Intent Classification:
  - "book / find a car" → ① BookingConcierge
  - "change / modify / cancel my reservation" → ② ReservationManager  
  - "I'm driving right now / I need help now" → ③ RentalAssistant
  - "return receipt / charge question" → ④ ReturnAdvisor
  - "damage claim / I didn't do this" → ⑤ DamageMediator
  - Ambiguous / multi-turn → maintain session context, continue with same agent

Escalation triggers:
  - Agent confidence < 0.65 on intent
  - Customer uses escalation language ("supervisor", "complaint", "legal")
  - More than 2 unsuccessful resolution attempts
  - Claim/refund exceeds agent authority limit
  - DNR flag detected
  → Hand off to human with full context summary
```

---

## 4. Customer Journey Automation Map

```
SEARCH
  "Find me a car in Dallas July 10–14" 
  → ① BookingConcierge
  → GET /fleet/search (Dallas, Jul 10, Jul 14)
  → GET /pricing/quote (Economy class, 4 days)
  → Returns: "Economy $44/day, $176 total — 3 left"
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [FULLY AUTOMATED]

BOOKING
  "Book it. Here's my card."
  → ① BookingConcierge
  → POST /customers (create/find guest)
  → POST /pricing/quote (token generation, 30s TTL)
  → POST /reservations/guest
  → Fires booking.confirmed notification
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [FULLY AUTOMATED]

PRE-ARRIVAL (T-24h)
  Proactive SMS: "Your rental at DFW is tomorrow at 10am. Unit 
  will be a Toyota Corolla at Lot B. Directions: [link]"
  → ③ RentalAssistant  
  → Triggered by booking.reminder.24h event
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [FULLY AUTOMATED]

MODIFICATION
  "Can I push my return to Saturday?"
  → ② ReservationManager
  → GET /fleet/search (check class availability for extended dates)
  → POST /pricing/quote (recalculate with new dates)
  → PATCH /reservations/{id} (apply new return_datetime)
  → Fires booking.modified notification
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [FULLY AUTOMATED]

COUNTER CHECKOUT
  Customer arrives at counter
  → Agent has agent portal pre-filled (by ③ RentalAssistant background prep)
  → Vehicle assigned, extras confirmed
  → POST /checkout/checkout (staff executes, agent drafted the form)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [AI-ASSISTED: staff confirms]

ACTIVE RENTAL
  "Battery is at 12%"  
  → ③ RentalAssistant
  → ev.critical_soc_alert handler
  → Calls charging network API: nearest DC fast charger 1.8mi
  → SMS: "Critical: battery at 12%. Nearest DC fast charger at 
    Electrify America on Maple Ave, 1.8 miles. Station has 4 open 
    bays now. I've opened navigation in your app. Reply TOW if you 
    need roadside assistance."
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [FULLY AUTOMATED]

RETURN — RECEIPT DISPUTE
  "Why is there a $96 mileage charge?"
  → ④ ReturnAdvisor
  → GET /checkout/agreements/{ra_id}
  → Calculates: (odometer_in - odometer_out) - (free_miles/day × days)
  → Explains: "You drove 687 miles. 300 free miles included (100/day × 3).
    387 overage miles × $0.25 = $96.75."
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [FULLY AUTOMATED]

DAMAGE DISPUTE
  "I'm getting billed $500 for damage I didn't cause"
  → ⑤ DamageMediator
  → GET /damage/inspections/{ra_id}/comparison
  → Shows PRE vs POST photos
  → Explains CDW coverage, deductible
  → If customer wants to dispute: escalates to ⑨ ClaimsProcessor
    + ClaimsCoordinator review
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [AI-ASSISTED: human reviews photos]
```

---

## 5. Debate — What to Automate, What to Protect

The following captures the internal analysis debate between positions, resolved by consensus.

---

### Issue A: Should an agent be able to confirm a reservation without payment pre-authorization in the request?

**Argument FOR automation (remove pre-auth gate):**  
Pre-auth is a friction point. Guest bookings via the web portal already trust the system to collect card details. If the agent passes card token through, it's identical to the web flow. Removing the step cuts booking completion time by 40 seconds.

**Argument AGAINST:**  
Pre-authorization is not just a UX step — it is the inventory lock mechanism. Without a confirmed PaymentIntent.AUTHORIZED, a fraudster can hold inventory with a bad card indefinitely. The 30-second Redis token TTL is the race guard between quote and reservation; pre-auth is the financial guard. Removing it means a booking confirmation can be issued for a card that will never settle.

**Consensus:** Pre-auth stays mandatory. The agent handles card tokenization (via Stripe.js on the client) and passes the token — but does not bypass the PaymentIntent flow. Total added time: ~3 seconds for async Stripe confirmation. Acceptable.

---

### Issue B: Should the BookingConcierge be able to auto-apply discounts beyond published promo codes?

**Argument FOR:**  
Agents in other industries (airlines, hotels) routinely offer "chat discounts" to close hesitant customers. Giving the BookingConcierge a 5–10% discretionary discount budget would increase conversion for near-misses.

**Argument AGAINST:**  
Unbounded discount authority creates a yield management nightmare. If the agent applies a 10% discount to every customer who expresses hesitation, ADR collapses. The agent cannot distinguish between a legitimately hesitant customer and one who has learned to always express hesitation. Discounts must be pre-configured as rate codes with explicit conditions.

**Consensus:** BookingConcierge can only apply promo codes that already exist in the `promotion_codes` table and are marked `is_active = true`. It cannot create new discounts. Revenue manager configures "chat incentive" codes (e.g., `CHAT5OFF`) with usage limits; agent applies them to qualifying customers (e.g., abandoning cart after 90 seconds without selecting).

---

### Issue C: Should the damage claim workflow be fully automated below a threshold?

**Argument FOR automation:**  
Claims under $200 are not economically worth a human's time. The average cost of a claims coordinator reviewing a minor cosmetic claim (time + overhead) exceeds the claim value itself. Automating sub-$200 claims reduces cost and speeds resolution for customers.

**Argument AGAINST:**  
Automated claim settlement creates a systematic vulnerability. A fraudster who learns the threshold will stage repeated minor damage events, each below the automation threshold, accumulating payouts. Additionally, PRE/POST photo comparison requires judgment: a photo taken at a different angle or lighting can make existing damage look worse or better. Vision API confidence scores are imperfect.

**Consensus:** Automate settlement only when ALL of the following are true:
1. Customer liability < $150 (more conservative than original $200 proposal)
2. Vision API confidence score > 0.88 on severity classification
3. Pre-rental PRE inspection exists (no PRE inspection = full human review)
4. Customer has zero prior damage claims in the system
5. CDW is active and deductible covers the full customer liability

Any single exception triggers ClaimsCoordinator review. This protects against systematic exploitation while automating the clear-cut minor cosmetic cases.

---

### Issue D: Should the OverdueTracker be able to extend rental duration and apply charges without customer confirmation?

**Argument FOR:**  
The business needs revenue protection. An overdue vehicle is costing the operator potential rental days and blocking availability for new customers. Proactively locking in an extension + charge is operationally cleaner than "waiting" for the customer.

**Argument AGAINST:**  
Charging a customer's pre-authorization for an amount they have not confirmed is legally problematic in several jurisdictions. The customer may have had an emergency preventing communication. Incremental auth captures against a held card without explicit consent can trigger chargebacks and Stripe disputes, which are expensive and damage merchant standing.

**Consensus:** The OverdueTracker may send proactive extension *offers* with pricing, but does NOT capture payment until either: (a) customer explicitly confirms via reply, or (b) 48 hours have elapsed and Branch Manager has reviewed and authorized. Extension is communicated as "being applied" to maintain urgency, but capture is deferred. This is the industry standard practice for rental overdue protection.

---

### Issue E: Should the FleetOptimizer create maintenance blocks autonomously?

**Argument FOR:**  
Scheduling maintenance windows in advance (before a block would conflict with a reservation) is exactly the kind of high-frequency, low-stakes decision agents should own. Fleet managers are chronically overloaded with counter work; they don't monitor gap windows proactively.

**Argument AGAINST:**  
Autonomous block creation can create conflicts if the system's understanding of vehicle availability is stale. A vehicle that the agent thinks has a 4-hour gap might have been manually assigned to a walk-up customer that hasn't been entered into the system yet. Creating a maintenance block on it would cause a conflict when the counter agent tries to check out.

**Consensus:** FleetOptimizer can create maintenance blocks ONLY on vehicles with status = `AVAILABLE` AND no confirmed reservations within 12 hours AND the block duration does not exceed the gap to the next confirmed reservation (with 2-hour buffer). All autonomous block creations are tagged with `created_by = 'fleet_optimizer_agent'` and are soft-blocks (is_hard_block = false), meaning counter agents can override them with one click. Weekly report to Fleet Manager shows all autonomous block actions for review.

---

### Issue F: Should agents have access to the customer's full payment details and card information?

**Argument FOR:**  
Agents need to be able to reference payment method to troubleshoot failed captures and help with refunds.

**Argument AGAINST:**  
Agents must NEVER have access to raw card numbers, full PAN, or CVV. This is a PCI-DSS requirement (PCI-DSS v4.0 §3.2). Even masked card numbers should be surfaced only when operationally necessary.

**Consensus:** Agents receive only: `card_last_four`, `card_brand`, `payment_status`, `amount`. They can trigger refunds through the API (which enforces limits). They cannot read or store any tokenized card data. All payment API calls go through the existing `/payments/*` endpoints which maintain Stripe's secure token vault. Agents are classified as PCI-DSS Level 4 (no CHD access), keeping audit scope minimal.

---

### Issue G: Should a single AI agent handle both customer-facing and operational decisions?

**Argument FOR a unified agent:**  
A single agent with access to all tools is simpler to maintain. Context switch between "customer mode" and "ops mode" adds latency and complexity.

**Argument AGAINST:**  
Mixing customer-facing and operational authority in one agent is a security anti-pattern. If the customer-facing agent has authority to create rate codes or modify vehicle fleet status, a sophisticated prompt-injection attack via customer input could manipulate fleet operations. Separation of customer and operational agents provides defense in depth.

**Consensus:** Strict agent segregation is maintained. Customer-facing agents (①–⑤) have only read access to operational data. Operational agents (⑥–⑨) are not accessible via customer channels. The orchestrator routes between them but cannot grant customer agents operational tool access. This is analogous to the existing RBAC: a COUNTER_AGENT cannot configure rate codes.

---

## 6. Implementation Roadmap

### Phase 1 — Customer Self-Service Foundation (Weeks 1–6)

**Deliver:** BookingConcierge + ReservationManager  
**Deploy on:** WhatsApp channel (highest engagement for this customer segment) + Email  
**Expected impact:** 45% reduction in booking-related support contacts

**Technical work:**
- Integrate Claude claude-sonnet-4-6 (or later claude-sonnet-4-6+) as the agent backbone
- Build tool wrapper layer: maps agent function calls → existing API endpoints
- Build session context store (Redis, 24h TTL per customer session)
- Add `POST /reservations/guest` to WhatsApp webhook handler
- Add confirmation number → session lookup for returning customers
- Set up evaluation harness: 500 synthetic booking scenarios to validate intent classification accuracy

**Success criteria:**
- Intent classification accuracy > 94% on held-out test set
- Booking completion rate via agent >= 78% (vs 62% current web form)
- No customer-visible errors in price calculation

---

### Phase 2 — Active Rental & Return Support (Weeks 7–12)

**Deliver:** RentalAssistant + ReturnAdvisor  
**Deploy on:** SMS (active rental alerts) + Email (return receipts)  
**Expected impact:** 30% reduction in return-related phone calls, 60% of receipt disputes resolved without human

**Technical work:**
- Connect to Redis event stream for `ev.low_soc_alert`, `return.receipt` triggers
- Build receipt line-item explainer from RentalAgreement + Payment records
- Integrate EV charging network APIs (ChargePoint, EVgo) for nearest-charger lookup
- Build goodwill refund tool with $75 limit + audit log
- Add conversation context persistence across multiple return-period contacts

**Success criteria:**
- Receipt dispute resolution rate (agent, no human) > 55%
- Proactive EV alert customer satisfaction score > 4.2/5.0
- False positive rate on refund approval < 2%

---

### Phase 3 — Damage & Claims Automation (Weeks 13–18)

**Deliver:** DamageMediator + ClaimsProcessor (partial)  
**Deploy on:** Email (claim notifications) + internal staff dashboard  
**Expected impact:** Claim first-response time < 2 hours (down from 3 days), sub-$150 claims fully automated

**Technical work:**
- Integrate vision model (Claude claude-sonnet-4-6 vision or GPT-4V) for damage photo analysis
- Build PRE/POST comparison visualizer (annotated zone-diff)
- Train severity classification on historical damage claim + inspector notes data
- Build CDW adjudication rules engine (coverage check + void condition detection)
- Implement two-tier approval workflow (auto-settle vs. human-review queue)
- LOU calculation verification agent (spot-checks fleet manager's LOU claims)

**Success criteria:**
- Vision API severity classification accuracy > 85% vs. senior claims coordinator benchmark
- Sub-$150 auto-settlement rate > 70% of eligible claims
- Customer claim acknowledgement time < 4 hours (down from 3 days)

---

### Phase 4 — Operational Intelligence (Weeks 19–26)

**Deliver:** FleetOptimizer + PricingStrategist + OverdueTracker  
**Deploy on:** Staff-facing dashboard widgets + manager notification channel  
**Expected impact:** Fleet utilization +4pp, ADR +6%, overdue recovery rate +18%

**Technical work:**
- Build demand forecasting model (reservation history × seasonality × competitor rates)
- Competitor rate scraper (OTA APIs, Google Hotel Ads)
- Rebalancing recommendation engine with ROI scoring
- OverdueTracker escalation pipeline (T+1h → T+2h → T+4h → T+24h → T+48h)
- PricingStrategist DRAFT rate code generator + manager approval workflow
- FleetOptimizer autonomous block creation with override audit log

**Success criteria:**
- Fleet rebalancing recommendation acceptance rate > 68%
- Overdue contact conversion rate (customer responds + returns within 4h) > 73%
- PricingStrategist ADR improvement (validated by A/B vs. control locations) > 5%

---

## 7. API Surface Changes Required

The existing API is largely sufficient. Three gaps need filling:

### 7.1 Agent authentication token
Agents need a long-lived API token with a dedicated role (`API_PARTNER` or a new `AGENT_SERVICE` role) scoped to only the endpoints they need. Each agent class gets a separate token so audit logs show which agent took which action.

### 7.2 Webhook endpoint for agent trigger events
Add `POST /agents/trigger` that accepts structured events from the Redis stream and routes them to the appropriate agent. Alternatively, agents consume the Redis stream directly (preferred — lower latency).

### 7.3 Refund authority limit on `/payments/refund`
Current endpoint requires BRANCH_MANAGER for all refunds. Add a `goodwill_under` parameter to the refund endpoint that allows refunds ≤ configured limit (e.g. $75) by a service account. This removes the need to hardcode the limit in the agent and keeps it configurable per tenant.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agent misclassifies customer intent, routes to wrong agent | Medium | Low | Orchestrator confidence threshold; fallback to human on ambiguity |
| Agent applies wrong promo code (expired or wrong segment) | Low | Medium | Validate against `promotion_codes.is_active` + `used_count < max_uses` before applying |
| Vision API misclassifies damage severity | Medium | High | Human review required for all claims > $150; vision confidence threshold enforced |
| Customer social-engineers agent to waive fees | Medium | Medium | Fee waiver capability excluded from all customer-facing agents; requires human staff role |
| Prompt injection via customer input manipulates fleet ops | Low | High | Strict agent segregation (customer agents cannot access fleet tools) |
| Agent creates double-booking through concurrent requests | Low | High | Existing advisory lock + exclusion constraint prevents this at DB level — agent cannot bypass |
| Overdue tracker harasses customer who had a genuine emergency | Medium | Medium | Soft escalation language; human review before Tier 3 contact; opt-out respect |
| Agent refund authorization abused by fraudulent returns | Low | High | Refund authority limited to $75; requires RA match + prior purchase history; flagged for review |
| PricingStrategist recommends rate higher than competitor, loses OTA bookings | Medium | Medium | Draft-only; human approves; rate parity dashboard monitors channel mix |
| Agent session context leak between customers | Low | Critical | Redis session keys scoped to customer_id; TTL enforced; no cross-session context sharing |

---

## 9. Metrics & Evaluation Framework

### Customer-Facing Agent KPIs

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Intent classification accuracy | n/a | > 94% | Weekly held-out eval set (500 cases) |
| Booking completion rate (agent) | 62% (web form) | > 78% | Reservations created / sessions started |
| First-contact resolution rate | 34% (phone/email) | > 68% | Issues resolved without human handoff |
| Customer satisfaction (CSAT) | 3.8/5 | > 4.3/5 | Post-interaction survey (10% sampling) |
| Escalation rate | n/a | < 18% | Escalations / total sessions |
| Average handle time (agent) | 8.4 min (human) | < 90 sec | Session start → resolution timestamp |

### Operational Agent KPIs

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Fleet utilization % | 71% | > 75% | (ON_RENT days / available days) × 100 |
| Overdue resolution rate | 55% | > 73% | Returns within 4h of first contact |
| Damage claim first-response | 3.2 days | < 2h | Claim opened → ESTIMATE_SENT timestamp |
| Auto-settled claims (%) | 0% | > 65% of eligible | Sub-$150 auto-settled / total eligible |
| ADR improvement (attributed) | baseline | +5–8% | A/B vs. locations without PricingStrategist |

---

## 10. Conclusion & Prioritization Matrix

```
HIGH IMPACT + LOW COMPLEXITY → BUILD FIRST
  ① BookingConcierge               (conversion uplift + 45% support deflection)
  ② ReservationManager             (modification/cancellation automation)
  ④ ReturnAdvisor                  (receipt dispute resolution)
  ⑧ OverdueTracker                 (revenue recovery + customer retention)

HIGH IMPACT + MEDIUM COMPLEXITY → BUILD SECOND
  ③ RentalAssistant                (proactive EV + extension + swap)
  ⑥ FleetOptimizer                 (utilization + rebalancing)
  ⑨ ClaimsProcessor (partial)      (sub-$150 auto-settlement)

HIGH IMPACT + HIGH COMPLEXITY → BUILD THIRD
  ⑤ DamageMediator                 (requires vision API + claims workflow)
  ⑦ PricingStrategist              (requires competitor data + yield model)
  ⑨ ClaimsProcessor (full)         (requires legal review for higher tiers)
```

The highest leverage investment is the **BookingConcierge + ReservationManager** pair. These two agents touch every customer in the system and have clear, bounded authority (read availability, calculate price, create/modify reservation). They can be built and deployed in 6 weeks, deliver measurable ROI within 90 days, and establish the agent infrastructure (tool wrappers, session store, orchestrator) that all subsequent agents reuse.

The **DamageMediator + ClaimsProcessor** pair is the most technically ambitious and legally sensitive. It should be built only after the customer-service agents have demonstrated system reliability and the vision model has been validated against a 1,000-claim ground truth dataset from the existing claims coordinator team.

The agent system does not replace the rental operation. It removes the routine, high-volume, rule-bound work so that counter agents, claims coordinators, and fleet managers can focus on what only humans can do: build trust with an anxious customer, exercise judgment on a contested claim with incomplete evidence, and make the call when the data is ambiguous. Those moments are where the brand is actually made.

---

*Generated: 2026-06-20*  
*Status: Design proposal — requires engineering review before implementation*
