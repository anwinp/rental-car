# RCM Product Plan — Shopify for small rental businesses

Synthesis of four parallel research streams: customer & jobs-to-be-done, feature
baseline, white-label storefront architecture, and self-serve lifecycle.

Every claim about the codebase below was verified directly, not taken from the
research. Market claims are labelled as assumptions.

---

## The one-paragraph version

The operational engine is real and substantial — 157 endpoints, a genuinely good
damage/inspection module, working deposits, a live AI agent with seven tools, and
multi-tenancy that now holds under adversarial testing. What is missing is
everything that turns an engine into a business someone can buy: **an operator
cannot set a price, cannot get their existing bookings in, cannot be charged,
cannot make the storefront look like theirs, and cannot get their data out.**
Four of those five are small pieces of work sitting next to APIs that already
exist. The fifth — the storefront — is the differentiator and the largest build.

---

## 1. Who this is for

**Target: independent operators, 10–50 vehicles.** One to three locations, two to
eight staff, owner is the buyer. Below 10 vehicles the product's org-chart
concepts (counters, shifts, five dashboards) are noise; above 200 they want SSO,
procurement and an SLA, and chasing them distorts the roadmap.

*(Segment boundaries and willingness-to-pay are research assumptions, not
verified market data.)*

**Do not chase:** airport franchisees (the franchisor mandates their software),
car subscription (a recurring-billing and asset-finance business wearing a rental
costume).

**Adjacent and attractive:** peer-to-peer fleet operators running 15 cars on
Turo — roughly 70% of what they need is already built, and what they most want,
per-vehicle P&L, is 0% built.

**Needs real additions:** campervan/RV (seasonal rate calendars, which do not
exist in any form; turnaround buffers), van/truck hire (hourly and per-km
billing; the rate schedule is day-granular).

### The jobs, ranked

1. **Never promise a car I don't have** — the job everything else hangs off
2. **Let people book and pay without calling me** — the demo that closes the sale
3. **Get me paid up front and hold the deposit**
4. **Prove what the car looked like leaving and returning** — badly under-served industry-wide
5. **Tell me what's out, back, and late today** — the most-opened screen they will ever use
6. **Make the paperwork real** — signed agreement, licence on file

Not hired for: bookkeeping, payroll, marketing, insurance broking.

### The structural mismatch

The product ships **five org-level dashboards** — Executive, Regional, Manager,
Staff, Back-office — for businesses with two employees. Plus a seven-step rate
wizard with CDP codes and blackout dates, for someone whose pricing fits on an
index card.

This is the clearest signal the product was designed around an enterprise org
chart rather than a business where one person does everything. The answer is
**progressive disclosure keyed to fleet size and location count** — hide, don't
delete, so one codebase serves 12 cars and 120.

---

## 2. What is actually built

Verified endpoint counts: **157 across 22 domains.**

| Domain | State |
|---|---|
| Fleet / vehicles | **End to end** — 18 routes, CSV import, blocks, calendar, availability cache |
| Reservations | **End to end** — booking funnel, modify, cancel, availability |
| Damage / inspections | **End to end — the strongest domain.** PRE/POST photo capture, automatic zone comparison, auto-claim per damaged zone, loss-of-use |
| Checkout / returns | **API real; admin real; counter PWA broken** |
| Payments (rental) | **End to end** — Stripe pre-auth/capture/void/refund, bond release worker |
| Multi-tenancy | **End to end** — signup, verification, provisioning, invites, platform console |
| AI agent | **End to end** — 7 real tools incl. create/cancel reservation, live on storefront and counter |
| Tasks, notifications delivery | **Real** (notifications have no admin UI) |
| **Pricing** | **API complete (11 routes) — UI is fabricated** |
| **Customers** | **API complete (9 routes) — list UI is fabricated** |
| Reporting | **Two async jobs, no route to read a result. UI fabricated** |
| Maintenance, corporate, billing, admin | **12-line health stubs.** No tables |
| Channels / OTA | Lead triage real; Booking.com and Expedia connectors are `NotImplementedError` |

### Verified defects that block selling

| # | Defect | Evidence |
|---|---|---|
| 1 | **Operators cannot set a price.** `/pricing` API is complete; `PricingPage` makes zero network calls and renders `INIT_RATES` | `PricingPage.tsx` |
| 2 | **Tax is always zero.** Live quote returns `"taxes": "0.00"`. `AvalaraClient` never instantiated; `pricing/service.py:620` calls `calculate_tax()`, a method the class does not define | reproduced |
| 3 | **Online bookings arrive unpaid.** Booking site says "Demo mode"; card data never reaches the API | `booking/[id]/page.tsx:697` |
| 4 | **Counter path 404s silently.** Three call sites POST `/api/v1/counter/*`; no counter router is mounted. Failure swallowed with `// Fall through — counter endpoints may not exist yet` | `ReservationsPage.tsx:108` |
| 5 | **No rental agreement is produced.** `weasyprint==62.3` in requirements, never imported. Signature capture is real; the document does not exist | verified |
| 6 | **No forward-booking import.** Vehicles import exists and is the only importer. Reservation creation demands a 64-char quote token with a 30s TTL | verified |
| 7 | **No export of any kind.** Zero export routes in any domain | verified |
| 8 | **No subscription billing.** `billing` is a 12-line stub; `stripe_customer_id` and `trial_ends_at` are inert | verified |
| 9 | **Plan limits enforce the wrong thing.** `assert_within_limit` is called only for staff (`team_router.py:244,450`). Vehicles and locations — the billable dimension — are never checked | verified |
| 10 | **The only upgrade prompt is a dead end.** `TeamPage.tsx:206` is a `<p>` with no link. No billing page, no plan-change endpoint | verified |
| 11 | **14-day hard delete against a 24-hour token.** `sweep_unverified` issues `DELETE FROM tenants` for unverified workspaces after 14 days; the verification token lives 24h. No warning email | `tenant_maintenance.py` |
| 12 | **Fabricated UI on six pages** — pricing, reports, corporate, customers list, counter overdue and shift | verified |

`ReportsPage` is the most dangerous of these: an operator making a fleet-purchase
decision on invented revenue numbers is being actively misled. Delete it rather
than leave it.

---

## 3. The white-label gap

This is the "Shopify" part, and it is close to unbuilt.

| | |
|---|---|
| Branding columns on `tenants` | **one** — `logo_url` |
| Branding / theme table | **none** |
| CSS custom properties declared | 96 |
| Literal hex colours painted in storefront components | **740** |
| `var(--…)` references in those components | 131 |
| `middleware.ts` in any app | **none** |

A theming layer exists and is almost entirely bypassed. Changing a token today
changes very little on screen.

**The expensive part is not the theme system — it is de-hardcoding 740 colour
literals**, sized at roughly 40% of the total effort, producing nothing
demo-able. Expect pressure to skip it. Skipping it means adding a second
bypassed abstraction on top of the first.

### Recommended model

**Presets plus constrained overrides.** Ship four designed themes; the tenant
picks one and adjusts a small set of safe knobs. Not a token editor — a 12-car
operator is not a web designer, and an open palette produces 2.1:1 contrast and a
purple CTA on a brown hero, then churn.

**One brand colour, derived server-side.** The tenant sets a seed; hover, muted,
ring and the contrast-safe foreground are computed in OKLCH and stored. Contrast
is enforced on write by *adjusting and explaining* — "we darkened your brand
colour slightly on buttons so the text stays readable" — never by rejecting.

**Never a custom CSS or script field.** That is stored XSS on a page taking card
details. Analytics becomes a vendor enum plus an ID, rendered by a known loader.

**Cache safety is the architectural risk.** Next.js caches by pathname, not by
`Host`. A storefront that reads the tenant from the host and caches anything will
serve tenant A's page on tenant B's domain. Fix structurally: `middleware.ts`
rewrites to an internal `/t/{tenant}/…` path so the tenant is part of every cache
key, and the theme is emitted server-side into `<head>` so there is no flash.
Module-level caching in any *server* module is a direct cross-tenant leak.

**Defer custom domains deliberately.** They will be the loudest request. A
verified `acme.rcm.app` carrying the operator's logo, colours, copy, legal text
and metadata is ~90% of the perceived value at ~25% of the cost, with none of the
certificate and DNS support burden. Sell the domain as an upgrade.

Prerequisite, and it is ops not code: **per-tenant subdomains do not work in
production today** — no wildcard DNS, no DNS-01 issuer.

### A liability, not a gap

`app/policies/*` hardcodes someone else's legal text and presents it as each
tenant's rental terms. Needs a versioned `tenant_documents` table with the
accepted version stamped onto each reservation, so "which terms did this customer
agree to" has an answer in a dispute.

---

## 4. Commercial model

### Billing metric: active vehicles

- **Not seats.** Counter turnover is high and shifts are covered by casuals. Seat
  pricing makes operators share logins, which destroys the audit trail and the
  entire permission model. Never charge for seats in a product whose integrity
  depends on individual logins.
- **Not bookings.** Demand is violently seasonal, so the bill is unforecastable;
  worse, it creates an incentive to keep bookings *out* of the system, and
  retention depends on every booking being in it.
- **Not locations.** Too coarse, and it taxes exactly the expansion you want.
- **Vehicles** match the operator's own mental model, correlate with revenue,
  grow with the customer, are trivially auditable, and create no incentive to
  withhold data.

**Refinement:** charge on *peak active* vehicles, excluding sold and laid-up
stock. Seasonal operators stop paying for cars that aren't earning — a real
differentiator in this segment.

### Existing tiers, critiqued

`STARTER 5/25/2 · GROWTH 25/250/10 · ENTERPRISE unlimited`

- **TRIAL is modelled as a tier** rather than a state, and its caps equal
  STARTER's — so the trial cannot demonstrate anything the cheapest paid plan
  doesn't. `trial_ends_at` already exists on the tenant.
- **25 → 250 vehicles is a canyon.** The 30–60 vehicle operator is the core of
  this segment and gets pushed onto a plan sized for 250 cars.
- **No price columns exist at all.** Nothing in the system knows what anything costs.
- Tiers differ only by counts, so every upgrade conversation is "pay more for the
  same thing."

*(Specific price points are assumptions requiring validation.)*

### Trial and its end

Start the clock at **first vehicle imported**, not signup — signing up Friday and
getting to it Tuesday should not burn four of fourteen days. Auto-extend once, on
effort rather than request.

At trial end, **never lock the account.** Read-only-*plus*: existing bookings can
still be checked out and in; no new reservations; the storefront closes with a
neutral "please call us" carrying the operator's phone number. If RCM strands a
customer at the counter with a car in their hand, RCM becomes the villain in that
operator's business.

### Limits should prompt, not punish

The existing 402 is well-judged — commercial not permissions, checked at creation
never retroactively, failing open on a missing config row, and pending
invitations correctly hold seats. What's wrong is everything around it: only
staff is enforced, no frontend handles 402 at all, there is no warning before the
wall, and the message points nowhere.

Add: a visible meter (`get_usage` already returns it and nothing consumes it), an
80% warning, a soft landing of +3 or +10% for 7 days, and structured 402 detail
with a real upgrade button. **On a bulk import that crosses the cap, import
everything then ask** — an operator whose fleet is already in the system converts
far better than one stopped at the door.

---

## 5. Migration is the product

An operator switching has ~30 live forward bookings and ~200 past customers.
Today forward bookings **cannot be imported by any means the API offers**. Their
only option is running RCM and their spreadsheet in parallel, double-entering
everything. Nobody sustains that past week two.

This is the single highest-leverage missing feature for conversion, and it goes
unbuilt everywhere because it is unglamorous.

**Fix the vehicle importer first** — it currently requires raw UUIDs for class and
branch (no operator can produce that file), mandates a 17-character VIN when
operators have plates, and imports **zero rows if any row fails**.

**Then build `POST /reservations/import`** — bypassing the quote engine, taking an
agreed total, with `price_locked` so a migrated booking is never re-quoted. Run
the availability check but *report* conflicts rather than rejecting: spreadsheet
operators are frequently double-booked and don't know it, and "these 3 bookings
overlap on the same car" makes the case for the product better than any feature
tour. Batch id with 7-day undo — the dominant fear is "I've made a mess I can't
reverse."

---

## 6. Data rights

**No export endpoint exists anywhere.** This is the most serious gap
ethically and commercially. Export must be available at all times, including
while past-due and suspended — holding a business's operating data over an unpaid
invoice is not acceptable and for EU customers likely not lawful.

There is a near-miss to build on: `reporting_tasks.py` already writes a per-tenant
CSV to S3 with no route to download it. The async-generate-then-signed-link
pattern is half-built.

There is also a good precedent to copy: `customers/service.py` implements GDPR
erasure properly, **blocking on legal holds** (active agreement, open claim). But
the product can delete a person's data and cannot give it to them — that is half
of GDPR Chapter III, and the missing half is the commercially important one.

**Export forward bookings in the exact shape RCM's own importer accepts.**
Exporting in your own import format is the strongest possible signal you are not
trying to trap anyone, and it costs nothing.

---

## 7. Build order

Each tier gates the next.

### Tier 1 — the product cannot be sold without these

1. **Rate & extras admin UI** wired to the existing `/pricing` API, and opened
   beyond SYSTEM_ADMIN. Operators literally cannot set a price today.
2. **Fix the `/counter/*` path break** and remove the swallowing `catch`.
3. **Delete or rewire the six fabricated pages.** Fake pages ship, get demoed,
   and get believed.
4. **Booking-site payment capture** — replace "Demo mode" with a real Stripe
   element against the existing pre-auth service.
5. **Per-location tax rate** on the quote. Shelve Avalara — for a 1–3 location
   operator it is over-engineering, and it is currently broken anyway.
6. **Rental agreement PDF** at checkout, attached to the confirmation email.
7. **Migration**: fix the vehicle importer, build reservation import.
8. **Export**, self-serve, available while past-due.
9. **Subscription billing** — price columns, Stripe subscription, trial as state,
   self-serve upgrade and downgrade.
10. **Enforce vehicle limits** with the meter, the 80% warning and an actionable 402.

### Tier 2 — competitive

11. Real reporting from the DB (`dashboard/router.py` already computes most of
    it) plus CSV export.
12. **Storefront white-label v1** — the de-hardcoding, preset system, branding
    table, asset pipeline, admin UI, contrast engine. ~8 engineer-weeks, excludes
    custom domains.
13. Notification template admin and delivery log.
14. Counter PWA offline replay — the queue is currently a badge that never drains.
15. Onboarding rewrite: four real checklist steps, restricted pre-verification
    session, drop the slug from signup, warn before the 14-day sweep.

### Tier 3 — sticky

16. **Agent as the operator's interface** — natural-language ops questions over
    real data. This substitutes for the BI product you would otherwise build, and
    is a better answer for someone checking their phone between jobs.
17. **Damage recovery closed loop** — inspection → auto-claim (both exist) →
    deposit capture → evidence pack, with recovered dollars on the dashboard.
    Nothing retains a small operator like a number showing what the software
    recovered.
18. Custom domains, gated on tier.
19. Seasonal pause, self-serve cancellation with automatic export.

### Not scheduled

OTA connector certification, telematics, toll processing, accounting sync,
GDS/rate filing, loyalty, Tyro. **Remove their dead beat-schedule entries and stub
modules so the codebase stops implying they exist** — `toll_processing` is
currently beat-scheduled against a task that does not exist and throws
`NotRegistered` every cycle.

---

## 8. Positioning

The wedge is not "another fleet CRM". Three things here are genuinely unusual at
this tier:

**Damage recovery, evidenced.** Sell the outcome — "recover the damage you're
currently eating" — not the feature. It is the most complete thing in the
codebase and it maps onto money operators lose today.

**Same-day onboarding.** Signup → import → prices → first live booking, no
salesperson. Half-built already; the readiness checklist endpoint is literally
named for it.

**The agent, positioned narrowly.** Leading with "AI-powered" reads as a product
solving its own problems, and it is not in the buyer's top ten jobs. Two uses
genuinely earn their place: answering "anything for Saturday?" at 11pm so the
booking isn't lost, and drafting the damage-claim letter that's been sitting for
three weeks.

**Free liability shield.** `poll_nhtsa_recalls` already decodes every VIN daily
and auto-blocks vehicles with safety-critical recalls. Real, working, zero-cost,
and a compelling demo line.

---

## 9. What the research could not settle

Labelled honestly, because acting on these as fact would be a mistake:

- All segment sizing, willingness-to-pay and churn figures are reasoned
  assumptions, not market data. Validate with ten real operators before pricing.
- Competitor feature sets and complaints are general-knowledge inference. No
  competitor product was examined.
- The claim that concierge migration roughly doubles trial conversion is an
  assumption, though a well-motivated one.
- Whether vehicle-class taxonomy genuinely causes first-session drop-off is a
  hypothesis worth testing directly.
