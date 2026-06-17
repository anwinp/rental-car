# Customer Portal — Feature Backlog

App: `apps/web-booking` · Port: 3400 · Framework: Next.js 14 App Router
Design system: "cosmos" dark theme — CSS vars `--p-surface`, `--p-brand` (#da291c red), `--p-text-1/2/3/4`, `--p-border`, `--p-success`

---

## TIER 1 — Critical (blocks production launch)

### CP-01 · Signup + Password Reset
**Why:** Login page exists but "Create account" links to `/`. No way to register.
**API:** `POST /customers` (create customer record) + `POST /auth/request-password-reset` + `POST /auth/reset-password`
**Pages:**
- `app/signup/page.tsx` — full registration form (name, email, phone, password, DOB)
- `app/forgot-password/page.tsx` — email entry → "check your email" state
- `app/reset-password/page.tsx` — token + new password form
**Wire:** Add "Create account" and "Forgot password?" links to login page
**Status:** TODO

---

### CP-02 · Pickup / Dropoff Time Selectors
**Why:** Times hardcoded to 10:00 in `bookingDraftStore.ts`. Customers can't choose pickup/return time.
**Scope:**
- Add time select dropdowns to `HeroSearch.tsx` (30-min increments, 07:00–22:00)
- Wire `pickup_time` / `return_time` through to `/search` URL params
- Use them in rate quote API call (`pickup_datetime`, `return_datetime`)
- Update booking wizard step 3 (payment) to show correct times
**Status:** TODO

---

### CP-03 · Cancellation Policy Visibility
**Why:** Policy nowhere shown before payment. Users abandon at checkout.
**Scope:**
- On search results vehicle card: show "Free cancellation" badge if policy applies
- On booking step 3 (payment): show policy summary card — "Cancel free until [date]" or fee tier
- On confirmation page: reinforce cancellation window
- Probe `GET /pricing/quote` response for `cancellation_policy` field; fall back to hardcoded tiers if absent
**Status:** TODO

---

### CP-04 · Vehicle Photo Gallery
**Why:** Single static image per class. Real booking portals show 4–8 photos.
**Scope:**
- Add photo carousel component to search result cards (swipeable on mobile)
- Add full lightbox on vehicle detail expand
- Probe `GET /fleet/classes` for `images` or `photo_urls` field
- Fall back to per-class placeholder gallery (3–5 generated images by class name) if no API photos
- Show interior + exterior + key feature shots in placeholder set
**Status:** TODO

---

### CP-05 · One-Way Rental Toggle
**Why:** `one_way` param exists in store but no UI. Revenue opportunity for airport routes.
**Scope:**
- Add "Return to different location" toggle in `HeroSearch.tsx`
- When toggled: show second location picker for dropoff
- Pass `one_way=true` and separate `dropoff` location to search
- Show "One-Way" badge on search results when active
- Warn about one-way fee in checkout if applicable
**Status:** TODO

---

## TIER 2 — High priority (Sprint 1)

### CP-06 · Account Profile Management
**Why:** Account page is read-only. Customers can't update their details.
**API:** `PATCH /customers/{id}` · `POST /auth/change-password`
**Scope:**
- Edit profile form: first name, last name, email, phone
- Change password form (current + new + confirm)
- Saved driver license info (pre-fills booking form)
- Notification preferences (email marketing opt-in)
**Page:** Enhance `app/account/page.tsx` with tabbed drawer (Profile / Security / Preferences)
**Status:** TODO

---

### CP-07 · Loyalty Program UX
**Why:** Tier and points visible but static (hardcoded 1,240). No earn/redeem logic shown.
**Scope:**
- Fetch real loyalty data from customer profile API
- Show tier progression bar ("X more rentals to reach Silver")
- Tier benefits table (Bronze / Silver / Gold perks)
- Point earning display: "This booking earns 234 points"
- Redemption option: "Use 500 points for $10 off" toggle in checkout
- Point history list in account page
**Status:** TODO

---

### CP-08 · Insurance & Extras Enhancement
**Why:** Only 5 extras, all optional. Missing fuel option and insurance tiers.
**Scope:**
- Add "Fuel Prepay" extra (pre-purchase full tank, avoid pump stop)
- Add insurance tier upgrade path: CDW (existing) vs. Full Protection (CDW + glass + tires + liability)
- Add "declining insurance" acknowledgement checkbox if customer removes all coverage
- Show what each extra covers (expandable detail panel per extra)
- Bundle suggestion: "CDW + GPS + RSA for $X/day" combo badge
**Status:** TODO

---

### CP-09 · Promo Code UI
**Why:** `promoCode` field exists in Zustand store but no UI anywhere.
**Scope:**
- Add promo code input to booking checkout step 3 (payment) with "Apply" button
- Call pricing API to validate code and show discount
- Show applied discount line in price breakdown
- Error state for invalid codes
**Status:** TODO

---

### CP-10 · Support & Help Center
**Why:** Footer links for Contact, FAQ, Policy all point to `/`. No actual support pages.
**Scope:**
- `app/support/page.tsx` — FAQ accordion (top 10 questions from rental ops), contact form
- `app/policies/cancellation/page.tsx` — full cancellation policy tiers table
- `app/policies/rental-terms/page.tsx` — rental agreement terms summary
- `app/policies/privacy/page.tsx` — privacy policy (GDPR/CCPA)
- Wire footer links to real pages
**Status:** TODO

---

## TIER 3 — Extended Experience (Sprint 2+)

### CP-11 · Post-Rental Survey & Reviews
**Why:** No feedback loop. Customer satisfaction untracked.
**Scope:**
- Survey page linked from return confirmation email
- Star rating + comment per rental
- Show aggregate ratings on vehicle class cards in search
**Status:** TODO

---

### CP-12 · Reservation Extension
**Why:** No way to add days to an active rental from the portal.
**API:** `PATCH /reservations/{id}` (existing endpoint)
**Scope:**
- "Extend Rental" action in My Reservations (CHECKED_OUT status only)
- Date picker for new return date
- Price difference preview
- Confirm + update reservation
**Status:** TODO

---

### CP-13 · Referral Program
**Why:** Growth lever. Loyalty hooks exist but no referral mechanics.
**Scope:**
- Unique referral link per logged-in customer
- "Invite friends" page with copy-link and social share
- Referee gets 10% off first rental; referrer gets 500 loyalty points
- Track referral count in account dashboard
**Status:** TODO

---

### CP-14 · Apple Pay / Google Pay
**Why:** Mobile conversion rate dramatically higher with wallet payment.
**Scope:**
- Stripe Payment Request Button (wraps both Apple Pay + Google Pay)
- Show wallet buttons above card form in payment step
- Handle payment intent creation on backend
**Status:** TODO

---

### CP-15 · Interactive Location Map
**Why:** Location picker is text-only. Map view improves findability.
**Scope:**
- Embedded map (Mapbox or Google Maps) on search/home showing all locations
- Click pin → navigate to search with that location pre-selected
- Distance from current location shown on each pin
**Status:** TODO

---

## Implementation Order

| ID | Feature | Impact | Effort | Status |
|----|---------|--------|--------|--------|
| CP-01 | Signup + Password Reset | Conversion | M | TODO |
| CP-02 | Time Selectors | Core UX | S | TODO |
| CP-03 | Cancellation Policy Visibility | Trust/Conversion | S | TODO |
| CP-04 | Vehicle Photo Gallery | Conversion | M | TODO |
| CP-05 | One-Way Rental Toggle | Revenue | S | TODO |
| CP-06 | Account Profile Management | Retention | M | TODO |
| CP-07 | Loyalty Program UX | Engagement | M | TODO |
| CP-08 | Insurance & Extras Enhancement | Revenue | S | TODO |
| CP-09 | Promo Code UI | Revenue | S | TODO |
| CP-10 | Support & Help Center | Support Cost | M | TODO |
| CP-11 | Post-Rental Survey | Quality | M | TODO |
| CP-12 | Reservation Extension | Revenue | S | TODO |
| CP-13 | Referral Program | Growth | L | TODO |
| CP-14 | Apple Pay / Google Pay | Conversion | M | TODO |
| CP-15 | Interactive Location Map | Discovery | L | TODO |
