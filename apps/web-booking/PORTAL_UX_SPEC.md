# RCM Customer Portal — UX Specification
**Version 1.0 | Design Workshop Output**
**Produced by:** Maya (UX Lead), James (Business Analyst), Priya (Security/Accessibility)
**For:** Development team building `apps/web-booking` (Next.js 14 App Router)

---

## Table of Contents

1. [Design Workshop Debate Log](#1-design-workshop-debate-log)
2. [All User Scenarios](#2-all-user-scenarios)
3. [Page-by-Page UX Design Spec](#3-page-by-page-ux-design-spec)
4. [Design System Notes](#4-design-system-notes)
5. [State Management Plan](#5-state-management-plan)
6. [Edge Case Inventory](#6-edge-case-inventory)
7. [API Contract Assumptions](#7-api-contract-assumptions)

---

## 1. Design Workshop Debate Log

This section records the key design debates and the consensus reached. Decisions are referenced by ID (D-01, etc.) in the spec below.

### D-01: Guest Checkout vs. Forced Login

**Maya:** Major rental brands (Hertz, Enterprise, Avis) all allow full guest checkout. Forcing account creation before the user sees a price is a conversion killer. Guest-first is non-negotiable.

**James:** We need an email address for the confirmation email and manage-reservation token. We get that in the Driver Info step regardless. Loyalty opt-in can be an upsell on the confirmation page, not a gate.

**Priya:** From a data minimization standpoint (GDPR/CCPA), collecting only what we need for the transaction is better practice. Guest checkout is correct. If the user wants to save their data, they actively create an account.

**Consensus:** Guest checkout is the default flow. Account creation is offered as an optional upsell on the confirmation page ("Save your details for next time"). The `/login` page is accessible via a "Sign In" link in the nav, not as a mandatory gate.

---

### D-02: One-Way Rental UX

**Maya:** The search form should start with a "Same pickup and drop-off location" toggle (checked by default). Revealing a second location field only when unchecked follows the progressive-disclosure pattern used by Enterprise.com. Keeps the form visually clean for the 80% who want round-trip.

**James:** One-way adds a drop-off fee that must be disclosed early. The fee should appear in the search results as a line item on cards (not just in the rate summary), so the user can compare round-trip vs. one-way before selecting.

**Priya:** The toggle must have a visible label, not just a visual indicator. Screen reader must announce "Return to different location: expanded" when the second location field appears. `aria-expanded` on the toggle button.

**Consensus:** Default to same-location. A labeled toggle reveals a "Drop-off location" field with `aria-expanded`. One-way fee appears as a badge on vehicle cards in results and as a named line item in the rate summary.

---

### D-03: Airport Pickup — Flight Number

**Maya:** Flight number should be an optional field that appears when the user selects an airport-tagged location. Don't force it into the base form.

**James:** We need the flight number for the grace period logic (counter holds the vehicle for 2 hours after actual arrival rather than scheduled pickup time). If the user doesn't provide it, the system defaults to a 30-minute hold and the confirmation email should explain this.

**Priya:** Flight number input must be validated as IATA/ICAO format (2–3 letter carrier code + 1–4 digits). No need to be strict on the server — a loose regex client-side is fine. The field must have a `pattern` hint and a helper text explaining the format.

**Consensus:** When pickup location is flagged as `is_airport: true` by the API, a "Flight Number (optional)" field appears in the HeroSearch form below the date fields. Helper text: "Helps us track delays. Format: AA1234". Light validation: `/^[A-Z]{2,3}\d{1,4}$/i`. Missing flight number → 30-minute grace period; present → 2-hour grace. The confirmation email states the actual hold period.

---

### D-04: Age Surcharge Notice

**Maya:** Don't ask age upfront in the search form — that's friction for the 90% of drivers over 25. Ask date of birth in the Driver Info step (where we need it anyway for license verification), then compute the surcharge server-side and add it to the rate summary.

**James:** The surcharge varies by vehicle class and state. The rate quote endpoint already handles this if we send DOB. We should warn the user the moment they enter a DOB that results in age < 25, before they reach the rate summary.

**Priya:** DOB field must be `type="date"`, not three separate select dropdowns (worse for screen readers and mobile autocomplete). We must not display the raw age in the error — display the surcharge amount only. "A young driver surcharge of $X/day applies for drivers under 25."

**Consensus:** DOB field is collected in Driver Info step. On blur, if computed age < 25, show a yellow inline notice directly below the DOB field: "Young driver surcharge: $XX.XX/day will be added to your total." The `useRateQuote` hook is re-triggered with `dob` param after the user leaves the DOB field. The updated total appears in the live price summary sidebar.

---

### D-05: Payment Integration — PCI Compliance

**Maya:** The current booking page has a "Stripe Payment Element — coming soon" placeholder. The spec needs to define exactly what goes there.

**Priya:** We must never touch raw card data. The Stripe Payment Element (iframe-based) is the correct pattern. The `<PaymentElement>` component from `@stripe/react-stripe-js` renders inside an iframe from stripe.com — our JS never sees the PAN, CVV, or expiry. We use `stripe.confirmPayment()` which returns a `paymentIntent.id` that we send to our API. No card data ever touches our servers or our JS bundle.

**James:** We need to handle: (a) card declined, (b) 3D Secure redirect, (c) insufficient funds, (d) card expired. Each has a distinct user message and retry path.

**Consensus:** The Payment step renders `<Elements stripe={stripePromise}><PaymentElement /></Elements>`. On submit, call `stripe.confirmPayment({ redirect: 'if_required' })`. Handle all Stripe error codes with user-facing messages (see Edge Case Inventory). The `paymentIntent.id` is sent to `POST /reservations` as `payment_intent_id`. The server confirms the reservation only if the PaymentIntent status is `requires_capture` or `succeeded`.

---

### D-06: Session Timeout and Draft Recovery

**Maya:** If a user is mid-booking and the session times out (auth token expires after 30 min of inactivity), we should not lose their work.

**James:** The booking flow is stateless by design for guests (no session needed). For logged-in users, the JWT can expire. We need to distinguish: (a) token expired during booking wizard → prompt re-auth in a modal, resume from same step; (b) user closes the tab and returns → restore from Zustand persist (localStorage).

**Priya:** We must not store any payment data in localStorage. We store only: step number, selected extras, driver info fields (name, email, phone, DL), DOB, special codes. Never the PaymentIntent client secret or any Stripe token.

**Consensus:** Zustand `bookingDraftStore` persists to `localStorage` (with `zustand/middleware/persist`). Persisted fields: `{ classId, pickup, dropoff, from, to, selectedExtras, driverData, promoCode, corporateCode, step }`. On mount, the booking page hydrates from the draft. A session expiry for authenticated users shows a modal: "Your session expired. Sign in again to continue — your booking details are saved." After re-auth, the wizard resumes at the same step. Payment data is never persisted.

---

### D-07: Loyalty Points and Corporate Codes

**Maya:** These are power-user features. Do not put them in the main search form or at the top of the booking wizard. Surface them in the Rate Summary step as an expandable "Have a promo or corporate code?" section.

**James:** Corporate codes unlock `RateType.CORPORATE` pricing. Promo codes apply `RateType.PROMOTIONAL` discounts. Loyalty points can offset up to 100% of the base rental (not taxes/fees). All three are mutually exclusive with OTA/Wholesale rates. The `POST /pricing/quote` endpoint accepts `corporate_code`, `promo_code`, and `loyalty_points_to_redeem`. We need to validate codes before the user reaches the payment screen.

**Priya:** The code entry field should not autocomplete (`autocomplete="off"`). Corporate codes may be confidential. Input should be masked to `text` type (not password, because the user needs to see what they typed). Loyalty balance must be fetched from `/auth/me` for logged-in users; guests see no loyalty UI.

**Consensus:** In the Rate Summary step, an expandable accordion section "Discounts & Loyalty" contains:
- "Promo/Coupon Code" text input + "Apply" button. On apply, re-fires `useRateQuote` with `promo_code`. Shows success ("$X.XX discount applied") or error ("Code not valid or expired").
- "Corporate Account Code" text input + "Apply" button. Same pattern.
- If user is authenticated and has loyalty points, shows: "You have X points (worth $Y). Redeem: [number input capped at available points] points."
All three can be stacked if the API allows. The "Apply" button triggers a new rate quote; the line item diff is reflected in the summary table.

---

### D-08: Sold-Out Vehicle Class

**Maya:** Don't just show a grey "Sold out" card. Show an "Upgrade Available" suggestion if a higher class has availability. Enterprise does this well — "Book the Midsize, available from $XX/day".

**James:** The availability response already returns all classes, so the client can compute this. Show sold-out cards last (sorted to bottom). For each sold-out class, check if any class priced higher has availability — if yes, badge that higher class with "Popular upgrade from [sold-out class]".

**Priya:** The sold-out card must still be announced to screen readers as "Sold out" via `aria-label`. The card should be `aria-disabled` but remain focusable so keyboard users know it exists. Do not render the "Select" button at all — replace it with a "Join waitlist" button that captures their email.

**Consensus:** Sold-out cards are sorted to the bottom of results. They display a "Notify me" button (not "Select"). Clicking opens a small inline form: email input + "Notify me when available" button → calls `POST /waitlist` with `{ class_id, pickup_location_id, pickup_date, dropoff_date, email }`. If a higher-priced class has availability, it gets a `variant="info"` badge: "Upgrade available". Sold-out count badge uses `variant="destructive"`.

---

### D-09: Modify Existing Reservation

**Maya:** The modify flow on `/manage/[token]` currently has "Modify Dates" stubbed as disabled. The full flow should take the user back to the search experience but pre-fill the new dates and keep the same class.

**James:** Modification rules: free if > 48 hours before pickup; fee applies if 24–48 hours; not allowed < 24 hours. The API returns `can_modify: true/false` and `modification_deadline`. When dates change, the rate difference must be calculated (upgrade charge or credit) before confirming.

**Priya:** The modify dialog must show the old dates and new dates side-by-side, and the price difference (positive = additional charge, negative = credit). The user must explicitly confirm. Do not auto-capture payment — create a PaymentIntent for the delta if positive.

**Consensus:** "Modify Dates" opens a Dialog with a date range picker pre-filled with current dates. The user selects new dates → the dialog fires `useRateQuote` with the new dates → shows old total, new total, and difference. If difference > $0, shows payment fields (Stripe Element for delta). If difference < $0, shows "You will receive a $X credit." Confirm button calls `PATCH /reservations/{id}` with `{ pickup_date, dropoff_date, payment_intent_id? }`.

---

### D-10: Mobile-First Responsive Design

**Maya:** The booking wizard stepper on mobile must collapse to a progress indicator (e.g. "Step 2 of 4 — Driver Details") rather than showing all four step labels horizontally. Below 640px, the `StepperList` switches to a single-line progress badge.

**James:** On the search results page, filters must be accessible on mobile. Use a "Filter" button that opens a bottom sheet (or a slide-in drawer) on mobile, rather than a persistent left sidebar.

**Priya:** Bottom sheet must trap focus. All touch targets must be minimum 44x44px (already enforced by `min-h-[44px] min-w-[44px]` in `StepperItem`). Date inputs should use native `type="date"` on mobile for system date picker, which is more accessible than a custom date picker library.

**Consensus:** Results page: filters in a left sidebar on `lg:` breakpoints, a "Filters" button opening a `<Dialog>` (which traps focus) on `< lg`. Stepper: on `< sm` breakpoints, show a compact "Step X of 4" header with a progress bar instead of the full `StepperList`. Vehicle cards: single column on mobile, 2-col on `sm`, 3-col on `lg`.

---

## 2. All User Scenarios

### Scenario 1: Happy Path — Guest Checkout

**Actor:** First-time visitor, no account.

1. Lands on `/` — sees the hero with `HeroSearch` form.
2. Enters location (autocomplete from `/locations` API), pickup date, return date. Clicks "Search Available Cars".
3. Redirected to `/search?pickup=LAX&dropoff=LAX&from=2026-07-01&to=2026-07-05`.
4. Sees vehicle class cards sorted by price (ascending default). Clicks "Select" on Midsize.
5. Redirected to `/booking/MCAR?pickup=LAX&from=2026-07-01&to=2026-07-05`.
6. **Step 0 — Extras:** Reviews optional add-ons, selects CDW and GPS. Clicks "Continue".
7. **Step 1 — Driver Info:** Enters First Name, Last Name, Email, Phone, DOB, DL Number, DL State. Clicks "Continue".
8. **Step 2 — Rate Summary:** Reviews itemized quote. Sees subtotal, extras, taxes, total. Enters payment card via Stripe Payment Element. Clicks "Confirm Booking".
9. **Step 3 — Confirmation (inline):** Sees confirmation number. Redirected to `/confirmation/RCM-20260701-XXXX`.
10. Receives confirmation email with manage link: `/manage/{token}`.

**Success criteria:** Confirmation number displayed, email received, reservation in `CONFIRMED` status.

---

### Scenario 2: Account User — Saved Cards and Loyalty Points

**Actor:** Returning customer with account, saved Visa ending in 4242, 1,200 loyalty points.

1. Lands on `/`, sees "Sign In" in nav. Clicks it → `/login`.
2. Signs in via password or magic link.
3. Returns to `/` (redirect from login). Completes search.
4. Booking wizard Step 2 (Rate Summary): Payment section pre-populates with saved card. Option to "Use a different card".
5. "Discounts & Loyalty" section shows: "1,200 points available (worth $12.00). Redeem [input] points."
6. User enters 1,200 points, clicks Apply. Rate summary updates: line item "Loyalty Redemption: -$12.00". Total decreases by $12.
7. Confirms booking with saved card (no re-entry of card details). Stripe charges the net amount.

**Success criteria:** Loyalty discount applied, saved card charged for net amount.

---

### Scenario 3: Return Customer with Saved Profile

**Actor:** Logged-in user with saved name, address, and DL on file.

1. Completes search, selects vehicle, proceeds to Driver Info step.
2. Form pre-fills all fields from saved profile (from `/auth/me` response).
3. User reviews, makes no changes. Clicks "Continue".
4. Rate Summary loads with loyalty and saved card already applied.

**Success criteria:** Zero typing required in Driver Info step for a returning user.

---

### Scenario 4: One-Way Rental

**Actor:** Guest, flying into LA, wants to drop off in San Francisco.

1. On `HeroSearch`, toggles "Return to a different location". Second field "Drop-off location" appears.
2. Enters pickup: LAX, drop-off: SFO, dates.
3. Search results: Each vehicle card shows a "One-way fee: $75" badge.
4. Booking wizard Rate Summary: line item "One-way drop-off fee: $75.00".

**Success criteria:** Different pickup/dropoff locations accepted; one-way fee disclosed at all stages.

---

### Scenario 5: Airport Pickup with Flight Number

**Actor:** Guest, LAX is an airport-tagged location.

1. Selects LAX as pickup location. HeroSearch reveals "Flight Number (optional)" field below dates.
2. User enters "AA1234". Light validation passes.
3. Booking confirmation email states: "We'll track your flight. We'll hold your vehicle for 2 hours after actual arrival."
4. If user leaves flight number blank: confirmation email states "Vehicle held for 30 minutes from scheduled pickup time."

**Success criteria:** Flight number stored in reservation; grace period communicated correctly.

---

### Scenario 6: Young Driver — Age Under 25

**Actor:** 22-year-old renter.

1. In Driver Info step, enters DOB. On blur, system computes age = 22.
2. Inline warning appears: "Young driver surcharge: $25.00/day will be added to your total."
3. Rate quote automatically re-fetches with `dob` param. Rate Summary shows: "Young Driver Surcharge: $125.00 (5 days)".

**Success criteria:** Surcharge disclosed inline at point of data entry; total correctly updated before payment.

---

### Scenario 7: Corporate Account

**Actor:** Enterprise customer with corporate code "ACME2026".

1. Proceeds normally through search and vehicle selection.
2. In Rate Summary step, expands "Discounts & Loyalty" accordion.
3. Enters "ACME2026" in Corporate Code field, clicks "Apply".
4. Rate quote re-fetches with `corporate_code: "ACME2026"`. Rate changes from Rack to Corporate pricing.
5. Line items update. Badge on rate summary: "Corporate rate applied."

**Success criteria:** Corporate rate applied; original rack rate not shown (prevents confusion).

---

### Scenario 8: Promo/Coupon Code

**Actor:** Guest with code "SUMMER20" for 20% off.

1. In Rate Summary step, expands "Discounts & Loyalty".
2. Enters "SUMMER20", clicks "Apply".
3. Rate quote updates: "Promotional discount: -$40.00".
4. Code is invalid (expired): inline error "This code is expired or invalid."

**Success criteria:** Valid code applies discount; invalid code shows error without breaking the form.

---

### Scenario 9: Modify Existing Reservation

**Actor:** Logged-in user or guest with manage token.

1. Navigates to `/manage/{token}`.
2. Reservation shows current dates, class, extras, total.
3. Clicks "Modify Dates". Dialog opens with current dates pre-filled.
4. User changes return date from Jul 5 to Jul 7 (2 extra days).
5. Dialog shows: Old total $320, New total $448, Difference: +$128.
6. Stripe Payment Element appears for the $128 delta.
7. User confirms. API: `PATCH /reservations/{id}` with new dates + paymentIntentId.
8. Dialog closes. Manage page refreshes with updated dates and total.
9. If new dates are within 24h of pickup: "Modifications are no longer accepted within 24 hours of pickup."

**Success criteria:** Modification possible > 48h out; fee disclosed 24–48h window; blocked < 24h.

---

### Scenario 10: Cancel Reservation — Free Window

**Actor:** Any user on `/manage/{token}`, pickup > 24 hours away.

1. Clicks "Cancel Booking". Confirmation dialog appears.
2. Dialog shows: "Free cancellation: no fee applies. Your reservation will be cancelled."
3. User clicks "Yes, Cancel". `DELETE /reservations/{id}` called.
4. Page shows cancellation confirmed state. Email sent.

---

### Scenario 11: Cancel Reservation — Cancellation Fee

**Actor:** User cancelling within fee window (e.g. 12 hours before pickup).

1. Clicks "Cancel Booking". Dialog shows: "A cancellation fee of $50.00 applies. You will be refunded $270.00."
2. Two buttons: "Keep my booking" (safe default, outlined) and "Cancel and pay fee" (destructive).
3. User confirms. API handles fee capture and partial refund.

**Success criteria:** Fee clearly disclosed; user cannot accidentally cancel without seeing the fee.

---

### Scenario 12: Sold-Out Vehicle Class

**Actor:** Guest searching for a compact car, which is sold out.

1. Results page shows "Economy" card with "Sold out" badge, sorted to bottom.
2. Card has "Notify me" button (not "Select").
3. Clicking "Notify me" reveals inline form: email input + "Alert me" button.
4. If a Midsize class is available and priced higher, it shows badge: "Popular upgrade from Economy".

**Success criteria:** Sold-out class does not block booking; waitlist capture works; upgrade is suggested.

---

### Scenario 13: Payment Failure — Retry Flow

**Actor:** Guest at Payment step, card declined.

1. Stripe returns `card_declined` error.
2. Error message appears below the Payment Element: "Your card was declined. Please check your card details or try a different card."
3. Payment Element remains active (user can edit card details or switch to a different card).
4. "Confirm Booking" button re-enables after user modifies the payment method.
5. New PaymentIntent is created automatically by Stripe when user re-enters a card.

**Success criteria:** No duplicate reservation created on decline; user can retry without restarting wizard.

---

### Scenario 14: 3D Secure (SCA) Redirect

**Actor:** European customer whose bank requires 3DS authentication.

1. `stripe.confirmPayment()` returns `{ error: null, paymentIntent: { status: 'requires_action' } }`.
2. Stripe handles the popup/redirect automatically (the Payment Element manages this).
3. On return from 3DS, the `confirmPayment` promise resolves. If authentication succeeded, proceed to create reservation. If failed, show error.

**Success criteria:** 3DS handled transparently; user returns to the booking flow in the correct step.

---

### Scenario 15: Session Timeout During Booking

**Actor:** Logged-in user, JWT expires during Rate Summary step (30 min inactivity).

1. User clicks "Confirm Booking". API returns `401 Unauthorized`.
2. A modal appears: "Your session expired. Sign in again — your booking details are saved."
3. Modal contains "Sign In" button → navigates to `/login?redirect=/booking/MCAR?...`.
4. After successful sign-in, `bookingDraftStore` (from localStorage) restores the wizard at Step 2.
5. Rate quote is re-fetched to get a fresh quote (quotes expire in 60s client-side).

**Success criteria:** No data loss; user resumes at the same step; no stale quote used.

---

### Scenario 16: Guest Returns — Look Up Reservation

**Actor:** Guest who lost their confirmation email, wants to manage their booking.

1. Nav has "Manage Booking" link → `/manage`.
2. `/manage` page (no token) shows a form: "Enter your confirmation number and email address."
3. Submitting calls `POST /manage/lookup` with `{ confirmation_number, email }`.
4. On success, server issues a manage token and redirects to `/manage/{token}`.
5. On failure (wrong email): "No reservation found with that confirmation number and email."

**Success criteria:** Token-free manage lookup works; email verification prevents unauthorized access.

---

### Scenario 17: Vehicle Upgrade at Results

**Actor:** Guest on search results page.

1. Economy class is available but user sees Midsize for only $5/day more.
2. Each card prominently shows total-trip price ("$80 for 4 days") as well as daily rate.
3. User clicks "Select" on Midsize — proceeds to booking for that class.

**Success criteria:** Total-trip pricing visible on card; easy to compare and upgrade.

---

### Scenario 18: Mobile — Responsive Booking Flow

**Actor:** User on an iPhone 14 (375px viewport).

1. Home hero: location input + date inputs stack vertically. "Search" button full width.
2. Results: single-column card grid. "Filters" floating button at bottom-right reveals filter drawer.
3. Booking wizard: stepper collapses to "Step 2 of 4 — Driver Details" header with progress bar.
4. Rate Summary: Stripe Payment Element is responsive by default; full-width on mobile.
5. All tap targets >= 44x44px.

**Success criteria:** Full booking flow completable on a 375px viewport without horizontal scrolling.

---

## 3. Page-by-Page UX Design Spec

---

### Page 1: Home — `/`

**File:** `apps/web-booking/app/page.tsx` + `app/components/HeroSearch.tsx`

#### Purpose
Primary acquisition page. Convert visitors to search and begin the booking funnel. Trust-building through tagline and social proof.

#### Above the Fold
- Full-viewport-height hero section
- Gradient background: `from-primary/10 via-background to-secondary/20` (as existing)
- Centered content column, max-width 4xl
- H1: "Find Your Perfect **Rental Car**" (accent color on "Rental Car")
- Subtitle: "Search availability, compare classes, and book in minutes. Transparent pricing — no hidden fees."
- Search widget card (`bg-card`, `rounded-2xl`, `shadow-lg`)

#### Below the Fold
- Feature strip: "Instant Confirmation", "Free Cancellation", "No Hidden Fees"
- Trust signals strip: SSL badge, 24/7 support phone number, free cancellation banner
- Popular locations section (SSR-rendered, no hydration needed)
- Footer: links to Privacy Policy, Terms, Support

#### HeroSearch Form — Fields and Validation

| Field | Type | Required | Validation | Notes |
|---|---|---|---|---|
| Pickup Location | `text` + autocomplete | Yes | Non-empty, must match a location from `/locations` | Debounced autocomplete dropdown (300ms), min 2 chars to trigger |
| Drop-off Location | `text` + autocomplete | Only if one-way toggle active | Same as pickup | Hidden by default (D-02) |
| "Return to different location" toggle | `button` with `aria-expanded` | — | — | Reveals drop-off field (D-02) |
| Pickup Date | `input type="date"` | Yes | >= today | Native date picker |
| Return Date | `input type="date"` | Yes | > pickup date | `min` set dynamically to pickup date |
| Pickup Time | `select` | No | Valid time slot | Defaults to "10:00 AM". Times in 30-minute increments 6am–10pm |
| Return Time | `select` | No | Valid time slot | Defaults to "10:00 AM" |
| Flight Number | `text` | No | `/^[A-Z]{2,3}\d{1,4}$/i` | Only visible when pickup location `is_airport: true` (D-03) |
| Driver Age confirmation | `checkbox` | No | — | "I confirm the primary driver is 25 or older" — unchecking reveals age surcharge notice (D-04) |

**Existing gap:** Current `HeroSearch.tsx` has 3 fields (location, from, to). Missing: time pickers, one-way toggle, flight number, driver age hint. These must be added.

#### Form States

- **Default:** Empty form, "Search Available Cars" button enabled (client-side validation runs on submit only).
- **Loading locations autocomplete:** Spinner in dropdown, "Searching locations…" text.
- **No autocomplete results:** "No matching locations found. Try a city, airport code, or address."
- **Submitting:** Button shows "Searching…" with spinner. Navigates to `/search` on success.
- **Validation error:** Inline error messages below each invalid field using `role="alert" aria-live="polite"` (already implemented for the three base fields).

#### Navigation
- Nav bar (new component needed): Logo left, "Sign In" / "My Account" right, "Manage Booking" link.
- No breadcrumbs on home.

#### URL Params Emitted
```
/search?pickup={locationId}&dropoff={locationId}&from={YYYY-MM-DD}&to={YYYY-MM-DD}&pickupTime={HH:mm}&returnTime={HH:mm}&flight={code}
```

#### Key UX Decisions (D-02, D-03, D-04)
- One-way toggle is a progressive disclosure pattern to keep form minimal.
- Flight number appears contextually — only for airport locations.
- Time pickers use `<select>` (not a custom picker) for accessibility and mobile compatibility.

---

### Page 2: Search Results — `/search`

**File:** `apps/web-booking/app/search/page.tsx` + `app/search/SearchResults.tsx`

#### Purpose
Display available vehicle classes, allow filtering and sorting, surface upsell (upgrade, add-ons preview). Convert looker to booker.

#### Above the Fold (Desktop)
- Compact "Edit Search" bar pinned to the top (sticky header)
  - Shows current search params (location, dates, duration)
  - "Edit" button opens HeroSearch form in a dropdown overlay
- Results count: "X vehicle classes available"
- Two-column layout: narrow filter sidebar left (on `lg:`), vehicle card grid right

#### Above the Fold (Mobile)
- Sticky compact search summary bar
- "Filters" button (bottom-right FAB or top-right icon)
- Full-width single-column card grid

#### Filters Panel

| Filter | Type | Options |
|---|---|---|
| Vehicle Class | Multi-checkbox | Economy, Compact, Midsize, Full-Size, SUV, Luxury, Van, Electric |
| Features | Multi-checkbox | Automatic, Manual, A/C, Bluetooth, Apple CarPlay, Android Auto |
| Fuel Type | Multi-checkbox | Gasoline, Electric (BEV), Hybrid, PHEV |
| Max Daily Rate | Range slider | $0–$500, increments of $10 |
| Passenger Capacity | Select | 2+, 4+, 5+, 7+, 9+ |

- "Clear all filters" link resets to defaults.
- Applied filter count badge on the "Filters" button on mobile.
- Filters update results in real-time (no "Apply" button needed — use `useDeferredValue` for performance).

#### Sort Options (Dropdown)
- Price: Low to High (default)
- Price: High to Low
- Most Popular
- Passenger Capacity: Most Seats First
- Alphabetical by Class Name

#### Vehicle Class Card

Each card (existing `VehicleClassCard` component, needs enhancement):

**Above the card fold:**
- Vehicle image (16:9 aspect ratio, `object-cover`)
- If no image: placeholder with class code initials

**Card header:**
- Class code (e.g. "MCAR") in `text-xs uppercase muted`
- Class name (e.g. "Midsize Car") in `text-xl font-bold`
- Availability badge:
  - `> 2 units:` No badge
  - `1–2 units:` Warning badge "Only X left"
  - `0 units:` Destructive badge "Sold out"
  - Upgrade suggestion: Info badge "Popular upgrade from Economy" (D-08)

**Card body:**
- Feature list (up to 4, check icon) — already implemented
- One-way fee badge if `pickup != dropoff` (D-02)
- Example vehicle makes (e.g. "Toyota Camry or similar") — comes from API

**Card footer:**
- Daily rate: `$XX.XX/day` in `text-2xl font-bold`
- Trip total: `$XXX total` in `text-sm muted` (computed: rate × days)
- "Taxes & fees not included" in `text-xs muted`
- Select button: primary variant; disabled + "Sold out" text if unavailable
- "Notify me" button (secondary): shown instead of Select when unavailable (D-08)

**URL on select:**
```
/booking/{classId}?pickup={locationId}&dropoff={locationId}&from={date}&to={date}&pickupTime={time}&returnTime={time}&flight={code}
```
All search params propagate.

#### Interactive States

| State | UI |
|---|---|
| Loading | `SearchSkeleton` (6 cards, 3-col grid) — already implemented |
| Error | Error alert with "Try again" button — already implemented |
| Empty (no params) | "Enter location and dates" prompt — already implemented |
| No results | "No cars available" with "Modify search" link — already implemented |
| No results after filtering | "No vehicles match your filters. Clear filters to see all available cars." |
| Partial load | Show loaded cards, skeleton for remaining |

#### Navigation
- Breadcrumb: Home > Search Results
- Back button returns to `/` (browser back).
- Forward: selecting a card navigates to `/booking/[id]`.

---

### Page 3: Booking Wizard — `/booking/[id]`

**File:** `apps/web-booking/app/booking/[id]/page.tsx`

#### Purpose
Guide the user through a 4-step funnel: extras → driver info → rate review + payment → inline confirmation. Minimize drop-off at each step.

#### Layout
- Max-width 3xl, centered.
- Left column (main, 2/3 width on desktop): active step content.
- Right column (sidebar, 1/3 width on desktop): sticky price summary (always visible). On mobile: sticky footer price bar.
- Stepper at top: 4 steps horizontally (desktop), compact progress bar on mobile.

#### Sticky Price Summary Sidebar / Mobile Footer Bar
- Vehicle class name + image thumbnail
- Pickup/return location + dates + duration
- Base rate: `$XX.XX/day × N days = $XXX.XX`
- Selected extras: listed with amounts
- Young driver surcharge (if applicable)
- Promo/corporate discount (if applied)
- Subtotal before taxes
- Taxes and fees (itemized after quote loads)
- **Total: $XXX.XX** (large, bold)
- "Prices include all mandatory fees. Taxes calculated at booking."
- Free cancellation banner: "Free cancellation until [date]"

The sidebar updates live as extras are selected/deselected and as the rate quote refreshes. Uses `useRateQuote` with a 60s staleTime and debounced re-trigger on extras changes.

---

#### Step 0 — Vehicle & Extras

**Purpose:** Confirm vehicle selection and upsell optional add-ons.

**Above the fold:**
- Selected vehicle summary card: image, class name, features (from search result)
- Upgrade option (if a higher class has availability within +30% price): "Upgrade to Full-Size for +$8/day. [Switch]" as a subtle callout.

**Extras section:**
- Heading: "Optional Extras"
- Each extra renders as a full-width checkbox card (existing pattern in booking page)

| Extra | Code | Description | Price | Note |
|---|---|---|---|---|
| Collision Damage Waiver | CDW | Reduces your liability in case of damage | $19.99/day | Most popular |
| GPS Navigation | GPS | In-car GPS device | $7.99/day | — |
| Child Safety Seat | CSS | Infant, toddler, or booster (specify) | $9.99/day | Shows sub-select for seat type when checked |
| Personal Accident Insurance | PAI | Covers medical costs for driver + passengers | $4.99/day | — |
| Roadside Assistance | RSN | 24/7 emergency roadside help | $3.99/day | — |
| Additional Driver | ADD | Add a second authorized driver | $12.99/day | Reveals additional driver fields in Step 1 |
| Prepaid Fuel | FUEL | Return the car on empty | $45.00 flat | Flat fee, not per-day |

**"Most Popular" badge:** CDW gets this badge. Implemented with `variant="info"` badge on the card.

**Extras running total:** Updates immediately based on local calculation while `useRateQuote` fetches. Shows "Updating…" spinner on the total when quote is fetching.

**Navigation:**
- "Continue to Driver Details" button → validates nothing required; always advances.
- Back: "< Back to Results" link (navigates to `/search` with same params).

---

#### Step 1 — Driver Info

**Purpose:** Collect the minimum data needed to create the reservation.

**Sections:**

**Primary Driver** (always shown):

| Field | Input Type | Required | Validation | Autocomplete |
|---|---|---|---|---|
| First Name | `text` | Yes | min 1 char, max 50, no digits | `given-name` |
| Last Name | `text` | Yes | min 1 char, max 50 | `family-name` |
| Email | `email` | Yes | Zod `z.string().email()` | `email` |
| Phone | `tel` | No | E.164 loosely validated `/^\+?[\d\s\-().]{7,15}$/` | `tel` |
| Date of Birth | `date` | Yes | Must be >= 18 years ago (cannot rent under 18); triggers young driver surcharge warning if age < 25 (D-04) | `bday` |
| Driver License Number | `text` | No (required for check-out by counter agent) | Alphanumeric, 5–20 chars | off |
| License State/Province | `select` | If DL number provided | US states + CA provinces | off |
| License Country | `select` | If DL number provided | ISO country list | off |
| License Expiry | `date` | No | Must be in future | off |

**Young driver inline notice** (appears when DOB results in age < 25):
```
⚠ Young driver surcharge: $25.00/day applies for renters under 25.
   This has been added to your rate summary.
```
Color: `bg-yellow-50 border-yellow-300 text-yellow-800` (light mode) / `bg-yellow-900/20 border-yellow-700 text-yellow-300` (dark mode).

**Additional Driver section** (only if "Additional Driver" extra was selected in Step 0):
- Same fields as Primary Driver
- Heading: "Additional Driver"
- Additional driver DL fields are required if the extra is selected.

**Account Creation Opt-In** (guest only, non-blocking):
```
[ ] Save my details for faster booking next time
    Create a free account with your email above.
```
If checked, `POST /auth/register` is called with the driver data after reservation creation (not blocking the booking flow).

**Loyalty Account** (guest only):
```
Already have a loyalty account? Enter your number:
[ loyalty number input ] 
```
If entered, loyalty points are fetched and applied in Step 2.

**"I am not the driver" notice** (checkbox):
```
[ ] I am booking on behalf of another person
```
If checked, shows a "Booker" section (just email for receipt) and the Driver fields remain for the actual driver.

**Navigation:**
- Back: returns to Step 0.
- "Continue to Rate Summary": triggers full Zod validation. If invalid, scrolls to first error.

---

#### Step 2 — Rate Summary & Payment

**Purpose:** Final price transparency check and PCI-compliant payment capture.

**Rate Summary Table:**

| Line Item Type | Display |
|---|---|
| Base rental (`base`) | "Midsize Car — 5 days @ $64.00/day: $320.00" |
| Extra (`extra`) | "GPS Navigation — 5 days @ $7.99/day: $39.95" |
| Young driver surcharge (`surcharge`) | "Young Driver Surcharge — 5 days @ $25.00/day: $125.00" |
| One-way fee (`fee`) | "One-way drop-off fee: $75.00" |
| Promo discount (`discount`) | "SUMMER20 (20% off): -$64.00" (green text) |
| Corporate rate savings (`discount`) | Shown as difference from rack rate |
| Airport concession fee (`fee`) | Shown if applicable |
| State/local taxes (`tax`) | Itemized by jurisdiction |
| **Total** | Bold, large, separated by divider |

Uses existing `quote.line_items[]` from `useRateQuote`. While loading: 5 skeleton rows.

**Discounts & Loyalty accordion** (collapsed by default, D-07):
- "Promo/Coupon Code" — text input + "Apply" button
- "Corporate Account Code" — text input + "Apply" button
- "Loyalty Points" — input (max = available balance) + "Redeem" button (authenticated users only)

**Payment Section:**
```html
<section aria-label="Payment">
  <h3>Payment</h3>
  <!-- Lock icon + "Secured by Stripe" badge -->
  <div id="stripe-payment-element">
    <Elements stripe={stripePromise} options={elementsOptions}>
      <PaymentElement 
        options={{ 
          layout: 'tabs',
          paymentMethodOrder: ['card', 'apple_pay', 'google_pay'],
          wallets: { applePay: 'auto', googlePay: 'auto' }
        }}
      />
    </Elements>
  </div>
  <!-- Billing address section (if required by Stripe radar rules) -->
</section>
```

**Trust signal below payment form:**
- SSL padlock icon + "256-bit SSL encryption"
- "Your card details are handled securely by Stripe and never stored on our servers."
- Stripe logo

**Terms consent:**
```
By confirming, you agree to our Terms of Service and Rental Agreement.
Free cancellation until [date]. After that, cancellation fees apply.
```

**"Confirm Booking" button:**
- Enabled once `paymentElement` is complete (Stripe fires `ready` event).
- Loading state: "Processing payment…" with spinner, `aria-busy="true"`.
- On success: navigates to `/confirmation/{confirmationNumber}`.

**Payment error handling (D-05, Scenario 13):**

| Stripe Error Code | User-Facing Message |
|---|---|
| `card_declined` | "Your card was declined. Please check your details or use a different card." |
| `insufficient_funds` | "Your card has insufficient funds. Please use a different card." |
| `expired_card` | "Your card has expired. Please enter a new card." |
| `incorrect_cvc` | "The security code is incorrect. Please try again." |
| `processing_error` | "There was a processing error. Please wait a moment and try again." |
| `requires_action` | Handled silently by Stripe (3DS popup) |
| Generic API error | "Booking failed. Your card has not been charged. Please try again." |

Error appears as `role="alert" aria-live="assertive"` below the payment form, above the confirm button.

**Navigation:**
- Back: returns to Step 1.
- "Confirm Booking": submits.

---

#### Step 3 — Inline Confirmation

**Purpose:** Immediately acknowledge the successful booking and reduce anxiety.

This step is shown inline within the wizard (before redirecting to `/confirmation/{num}`) for speed. The page then redirects to `/confirmation/{confirmationNumber}` after 2 seconds, or immediately on "View Confirmation" button click.

**Content:**
- Large green checkmark icon (accessible via `aria-hidden="true"`, success state announced via `role="status"`)
- "Booking Confirmed!" heading
- "Confirmation #RCM-20260701-XXXX" in large monospace display
- "A confirmation email has been sent to {email}"
- "We'll hold your vehicle until [pickup_time + grace_period]"
- Quick actions:
  - "View Full Confirmation" → `/confirmation/{num}`
  - "Manage My Booking" → `/manage/{token}`
  - "Book Another Car" → `/`

---

### Page 4: Confirmation — `/confirmation/[confirmationNumber]`

**File:** `apps/web-booking/app/confirmation/[confirmationNumber]/page.tsx` + `ConfirmationDetails.tsx`

#### Purpose
Shareable, bookmarkable confirmation page. Serves as both post-booking receipt and the destination for the "view confirmation" link in emails. Fetches live reservation data on load.

#### Layout
- Max-width 2xl, centered.
- Single-column layout.

#### Sections

**1. Success Header (already implemented)**
- Green circle with checkmark
- "Booking Confirmed"
- Confirmation #

**2. Reservation Card (enhance existing)**
- Class name + status badge
- Pickup location, date, and time
- Drop-off location, date, and time
- Duration ("5 days")
- Primary driver name + email
- Add additional driver info if `additionalDriver` on reservation
- Extras list (each with name and total cost)
- Rate summary (collapsed accordion "View full pricing breakdown")
- **Total charged** (prominent)

**3. Pickup Instructions**
- Location name, address, map embed (Google Maps static image or Mapbox)
- Counter hours
- "What to bring:" bullet list:
  - Valid driver's license (and additional driver's license if applicable)
  - Credit card in the primary driver's name
  - Confirmation number: `{num}`
  - If airport pickup: your boarding pass

**4. Action Buttons (existing, enhance)**
- "Manage Booking" → `/manage/{token}`
- "Download Receipt (PDF)" → `{invoice_url}` (external)
- "Add to Calendar" → ICS download (already implemented)
- "Share" → Web Share API (`navigator.share`) with fallback to copy-to-clipboard

**5. Account Creation CTA** (guests only, D-01)
```
Save time next time — create a free account with your booking details.
[Create Account]   (no thanks — link)
```
Clicking "Create Account" pre-fills registration with the driver's name and email.

**6. Waitlist Confirmation** (if user joined waitlist, not main booking flow)
- "You're on the waitlist for Economy class."
- "We'll email {email} if a vehicle becomes available."

#### States

| State | UI |
|---|---|
| Loading | Skeleton card with animated pulses (already implemented) |
| Success | Full confirmation layout as above |
| Reservation not found | Error card: "We couldn't find this reservation." + "Back to Home" |
| Cancelled reservation | Status badge `CANCELLED`. Message: "This reservation was cancelled on {date}." |

---

### Page 5: Login/Register — `/login`

**File:** `apps/web-booking/app/login/page.tsx`

#### Purpose
Allow existing customers to sign in and optionally create accounts. Must never be a forced gate — always offer "Continue as guest" path.

#### Layout
- Centered card, max-width md.
- No sidebar.

#### Tabs (already implemented: Password / Magic Link)
Enhance with a third tab: Register.

**Tab 1: Password Sign-In** (already implemented)
- Email, Password, Sign In button, error state.
- Add: "Forgot Password?" link → `POST /auth/forgot-password` → email with reset link.

**Tab 2: Magic Link** (already implemented)
- Email, Send Magic Link button.
- Post-send: "Check your email" state (already implemented).

**Tab 3: Register** (new)

| Field | Validation |
|---|---|
| First Name | Required, 1–50 chars |
| Last Name | Required, 1–50 chars |
| Email | Required, Zod email |
| Password | Required, min 8 chars, must contain 1 uppercase, 1 digit, 1 special char |
| Confirm Password | Must match password |

- After successful registration → redirect to `/` (or to `redirect` query param if set).
- "By creating an account, you agree to our Terms and Privacy Policy." (links required)

**Google Sign-In** (already implemented as stub)
- Must implement actual OAuth flow: `GET /api/v1/auth/google` → Google consent → callback → cookie set → redirect.

**"Continue as Guest" link** (already implemented as "Book as guest → /")
- This link should appear prominently, not be hidden in the card footer.
- Move to: a `<p>` above the card with "Don't need an account? **Book as guest**".

#### Query Params
- `?redirect={url}` — after sign-in, redirect to this URL (used by session timeout flow, D-06).
- `?prefill_email={email}` — pre-fills the email field (used when offering account creation from confirmation page, D-01).
- `?tab=register` — opens directly on the Register tab (used from "Create Account" CTA on confirmation page).

#### Accessibility
- Tab panels use `role="tabpanel"` with `aria-labelledby`.
- Password field has show/hide toggle (`type="text"` toggle) with `aria-label="Show/hide password"`.
- All minimum touch targets 44x44px.

---

### Page 6: My Account — `/account`

**File:** `apps/web-booking/app/account/page.tsx` (new file — does not exist yet)

**Route:** Protected. Redirect to `/login?redirect=/account` if unauthenticated.

#### Purpose
Central hub for authenticated customers: view past and upcoming reservations, manage profile, manage saved payment methods, view loyalty balance.

#### Layout
- Two-column on desktop: sidebar nav left, content right.
- Single-column on mobile with tab nav.

#### Sidebar/Tab Nav Items
1. My Reservations (default view)
2. Profile & Preferences
3. Payment Methods
4. Loyalty & Rewards
5. Sign Out

---

#### Section: My Reservations

**Upcoming Reservations:**
- List of reservations in `CONFIRMED` / `PENDING` status.
- Each row: class name, pickup date → return date, location, status badge, "Manage" link → `/manage/{token}`.
- "Modify" / "Cancel" quick actions inline.
- Empty state: "No upcoming reservations. Ready to book?" with search CTA.

**Past Reservations:**
- Reservations in `CLOSED` / `RETURNED` / `CANCELLED` status.
- Paginated, 10 per page.
- Each row: class name, dates, location, total, "Download Receipt" link.
- "Book again" button: pre-fills search with same location and similar dates (+1 year).

---

#### Section: Profile & Preferences

Form fields (all pre-filled from `/auth/me`):

| Field | Validation |
|---|---|
| First Name | Required |
| Last Name | Required |
| Email | Required, read-only (requires separate email-change flow) |
| Phone | E.164 format |
| Date of Birth | Date, must be >= 18 years ago |
| Driver License Number | Optional |
| License State | Optional |
| License Country | Optional |
| License Expiry | Optional, must be in future |
| Preferred Language | Select (en, es, fr, de) |
| Email Notifications | Checkbox group: Booking confirmations (mandatory), Promotional offers, Loyalty updates |
| SMS Notifications | Toggle |

Save button: calls `PATCH /auth/me` with changed fields only. Shows success toast on save.

**Change Password:**
- "Change Password" link → opens a dialog with Current Password, New Password, Confirm New Password.

---

#### Section: Payment Methods

- List of saved payment methods from Stripe (via `GET /payments/methods`).
- Each card shows: card brand icon, "•••• 4242", expiry, "Default" badge if default.
- Actions: "Make Default", "Remove" (with confirmation dialog).
- "Add New Card" button → opens Stripe `SetupIntent` flow using `<PaymentElement mode="setup">`.
- Warning when removing last card: "You won't be able to use saved cards at checkout without at least one card on file."

PCI note: no raw card data stored; all card management via Stripe Customer API.

---

#### Section: Loyalty & Rewards

- Current balance: "1,250 points ($12.50 value)"
- Points expiry date (if applicable)
- How points are earned: "Earn 1 point per $1 spent on base rental. Points expire after 24 months of inactivity."
- Tier status: "Silver Member" with progress to next tier.
- Points history table: Date, Description (reservation #), Points earned/redeemed.
- "How to redeem" info box linking to terms.

---

### Page 7: Manage Reservation — `/manage/[token]`

**File:** `apps/web-booking/app/manage/[token]/page.tsx` (substantially implemented)

#### Purpose
Allow any user (guest or authenticated) to view, modify, or cancel a reservation without requiring account login. The token is a time-limited signed JWT (or UUID) sent in the confirmation email.

#### Token Validity
- Token valid for 30 days from reservation creation (configurable server-side).
- After token expiry: show "This link has expired" state with "Look up your booking" button → `/manage` (lookup form).

#### Layout (enhance existing)
- Max-width 2xl, centered.
- Single-column.

#### Sections (enhance existing implementation)

**1. Reservation Summary** (exists, enhance)
- Add: pickup and drop-off addresses (not just dates)
- Add: extras list with per-item costs
- Add: full rate summary (collapsed by default)
- Add: "What to bring" section (same as confirmation page)
- Add: map embed for pickup location

**2. Modification Section** (currently stubbed as disabled — D-09)
- Button: "Modify Dates" (shown if `can_modify: true`)
- Opens Dialog:
  - Date range picker, pre-filled with current dates
  - Min date: today; max date: 2 years
  - On date change: `useRateQuote` fires immediately → shows "Calculating new price…" skeleton
  - Price comparison: Old Total vs. New Total vs. Difference
  - If difference > $0: Stripe Payment Element for delta amount
  - If difference < $0: "Credit of $X will be applied to your original payment method within 5–7 business days."
  - "Confirm Modification" button → `PATCH /reservations/{id}`
  - Error states: "Modifications closed within 24 hours of pickup", "New dates unavailable"

**3. Cancellation Section** (exists, enhance)
- "Cancel Booking" button → Dialog (existing implementation)
- Enhance dialog to show cancellation fee if applicable (D-11):
  - Fee window: shows fee amount and net refund
  - Free window: "No fee applies"
- After cancellation: show "A refund of $X will appear within 5–7 business days." (update existing generic message)

**4. Add to Calendar / Download Receipt** (partially exists — enhance)
- ICS download (existing)
- PDF receipt download (exists if `invoice_url` present)
- "Email me a new manage link" button (if user suspects their link expired or was deleted)

#### States

| State | UI |
|---|---|
| Loading | Skeleton card (existing) |
| Valid token, active reservation | Full management UI |
| Valid token, cancelled reservation | Summary + "Rebook" CTA |
| Expired token | "This link has expired" + lookup form |
| Invalid token | "Access denied" + support link |

#### `/manage` (no token) — Lookup Form (new page)

**File:** `apps/web-booking/app/manage/page.tsx` (new)

- Heading: "Find Your Reservation"
- Form: Confirmation Number (text), Email Address (email)
- Submit: calls `POST /manage/lookup` → redirects to `/manage/{token}` on success
- Error: "No reservation found. Please check your confirmation number and email."
- "Check your email" hint if the user thinks they might have another email address

---

## 4. Design System Notes

### Color Palette (Dark Theme)

The portal inherits the monorepo's Tailwind preset and CSS custom properties. The design brief specifies:

```css
/* Raw CSS vars (to be set in globals.css for dark theme) */
--page-bg: #080b14;        /* maps to: background */
--accent: #8b5cf6;          /* maps to: primary (violet-500) */
--text-1: #e2e8f0;          /* maps to: foreground */
--card-bg: #111729;         /* maps to: card */
--border: #1c2438;          /* maps to: border */
```

**Full HSL mapping for `globals.css`:**
```css
:root {
  --background: 224 52% 6%;        /* #080b14 */
  --foreground: 214 32% 91%;       /* #e2e8f0 */
  --card: 224 41% 12%;             /* #111729 */
  --card-foreground: 214 32% 91%;
  --primary: 263 70% 65%;          /* #8b5cf6 violet-500 */
  --primary-foreground: 0 0% 100%;
  --secondary: 224 35% 18%;
  --secondary-foreground: 214 32% 91%;
  --muted: 224 35% 15%;
  --muted-foreground: 215 20% 55%;
  --border: 224 38% 17%;           /* #1c2438 */
  --input: 224 38% 17%;
  --ring: 263 70% 65%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --radius: 0.5rem;
}
```

**Status / semantic colors** (from preset, use in portal):
- `status.available` (#22c55e) — available badge
- `status.onRent` (#3b82f6) — checked out badge
- `status.maintenance` (#f59e0b) — warning states
- `status.damage` (#ef4444) — error, destructive actions
- `status.admin` (#8b5cf6) — accent, primary

### Typography Scale

Based on Inter font (already in preset):

| Token | Size | Weight | Use |
|---|---|---|---|
| `text-4xl font-bold` | 36px/700 | H1 hero |
| `text-3xl font-bold` | 30px/700 | Page H1 |
| `text-2xl font-bold` | 24px/700 | Section heading, price total |
| `text-xl font-semibold` | 20px/600 | Card title, vehicle class name |
| `text-lg font-medium` | 18px/500 | Sub-heading |
| `text-base` | 16px/400 | Body, labels |
| `text-sm` | 14px/400 | Helper text, secondary info |
| `text-xs` | 12px/400 | Badges, micro-copy, "per day" suffix |
| `font-mono` | — | Confirmation number (`tracking-wider`) |

Confirmation number specifically: `text-3xl font-bold tracking-wider font-mono` for easy reading/copying.

### Component Patterns

**Vehicle Card:**
- `<Card>` with `rounded-lg border bg-card shadow-sm`
- Hover: `hover:shadow-md hover:border-primary/40 transition-all duration-200`
- Selected state (when applicable): `border-primary bg-primary/5`
- Unavailable: `opacity-60 cursor-not-allowed`

**Badge variants** (extend existing `badge.tsx`):

| Variant | Color | Usage |
|---|---|---|
| `default` | muted | Neutral statuses |
| `success` | green-600 | CONFIRMED, active |
| `warning` | amber-500 | Low availability, young driver notice |
| `destructive` | red-600 | Sold out, cancelled |
| `info` | blue-500 | Upgrade suggestion, one-way fee |
| `outline` | border color | Generic label |

**Step Wizard:**
- Uses existing `StepperRoot / StepperList / StepperItem / StepperContent` from `@rcm/ui`
- On `< sm` breakpoints: hide `StepperList`, show instead:
  ```html
  <div class="flex items-center gap-3 mb-6 sm:hidden">
    <span class="text-sm font-medium text-muted-foreground">Step {n} of 4</span>
    <span class="font-semibold">{stepLabel}</span>
    <div class="ml-auto h-1.5 flex-1 rounded-full bg-muted">
      <div class="h-full rounded-full bg-primary" style="width: {n/4*100}%"></div>
    </div>
  </div>
  ```

**Date Picker:**
- Use native `<input type="date">` for accessibility and mobile (already in HeroSearch).
- Do not use a custom date picker library — the native control is keyboard-navigable, mobile-native, and screen-reader-friendly.
- Set `min` and `max` attributes dynamically.
- Style with `appearance-none` + Tailwind to match dark theme.

**Trust Signal Strip:**
```
[ 🔒 SSL Secured ] [ 24/7 Support: 1-800-RCM-RENT ] [ Free Cancellation ]
```
- Shown at: bottom of HeroSearch widget, above the payment form in Step 2, below the confirm button in Step 2.
- Component: `<TrustSignals />` — simple flex row with icons and short text.

**Location Autocomplete:**
- Debounced `useQuery` hook: `useLocations({ q: inputValue })` — calls `GET /locations?q={q}&limit=8`.
- Dropdown: `<Popover>` anchored to input, keyboard-navigable with `role="listbox"`.
- Each option: `role="option"`, location name + type badge (AIRPORT, CITY, HOTEL).
- Airport options: plane icon prefix.
- Loading state: "Searching…" with spinner.
- No results: "No locations found for '{q}'.".

### Trust Signals

**SSL Badge:** Show on every page with payment-related content. SVG padlock + "Secured by SSL".

**Free Cancellation Banner:**
- Green banner at top of `/search` results: "Free cancellation on all bookings made today. Cancel up to 24 hours before pickup."
- Also in sticky price summary on booking wizard.

**24/7 Support:**
- Always visible in footer and in nav bar.
- "Need help? Call 1-800-RCM-RENT or chat with us."

---

## 5. State Management Plan

### What Goes in Zustand

**`bookingDraftStore`** — persisted to `localStorage` (never includes payment data):

```typescript
interface BookingDraft {
  // Search context
  classId: string | null
  pickupLocationId: string | null
  dropoffLocationId: string | null
  pickupDate: string | null        // YYYY-MM-DD
  returnDate: string | null        // YYYY-MM-DD
  pickupTime: string | null        // HH:mm
  returnTime: string | null        // HH:mm
  flightNumber: string | null

  // Wizard state
  activeStep: number               // 0–3
  selectedExtras: string[]         // array of extra codes

  // Driver info (safe to persist, no PCI data)
  driverData: {
    firstName: string
    lastName: string
    email: string
    phone: string
    dob: string                    // YYYY-MM-DD
    dlNumber: string
    dlState: string
    dlCountry: string
    dlExpiry: string
  } | null

  additionalDriver: DriverData | null

  // Discount codes
  promoCode: string | null
  corporateCode: string | null
  loyaltyPointsToRedeem: number

  // Actions
  setClassId: (id: string) => void
  setSearchContext: (ctx: SearchContext) => void
  setStep: (step: number) => void
  toggleExtra: (code: string) => void
  setDriverData: (data: DriverData) => void
  setPromoCode: (code: string | null) => void
  setCorporateCode: (code: string | null) => void
  setLoyaltyPoints: (pts: number) => void
  resetDraft: () => void
}
```

Persistence middleware: `zustand/middleware/persist` with `name: 'rcm-booking-draft'`.

**`userSessionStore`** — NOT persisted (in-memory only, derived from JWT):

```typescript
interface UserSession {
  isAuthenticated: boolean
  userId: string | null
  email: string | null
  firstName: string | null
  loyaltyBalance: number           // points
  savedPaymentMethods: PaymentMethod[]
  isLoading: boolean
}
```

This store is hydrated on app mount from `useCurrentUser()` (TanStack Query). It is not directly stored in Zustand — it's a derived view of the TanStack Query cache. Use `useCurrentUser()` directly in components. Do not duplicate.

**`searchFiltersStore`** — NOT persisted (session only):

```typescript
interface SearchFilters {
  vehicleClasses: string[]
  features: string[]
  fuelTypes: string[]
  maxDailyRate: number
  minPassengers: number
  sortBy: 'price_asc' | 'price_desc' | 'popular' | 'seats_desc' | 'alpha'
  
  setFilter: <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => void
  resetFilters: () => void
}
```

---

### What Goes in URL Search Params

These must be in the URL so the browser back button works and pages can be bookmarked/shared:

**`/search` page:**
```
?pickup={locationId}&dropoff={locationId}&from={YYYY-MM-DD}&to={YYYY-MM-DD}&pickupTime={HH:mm}&returnTime={HH:mm}&flight={code}
```

**`/booking/[id]` page:**
```
?pickup={locationId}&dropoff={locationId}&from={YYYY-MM-DD}&to={YYYY-MM-DD}&pickupTime={HH:mm}&returnTime={HH:mm}&flight={code}
```

The `classId` is in the dynamic segment `[id]`. The wizard step is in `bookingDraftStore` (not URL, to prevent the user accidentally going back and losing their payment state).

Note: Do NOT put the step number in the URL for the booking wizard. URL-based step navigation causes issues with the payment flow (Stripe confirmPayment cannot be re-called from a URL change). Stepper state lives in Zustand only.

---

### What Uses React Local State (`useState`)

- Dialog open/close state (`cancelDialogOpen`, `modifyDialogOpen`)
- Form submit loading state (when not using React Hook Form's `isSubmitting`)
- Autocomplete dropdown open state
- Tab switcher active tab (on `/login`)
- Filter panel open state on mobile
- Stripe Payment Element ready state (`paymentElementReady`)
- Payment error message string (local to the payment step component)
- Magic link sent state (already implemented)
- Inline promo/corporate code apply result messages

---

### TanStack Query Usage

| Query | Key | staleTime | refetchInterval | Notes |
|---|---|---|---|---|
| Availability | `['fleet', 'availability', params]` | 25s | 30s | Auto-poll to show real-time availability |
| Rate Quote | `['pricing', 'quote', params]` | 60s | — | Re-fires when extras/codes change (debounced 500ms) |
| Current User | `['auth', 'me']` | Infinity | — | Invalidated on logout |
| Locations | `['locations', q]` | 5min | — | Autocomplete cache |
| Managed Reservation | `['managed', token]` | 0 | — | Always fresh on manage page |
| My Reservations | `['reservations', { userId }]` | 30s | — | Account page list |
| Payment Methods | `['payments', 'methods']` | 5min | — | Account page |
| Loyalty Balance | Derived from `['auth', 'me']` | — | — | Part of user profile |

---

## 6. Edge Case Inventory

Each entry describes the trigger condition, the required UI state, and the component responsible.

### Search Form (`HeroSearch`)

| ID | Trigger | UI State | Component |
|---|---|---|---|
| EC-001 | Return date before pickup date | Inline error on return date field | `HeroSearch` |
| EC-002 | Pickup date is today's date | Warning: "Same-day bookings may have limited availability" | `HeroSearch` |
| EC-003 | Pickup date more than 12 months in future | Warning: "Availability this far out is not guaranteed" | `HeroSearch` |
| EC-004 | Pickup == dropoff location but one-way toggle is on | Error: "Pickup and drop-off locations must be different for one-way rental" | `HeroSearch` |
| EC-005 | Flight number entered for non-airport location | Field is hidden — cannot trigger. If toggle race: ignore field value | `HeroSearch` |
| EC-006 | Locations API is down | Autocomplete shows error inline: "Location search unavailable. Please type your location manually." | `LocationAutocomplete` |

### Search Results (`/search`)

| ID | Trigger | UI State | Component |
|---|---|---|---|
| EC-007 | All vehicle classes sold out | Full empty state: "No vehicles available. Try different dates or locations." + "Modify Search" | `SearchResults` |
| EC-008 | Specific class sold out, others available | Sold-out cards at bottom, "Notify me" button, upgrade suggestion badge | `VehicleClassCard` |
| EC-009 | Availability API error | Error alert + "Try again" button (already implemented) | `SearchResults` |
| EC-010 | User applies filters that result in zero matches | "No vehicles match your filters. [Clear filters]" — show all-available count | `SearchResults` |
| EC-011 | Availability changes between search and card click | User selects a class, redirects to booking; booking page immediately re-fetches quote. If class is now unavailable, show error in booking page: "Sorry, this vehicle class just became unavailable. [Return to results]" | `BookingPage` |
| EC-012 | Rental duration is 1 day | All pricing shows "/day" and no "× N days" (or shows "× 1 day") | `VehicleClassCard` |
| EC-013 | Rental duration is 28+ days | "Monthly rate may apply. Pricing shown is daily rate only." info badge | `VehicleClassCard` |

### Booking Wizard

| ID | Trigger | UI State | Component |
|---|---|---|---|
| EC-014 | Rate quote fails to load in Step 2 | "Rate information temporarily unavailable. Your total will be confirmed at pickup." Disable confirm button. Show "Retry" button. | `RateSummaryStep` |
| EC-015 | Rate quote changes between Step 0 and Step 2 (extras added, price updated) | No alert needed — the sidebar always shows current quote. Prices are confirmed at Step 2 explicitly. | Sidebar |
| EC-016 | DOB entered results in age < 18 | "You must be at least 18 years old to rent a vehicle." Error state, prevent advance. | `DriverInfoStep` |
| EC-017 | DOB results in age < 25 | Yellow inline surcharge notice (D-04). Non-blocking — user can proceed. | `DriverInfoStep` |
| EC-018 | DL expiry is in the past | Warning: "Your license appears to be expired. Please ensure you have a valid license at pickup." Non-blocking. | `DriverInfoStep` |
| EC-019 | Promo code invalid | Inline error below code field: "Code is not valid or has expired." | `DiscountsAccordion` |
| EC-020 | Promo code not combinable with corporate code | "Promo codes cannot be combined with corporate rates." Clear one or the other. | `DiscountsAccordion` |
| EC-021 | Corporate code invalid or not authorized | "Corporate code not recognized. Check with your company's travel manager." | `DiscountsAccordion` |
| EC-022 | Loyalty points redemption exceeds available balance | Input capped at available balance. If user enters more via keyboard: auto-correct to max. | `DiscountsAccordion` |
| EC-023 | Payment card declined (Stripe) | Error below payment form (see payment error table in Page 3 spec). Retry in place. | `PaymentStep` |
| EC-024 | 3DS authentication fails | "Payment authentication failed. Please try a different card." | `PaymentStep` |
| EC-025 | Stripe.js fails to load | "Payment form unavailable. Please refresh the page or contact support." Fall back to phone booking option. | `PaymentStep` |
| EC-026 | API `POST /reservations` fails after Stripe success | "Your payment was processed but we couldn't confirm your booking. Please contact support with reference: {paymentIntentId}." Do NOT retry automatically — prevents double-charge. | `PaymentStep` |
| EC-027 | Session timeout during booking (D-06) | Session expired modal. Re-auth redirect with `redirect` param. Draft persisted in localStorage. | `SessionGuard` |
| EC-028 | User navigates browser back from Step 3 | Cannot re-submit — booking already created. Show: "Your booking is already confirmed. Confirmation #{num}" | `BookingPage` |
| EC-029 | One-way rental, drop-off location has no inventory for the class | Show class as unavailable for one-way. Suggest round-trip or different drop-off. | `SearchResults` |
| EC-030 | Booking wizard opened directly (no search context) | No search params → redirect to `/` with error toast: "Please start your search from the home page." | `BookingPage` |

### Confirmation Page

| ID | Trigger | UI State | Component |
|---|---|---|---|
| EC-031 | Confirmation number not found | Error card: "Reservation not found" (already implemented) | `ConfirmationDetails` |
| EC-032 | Reservation in CANCELLED status | Show cancelled state: "This reservation was cancelled." No action buttons except "Book again". | `ConfirmationDetails` |
| EC-033 | PDF invoice not yet generated | "Download Receipt" button hidden. "Your invoice will be available within 24 hours." | `ConfirmationDetails` |
| EC-034 | User visits confirmation page days later (via email link) | Same as normal — data fetched fresh. Long-lived page. | `ConfirmationDetails` |

### Manage Reservation Page

| ID | Trigger | UI State | Component |
|---|---|---|---|
| EC-035 | Token expired (> 30 days) | "This link has expired. Look up your booking." → `/manage` form | `ManageContent` |
| EC-036 | Token invalid (tampered) | "Access denied. This link is invalid." + support contact | `ManageContent` |
| EC-037 | `can_modify: false` (< 24h to pickup) | "Modify Dates" button hidden. Notice: "Modifications are no longer accepted within 24 hours of pickup." | `ManageContent` |
| EC-038 | `can_cancel: false` (reservation in CHECKED_OUT status) | "Cancel Booking" button hidden. "Your vehicle is already checked out. Contact us to return early." | `ManageContent` |
| EC-039 | Modification → new dates unavailable | Dialog error: "The dates you selected are unavailable for this vehicle class. Please try different dates." | `ModifyDatesDialog` |
| EC-040 | Modification → price delta payment fails | "We couldn't charge the difference. Your booking has not been modified." Stay in dialog, allow retry. | `ModifyDatesDialog` |
| EC-041 | Cancellation fails (API error) | "Cancellation failed. Please try again or contact support." (already partially implemented) | `ManageContent` |
| EC-042 | Reservation in NO_SHOW status | "This reservation was marked as no-show. Contact support if this is an error." | `ManageContent` |
| EC-043 | Lookup form — wrong email submitted | "No reservation found with that confirmation number and email." (rate-limit after 5 attempts) | `ManageLookupPage` |

### Authentication

| ID | Trigger | UI State | Component |
|---|---|---|---|
| EC-044 | Login with wrong credentials | "Email or password is incorrect." (already implemented) | `LoginPage` |
| EC-045 | Magic link expired | "This link has expired. Request a new one." + magic link form | `MagicLinkCallback` |
| EC-046 | Account with email already exists (registration) | "An account with this email already exists. Sign in instead." + switch to Login tab | `RegisterForm` |
| EC-047 | Registration email already in use (guest who booked then tried to register) | Same as EC-046 + "Link this booking to your account" CTA | `RegisterForm` |
| EC-048 | Google OAuth error | "Sign-in with Google failed. Please try email and password." | `LoginPage` |
| EC-049 | User is a DNR (Do Not Rent) customer | After authentication, any booking attempt returns 403. Show: "We're unable to complete this booking. Please contact our support team." — do not reveal DNR status explicitly. | `BookingPage` |

### General / Cross-Page

| ID | Trigger | UI State | Component |
|---|---|---|---|
| EC-050 | User with no loyalty account tries to enter loyalty number | If number not found: "Loyalty account not found. Would you like to create one?" | `LoyaltyInput` |
| EC-051 | API returns unexpected 500 | Generic error boundary: "Something went wrong. Please refresh the page." + error ID for support reference. | `ErrorBoundary` |
| EC-052 | User offline (navigator.onLine = false) | Toast: "You appear to be offline. Please check your connection." Disable form submissions. | `OfflineBanner` |
| EC-053 | Duplicate booking attempt (same user, same dates, same class) | Warning dialog: "You already have a booking for this class on these dates. Continue anyway?" | `BookingPage` |
| EC-054 | Promo code applied, user changes dates (changing total) | Rate re-fetches automatically with the promo code still applied. If code is no longer valid for new dates, show error. | `RateSummaryStep` |
| EC-055 | Class image fails to load | Show class code initials in a colored placeholder div. `onError` handler sets `showPlaceholder: true`. | `VehicleClassCard` |

---

## 7. API Contract Assumptions

The following endpoints are assumed to exist or need to be created, based on the existing `packages/api-client` hooks and the scenarios above. Gaps flagged for backend team.

### Existing (used in current code)
- `GET /fleet/availability?pickup_location_id&dropoff_location_id&pickup_date&dropoff_date` → `AvailabilityResponse`
- `POST /pricing/quote` (body: `RateQuoteRequest`) → `RateQuoteResponse`
- `POST /reservations` (body: `ReservationCreate`) → `ReservationResponse`
- `GET /manage/{token}` → `ManagedReservation`
- `DELETE /reservations/{reservationId}`
- `GET /auth/me` → `UserProfile`
- `POST /auth/login`
- `POST /auth/magic-link`

### New Endpoints Needed

| Method | Path | Purpose | Priority |
|---|---|---|---|
| `GET` | `/locations?q={q}&limit={n}` | Location autocomplete | P0 |
| `POST` | `/manage/lookup` | Guest reservation lookup by confirmation + email | P0 |
| `PATCH` | `/reservations/{id}` | Modify reservation dates | P0 |
| `POST` | `/waitlist` | Join waitlist for sold-out class | P1 |
| `POST` | `/auth/register` | Create account | P0 |
| `POST` | `/auth/forgot-password` | Trigger password reset email | P1 |
| `GET` | `/reservations?status=CONFIRMED,PENDING` | My upcoming reservations | P0 |
| `GET` | `/reservations?status=CLOSED,RETURNED,CANCELLED` | My past reservations | P0 |
| `GET` | `/payments/methods` | List saved Stripe payment methods | P0 |
| `POST` | `/payments/methods/setup-intent` | Create Stripe SetupIntent for saving a card | P0 |
| `DELETE` | `/payments/methods/{id}` | Remove saved payment method | P1 |
| `PATCH` | `/payments/methods/{id}/default` | Set default payment method | P1 |
| `GET` | `/loyalty/balance` | Get loyalty points balance (or include in /auth/me) | P1 |
| `GET` | `/loyalty/history` | Loyalty points history | P2 |
| `PATCH` | `/auth/me` | Update profile | P0 |
| `POST` | `/auth/change-password` | Change password (authenticated) | P1 |
| `POST` | `/auth/google` | Initiate Google OAuth | P1 |

### RateQuoteRequest — Required Extensions

The current `RateQuoteRequest` schema needs these additional fields:

```typescript
{
  // existing
  pickup_location_id: string
  pickup_date: string
  dropoff_date: string
  dropoff_location_id?: string  // for one-way
  class_code: string
  extras?: string[]

  // new — needed for correct pricing
  dob?: string                  // YYYY-MM-DD, triggers young driver surcharge
  promo_code?: string
  corporate_code?: string
  loyalty_points_to_redeem?: number
  flight_number?: string        // for airport grace period calculation
}
```

### RateQuoteResponse — Required Line Item Types

The `line_items` array must support these `type` values for the UI to render correctly:

```typescript
type LineItemType = 
  | 'base'          // base rental
  | 'extra'         // optional add-on
  | 'surcharge'     // young driver, etc.
  | 'fee'           // one-way, airport concession, etc.
  | 'discount'      // promo, corporate, loyalty
  | 'tax'           // jurisdiction taxes
```

### ReservationCreate — Required Extensions

```typescript
{
  // existing
  pickup_location_id: string
  pickup_date: string
  dropoff_date: string
  class_code: string
  extras?: string[]
  customer: DriverData

  // new
  dropoff_location_id?: string
  pickup_time?: string            // HH:mm
  dropoff_time?: string           // HH:mm
  flight_number?: string
  corporate_code?: string
  promo_code?: string
  loyalty_points_to_redeem?: number
  payment_intent_id: string       // REQUIRED — Stripe PaymentIntent ID
  additional_driver?: DriverData
  save_profile?: boolean          // guest opt-in to create account
}
```

---

## Implementation Notes for Dev Agents

### Agent 1 — Home Page and HeroSearch Enhancement
Focus files:
- `apps/web-booking/app/page.tsx`
- `apps/web-booking/app/components/HeroSearch.tsx`
- New: `apps/web-booking/app/components/LocationAutocomplete.tsx`
- New: `apps/web-booking/app/components/TrustSignals.tsx`
- New: `apps/web-booking/app/components/NavBar.tsx`

Key work: Add one-way toggle, time selectors, flight number field, location autocomplete, NavBar component.

### Agent 2 — Search Results Enhancements
Focus files:
- `apps/web-booking/app/search/page.tsx`
- `apps/web-booking/app/search/SearchResults.tsx`
- New: `apps/web-booking/app/search/FilterPanel.tsx`
- New: `apps/web-booking/app/search/SortDropdown.tsx`

Key work: Add filter panel, sort dropdown, mobile filter drawer, upgrade badge, waitlist button, total-trip pricing on cards.

### Agent 3 — Booking Wizard Completion
Focus files:
- `apps/web-booking/app/booking/[id]/page.tsx`
- New: `apps/web-booking/app/booking/[id]/ExtrasStep.tsx`
- New: `apps/web-booking/app/booking/[id]/DriverInfoStep.tsx`
- New: `apps/web-booking/app/booking/[id]/RateSummaryStep.tsx`
- New: `apps/web-booking/app/booking/[id]/PaymentStep.tsx`
- New: `apps/web-booking/app/booking/[id]/PriceSummarySidebar.tsx`
- New: `apps/web-booking/app/booking/[id]/DiscountsAccordion.tsx`

Key work: Refactor current monolith into step components, add Stripe integration, DOB + surcharge logic, promo/corporate code accordion, price summary sidebar, young driver notice.

### Agent 4 — Account, Confirmation, and Manage Enhancements
Focus files:
- `apps/web-booking/app/confirmation/[confirmationNumber]/ConfirmationDetails.tsx`
- `apps/web-booking/app/manage/[token]/page.tsx`
- New: `apps/web-booking/app/manage/page.tsx` (lookup form)
- New: `apps/web-booking/app/account/page.tsx`
- New: `apps/web-booking/app/account/ReservationsSection.tsx`
- New: `apps/web-booking/app/account/ProfileSection.tsx`
- New: `apps/web-booking/app/account/PaymentMethodsSection.tsx`
- New: `apps/web-booking/app/account/LoyaltySection.tsx`

Key work: Enhance confirmation page with pickup instructions, calendar/share actions; implement full Manage page modify flow; build My Account sections.

### Agent 5 — State, Auth, and Cross-Cutting Concerns
Focus files:
- New: `apps/web-booking/lib/stores/bookingDraftStore.ts`
- New: `apps/web-booking/lib/stores/searchFiltersStore.ts`
- `apps/web-booking/app/login/page.tsx` (add Register tab, forgot password)
- New: `apps/web-booking/app/components/ErrorBoundary.tsx`
- New: `apps/web-booking/app/components/OfflineBanner.tsx`
- New: `apps/web-booking/app/components/SessionGuard.tsx`

Key work: Implement Zustand stores with persist middleware, add Register tab and forgot password to login, implement session timeout detection and recovery modal, error boundary, offline banner.

---

*End of RCM Customer Portal UX Specification v1.0*
*Workshop date: 2026-06-16 | Next review: Prior to Sprint 1 kickoff*
