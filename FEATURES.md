# Rental Car Management System — Comprehensive Feature Specification

> **Research basis:** Four-agent research team covering (1) open-source landscape, (2) fleet & inventory management, (3) reservations & customer management, (4) payments & billing. Cross-referenced against commercial platforms: TSD, RentWorks, Rent Centric, HQ Rental Software, Navotar, ERPNext, Odoo, and industry standards (OTA Alliance, SIPP/ACRISS, ISO 3779).
>
> **Consensus methodology:** Features listed here appear in at least two research streams or are documented industry standards. Contested or optional features are marked.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Fleet & Inventory Management](#2-fleet--inventory-management)
3. [Reservation & Booking Engine](#3-reservation--booking-engine)
4. [Rate & Pricing Engine](#4-rate--pricing-engine)
5. [Customer & Identity Management](#5-customer--identity-management)
6. [Counter Operations](#6-counter-operations)
7. [Extras & Ancillaries](#7-extras--ancillaries)
8. [Payments & Billing](#8-payments--billing)
9. [Damage & Claims Management](#9-damage--claims-management)
10. [Maintenance Management](#10-maintenance-management)
11. [Telematics & GPS Integration](#11-telematics--gps-integration)
12. [Corporate Account Management](#12-corporate-account-management)
13. [Loyalty & Rewards Program](#13-loyalty--rewards-program)
14. [Channel Management & OTA Integration](#14-channel-management--ota-integration)
15. [Toll, Fine & Violation Processing](#15-toll-fine--violation-processing)
16. [Multi-Location & Fleet Operations](#16-multi-location--fleet-operations)
17. [EV Fleet Management](#17-ev-fleet-management)
18. [Reporting & Analytics](#18-reporting--analytics)
19. [Compliance & Document Management](#19-compliance--document-management)
20. [Mobile Applications](#20-mobile-applications)
21. [Admin, Configuration & Security](#21-admin-configuration--security)
22. [Integration Architecture](#22-integration-architecture)
23. [Data Model Overview](#23-data-model-overview)
24. [Technology Stack Recommendation](#24-technology-stack-recommendation)
25. [Gap Analysis vs. Open Source](#25-gap-analysis-vs-open-source)

---

## 1. System Overview

### 1.1 What This System Does

An end-to-end rental car management system covers every workflow from the moment a customer searches for a vehicle to final invoice settlement — and everything in between: fleet acquisition, maintenance, availability management, multi-channel booking, counter check-out/check-in, payments, damage claims, compliance, and reporting.

### 1.2 User Roles

| Role | Description |
|---|---|
| Customer (B2C) | Books vehicles via web/mobile; manages own reservations |
| Corporate Booker | Books on behalf of company account; subject to travel policy |
| Counter Agent | Handles walk-in and reservation check-out/check-in |
| Fleet Manager | Manages vehicle inventory, maintenance, rebalancing |
| Maintenance Technician | Logs service work orders |
| Branch Manager | Oversees daily operations at one location |
| Regional Manager | Manages multiple locations; views aggregated reporting |
| Finance / AR | Manages invoicing, collections, accounting integration |
| System Administrator | Configures rates, policies, user permissions |
| API / Channel Partner | External OTA, insurance company, or corporate travel portal |

### 1.3 Core Domain Entities

```
Customers → Reservations → Rental Agreements → Invoices → Payments
                ↓                  ↓
            Vehicles          Inspections → Damage Claims
                ↓
         Maintenance Orders
```

### 1.4 Key Industry Standards Implemented

- **SIPP/ACRISS** — 4-character vehicle classification codes (position 1: category, 2: type, 3: transmission/drive, 4: fuel/AC)
- **ISO 3779** — VIN format and checksum validation (17-character)
- **OTA Alliance XML schemas** — OTA_VehAvailRateRQ/RS, OTA_VehResRQ/RS for OTA/GDS connectivity
- **OCPP 1.6/2.0.1** — Open Charge Point Protocol for EV charger management
- **MCC 7512** — Merchant category code for automobile rental (unlocks extended pre-auth windows)
- **PCI DSS** — Payment card data security (tokenization required; no raw card storage)

---

## 2. Fleet & Inventory Management

### 2.1 Vehicle Record

Every vehicle in the fleet has a master record containing:

**Identity**
- VIN (17-char, ISO 3779 checksum validated)
- License plate + issuing jurisdiction + expiry
- Title number and state
- Fleet number (operator-assigned, printed on key tags)
- Unit number (short counter code)

**Specifications**
- Make, model, trim level, model year
- Body style, exterior/interior color (with manufacturer color code)
- Transmission type (Automatic, Manual, CVT, DCT)
- Drive type (FWD, RWD, AWD, 4WD)
- Engine displacement, cylinder count
- Fuel type (Gasoline, Diesel, Hybrid, PHEV, BEV, Hydrogen)
- Fuel tank capacity (gallons) or battery capacity (kWh for EVs)
- EPA/WLTP MPG or range ratings
- Doors, seats, luggage capacity (large bags / small bags), cargo volume
- Towing capacity, wheelbase

**Classification**
- SIPP code (4-character, auto-assigned from specs)
- Vehicle class (maps to reservation class: Economy, Compact, Midsize, Standard, Fullsize, Premium, Luxury, Economy SUV, Compact SUV, Midsize SUV, Fullsize SUV, Minivan, Pickup, Convertible, Specialty/Exotic)
- Vehicle pool assignment (logical grouping for upgrade/substitution)

**Operational**
- Home location and current location
- Status: Available, On Rent, In Maintenance, Staging, In Transit, Awaiting Disposal, Disposed
- Current odometer and unit (miles/km)
- Current fuel level %
- In-service date

**Financial**
- Acquisition cost, residual value, current book value
- Depreciation method (Straight-Line, Units of Production, MACRS)
- Monthly depreciation amount
- Fleet type (Owned, Leased, Program Car, Courtesy)
- Lease reference (if leased)

**EV-Specific**
- Battery capacity (kWh), rated range (miles)
- Charge port type (CCS, CHAdeMO, J1772, NACS)
- On-board charger power (AC), DC fast charge rate
- Live state of charge % (from telematics)
- Charging status (Idle, Charging AC, Charging DC, Full, Fault)

**Media**
- Photos by type: Exterior (4 angles), Interior (front/rear), Dashboard, Trunk, Damage
- Marketing thumbnail for booking engine

### 2.2 Vehicle Catalog & Pool Management

- **SIPP-to-Pool mapping**: multiple SIPP codes can satisfy one reservation class (e.g., ECMR and EDMR both satisfy Economy class)
- **Upgrade matrix**: pre-configured table of which class can substitute for which, and whether upgrades are automatic or require manager approval
- **Pool hierarchy**: Economy → Compact → Midsize → Standard → Fullsize (each level can serve levels below in an upgrade scenario)
- **Overbooking buffer**: configurable % of fleet withheld from online booking for walk-up or upgrade use

### 2.3 Fleet Availability Matrix

- Per-vehicle block calendar with typed blocks:
  - `Reservation` — confirmed rental window
  - `TurnAround` — post-return cleaning + inspection buffer (configurable by class/location, typically 60–120 min)
  - `Maintenance` — scheduled or unscheduled repair hold
  - `RecallHold` — safety recall hard block (cannot be overridden)
  - `InTransit` — vehicle being transferred between locations
  - `Hold` — manager-placed discretionary hold
  - `Inspection` — extended post-return inspection (damage discovered)
  - `Staging` — newly delivered vehicle pending activation
- **Hard vs. soft blocks**: hard blocks (recalls, active maintenance) cannot be overridden; soft blocks can be removed by authorized managers
- **Class-level availability cache**: aggregated available count per class per location per time slot (hourly or 30-min buckets), recomputed on reservation events
- **Safety buffer**: configurable % per class withheld from online availability
- Turnaround buffer: shorter for same-day same-location turns, configurable per vehicle class

### 2.4 Vehicle Lifecycle Management

**Acquisition**
- Purchase order / lease agreement record
- Vendor (dealer/manufacturer/auction) reference
- Expected and actual delivery date
- Negotiated price, manufacturer incentives, net cost
- Program car type (Retail, Fleet Direct, Program Car, Loaner Return)
- Program buy-back date and guaranteed buy-back price (for program cars)
- Delivery inspection form: all keys, manuals, floor mats, transport damage check
- Activation workflow: delivery → registration → fleet config → telematics install → photo capture → activate

**Active Fleet**
- Continuous utilization tracking (rental days, idle days, maintenance days)
- Rolling TCO calculation per vehicle

**Rotation Triggers** (configurable per class/acquisition type)
- Maximum age in months
- Maximum odometer miles
- Minimum book value threshold
- Condition score below threshold (from damage history + maintenance trend)
- Actions: Alert, Auto-create disposal order, Auto-mark for remarketing

**Disposal Workflow**
- Disposal methods: Auction, Trade-In, Private Sale, Remarketing, Write-Off, Repossession
- Remarketing vendor assignment
- Estimated and actual sale price
- Disposal costs (transport, reconditioning, dealer prep)
- Net proceeds = sale price − disposal costs
- Gain/loss on disposal = net proceeds − book value at disposal
- Title and plate transfer tracking
- Pre-disposal reconditioning work order (to improve sale price)

**Depreciation Tracking**
- Straight-line: (Acquisition Cost − Residual Value) / Useful Life Months
- Units of Production (mileage-based): (Acquisition Cost − Residual Value) / Estimated Life Miles
- Monthly GL journal entries per vehicle
- Accumulated depreciation running total
- Deviation tracking: actual residual vs. planned residual (triggers early disposal if variance > threshold)

### 2.5 Fleet Rebalancing

- **Demand forecasting**: historical + forward reservations + seasonal factors + external demand signals (flight arrivals, events)
- **Shortage/surplus gap calculation** by class by location (configurable trigger thresholds)
- **Transfer order workflow**: Requested → Approved → Assigned → In Transit → Received
- **Transport methods**: Self-Drive, Fleet Driver, Auto Hauler, Trailer Transport
- **Vehicle status during transit**: InTransit (blocked at both locations)
- **Transfer cost tracking**: driver labor, fuel, hauler, tolls
- **Rebalancing optimization report**: pairs nearest surplus to nearest shortage, estimates cost vs. revenue gain, recommends minimum batch size
- **Rule**: do not transfer if cost > 1.5× estimated revenue gain

---

## 3. Reservation & Booking Engine

### 3.1 Reservation States

```
QUOTE → PENDING → CONFIRMED → MODIFIED → CHECKED_OUT → EXTENDED → RETURNED → CLOSED
                      ↓                                                ↓
                  CANCELLED                                        DISPUTED
                      ↓
                   NO_SHOW
```

| State | Description |
|---|---|
| QUOTE | Non-binding price inquiry; no inventory held; session-scoped |
| PENDING | Inventory tentatively held; expires after 15–30 min without confirmation |
| CONFIRMED | Fully confirmed; confirmation number issued; hard inventory hold |
| MODIFIED | Confirmed reservation with at least one post-confirmation change; all versions versioned |
| CHECKED_OUT | Vehicle dispatched; rental agreement signed; odometer/fuel logged |
| EXTENDED | Return date pushed past original while vehicle is out |
| RETURNED | Vehicle back; return inspection complete; preliminary charges calculated |
| CLOSED | Final invoice settled; record archived |
| CANCELLED | Cancelled before pickup; cancellation policy applied; inventory released |
| NO_SHOW | Customer did not appear within grace period (configurable, typically 2–4 hrs) |
| DISPUTED | Post-rental charge dispute active |

### 3.2 Availability Search

**Inputs**: pick-up location, drop-off location (may differ), pick-up datetime, return datetime, driver age (for surcharge calculation), promo/CDP code

**Processing**:
1. Query available fleet count per class at pick-up location for the window
2. Exclude: blocked vehicles (reservations + maintenance + recalls + transit)
3. Subtract safety buffer
4. Apply upgrade matrix: if requested class unavailable, show next class up as alternative
5. Return classes with available count > 0

**Race condition guard**: availability re-checked at time of confirmation (between quote and booking). If class becomes unavailable between quote and confirm, offer alternatives or waitlist.

**Flight tracking integration**: for airport pick-ups, allow customer to enter flight number; system monitors live flight status and automatically adjusts hold window if flight is delayed (prevent premature no-show).

### 3.3 Booking Flow

1. **Search** → available classes shown with pricing
2. **Select class + add-ons** → itemized quote with all fees/taxes
3. **Enter renter details** → name, contact, driver's license, payment method
4. **Confirm** → pre-authorization placed; confirmation number issued; confirmation email/SMS sent
5. **Online check-in** (optional, T-48h to T-1h) → pre-fill details, select add-ons, sign digital RA → reduces counter time
6. **Counter check-out** or **express pickup** (loyalty express lane)
7. **Active rental** → extension/modification available
8. **Counter check-in** or **express drop**
9. **Final invoice** → email receipt

### 3.4 Confirmation Number

- Alphanumeric, 6–12 characters (operator-configurable format)
- Unique globally across all locations and channels
- Used as primary lookup at counter (alongside customer name, loyalty number, phone)

### 3.5 Pre-Arrival

- Reminder notifications at T-48h and T-24h (email + SMS)
- Online check-in portal: pre-fill driver details, add extras, store payment — reduces counter time to ~60 seconds
- Mobile key pre-provisioning (at participating locations)
- Vehicle pre-assignment: operations staff assign specific VIN from class pool (can change up to departure)

### 3.6 No-Show Handling

- Configurable grace period (2–4 hours typical; airport locations often 4–6 hours)
- Mid-period check: if not checked out by T+1h, proactive SMS to confirm/delay
- Auto-transition to NO_SHOW at end of grace period
- No-show fee charged to card on file (configurable: first day charge or flat fee)
- Inventory released to availability pool
- Customer record flagged for no-show history

### 3.7 Modification & Extension

**Modifications** (any pre-checkout change):
- Date/time change (availability re-checked)
- Vehicle class change (pricing recalculated)
- Location change (triggers one-way fee recalculation)
- Add-on additions/removals
- Additional driver add
- All modifications versioned with timestamp and agent ID

**Extensions** (post-checkout):
- Availability check at return location for extension period (same VIN must not be committed to next reservation)
- Extension rate quoted (may differ from original — rate at time of extension or locked original)
- Incremental pre-authorization placed for extension amount
- Customer notified; updated rental agreement issued

### 3.8 Cancellation

- Policy linked to rate code (not customer), ranging from anytime-free to fully non-refundable
- Cancellation fee applied per policy tier
- Inventory released immediately
- Pre-auth reversed (minus fee if applicable)
- Cancellation confirmation sent
- Force majeure override: manager can waive fee with reason code + documentation

---

## 4. Rate & Pricing Engine

### 4.1 Rate Components

Every quote is composed of:
- **Base rate**: core per-day/week/month charge for vehicle class at location
- **Duration tiers**: daily, weekly (typically 15–25% discount vs. 7× daily), monthly (40–60% discount; often mileage-capped)
- **Location surcharges**: airport concession fee (10–15%), Customer Facility Charge (flat per day), energy recovery fee
- **Government taxes**: state/county/city sales tax, tourism levies, airport access fees
- **Vehicle Licensing Fee (VLF)**: amortized registration/licensing cost
- **Mileage**: unlimited or capped (e.g., 200 miles/day free, then $0.25/mile)

### 4.2 Rate Types

| Rate Type | Description |
|---|---|
| Rack / Published | Standard retail rate; highest price |
| Corporate / Contract (CRA) | Negotiated rate for corporate accounts; requires CDP code |
| Government / NGO | Special rate for government agencies |
| Insurance Replacement | Flat daily rate agreed with insurance carriers; 20–40% below rack |
| Promotional | Time-limited discounts; may have advance purchase requirement, blackout dates |
| OTA / Wholesale | Net rate provided to OTAs; OTA marks up |
| Membership (AAA, AARP, etc.) | 5–20% off rack for qualifying members |
| Tour Operator / Package | Bundled net rate (heavily discounted) |
| Loyalty Redemption | Points-based "free" day; no cash charge |
| Weekend Special | Fri 12pm–Mon 9am promotional rate |

### 4.3 Rate Code Structure

```
rate_codes
  rate_code          Unique identifier (e.g., "CORP_ACME_2025", "PROMO_SUMMER")
  rate_type          ENUM above
  rate_name
  vehicle_class_id   FK (or NULL = applies to all classes)
  location_id        FK (or NULL = all locations)
  valid_from
  valid_until
  blackout_dates     JSONB array of date ranges
  min_rental_days
  max_rental_days
  advance_booking_hours_min  (e.g., must book 24+ hours out)
  advance_booking_hours_max  (e.g., must book within 30 days)
  refundable         BOOLEAN
  cancellation_policy_id FK
  is_combinable      BOOLEAN (can stack with another code)
  corporate_account_id FK (if tied to specific account)
  max_uses_total     NULL = unlimited
  max_uses_per_customer
  cdp_code           Corporate Discount Program code (6–8 digits)
  pc_code            Promotion Code companion to CDP

rate_schedule_items
  item_id
  rate_code
  days_min, days_max (duration bracket)
  day_of_week_mask   JSONB (Mon–Sun applicable days)
  price_per_day
  price_per_week     (if weekly tier applies)
  price_per_month    (if monthly tier applies)
```

### 4.4 Dynamic / Yield Pricing

- Yield management engine monitors: current utilization rate by class at location, forward demand (confirmed reservations as % of fleet), time-to-departure (last-minute vs. advance)
- Rules-based OR ML-based pricing: adjusts base rates up/down within configured floor/ceiling
- Competitor rate monitoring (optional): web scraped or via data feed from RateGain, OAG, or similar
- Price floors (prevent race-to-bottom during oversupply) and ceilings (prevent gouging during peak)
- Rate parity enforcement: optional config to prevent direct price being higher than OTA price

### 4.5 Promotional Code Validation

Rules checked at booking:
- Valid date range
- Eligible vehicle classes and locations
- Minimum rental duration
- Maximum uses (total / per-customer)
- Customer eligibility (new customers only, loyalty tier, etc.)
- Stack rules (combinable with corporate code or mutually exclusive)

### 4.6 Rate Calendar & Seasonality

- Rate schedules per location / class / date range
- Seasonal multipliers (summer peak, holiday blackout)
- Event-based surcharges (concerts, conventions, major events)
- Weekend special: custom rates for Fri–Mon window

---

## 5. Customer & Identity Management

### 5.1 Customer Profile

**Personal**
- Full legal name, date of birth, gender, nationality
- Email (primary), mobile phone, alternate phone
- Address (mailing and billing if different)
- Communication preferences (email, SMS, marketing opt-in)
- Account status (Active, Suspended, Blacklisted)

**Driver's License**
- License number, issuing country/state, issue date, expiry date, license class
- Scanned image (OCR-captured)
- Minimum age verification flag
- International Driving Permit (IDP) required flag
- License validation check at booking + at counter

**KYC Verification**
- Tier 1 (self-service): OCR/AI license scan via app/web upload + liveness check (selfie match)
- Tier 2 (counter): physical document inspection; secondary ID for international renters
- Address verification (for corporate onboarding)
- Credit/debit card holder name matching

**Stored Payment Methods**
- Tokenized card references (PCI DSS compliant — no raw PAN stored)
- Multiple cards per customer
- Card nickname, expiry display (truncated)

**Preferences**
- Preferred vehicle class, transmission, fuel type
- Preferred add-ons (auto-select on booking)
- Preferred receipt format
- Preferred contact channel

### 5.2 Do Not Rent (Blacklist / DNR)

- DNR flag with reason code: DAMAGE_UNRECOVERED, THEFT, FRAUD, PAYMENT_FAILURE, POLICY_VIOLATION, AGGRESSIVE_BEHAVIOR
- Scope: location-level, brand-level, or network-wide
- DNR record: date added, added by (staff ID), incident reference, review/expiry date
- System blocks new reservations and counter pickups for DNR customers
- Manager override capability with reason code (creates audit log)
- Optional network-wide DNR registry sharing (industry-standard in franchise networks)

### 5.3 Duplicate Detection & Profile Merge

- Duplicate detection on: email, phone, license number
- Master profile merge tool for customer service agents
- Audit trail on all merge operations

### 5.4 Customer Account Types

| Type | Description |
|---|---|
| Individual / Retail | Standard B2C customer |
| Corporate Employee | Linked to a corporate account; books under company rate |
| Travel Agent | Books on behalf of multiple clients |
| Insurance Claimant | Referred by insurance company; billing goes to insurer |
| Loyalty Member | Has loyalty account; tier-based benefits |

---

## 6. Counter Operations

### 6.1 Check-Out Workflow

1. **Lookup**: by confirmation number, customer name, loyalty number, or phone
2. **Identity verification**: physical driver's license check; secondary ID if required
3. **Review reservation**: vehicle class, rate, add-ons, special instructions, loyalty tier alert
4. **Upgrade offer**: present class upgrade options with price delta (scripted upsell)
5. **Add-on upsell**: CDW/LDW (if not pre-selected), GPS, toll pass, additional driver
6. **Verify/capture payment**: credit card pre-authorization for estimated total + buffer; card must match primary driver's name
7. **Rental Agreement (RA)**: generate and present (print or digital tablet); agent walks through key terms
8. **Vehicle assignment**: specific VIN assigned from class pool; vehicle status → In Transit/Out
9. **Vehicle walk-around**: joint pre-rental inspection; existing damage marked on diagram + photos; customer initials
10. **Fuel + odometer**: starting readings recorded
11. **Keys/access**: physical key, keycard, or digital key QR code
12. **Signature**: customer signs RA (wet ink or e-signature on tablet)
13. **Dispatch**: reservation status → CHECKED_OUT; vehicle status → On Rent

### 6.2 Express Check-Out

- Loyalty members with stored profile + pre-auth: kiosk or app self-service
- Vehicle pre-assigned; proceed directly to dedicated express lot
- QR code in app to locate/unlock vehicle (at participating locations)
- Mobile agent with tablet (meets customer in garage) — no counter required

### 6.3 Check-In / Return Workflow

1. **Vehicle arrival**: customer drives to return lane
2. **Scan / lookup**: plate scan or confirmation number → reservation pulled
3. **Odometer + fuel**: agent records return readings
4. **Post-rental inspection**: compare to pre-rental baseline; photograph any new damage
5. **Equipment return**: toll pass device scanned; child seats noted
6. **Charge calculation**:
   - Base rental (actual return time vs. scheduled; grace period 29–59 min)
   - Fuel surcharge if below contracted level
   - Mileage overage (if applicable)
   - Damage charges (if new damage)
   - Toll charges (fetched from toll provider)
   - Late return fee (beyond grace period)
7. **Final invoice**: total presented; pre-auth capture at final amount
8. **Receipt**: email or printed
9. **Status update**: RETURNED → CLOSED; vehicle → AVAILABLE (or NEEDS_CLEANING or DAMAGE_HOLD)

### 6.4 Additional Driver Management

- Up to N additional drivers per rental agreement (configurable max)
- All additional drivers must present license at counter at time of check-out
- Additional driver fee per day or flat fee (configurable)
- Each additional driver record: name, license number, issuing country, expiry, date of birth
- Restrictions: some corporate rate agreements include free additional driver; some age restrictions apply to additional drivers

### 6.5 Rental Agreement (RA) Document

RA includes:
- Confirmation/RA number, rental dates, location, vehicle (class + VIN + plate)
- Primary and additional drivers
- Rate breakdown (daily rate × days + all extras + estimated taxes)
- Mileage plan terms
- Fuel policy
- Pre-rental damage log (diagram + written list)
- CDW/LDW terms, deductible amount, exclusions
- Late return policy and grace period
- One-way terms and drop location
- Customer signature field (wet or digital)

---

## 7. Extras & Ancillaries

### 7.1 Insurance & Protection Products

| Product | Code | Description |
|---|---|---|
| Collision Damage Waiver | CDW | Waives liability for collision damage (theft excluded); deductible $0–$1,500 |
| Loss Damage Waiver | LDW | CDW + theft protection; eliminates deductible |
| Supplemental Liability Insurance | SLI/ALI | Third-party liability coverage (up to $1M) |
| Personal Accident Insurance | PAI | Medical coverage for renter + passengers |
| Personal Effects Coverage | PEC | Coverage for items stolen from vehicle |
| Roadside Assistance | RSA | Lockout, flat tire, fuel delivery; per-day charge |
| Super Cover / Zero Excess | — | Premium: reduces deductible to $0; full damage coverage bundle |

**CDW/LDW exclusions** (standard; vary by operator):
- Tires/wheels (unless specific glass/tire coverage purchased)
- Windshield chips/cracks (unless glass coverage)
- Interior damage (burns, tears, stains)
- Underbody damage (off-road or speed bump damage)
- Roof damage (from loading/bridge clearance)
- Wrong fuel damage
- Damage from DUI or unauthorized driver
- Cross-border use without authorization

### 7.2 Vehicle Equipment

| Add-On | Notes |
|---|---|
| GPS / Navigation unit | Per-day; increasingly superseded by phone mounts |
| Child/Infant seat | Per-day; customer specifies age/weight for appropriate seat type |
| Booster seat | For older children |
| Ski rack / roof rack | Seasonal |
| Snow chains | Mountain/winter locations |
| Wi-Fi hotspot device | Per-day + data |
| Satellite radio (SiriusXM) | Per-day |
| Phone mount + USB charger | |
| Luggage rack / cargo carrier | |
| Tow bar / hitch | Heavy vehicle classes |

### 7.3 Driver Services

| Add-On | Notes |
|---|---|
| Additional driver | Per-day or flat; license verified at counter |
| Young driver surcharge | Under 25 (25 in some markets); per-day |
| Senior driver surcharge | Over 70/75 in some markets |
| Chauffeur/driver service | Premium service offering |

### 7.4 Fuel Options

| Option | Description |
|---|---|
| Full-to-Full | Customer returns full; no fuel charge if full |
| Pre-Purchase Fuel Plan (PPFP) | Pay for full tank upfront at discounted rate; return at any level; no refund for unused fuel |
| Same-to-Same | Return at same level received; deficit charged |
| EV Charging Plan | Flat charge fee or return-fully-charged requirement |

### 7.5 Convenience Services

| Add-On | Notes |
|---|---|
| Toll Pass / E-Toll | Pre-loaded transponder; per-day fee + actual tolls billed post-return |
| Airport Meet & Greet | Concierge delivery to arrivals hall |
| Delivery & Collection | Vehicle delivered to/collected from customer address |
| Express Return | Key drop; auto-close at scheduled time |

### 7.6 Extras Catalog Management

```
extras_catalog
  extra_id
  extra_type         ENUM: Insurance, Equipment, Fuel, Driver, Convenience, Toll
  code               e.g., "CDW", "GPS", "CSS" (child safety seat)
  name
  description
  pricing_type       ENUM: PerDay, PerRental, PerMile, PerEvent
  price              or per-day rate
  tax_treatment      Taxable or exempt (varies by jurisdiction)
  available_at       JSONB location_ids (or NULL = all)
  available_for_classes JSONB class_ids (or NULL = all)
  max_quantity       (e.g., max 2 child seats per rental)
  requires_physical_item BOOLEAN (e.g., GPS unit must be inventoried)
  inventory_count    If requires_physical_item = TRUE
```

---

## 8. Payments & Billing

### 8.1 Supported Payment Methods

**B2C (Consumer)**
- Credit card (Visa, Mastercard, Amex, Discover) — primary; pre-auth capable
- Debit card (with restrictions: higher deposit, credit check, max duration cap at some locations)
- Digital wallets (Apple Pay, Google Pay, PayPal) — tokenized; same pre-auth rules as underlying card
- Cash (large deposit required; not accepted at many airport locations)

**B2B (Corporate)**
- Corporate credit card (Amex BTA, Visa Commercial, Mastercard Corporate)
- Direct Bill / Net-30/60 open account (requires credit approval)
- Purchase Order (PO) matching before payment release
- Wire Transfer / ACH (for monthly invoice settlement)
- Fuel card integration (WEX, Fleetcor — separate billing for fuel charges)

### 8.2 Pre-Authorization Lifecycle

**What it is**: temporary hold on available credit/funds; NOT a charge. Funds reserved while rental total is unknown.

**Authorization amounts**:
- Standard retail: estimated total + $200–$500 buffer
- Luxury/exotic: estimated total + $500–$2,000
- Debit card: estimated total + $350–$500 flat
- Corporate (central bill): $1 or $0 verification only

**Authorization fields**:
- Gateway authorization code
- Amount authorized + currency
- Authorized at timestamp
- Network-imposed expiry (Visa: 7 days; Mastercard/Amex with MCC 7512: up to 30 days)
- Status: pending, captured, released, expired, declined
- Network Transaction ID (required for incremental auth chaining)

**Incremental Authorization**: when rental extends past auth window or rental period extended:
- New auth using stored Network Transaction ID (Visa/MC requirement for CIT/MIT chain)
- Amount = remaining estimated charges + buffer
- Prior auth may be left to expire or voided

**Expiry Management**: automated job re-authorizes 24–48 hours before expiry for all open rentals. Failed re-auth triggers escalation workflow.

### 8.3 Charge Timeline

| Phase | What's Charged |
|---|---|
| Reservation | Optional deposit (0–100% of estimated total); stored as deferred revenue |
| Pickup | Pre-authorization placed; some add-ons charged immediately (PPFP, CDW if daily charge model) |
| Mid-rental | Extension charges; toll pass activation; mileage alerts |
| Return | Final odometer + fuel → charges calculated; pre-auth captured at final amount |
| Post-return | Toll events (15–60 days); traffic violations (30–180 days); damage assessment (if disputed) |

### 8.4 Invoice Structure

**Header**: invoice number, date, due date, bill-to (customer or corporate account), rental period, vehicle, location, driver, payment method summary

**Line Item Categories**:
- Base rental (daily/weekly/monthly rate × duration)
- Duration discount (weekly/monthly break applied)
- One-way surcharge
- Young/senior driver surcharge
- Additional driver fee
- Insurance/protection products (CDW, SLI, PAI, PEC, RSA)
- Equipment add-ons (GPS, child seat, etc.)
- Fuel charges (PPFP or post-return refueling fee)
- Mileage overage (actual miles − included miles × overage rate)
- Toll pass fee (daily × days)
- Toll events (per event + admin fee)
- Traffic violations (fine + processing fee)
- Late return fee
- Location surcharges (airport concession, CFC)
- Vehicle Licensing Fee
- Government taxes (state, county, city — itemized by jurisdiction)
- Damage charges (separate line or separate invoice)

**Totals**:
```
Subtotal (pre-tax rental + add-ons + fuel + mileage)
+ Taxes (itemized per jurisdiction)
+ Non-taxable fees (concession, CFC)
─────────────────
= Invoice Total
− Payments Applied
─────────────────
= Balance Due / Refund Amount
```

### 8.5 Revenue Recognition (ASC 606 / IFRS 15)

- **Performance obligation**: making vehicle available for contracted period
- **Recognition**: straight-line over rental period (daily basis)
- **Deposits at booking**: deferred revenue (liability) until rental commences
- **CDW/protection products**: recognized pro-rata over rental period
- **PPFP**: recognized at pickup
- **Damage charges**: recognized when determinable and collectible
- **Toll/fine fees**: recognized when charged to customer

### 8.6 Refunds & Voids

| Scenario | Action | Timing |
|---|---|---|
| Cancel same-day (pre-capture) | Void authorization | Immediate |
| Cancel post-capture | Refund | 3–10 business days |
| Overpayment at return | Partial refund | 3–7 business days |
| Deposit for cancelled reservation | Refund per policy | Per cancellation policy |
| Dispute resolved in customer favor | Credit note + refund | Upon claim resolution |

**Refund approval workflow**: amounts above configurable threshold (e.g., $500) require manager approval. All refunds create audit trail.

### 8.7 Accounting Integration

**GL mapping** (configurable per company):
- 4000: Rental Revenue – Base
- 4010: Rental Revenue – Protection Products
- 4020: Rental Revenue – Equipment/Accessories
- 4030: Fuel Revenue
- 4040: Mileage Overage Revenue
- 4050: Damage/Loss Recovery
- 4060: Toll & Fine Processing Fee Revenue
- 4200: Sales Tax Payable
- 1200: AR – Corporate
- 2100: Customer Deposits / Pre-Payments
- 2110: Deferred Revenue

**Integration interfaces**:
- ERP exports (QuickBooks, Sage, NetSuite, SAP, Xero) via API or scheduled file (CSV, IIF, XML)
- Avalara AvaTax or TaxJar for real-time multi-jurisdictional tax calculation
- Daily settlement report for bank reconciliation
- AR aging export to AR module

---

## 9. Damage & Claims Management

### 9.1 Vehicle Inspection System

**Inspection Types**:
- Pre-Rental (VCR — Vehicle Condition Report)
- Post-Rental
- Mid-Rental (if accident reported)
- Delivery (new vehicle arrival)
- Periodic (scheduled condition audit)

**Inspection Zones**: Front, Rear, Left Front, Left Rear, Left Front Door, Left Rear Door, Right Front, Right Rear, Right Front Door, Right Rear Door, Roof, Hood, Trunk, Windshield, Rear Window, All Glass Panels, Interior Front, Interior Rear, Dashboard, Cargo, Underbody, Wheels

**Damage Types**: Scratch, Scuff, Dent, Dent-with-Scratch, Crack, Chip, Glass Crack, Glass Chip, Broken Glass, Interior Stain, Interior Burn, Interior Tear, Missing Part, Flood Damage, Wheel Scuff, Tire Damage, Hail Damage, Collision, Other

**Severity Grades**:
- Grade 1: Cosmetic/Acceptable (surface scratch < 5cm, door ding < 1cm)
- Grade 2: Minor (scratch 5–15cm through paint; dent < 3cm; glass chip not in sightline)
- Grade 3: Moderate (scratch > 15cm to primer; dent 3–10cm with paint; crack < 15cm)
- Grade 4: Severe (major collision, spreading glass crack, panel requiring replacement)
- Grade 5: Total Loss (structural frame damage, airbag deployment, flood/fire)

**Photo capture**: zone-level photos with timestamps, geo-location, and device fingerprint. High-volume operators use automated drive-through camera rigs with AI damage flagging.

**Customer acknowledgment**: SVG vehicle diagram with pre-existing damage highlighted; customer signs digitally; signature stored with document hash for legal defensibility.

### 9.2 Damage Claim Process

1. Post-rental inspection reveals new damage (items in post-rental not present in pre-rental)
2. Damage incident record created; customer notified in writing within legal window
3. Repair estimate obtained
4. Claim type determined: Customer Charge, CDW Waiver Claim, Third-Party Insurance, Credit Card Benefit, Operator Absorbed
5. CDW interaction:
   - With CDW: customer liable only for deductible (commonly $0–$1,500)
   - Without CDW: customer liable for full repair + loss of use + admin fee
6. Loss of Use (LOU): days vehicle out of service × daily revenue rate (ADR)
7. Diminished value: assessed reduction in vehicle market value post-repair
8. Admin/handling fee: flat fee per claim
9. Dispute: customer may dispute within configurable window
10. If disputed: documentation provided (pre/post photos, signed inspection, signed RA)
11. Insurance subrogation: if third-party insurer pays → operator credits customer for any amount already collected

**Claim States**: Open → Estimate Sent → Customer Acknowledged → Repair In Progress → Repair Complete → Invoiced → Paid / Disputed / In Litigation / Written Off

### 9.3 Damage Documentation Standards

- Pre and post inspection photos must be timestamped and geo-tagged
- Photos stored immutably (cannot be modified after upload)
- Digital signature captures: IP address, device fingerprint, GPS coordinates, and hash of document at time of signing
- All inspection records preserved for minimum 7 years (legal/regulatory requirement)

---

## 10. Maintenance Management

### 10.1 Scheduled Maintenance

**Maintenance plan templates** define:
- Service types: Oil Change, Tire Rotation, Brake Inspection, Brake Pads, Air Filter, Fuel Filter, Transmission Fluid, Coolant Flush, Timing Belt, Spark Plugs, Battery Check, State Safety Inspection, Emissions Test, Tire Replacement, Major Service, Detail Clean
- Trigger types: Mileage interval, Days interval, Calendar date, Months in service
- Alert lead times: configurable lead miles/days before trigger (e.g., alert 500 miles before oil change due)
- Estimated duration and cost per service type
- Safety-critical flag: if flagged, vehicle cannot be dispatched past due date

**Common schedules**:
- Oil change: every 5,000 miles OR 90 days (synthetic: 7,500–10,000 miles)
- Tire rotation: every 5,000–7,500 miles
- State safety inspection: annually (calendar trigger)
- Emissions test: annually or biennially (jurisdiction-specific)
- Brake inspection: every 10,000–15,000 miles
- Major service (30k/60k/90k): mileage-based multi-item bundle
- Deep detailing: every 30 days or 30 rentals

### 10.2 Maintenance Alerts

- Alert levels: Upcoming (> lead), Due (at lead), Overdue (past due)
- Notification routing: maintenance manager at home location + current location manager (if different)
- Escalation: if Overdue + vehicle Available → auto-status change to Requires Maintenance (hard block)
- Alert status: Open, Acknowledged, Work Order Created, Completed, Dismissed

### 10.3 Work Orders

**Fields**: WO type (Scheduled, Unscheduled, Recall, PDI, Reconditioning), linked vehicle block, location, vendor, status, priority, dates (opened/scheduled/started/completed), odometer at service, technician, labor hours + rate + cost, parts (part number, description, quantity, cost), sublet cost, total cost, warranty claim flag.

**Unscheduled repairs**: triggered by damage incident at return. Severity determines whether vehicle is blocked before next rental. Repair cost linked back to damage claim for customer/insurance recovery.

### 10.4 Recall Management

- NHTSA API integration: periodic batch job queries by VIN for all active fleet vehicles; new recalls auto-imported
- Recall record: NHTSA campaign number, manufacturer campaign number, component, safety risk level, remedy available flag, dealer assignment, repair status
- Safety-critical recalls: automatic hard block on vehicle (overrides all availability)
- Recall-hold block: cannot be removed until recall work completed and signed off
- Recall repair: standard work order created; warranty claim tracked (recall repairs are typically manufacturer-covered)

---

## 11. Telematics & GPS Integration

### 11.1 Supported Providers

Commercial integrations (REST APIs or native connectors):
- **Geotab / MyGeotab** — widely used by Enterprise/National/Alamo
- **Verizon Connect (Reveal)** — strong at mid-large operators
- **Samsara** — modern API, AI dashcams, strong EV support
- **Spireon (FleetLocate / NSpire)** — rental-specific features; Solera ecosystem
- **CalAmp (PULS)** — strong in sub-prime/rent-to-own
- **Ituran** — strong in international/Latin American markets

### 11.2 Data Captured

**Events**: Position, Engine On/Off, Speeding, Harsh Brake, Harsh Acceleration, Harsh Cornering, Idle Start/End, Geofence Entry/Exit, Fuel Change, Diagnostic Fault (DTC codes), Tamper Detect, Panic, Battery Low

**Per-event fields**: vehicle_id, device_id, event_type, timestamp, lat/lng/altitude, speed, heading, odometer (from ECU), fuel level %, engine RPM, coolant temp, battery voltage, ignition status

**Aggregated daily**: trips count, total distance, drive time, idle time, max/avg speed, harsh event counts, fuel consumed, engine faults, first/last ignition

**EV-specific**: SOC %, range estimate, charging power kW, charging session reference, kWh added, battery temperature

### 11.3 Integration Patterns

- **Pull (polling)**: RMS calls provider API every 1–5 minutes using `since_timestamp` — simple but adds latency
- **Push (webhooks)**: provider POSTs events in real-time to RMS endpoint; events queued via message bus (Kafka, SQS, RabbitMQ) before processing — preferred for operational use cases
- **VIN mapping layer**: telematics device serial ↔ vehicle_id ↔ VIN (must be maintained when devices are swapped)

### 11.4 Operational Use Cases

- **Real-time map**: dispatcher view showing all vehicles with position, speed, status, SOC
- **Stolen vehicle recovery**: high-frequency position updates, starter interrupt (on supported devices/jurisdictions), police relay
- **Mileage verification**: OBD odometer at return vs. counter-reported mileage; discrepancy > threshold flagged
- **Fuel monitoring**: sudden fuel drop without ignition → siphoning alert
- **Driver behavior scoring**: harsh events per rental; used for incident investigation context
- **Unauthorized movement**: vehicle moving during scheduled maintenance or with expired contract → alert

### 11.5 Geofencing

Geofence types: Return Area, Home Lot, City Boundary, State/Country Limit, Restricted Zone, EV Charging Area

Use cases:
- Airport return zone: alert if vehicle exits without active check-in
- City/state limit: alert if vehicle violates geographic rental agreement terms (CDW may be voided)
- EV charging area: alert if EV parked outside charging zone with low SOC

Boundary types: circle (center + radius) or polygon (lat/lng array)

---

## 12. Corporate Account Management

### 12.1 Account Structure

- **Master Account**: company entity; holds rate contract, CDP code, billing instructions, vehicle class policy, spending limits
- **Sub-accounts / Cost Centers**: department or project-level billing allocation; map to GL codes
- **Authorized Bookers**: employees who may book under the account
- **Approved Travelers**: may differ from bookers; pre-vetted driver list
- **Travel Policy**: enforced at booking (e.g., economy class only unless > 4-hour drive; no sports cars; CDW mandatory)

### 12.2 Corporate Discount Program (CDP) Code

- Unique 6–8 digit numeric code per corporate account
- Entered at booking to unlock negotiated rate + billing
- Multiple codes: parent company vs. subsidiaries; different rate tiers
- PC (Promotion Code): companion to CDP for additional discount
- CDP code in GDS rate file enables TMC and online booking tool access to negotiated rates

### 12.3 Contract Terms

- Negotiated rate: % off rack, flat rate per class, or class+market-specific rates
- Rate validity period (typically 1–2 year contracts)
- Guaranteed availability at key locations during peak (for large accounts)
- Maximum vehicle class allowed (policy cap)
- Included extras: CDW, SLI waived for self-insured companies
- Mileage: unlimited or capped with negotiated overage rate
- Volume commitments and rebate thresholds
- Monthly reporting: by traveler, cost center, vehicle class, location, spend
- Duty of Care: real-time traveler location data to corporate travel manager

### 12.4 Corporate Billing

- **Direct Bill**: open account; charges accumulate; monthly consolidated invoice
- **Ghost/Lodge Card**: virtual card number shared across account; driver presents it; charges route centrally
- **T&E Integration**: push receipts to Concur, SAP Expense, Oracle Expense as expense items
- **PO Matching**: PO number required on invoice; released to AR only after PO match
- **EDI 210 invoicing**: for large enterprise accounts expecting electronic invoicing
- Tax-exempt certificate on file: removes applicable taxes from corporate invoices

---

## 13. Loyalty & Rewards Program

### 13.1 Tier Structure (Configurable)

| Tier | Qualification | Example Benefits |
|---|---|---|
| Member (Base) | Enrollment | Counter skip eligible, earn points |
| Silver | 3–5 rentals or 750–1,000 points/year | Dedicated counter, free additional driver |
| Gold | 8–12 rentals or 2,000–2,500 points/year | Express pickup, free upgrade, bonus points |
| Platinum | 20–25 rentals or 5,000+ points/year | Car-of-class choice, counter skip, guaranteed upgrade, rollover |
| Chairman / Top Tier | Invitation only or 30+ rentals | Any car in lot choice, dedicated account manager |

### 13.2 Points Engine

**Earning**:
- Base: points per $ spent (e.g., 1pt/$1) or per rental day (e.g., 50pt/day)
- Class multipliers: bonus for premium/luxury class rentals
- Partner earning: airline miles, hotel points, co-branded credit card
- Promotional bonuses: sign-up bonus, referral, double-points promos

**Redemption**:
- Free rental day: points redeemed against award day (class restrictions by tier)
- Points + cash: partial redemption
- Transfer to airline miles (common ratio: 1:1 or 1:2)
- Upgrade redemption: upgrade to higher class using points

**Management**:
- Rolling 12-month qualification window (some programs use calendar year)
- Tier rollover: excess qualifying activity carries to next year (partial)
- Points expiration: typically 12–18 months of account inactivity
- Profile-stored preferences: class, add-ons, payment → enable fast counter checkout
- Counter recognition: loyalty tier prominent on agent screen; tier-based greeting

---

## 14. Channel Management & OTA Integration

### 14.1 Direct Channels

- **Web booking engine**: highest margin; full pricing and product control; loyalty integration; online check-in
- **Mobile app**: express pickup, digital key, push notifications, live rental status
- **Call center / reservations desk**: agent-assisted booking using same backend as web
- **Walk-up counter**: same-day, no prior reservation; walk-up rate; subject to availability
- **Kiosks**: self-service for loyalty members at participating locations

### 14.2 OTA & GDS Connectivity

**Major OTAs**: Expedia (+ Hotels.com, Egencia), Priceline / Booking.com / Kayak, Hotwire (opaque), Rentalcars.com, AutoEurope, Kayak/Skyscanner (meta-search), Google Travel

**GDS Networks**: Sabre, Amadeus, Travelport (Galileo/Worldspan) — used by travel agents and TMCs

**Aggregators**: CarTrawler (white-label for airlines: Ryanair, easyJet, Air France), Mozio (ground transport)

**Integration Standards**:
- OTA Alliance XML schemas: `OTA_VehAvailRateRQ/RS` (availability+rate query), `OTA_VehResRQ/RS` (reservation create), `OTA_VehRetResRQ/RS` (retrieve reservation), `OTA_VehCancelRQ/RS` (cancellation)
- REST/JSON APIs for modern direct partners (airlines, hotels, super-apps)
- GDS vendor codes: ZE=Hertz, ZI=Avis, ZR=National, ZT=Thrifty, ZD=Budget, EP=Enterprise, ET=Alamo

**Channel Manager**:
- Centralized availability calendar synced across all channels
- Rate plan mapping: internal rate codes ↔ OTA rate codes
- Booking retrieval and confirmation number mapping (internal RA# ↔ OTA booking ref)
- Rate parity monitoring (contract enforcement)

### 14.3 Insurance Replacement Channel

- Claimant referred by insurance carrier
- Flat daily rate per master contract (20–40% below rack)
- Reservation flagged as insurance replacement type
- Billing direct to insurance company; duration governed by claim timeline
- Extension requests routed through insurance adjuster workflow

---

## 15. Toll, Fine & Violation Processing

### 15.1 Toll Pass Programs

US programs: E-ZPass (19 states), SunPass (FL), FasTrak (CA), TxTag/TollTag (TX)
Aggregator: PlatePass — nationwide program used by major operators; single toll account covers all supported roads

**Operator models**:
1. **Daily fee + pass-through**: charge $X/day device fee; actual tolls billed at cost + per-event admin fee
2. **Daily unlimited**: charge flat daily fee; operator absorbs actual tolls (margin play)
3. **Optional opt-in**: activated at counter; daily fee applies only for days activated

### 15.2 Toll Processing Data Flow

1. Vehicle plate captured at toll gantry
2. Toll authority invoices operator's fleet toll account (bulk monthly)
3. Operator matches toll event: plate + datetime → active rental agreement
4. Charge queued against renter's card-on-file
5. Batch processing: daily or weekly
6. Customer notified by email of pending charges
7. Charge processed; receipt issued
8. Unmatched tolls: manual resolution queue

**Fields**: toll authority, toll location, event datetime, toll amount, admin fee, total charged, billing batch, status (pending/charged/failed/disputed/waived)

### 15.3 Traffic Violation / Fine Processing

- Violation authority issues citation to registered owner (operator)
- Operator receives citation (mail or electronic database)
- Match citation date/time + plate → active rental agreement
- Customer notification in writing within legal window (30–60 days in most US states)
- Charge: fine amount + administrative fee ($25–$75)
- **Liability transfer**: in supporting jurisdictions, operator transfers liability to renter by submitting renter identification to DMV
- Post-return violations arrive up to 6–18 months later; stored card-on-file expiry is an operational challenge

---

## 16. Multi-Location & Fleet Operations

### 16.1 Location Types

| Type | Description |
|---|---|
| Airport Station | On-airport or off-airport shuttle; 24/7; highest volume; concession fees |
| Downtown / City Branch | Business district; typically 8am–6pm |
| Neighborhood / Suburban | Insurance replacement focus; lower volume |
| Hotel In-Lobby | Partnership desk; limited inventory |
| Dealer / Body Shop | Collision replacement |
| One-Way Drop Hub | Primarily receives one-way returns |

### 16.2 One-Way Rentals

- **One-way fee / drop charge**: based on geographic distance, demand imbalance, vehicle class, season
- **Repositioning specials**: free one-ways on routes where operator needs fleet movement
- **System handling**: pick-up location code + drop-off location code as separate reservation fields; one-way fee calculated and displayed at booking
- **Fleet imbalance**: one-way routes continuously drain inventory from origin; rebalancing required (see §2.5)

### 16.3 Cross-Border Rentals

- Additional authorization required at booking (not all operators permit)
- Country-specific cross-border insurance (domestic CDW often invalid)
- Green Card (International Motor Insurance Certificate) for some markets
- Physical authorization letter placed in vehicle (required by some customs authorities)
- Vehicle-level cross-border authorization record with valid dates and destination country

### 16.4 Airport-Specific Operations

- **CONRAC** (Consolidated Rental Car Facility): shared return facility at many major airports
- **Flight tracking**: monitor inbound flight status; auto-extend hold window on delays
- **Return lane scanning**: plate or QR barcode scan on vehicle windshield
- **Shuttle coordination**: off-airport lots integrate bus schedule with fleet readiness
- **Airline partnerships**: co-branded miles for renters arriving on partner airline; integrated in booking flow

---

## 17. EV Fleet Management

### 17.1 SOC (State of Charge) Management

**Dispatch policy** per class/location:
- Minimum dispatch SOC % (e.g., 80% — cannot dispatch below)
- Target dispatch SOC % (e.g., 95% — ideal)
- Low SOC alert threshold during rental (e.g., 20% — notify customer)
- Minimum return SOC % (e.g., 15% — charge before other tasks)

**Post-return workflow**:
1. Return SOC checked from telematics
2. If below minimum dispatch SOC: status → Charging Required; block created; charger assigned; estimated charge time calculated
3. Telematics ChargingEnd event or SOC threshold reached → status → Available

### 17.2 Charging Infrastructure

**Charger types**: L1 (1.4kW), L2 (7.2–19.2kW), DCFC-CCS (50–350kW), DCFC-CHAdeMO, DCFC-NACS (Tesla standard)

**OCPP integration** (Open Charge Point Protocol 1.6/2.0.1):
- Remote start/stop charging sessions
- Real-time session energy data
- Fault detection and reporting
- Per-session kWh metering (for cost tracking)

**Charging network providers**: ChargePoint, EVgo, Blink, Tesla, Volta, and unnetworked/proprietary

**Fleet-level SOC dashboard**: all EVs at a location showing current SOC, range estimate, charging status, next reservation, time to dispatch readiness, charger assignment

### 17.3 Customer-Facing EV Experience

At booking:
- Rated range and typical real-world range displayed
- Compatible charging network coverage in rental region
- Included charging benefits (if any)

At pickup:
- Current charge level and range on rental agreement
- Vehicle-specific charging instructions (port location, connector type)
- Charging network card or app credentials
- Nearest DC fast charger locations
- Explanation of range variation (highway vs. city; weather impact)
- Return SOC requirement clearly stated
- Emergency towing policy if range depleted

During rental (proactive):
- Push notification when SOC < low threshold: "Nearest compatible charger is X miles away at [Address]"
- If SOC < 10%: automated proactive contact by customer service

---

## 18. Reporting & Analytics

### 18.1 Revenue Reports

| Report | Key Metrics |
|---|---|
| Revenue by Category | Base rental, protection products, equipment, fuel, mileage, tolls |
| Revenue by Location | Total revenue, rental count, ADR, RevPACD per location |
| Revenue by Vehicle Class | Revenue, days rented, ADR, fleet size |
| Revenue by Channel | Direct, OTA, corporate, insurance replacement, walk-up |
| Revenue by Driver/Traveler | For corporate accounts |

### 18.2 Fleet Utilization Reports

| Metric | Formula |
|---|---|
| Utilization Rate | Rental Days / Available Fleet Days × 100 |
| RevPACD (Revenue Per Available Car Day) | Total Revenue / Available Fleet Days |
| ADR (Average Daily Rate) | Total Rental Revenue / Total Rental Days |
| ALOR (Average Length of Rental) | Total Rental Days / Total Rentals |
| Idle Days | Days available but not rented, by vehicle/class/location |

Industry benchmarks: Airport locations 75–85% utilization; neighborhood 55–75%

### 18.3 Financial Reports

- AR Aging: 0–30, 31–60, 61–90, 90+ day buckets by customer/account
- Corporate Account Balance: outstanding invoices vs. credit limit
- Daily Settlement Summary: captured, refunded, net by payment method
- Pre-Auth Expiry Report: open auths expiring in next 48 hours
- Chargeback Report: disputes received/won/lost/fees
- Refund Report: by reason, by amount band

### 18.4 Tax Reports

- Tax collected by jurisdiction (state, county, city, special district)
- VAT/GST summary (collected vs. input, net payable)
- Tax-exempt transaction log
- Filing-frequency reminders per jurisdiction

### 18.5 Damage & Claims Reports

- Open damage claims by status
- Recovery rate: damage charged vs. collected
- Loss-of-use days and revenue impact by period
- Insurance recovery by insurer
- Damage frequency by vehicle class (identifies problem models)

### 18.6 Maintenance & Fleet Health

- Maintenance cost per vehicle, per class, per period
- Maintenance downtime (days blocked) by vehicle and location
- Vendor performance: avg repair cost, cycle time, repeat-repair rate
- Fleet age and mileage distribution
- TCO per vehicle class (acquisition + fuel + maintenance + insurance + end-of-life)

### 18.7 Operational Dashboards

- **Real-time fleet map**: vehicle positions, status, active rentals
- **Daily operations**: pickups scheduled, returns due, overdue, vehicles in maintenance
- **Counter KPIs**: average check-out time, upsell conversion rates, no-show rate
- **EV SOC fleet dashboard**: all EVs, SOC %, dispatch readiness, charger assignments

---

## 19. Compliance & Document Management

### 19.1 Per-Vehicle Documents

| Document | Notes |
|---|---|
| Insurance Certificate | Per vehicle; expiry tracked |
| Vehicle Registration | Per jurisdiction; expiry tracked |
| State Safety Inspection | Annual (jurisdiction-specific) |
| Emissions Test | Annual/biennial (jurisdiction-specific) |
| MOT (UK) | Annual after 3 years old |
| Certificate of Conformity | EU type-approval |
| Cross-Border Authorization | Short-term; per destination country |
| Lien Release | If financing paid off |
| Title | Permanent; no expiry |
| Recall Completion Certificate | Per recall, upon remedy completion |
| Lease Agreement | If leased |

### 19.2 Expiry Alert System

Alert schedule (configurable per document type):
- Insurance Certificate: 90, 60, 30, 14, 7 days before expiry
- Vehicle Registration: 60, 30, 14, 7 days
- Safety Inspection: 30, 14, 7 days

Alert levels: Far (>90 days), Upcoming (31–90), Urgent (8–30), Critical (1–7), Expired (≤0)

**Automatic actions on expiry**:
- Registration expired → hard block on vehicle dispatch
- Insurance expired → escalate to risk management + hard block
- Safety inspection expired → hard block in states with enforcement
- Emissions only → warning (enforcement varies)

### 19.3 Jurisdiction Compliance Matrix

A configurable table of which documents are required in which jurisdictions, their renewal frequency, and grace periods. Enables multi-state/multi-country operators to maintain compliance without manual tracking per location.

---

## 20. Mobile Applications

### 20.1 Customer Mobile App

- Search and book vehicles
- Manage existing reservations (modify, extend, cancel)
- Digital rental agreement (pre-sign before arrival)
- Digital key / QR code for express pickup (at participating locations)
- Live rental status: vehicle location, SOC (EV), return countdown
- EV: nearest charger finder, current SOC, proactive low-range alert
- Loyalty: points balance, tier status, redemption
- Push notifications: reminders, extensions, receipts, toll charges, damage notices
- Express return: drop key and close rental from app
- Stored payment methods management
- Receipt history and PDF download

### 20.2 Counter / Agent App (Tablet-Based)

- Full counter checkout and check-in workflow on tablet
- Mobile agent mode: approach customer in garage/lot (no fixed counter required)
- Pre-rental and post-rental inspection form with photo capture
- Digital signature capture on tablet
- Vehicle assignment and status management
- Print-free RA delivery (email or app)

### 20.3 Fleet / Inspection Mobile App

- Vehicle condition report with zone-by-zone checklist
- Photo capture with auto-annotation (zone label, timestamp)
- Damage marking on SVG vehicle diagram
- Works offline (sync when connectivity restored)
- Maintenance report submission
- Vehicle transfer receipt confirmation

---

## 21. Admin, Configuration & Security

### 21.1 System Configuration

- Location management: add/edit locations, hours, contact info, location type, concession fees
- Vehicle class and pool configuration
- SIPP code management and upgrade matrix
- Rate schedule management (all rate types, date ranges, blackout dates)
- Extras catalog management
- Turnaround buffer configuration per class/location
- Cancellation policy configuration
- Tax rate table management (or Avalara/TaxJar integration)
- Notification templates (email, SMS)
- User roles and permissions
- Branch-level vs. corporate-level access controls

### 21.2 Security

- **PCI DSS compliance**: no raw card numbers stored; all payment data tokenized
- **PII encryption**: driver's license images and personal data encrypted at rest
- **Role-based access control (RBAC)**: granular permissions per role per location
- **Audit logging**: all data mutations logged with user ID, timestamp, previous value
- **Multi-factor authentication (MFA)** for staff logins
- **Session management**: configurable timeout for counter sessions
- **API authentication**: OAuth 2.0 / JWT for all API access
- **Data retention**: configurable retention periods with automated purge for expired data
- **GDPR / CCPA compliance**: right to deletion, data export, consent management

### 21.3 Multi-Tenancy (Franchise Support)

- Schema-level or row-level tenant isolation
- Central rate management with location-level override capability
- Franchise royalty calculation and reporting (% of revenue per franchise period)
- Network-wide availability (book at one location, pick up at another — cross-location availability query)
- Corporate consolidation: chain-wide reporting across all franchisees
- White-label booking engine per franchisee (own branding, own domain)

---

## 22. Integration Architecture

### 22.1 Internal API

- REST API (JSON) — primary interface for all frontends and third-party integrations
- OpenAPI 3.0 specification (machine-readable, auto-generated client SDKs)
- Versioned (`/api/v1/`, `/api/v2/`) for backward compatibility
- Webhook system for reservation lifecycle events (created, modified, checked_out, returned, cancelled)
- Authentication: OAuth 2.0 client credentials (for server-to-server) + JWT bearer tokens (for user sessions)

### 22.2 Payment Gateway Integrations

- **Stripe**: primary for card processing, tokenization, pre-auth, incremental auth, refunds
- **Braintree (PayPal)**: alternative; strong PayPal wallet support
- **Adyen**: preferred for international/multi-currency operations
- Gateway-agnostic abstraction layer: swap payment providers without changing business logic

### 22.3 Communication Services

- **Email**: SendGrid / Mailgun / AWS SES — transactional emails (confirmation, receipts, damage notices)
- **SMS**: Twilio / AWS SNS — booking confirmations, return reminders, low-SOC alerts
- **Push notifications**: Firebase Cloud Messaging (Android) + APNs (iOS)

### 22.4 Identity Verification (KYC)

- **Jumio**: document OCR + liveness check
- **Onfido**: alternative KYC provider
- **Stripe Identity**: emerging option for operators already using Stripe

### 22.5 Mapping & Routing

- **Google Maps Platform**: geocoding, distance matrix, nearest charger routing
- **Mapbox**: alternative for white-label mapping, offline tiles

### 22.6 E-Signature

- **DocuSign** or **HelloSign / Dropbox Sign**: legally binding digital rental agreements
- In-app tablet signature: sufficient for counter and inspection scenarios

### 22.7 Accounting / ERP

- **QuickBooks Online API**: small-to-mid operators
- **Xero API**: international operators, especially Oceania/UK
- **NetSuite (Oracle)**: enterprise operators
- **SAP / Microsoft Dynamics**: enterprise franchise networks

### 22.8 Tax Calculation

- **Avalara AvaTax**: real-time US multi-jurisdictional tax; supports global VAT
- **TaxJar**: alternative for US operators; strong nexus management
- Self-managed rate table: viable for single-state operations only

### 22.9 Telematics

See §11 for provider list. Integration via provider REST APIs or webhooks; VIN-to-device mapping required.

### 22.10 OTA / GDS

- OTA Alliance XML over HTTPS for Expedia, Booking.com, Sabre, Amadeus, Travelport
- CarTrawler REST API for airline-ancillary integration
- Google Travel Connectivity Partner API
- Rate filing tool for GDS: Sabre Rate Access, Amadeus Rate Loader

### 22.11 Toll Processing

- **PlatePass**: dominant US aggregator (integrates with E-ZPass, SunPass, FasTrak, etc.)
- **eVinci**: alternative toll management platform
- Direct integrations with state toll authorities where aggregators unavailable

### 22.12 Vehicle Recall Data

- **NHTSA Recall API**: `https://api.nhtsa.dot.gov/recalls/recallsByVehicle` — batch VIN lookup
- **manufacturer recall feeds**: GM, Ford, Stellantis provide fleet recall EDI feeds

---

## 23. Data Model Overview

### 23.1 Core Entity Relationships

```
Locations (1)──────< Vehicles (many)
                        |
           ┌────────────┼────────────────────┐
           |            |                    |
    VehicleBlocks  MaintenanceOrders  VehicleInspections
           |                                 |
    Reservations ──────────────────> DamageIncidents
           |                                 |
    RentalAgreements                  DamageClaims
           |                                 |
       Invoices ──────────────────> Payments / Refunds
           |
    TollCharges / Violations
           |
    CorporateAccounts > Customers < LoyaltyAccounts
```

### 23.2 Key Tables

**vehicles**: vehicle_id, vin, plate, make, model, year, sipp_code, class_id, pool_id, home_location_id, current_location_id, status, odometer_current, fuel_level_pct, acquisition_cost, book_value, depreciation_method, fleet_type, in_service_date

**reservations**: reservation_id, confirmation_number, channel, booking_datetime, status, pickup_location_id, dropoff_location_id, pickup_datetime, return_datetime, actual_return_datetime, class_id, assigned_vehicle_id, customer_id, rate_code, base_rate, currency, extras_total, taxes_total, grand_total, deposit_amount, cdp_code, corporate_account_id, loyalty_member_number, insurance_replacement_flag, cancellation_policy_id

**customers**: customer_id, first_name, last_name, email, phone, dob, nationality, license_number, license_country, license_expiry, loyalty_number, loyalty_tier, loyalty_points, corporate_account_id, dnr_flag, dnr_reason, kyc_status, account_status

**invoices**: invoice_id, invoice_number, invoice_type, rental_agreement_id, customer_id, corporate_account_id, invoice_date, due_date, subtotal, tax_amount, total, payments_applied, balance_due, status, line_items[] (JSONB or normalized)

**payments**: payment_id, invoice_id, payment_method_type, amount, currency, gateway_ref, auth_code, status, captured_at, refunded_amount

**vehicle_inspections**: inspection_id, vehicle_id, reservation_id, type (pre/post), inspector_id, customer_id, datetime, odometer, fuel_level, zone_conditions[] (JSONB or normalized), customer_signature_id, notes

**maintenance_orders**: wo_id, vehicle_id, wo_type, plan_item_id, recall_id, incident_id, location_id, vendor_id, status, priority, scheduled_date, completed_date, odometer_at_service, labor_cost, parts_cost, total_cost, vehicle_block_id

**corporate_accounts**: account_id, company_name, cdp_code, rate_agreement_id, payment_terms, billing_cycle, credit_limit, direct_bill_enabled, allowed_classes[], cdw_waived, tax_exempt

---

## 24. Technology Stack Recommendation

### 24.1 Backend

**Primary recommendation**: Node.js with TypeScript (NestJS framework)
- Strong ecosystem for REST APIs and event-driven architecture
- First-class TypeScript reduces runtime errors
- Native async/await for IO-heavy operations
- NestJS provides structure comparable to Rails/Django without their performance limitations

**Alternative**: Laravel (PHP 8.2+) — most common in open-source rental software; well-understood; large talent pool; good for teams with PHP background

**Database**: PostgreSQL 15+
- Superior JSON support for semi-structured fields (telematics, extras, zone conditions)
- Row-level security for multi-tenant isolation
- Strong indexing for date-range overlap queries (vehicle availability)
- Mature replication and point-in-time recovery

**ORM**: Prisma (Node) or Eloquent (Laravel) — avoid raw SQL except for complex availability queries

**Cache / Session**: Redis
- Session store
- Rate query cache (availability results cached for 30–60 seconds under load)
- Real-time telematics event deduplication

**Message Queue**: Bull (Redis-backed, for Node) or Laravel Queues — for async jobs: toll processing, notification sending, telematics event processing, report generation

**Search**: Elasticsearch or PostgreSQL full-text search — for customer name lookup, fleet search

### 24.2 Frontend

**Booking Engine (Customer-Facing)**: Next.js (React) with TypeScript
- SSR for SEO on public booking pages
- Client-side for dynamic availability/rate updates

**Admin Dashboard**: React with Vite + shadcn/ui (Tailwind-based component library)
- Real-time fleet map: Mapbox GL JS or Google Maps JS SDK
- Data tables: TanStack Table (formerly React Table)
- Charts/dashboards: Recharts or Tremor

**Mobile Apps**: React Native (code sharing between iOS/Android)
- Customer app + Counter/Agent app + Fleet/Inspection app
- Offline support for inspection app (required in low-connectivity garage environments)

### 24.3 Infrastructure

- **Containerization**: Docker + Kubernetes (EKS/GKE for managed K8s)
- **CI/CD**: GitHub Actions or GitLab CI
- **Cloud**: AWS (primary recommendation) — RDS PostgreSQL, ElastiCache Redis, SQS, S3 for photos, CloudFront CDN
- **File Storage**: S3 + CloudFront for vehicle photos, inspection photos, scanned documents
- **Background Jobs**: ECS Fargate or K8s Jobs for long-running reports and batch toll processing
- **Monitoring**: Datadog or Grafana + Prometheus; Sentry for error tracking

### 24.4 Security Infrastructure

- **Secrets management**: AWS Secrets Manager or Vault
- **WAF**: AWS WAF on API Gateway
- **DDoS protection**: CloudFront + AWS Shield
- **PCI DSS scope reduction**: offload all card data to Stripe/Adyen (never touch raw PANs)
- **Audit logging**: immutable append-only audit log (AWS CloudTrail or application-level)

---

## 25. Gap Analysis vs. Open Source

Every major open-source rental car project is missing most of the following. These are where a production-quality system earns its differentiation:

| Feature Area | Open Source Status | This Spec |
|---|---|---|
| Yield / dynamic pricing | Absent — single flat daily rate | Full rate engine with duration tiers, yield rules, rate codes |
| OTA / GDS integration | Absent | OTA Alliance XML + CarTrawler + GDS connectivity |
| Telematics / GPS | Absent | Geotab, Samsara, Verizon Connect integrations + geofencing |
| Damage inspection app | Text field at best | Photo-annotated, zone-by-zone, AI damage flagging, digital signature |
| Loyalty program | Absent | Full tier/points/redemption engine with partner earn |
| Corporate accounts | "Company name" field | Full CDP, direct billing, cost centers, policy enforcement, EDI |
| Toll processing | Absent | PlatePass integration + per-event billing + liability transfer |
| Pre-auth lifecycle | Absent | Full incremental auth, expiry management, MCC 7512 optimization |
| Multi-tenancy / franchise | Absent | Row-level isolation, royalty reporting, central rate management |
| SIPP / class management | Flat categories | Full SIPP assignment, pool mapping, upgrade matrix |
| EV fleet support | Absent | SOC management, OCPP charging, range display, proactive alerts |
| No-show management | Absent | Grace period, auto-transition, proactive SMS, fee automation |
| Fleet lifecycle | Basic status field | Full acquisition→remarketing lifecycle with depreciation |
| Recall management | Absent | NHTSA API integration, safety-critical hard blocks |
| Compliance documents | Absent | Per-vehicle document tracking with expiry alerts and auto-blocks |
| Revenue recognition | Absent | ASC 606 compliant daily-basis recognition |
| Cross-border rentals | Absent | Per-vehicle authorization records, cross-border insurance docs |
| Audit logging | Absent | Immutable audit trail on all mutations |
| Mobile apps | Responsive web only | Native React Native apps for customer, counter, and fleet |
| GDS rate filing | Absent | Sabre/Amadeus rate file management |

---

*Document produced via multi-agent research consensus — June 2026. Research agents covered: open-source landscape, fleet/inventory domain, reservations/customer domain, payments/billing domain. Cross-referenced against TSD, RentWorks, Rent Centric, HQ Rental Software, Navotar, ERPNext, Odoo, and industry standards (SIPP/ACRISS, OTA Alliance, NHTSA, PCI DSS, ASC 606).*

---

# PART II — ADMIN MANAGEMENT WORKFLOWS & OPERATIONAL REQUIREMENTS

*This section defines how administrators configure, operate, and manage the system end-to-end. It covers every workflow an admin will perform: from entering a vehicle into inventory through pricing it, handling damage claims, managing staff, and controlling system configuration. Research conducted by three specialized agents covering fleet/inventory admin, rate/pricing admin, and damage/claims + general system admin domains — June 2026.*

---

## 26. Fleet & Vehicle Entry Administration

### 26.1 New Vehicle Entry Wizard (5-Step Flow)

Every new vehicle enters the fleet through a structured wizard that enforces data completeness before the unit becomes rentable.

**Step 1 — Identity & Acquisition**
- VIN entry triggers automatic decode: NHTSA vPIC API (free, covers all US vehicles) for make/model/year/trim/engine/body style. Optionally supplement with IHS Markit/Polk commercial API for complete color, options, and package data.
- Manual override available for any field the VIN decoder does not return (fleet vehicles, imports).
- Fields: VIN, year, make, model, trim/series, body style, doors, drivetrain (FWD/AWD/4WD/RWD), transmission (auto/manual), engine description, fuel type (gas/diesel/hybrid/EV/PHEV).
- Acquisition fields: acquisition type (purchase, lease, program car, daily rental fleet), acquisition date, purchase/lease price, vendor/dealer, PO number, odometer at acquisition.
- For leases: lease term months, monthly payment, residual value, mileage cap per year, excess mileage rate, lease-end date — all entered here and tracked against actuals.

**Step 2 — Specifications**
- Exterior color (primary and secondary), interior color, interior material.
- Seating capacity, cargo capacity.
- Fuel tank capacity (gallons/liters), EPA city/highway/combined MPG (or kWh/100mi for EVs).
- EV-specific fields: battery capacity (kWh), rated range (miles/km), charging port type (CCS/CHAdeMO/NACS/Type 2), onboard charger kW rating.
- Options and packages (multi-select from a configurable catalog): navigation, sunroof, leather, heated seats, third-row, tow hitch, backup camera, etc.

**Step 3 — Classification & Assignment**
- SIPP/ACRISS code: auto-calculated from specs using the 4-position algorithm:
  - Position 1 (Category): M=Mini, E=Economy, C=Compact, I=Intermediate, S=Standard, F=Fullsize, P=Premium, L=Luxury, X=Special, U=SUV, V=Minivan, W=Estate/Wagon
  - Position 2 (Type): B=2-door, C=2/4-door, D=4-door, W=Wagon/Estate, V=Passenger Van, L=Limousine, S=Sport, T=Convertible, F=SUV, J=All-terrain, X=Special
  - Position 3 (Transmission/Drive): M=Manual, N=Manual 4WD, A=Auto, B=Auto 4WD, D=Auto AWD, C=Auto 2WD
  - Position 4 (Fuel/AC): R=Gas/AC, N=Gas/no-AC, D=Diesel/AC, Q=Diesel/no-AC, H=Hybrid/AC, E=EV/AC, L=LPG/AC
  - System displays calculated code with position-by-position explanation; admin can override.
- Internal vehicle class assignment (maps SIPP to internal rate class — e.g., ECAR, CCAR, ICAR, SCAR, etc.).
- Home location assignment (primary branch).
- Fleet pool assignment (for pool-based upgrade matrix management).
- License plate entry (or "pending" if pre-delivery).
- State/jurisdiction of registration.

**Step 4 — Financial & Compliance**
- Depreciation method: Straight-Line (SL), Units of Production (UoP), or MACRS. For SL: useful life in months, salvage value. For UoP: lifetime mileage expectation. For MACRS: asset class.
- Target disposal mileage and/or age (triggers rotation workflow when reached).
- Insurance coverage confirmation (links to fleet policy; no per-vehicle entry needed unless self-insured).
- Compliance document upload: registration (file upload + expiry date), emission certificate (file upload + expiry date), safety inspection (file upload + expiry date). System sets expiry alerts at 60/30/7 days.
- Recall check: system queries NHTSA Recalls API by VIN at creation. Open recalls displayed; if safety-critical, unit is blocked from Available status until recall is resolved.

**Step 5 — Review & Activate**
- Summary of all entered data with inline edit links back to each step.
- Activation blockers checklist — unit cannot transition to Available until all items are green:
  - [ ] VIN entered and decoded
  - [ ] Vehicle class assigned
  - [ ] Home location assigned
  - [ ] License plate assigned (non-pending)
  - [ ] At least one photo uploaded (primary exterior)
  - [ ] Registration document uploaded and not expired
  - [ ] Pre-delivery inspection (PDI) completed
  - [ ] Telematics device assigned (if required by location policy)
  - [ ] No open safety-critical recalls
  - [ ] Depreciation method set
- Admin resolves any blockers; then clicks Activate → vehicle transitions to Available.

### 26.2 Bulk Vehicle Import

- CSV import template downloadable from the system with all required/optional column headers and data dictionaries.
- Pre-validation pass before import: system parses the file and reports errors row-by-row (missing required field, invalid SIPP code, duplicate VIN, unknown location code, etc.) without importing anything.
- Admin corrects errors in the CSV or uses inline error correction UI (edit cells in a browser-based grid before confirming import).
- Import preview: shows count of valid rows, count of error rows, count of duplicate VINs to skip.
- Admin selects action for duplicates: skip, or overwrite with new data.
- Import log: stored after completion — shows every row processed, result (created/skipped/error), and the specific error for any failures. Downloadable as CSV.
- VIN decode runs asynchronously on import in batches; admin sees a progress indicator and is notified when decode is complete.
- Imported vehicles land in Staging status, not Available — admin must run through any remaining activation steps.

### 26.3 Acquisition & Pre-Delivery Workflow

**PO / Acquisition Entry**
- Before vehicle physically arrives, admin creates an acquisition record: expected VIN or lot number, vehicle description (year/make/model from PO), expected delivery date, source (dealer, auction, OEM fleet program), PO/contract number, agreed price.
- Creates the vehicle record in "Pending Delivery" status.
- Pending Delivery dashboard: shows all units on order, grouped by expected delivery date, with days until expected and any delay flags.

**Delivery Confirmation**
- When vehicle arrives: admin opens the pending record, confirms VIN (enters actual VIN from delivered unit; system validates against expected and NHTSA decodes), confirms odometer, confirms physical condition matches expectation.
- Delivery date recorded (actual vs. expected).

**Pre-Delivery Inspection (PDI)**
- Structured checklist launched from the vehicle record.
- Inspection zones: Front, Driver Side, Rear, Passenger Side, Top/Roof, Interior, Under-hood, Undercarriage.
- For each zone: condition (OK / Minor Defect / Major Defect), free-text notes, photo upload (minimum 1 photo per zone with defect; minimum 1 photo per zone even if OK, for baseline record).
- Mechanical checklist: tire condition + pressure (all 4 + spare), fluid levels, brake pad condition, windshield wipers, all lights functional, horn, AC/heat, all electronic accessories.
- Interior checklist: all seats present and undamaged, all seatbelts functional, floor mats present, no odors, infotainment system operational.
- Digital signature from the staff member completing the inspection.
- PDI record is permanently linked to the vehicle and serves as the baseline for future damage claims.

### 26.4 Telematics & Toll Transponder Assignment

**Telematics Device Assignment**
- Admin opens vehicle record → Hardware tab.
- Selects telematics device from inventory of unassigned devices (searchable by device serial number, device type, provider).
- System links device serial to vehicle VIN; provider is notified via API (device provisioned to this vehicle).
- Data feed begins appearing in the vehicle's telematics panel within minutes.
- If device is replaced: unassign the old device (enters unassigned inventory), assign new device. Historical telematics data from old device is retained linked to the vehicle for that time period.

**Toll Transponder Assignment**
- Transponder inventory management: admin can bulk-add transponders by entering account numbers and tag IDs for each state/regional toll authority (E-ZPass, SunPass, FasTrak, TxTag, etc.).
- Assign transponder to vehicle: select from unassigned inventory by transponder ID or state.
- Transponder status: Active (in vehicle and billable), Unassigned (in drawer), Missing, Deactivated.
- When a vehicle is checked out to a customer, the system notes which transponders are assigned — used for toll billing attribution.
- Transponder audit: monthly reconciliation of transponder charges vs. toll events attributed to rentals; discrepancies flagged for review.

### 26.5 Photo Management

- Photo slots per vehicle: standard labeled set — Exterior Front, Exterior Driver Side, Exterior Rear, Exterior Passenger Side, Interior Front Seats, Interior Rear Seats, Dashboard, Cargo Area, Wheels/Tires, Odometer. Each slot accepts upload.
- Primary thumbnail: admin designates one photo as the primary — displayed in availability search results and on the rental agreement.
- Marketing vs. unit-specific: photos can be tagged "Marketing" (generic stock photo for the class — shown in OTA listings) vs. "Unit-Specific" (actual photo of this vehicle — shown at counter and in inspection app). OTA channels receive marketing photos; counter app shows unit-specific.
- Photo versioning: when new photos are uploaded, previous photos are archived (not deleted) — useful for damage dispute resolution.
- Bulk photo upload for a new vehicle batch: admin uploads a ZIP of photos named by VIN, and the system parses and assigns to the correct vehicle records.

### 26.6 Fleet Status Management

Valid vehicle statuses and the allowed transitions between them:

| Status | Description | Can Be Rented |
|---|---|---|
| Staging | Newly entered, activation incomplete | No |
| Available | Ready to rent | Yes |
| On Rent | Currently rented to a customer | No |
| Returning | Customer is in process of returning | No |
| Ready for Inspection | Returned, awaiting check-in inspection | No |
| Cleaning | Post-rental cleaning in progress | No |
| Maintenance | In scheduled or unscheduled maintenance | No |
| In Repair | In body shop for damage repair | No |
| Damage Hold | Damage discovered; awaiting assessment | No |
| Admin Hold | Held for operational reason (see 26.7) | No |
| Pending Disposal | Approved for disposition, awaiting auction/sale | No |
| Disposed | Sold, auctioned, or scrapped | No |
| Pending Delivery | Ordered but not yet delivered | No |

**Transition rules enforced by the system:**
- Available → On Rent: only via rental agreement creation (counter or reservation)
- On Rent → Returning: only via return initiation
- Returning → Ready for Inspection: automatic on return arrival
- Ready for Inspection → Cleaning: after no damage found at inspection
- Ready for Inspection → Damage Hold: if damage flagged at inspection
- Cleaning → Available: after cleaning complete
- Available / Cleaning → Maintenance: mechanic work order created
- Maintenance → Available: work order closed + inspection passed
- Damage Hold → In Repair: repair authorization approved
- In Repair → Ready for Inspection: repair completed
- Available → Admin Hold: admin places a hold
- Admin Hold → Available: hold released
- Any active status → Pending Disposal: manager initiates rotation

**Status change audit:** every status change is logged with: timestamp, previous status, new status, staff ID, reason code, and any linked record (work order, damage claim, rental agreement).

**Reason codes required for manual status changes:**
- To Maintenance: Scheduled PM / Recall Service / Unscheduled Repair / Pre-delivery Service
- To Admin Hold: VIP Hold / Fleet Event / Inspection Required / Documentation Hold / Training Vehicle
- To Damage Hold: Return Damage / Post-Return Damage Found / Customer Report
- To Pending Disposal: Age/Mileage Threshold / Damage Write-Off / Program End / Lease Return

### 26.7 Administrative Hold Workflow

- Admin places a hold from the vehicle record: select reason code, enter optional description, set expected release date (or "indefinite").
- Hold types with different behaviors:
  - **Duration Hold**: vehicle will be released automatically on the release date.
  - **Event Hold**: vehicle is blocked for a specific reservation (VIP, delivery vehicle, training demo). Released when the linked event ends.
  - **Documentation Hold**: vehicle blocked until specific documents are uploaded/renewed. Released automatically when the blocking document is updated to current.
  - **Manual Hold**: requires manual admin action to release.
- Bulk hold: admin can select multiple vehicles from the fleet list and place the same hold simultaneously.
- Overriding a hold requires manager-level permission and generates an audit log entry.
- Hold history is preserved on the vehicle record — not deleted when released.

### 26.8 SIPP Upgrade Matrix Configuration

The upgrade matrix defines which vehicle classes can be substituted for others when the reserved class is unavailable. Configured per location.

**Matrix UI**: Grid format with columns = available (substitute) classes and rows = requested (reserved) classes. Each cell = allowed substitution.

Cell states:
- **Auto**: system can automatically upgrade (no agent action needed); customer is informed of the upgrade at no extra charge.
- **Agent Offer**: agent must manually offer the upgrade to the customer at the counter.
- **Manager Approval**: upgrade requires manager authorization (typically used for cross-category upgrades, e.g., Economy → Luxury).
- **Not Allowed**: this substitution is not permitted.

**Configuration process:**
1. Admin navigates to Location Settings → Upgrade Matrix.
2. Grid is displayed with all active vehicle classes on both axes.
3. Admin clicks each cell to set the substitution policy.
4. Standard industry practices pre-populated as defaults (e.g., Economy can auto-upgrade to Compact, Compact can auto-upgrade to Intermediate, etc. — but Economy cannot substitute for SUV without manager approval).
5. Admin can set a global rule "Always allow Auto upgrade within same category, Agent Offer for one-category jump, Manager Approval for two+ category jumps" and then override specific cells.

**Fleet size targets per class**: Admin also configures target inventory levels per class per location (minimum and optimal fleet size). A gap analysis view shows current fleet count vs. target per class, highlighting shortfalls.

### 26.9 Vehicle Rotation & Disposal

**Rotation triggers (configurable thresholds):**
- Odometer reaches target mileage (e.g., 30,000 miles for standard rental)
- Vehicle age reaches target months (e.g., 18 months)
- Cumulative repair costs exceed X% of current book value
- TCO analysis indicates marginal cost exceeds defined threshold

**Rotation workflow:**
1. System generates a "Rotation Candidates" report — vehicles meeting any trigger condition.
2. Fleet manager reviews candidates and marks vehicles for disposal (individual or batch).
3. Vehicle transitions to Pending Disposal status — can still be rented if no replacement has arrived, or immediately taken out of service depending on condition.
4. Remarketing: admin records which disposal channel was used (auction, dealer trade-in, employee sale, rental fleet broker, private sale), sale price, sale date, buyer reference.
5. Disposal record links to the vehicle's financial record for final depreciation calculation and gain/loss on disposal recognition (book value vs. sale price).
6. Vehicle transitions to Disposed status — permanently removed from rentable fleet; retained in system for historical records.

**TCO View per vehicle:**
- Acquisition cost
- Total depreciation taken to date (by period)
- Current book value
- Total maintenance/repair costs (broken down by category: PM, unscheduled, damage)
- Total toll/violation costs
- Revenue generated (total rental revenue attributed to this unit)
- Net contribution (revenue minus all costs)
- Graphical lifecycle chart: cost accumulation vs. revenue over time
- Projected break-even and optimal rotation date

---

## 27. Rate & Pricing Administration

### 27.1 Rate Code Creation Wizard (7-Step Flow)

A rate code is the fundamental pricing container. Every rental is priced by looking up the applicable rate code(s) for the booking parameters.

**Step 1 — Rate Code Identity**
- Rate Code: alphanumeric, 4–8 characters (e.g., `WKDB`, `STDM01`, `CORPXYZ`). Must be unique system-wide. This is the code filed to GDS channels.
- Description: internal name (e.g., "Weekend Drive Special — Base").
- Rate Type: Retail / Corporate / Promotional / Government / Insurance Replacement / OTA Net / Wholesale. Controls which booking channels see it.
- Market Segment: Leisure / Business / Government (for reporting and channel filtering).
- Currency: defaults to location currency; can override.
- Status: Draft (not visible to booking engine until Activated).
- Effective Date Range: mandatory start and end date.

**Step 2 — Vehicle Class Rate Table**
For each vehicle class (SCAR, ECAR, CCAR, ICAR, SPAR, IFAR, SFAR, MVAR, FVAR, LDAR, PVAR, XPAR):
- Daily Rate (rate per day for 1–6 day rentals, or 1–29 days per configuration)
- Weekend Rate (flat fee for Friday-pickup/Monday-return rentals — distinct from daily rate)
- Weekly Rate (flat fee for 7-day rentals, not 7× daily)
- Extra-Weekly Rate (rate per day for days beyond one week, up to two weeks)
- Monthly Rate (flat fee for 28-day rentals)
- Extra-Day Rate (rate per day beyond monthly periods)
- Free Mileage Allowance: per day / per week / per rental / unlimited
- Excess Mileage Charge: per mile or per km
- "Calculate from Daily" helper: entering the daily rate and clicking populate fills weekly = daily × 6.5, monthly = daily × 24, using configurable multipliers

**Step 3 — Location Assignment**
- All Locations (global) / By Country or Region / Specific Location List / Location Group
- Location-level overrides: after assigning locations, an override grid appears (rows = locations, columns = vehicle classes, cells = override rate or blank to inherit base rate). Blank = inherit.

**Step 4 — Channel/Distribution Assignment**
Toggle per channel: Direct Web, Mobile App, Call Center, Counter, Sabre GDS, Amadeus GDS, Travelport GDS, specific OTA connections, corporate booking tools (Concur/Egencia/Deem).
- Channel-specific price adjustment: e.g., base rate + 12% on OTA channels to offset commission.
- Visibility start/end date per channel can differ from rate code effective dates.

**Step 5 — Policy Attachment**
- Minimum/maximum rental duration (days)
- Minimum driver age override
- Prepay required (Y/N)
- Cancellation policy code
- Guarantee type: credit card hold vs. prepay
- Geographic restrictions: no cross-border use, restricted states/countries
- Combinable with other promotions (Y/N)

**Step 6 — Taxes & Fees Template**
Select a tax template (bundle of applicable taxes/fees) or inherit from location default. Government rates may override to be tax-exempt.

**Step 7 — Review & Activate**
Summary of all configured parameters. Save as Draft (no booking-engine effect) or Activate (effective as of effective date).

### 27.2 Rate Calendar UI

**Grid/Spreadsheet View (primary)**
- Rows = Vehicle Classes; Columns = Date ranges (week or month navigation)
- Cells = Rate amount for that class/date combination
- Inline edit: click a cell to edit; drag-select a range and apply a bulk rate to fill all cells in the selection
- Color-coding: green = below market, yellow = at market, red = above market (if competitor feed integrated)
- Cells with seasonal overrides shown with a different background
- Cells with no rate configured shown as grey/striped (alerts admin to gaps)
- "Banding": admin selects start date, end date, enters a rate — system fills all cells in that band
- Utilization heatmap overlay: shows historical utilization so admin can spot rate/demand misalignment

**Timeline View**: horizontal calendar at top, rate code rows on left, date-range bands as colored bars — click a band to open an edit drawer. Better for visualizing seasonal structure.

**Export/Import**: Export current rate table to Excel; bulk update in Excel; re-import CSV for mass rate changes.

### 27.3 Seasonal Pricing Configuration

**Season Setup (in Pricing Calendar module)**
- Season Name: e.g., "High Summer", "Off-Peak Winter", "Spring Break", "Holiday Peak"
- Start/End Date or day-of-year for annual recurrence
- Season Code (short code for naming conventions and reports)
- Recurrence: one-time or annual (with date drift rules for floating holidays)
- Priority: when seasons overlap, which takes precedence?

**Holiday Calendar**: Named holidays with specific dates and drift rules (e.g., "Thanksgiving = 4th Thursday of November"). Referenced in blackout dates and yield rules.

**Seasonal pricing implementation options:**
1. **Separate Rate Codes per Season** (traditional approach): `STDM_SUM`, `STDM_WIN`, `STDM_HOL` — each with its own date range. Most common in enterprise systems.
2. **Season Multipliers on Base Rate** (modern approach): base rate code + season multipliers: Off-Peak = 0.85×, Shoulder = 1.0×, Peak/Summer = 1.25×, Holiday = 1.50×. Configured in the Seasons module.
3. **Absolute Seasonal Bands**: admin sets explicit rate per class per season. More deterministic, requires more data entry.

### 27.4 Yield Rules Engine Configuration

**Rule Definition Fields:**
- Rule Name and Description
- Scope: rate codes / vehicle classes / locations this rule applies to
- Trigger Condition (examples):
  - Fleet Utilization > X% for pickup date
  - Days to Pickup < N
  - Available units in class < N at pickup location
  - Booking velocity exceeds baseline pace (configurable threshold)
  - Competitor rate crosses a threshold (if rate shopping feed integrated)
- Action: increase/decrease rate by X% or $X amount
- Priority: governs which rule wins if multiple fire simultaneously
- Stacking mode: Highest priority wins / Additive / Multiplicative (configured globally or per rule group)
- Active date range and days-of-week applicability
- Override ceiling/floor flag: prevent this rule from pushing rates above a ceiling or below a floor

**Example Rule: "High Utilization Surge — SUV"**
- Scope: Classes IFAR, SFAR; All locations
- Trigger: Available SUV units at pickup location on pickup date < 10% of fleet
- Action: Increase all active retail rate codes for IFAR/SFAR by 15%
- Cap: pricing ceiling for IFAR ($89/day) — do not exceed
- Priority: 80

**Test Rule**: Enter a hypothetical scenario (location, date, class, current utilization %) and see which rules would fire and the resulting rate — before saving the rule.

**Rate Floors & Ceilings**
Configured in Revenue Controls module at multiple scope levels (global / rate code / vehicle class / location / season):
- Floor: minimum that any automatic adjustment can produce
- Ceiling: maximum that any automatic adjustment can produce
- Override permission: can a manual override bypass this floor/ceiling? (controlled by role)
- Yield rules are always evaluated against floor/ceiling; if a rule would breach them, the floor/ceiling value is used

### 27.5 Day-of-Week Pricing

Configured within the rate code on a "DOW Pricing" tab:
- 7-day grid (Mon–Sun) with modifier per day
- Mode: absolute amount (e.g., Fri = +$8/day, Sat = +$12/day) or percentage (Fri = +20%, Sat = +25%)
- Or index-based: Mon=100, Fri=125, Sat=130, Sun=110 (100 = base rate)
- Pickup day of week determines which modifier applies

Typical configuration: Mon–Thu = base rate, Fri = +15%, Sat = +25%, Sun = +5%.

**Weekend Rate Tier** is distinct from DOW modifiers: it is a flat fee for the entire Friday-to-Monday period, not a per-day surcharge on individual days.

### 27.6 Special Pricing Programs

**Advance Purchase / Early Booking Discounts**
- APR (Advance Purchase Rate) setup: rate code type = "Advance Purchase", days-in-advance threshold (7/14/21/30 days), discount (% off or absolute), prepay required = Yes, non-refundable cancellation policy.
- Tiered advance discount: 7+ days = 5%, 14+ days = 10%, 30+ days = 15% (each tier configured separately with its cutoff and discount amount).
- Booking engine calculates "days until pickup" at search time; rate is suppressed if threshold not met.

**Last-Minute Pricing**
- Surcharge (demand-driven): yield rule "if days to pickup < 1, increase rate by 20%".
- Last-minute discount: rate code with a maximum advance booking window (e.g., "only available if pickup is within 24–48 hours"); optional availability threshold trigger — when a location has > X% of a class sitting unused with pickup in the next 24 hours, system auto-activates a discount rate.

**Blackout Dates**
- Within each rate code, a "Blackout Dates" tab with:
  - Specific date ranges (e.g., Dec 23 – Jan 2)
  - Recurring annual exclusions (e.g., "every Thanksgiving week")
  - Holiday calendar selection
- Calendar widget: admin clicks days to block (shown in red); range selection or start/end entry for longer ranges.
- Two modes: pickup-date blackout (rate unavailable if pickup is in the blackout period) vs. rental-period blackout (rate unavailable if any day of the rental falls in the blackout period — stricter).

**Rate Cloning / Year-Over-Year Copy**
- Clone action on any rate code: creates a new rate code in Draft status with all source parameters; admin enters new code name, new effective date range, optional % adjustment applied to all class rates.
- Season Copy Wizard: copies all rate codes active during a source season (e.g., "Summer 2025") and creates equivalent codes for the target season (e.g., "Summer 2026") with a configurable date offset and bulk rate adjustment.

### 27.7 Rate Preview (Pre-Publication Simulation)

Admin tool that runs the full rating engine on a hypothetical search before activating rates.

**Inputs:** pickup location, return location, pickup date/time, return date/time, driver age, corporate code, promo code, channel simulation, mode (Production / Draft / Historical).

**Output:** all available rate codes for the search, sorted by price. For each: rate code name, vehicle class, duration tier applied, base subtotal, yield adjustments applied (labeled), taxes and fees itemized, total. Warning if any rate code has a misconfiguration (missing tax template, gap in date coverage, wrong currency).

**Draft vs. Live Compare**: side-by-side view of current active rate quote vs. what the draft rate would quote — lets admin confirm the impact of a change before going live.

**Rate Change Audit Log**: within each rate code, an Audit Trail tab shows every change: timestamp, user, field changed, old → new value. Global audit search: query by date range, user, rate code, location. Yield rule adjustments are logged attributed to "System — Yield Engine" with the rule name that triggered the change.

### 27.8 Corporate Account & Rate Administration

**Corporate Account Creation**
1. Company information: legal name, DBA, industry (SIC), primary contact, billing address.
2. CDP Code: admin enters a specific code or auto-generates following the configured format (e.g., `C` + 6 digits = `C001234`). Must be unique system-wide.
3. Account tier: Gold / Silver / Standard (controls service level, priority upgrades).
4. Payment terms: direct bill / credit card / centrally billed.
5. Credit limit (for direct bill accounts).
6. Invoice frequency: weekly, bi-weekly, monthly.
7. Account manager: assign internal staff member.
8. Status: Active / Inactive / Prospect.

**Corporate Rate Agreement Setup**
- Agreement Name + Contract Reference Number.
- Agreement period: start and end date.
- Class-level rate table per vehicle class per location (same grid structure as standard rate codes but scoped to this account's CDP code).
- Rate structure options:
  - **Flat Rate**: fixed dollar amounts per class (most common)
  - **Discount Off Retail**: X% off the current retail rate at booking time
  - **Net Rate**: specific rate regardless of retail
  - **Floor-Protected Discount**: discount off retail but not below a minimum floor
- Location availability matrix: grid showing which classes are available/guaranteed at which locations.

**Travel Policy Rules (per corporate account)**
- Maximum vehicle class allowed (e.g., compact for individual travel).
- Approved locations list.
- Required cost center / project code at booking (mandatory field enforcement).
- Supervisor approval required above $X total cost.
- Loyalty points: earned by employee vs. suppressed (common on direct-bill accounts).
- One-way rental permitted (Y/N, with one-way fee override).
- Young driver surcharge: waived (Y/N) — common corporate perk.
- Additional driver fee waiver (Y/N).
- Policy enforcement behavior: block booking / require justification code / allow but flag for audit.

**Contract Renewal Workflow**
1. Expiration alert sent to account manager 30–60 days before contract end (configurable).
2. Admin opens expiring agreement → clicks "Renew" → system creates draft renewal pre-populated with all current terms.
3. Admin adjusts rates for new period (typically 2–5% annual increase applied as bulk % adjustment).
4. Internal approval workflow (if required by org policy).
5. Activation: new agreement activates on start date; system auto-transitions from old to new agreement terms.

**Corporate Account Performance View (Performance Tab)**
- Total rentals, total revenue/spend, average daily rate, average rental duration (YTD, MTD, by period).
- Vehicle class mix: are employees booking within policy class?
- Location mix: most-used pickup locations.
- Channel mix: CBT vs. direct %.
- Volume vs. contracted minimums (if volume commitments exist).
- Individual renter report: employee-level rental history and policy compliance.
- Exportable to Excel/PDF for quarterly business reviews.

**Corporate Account List Management**
- Filter: status (Active/Inactive/Expired/Prospect), tier, industry, account manager, expiring within N days.
- Columns: company name, CDP code, tier, account manager, contract dates, YTD spend, YTD rentals, contract status, days until expiration.
- Bulk actions: export, bulk renew with rate adjustment, reassign account manager.

### 27.9 Promotional Code Management

**Creating a Promo Code**
- Promo Code string (customer-entered), description, discount type (% off / flat $ off / specific product / fixed rate override), discount value.
- Effective dates (when code can be entered); applicable pickup dates (when the rental can be picked up).
- Usage limits: total redemptions cap; per-customer limit.
- Minimum rental duration/value; applicable vehicle classes and locations.
- Channel restrictions (direct web only vs. also phone/counter).
- Combinable with other promotions (Y/N).
- Campaign tag for reporting grouping.
- Status: Draft → Activate to go live.

**Bulk/Unique Code Generation**
- For targeted campaigns: specify quantity (e.g., 5,000), code format (prefix + random segment, e.g., `VIP` + 8 alphanumeric = `VIPABC12345`), character set (avoid ambiguous characters for printed codes).
- System generates all codes in batch; export as CSV for upload to email marketing platform.
- All codes from a batch share a Campaign Batch ID for aggregate performance reporting.

**Usage Tracking Per Code**
- Total uses, total discount given, total revenue generated, unique customers, uses remaining (if cap configured).
- Daily usage trend chart.
- Transaction-level log: every booking using the code with booking reference, customer, location, discount amount.
- Alert at 80% of cap consumed.

**Deactivation**: one-click toggle to Inactive status; takes effect immediately; existing bookings unaffected; deactivation is logged.

### 27.10 Extras & Add-On Pricing Administration

**Creating an Extra Product**
- Extra Code (internal), display name (customer-facing), description, category (Protection / Equipment / Fuel / Other).
- ACRISS Extra Code for GDS compatibility (e.g., `Q` = CDW).
- Pricing model: Per Day / Per Rental / Per Week / Per Transaction.
- Base price; taxable (Y/N); maximum charge cap (e.g., CDW capped at 10 days for long rentals).
- Availability: all locations or specific list; mandatory at certain locations (e.g., road tax in some countries).
- Max units per rental (e.g., maximum 2 child seats).
- Vehicle class restrictions (some extras only available on certain classes).
- Display order in booking flow; image; T&C link.

**Location-Specific Extra Pricing**
After creating the extra, a Location Price Override Grid sets per-location pricing: blank = inherit product default. Location groups can be defined for pricing (e.g., "Premium Airport Group" = $14.99, "Standard Group" = $9.99).

**Bundle Configuration**
- Bundle type extra: admin selects component extras (e.g., CDW + RSA + PAI), sets bundle price (less than sum of components), defines component override behavior (components not charged separately when bundle is selected), exclusivity rules (prevents double-purchasing individual CDW if bundle selected).
- Display: shows savings vs. buying components individually.

**Age-Tier Pricing (Young Driver Surcharge)**
- Age range tiers with per-day or flat-per-rental surcharge: Age 18–20 = $25/day, Age 21–24 = $15/day, Age 25+ = $0.
- Overall minimum rental age (drivers below this are blocked, not surcharged).
- Location-level age rule overrides (critical — rules vary by jurisdiction; Germany, UK, etc. have different thresholds).

**Fuel Price Management**
- Fuel price table by fuel type (regular/premium/diesel) by location group; updated weekly (or via OPIS data feed integration).
- Prepaid Fuel Option (PFO) price = tank capacity × fuel price × markup factor (can be formula-driven or manually set).
- Fuel Service Charge (FSC): per-gallon premium + service fee for under-full returns.
- Admin reviews new price proposal before activation (even when auto-generated from feed).

### 27.11 Location Fee Configuration

**Airport Concession Recovery Fee (ACRF)**
- Calculation basis: % of base rate (most common, e.g., 11.11%), flat per-day, or flat per-rental.
- Display label: regulated in many jurisdictions (must say "Concession Recovery Fee").
- Taxable (Y/N) — varies by state.
- Applied automatically on all rentals at airport locations.

**Customer Facility Charge (CFC)**
- Flat per-day or per-transaction fee at ConRAC locations.
- Rate set by airport authority — must match exactly.
- Maximum days cap (some airports cap CFC at N days).
- Mandatory (Y), not optional.
- Typically not taxable.

**Tax Rate Management**
- Tax template per location: list of all applicable taxes with name, type (state sales tax / county rental tax / city tax / stadium tax / VLF / etc.), calculation basis, rate (%), cap, applicable base (base rate only vs. all charges), jurisdiction, effective dates.
- New tax rate: create a new record with effective date rather than editing existing (preserves historical accuracy for past bookings).
- Avalara/AvaTax integration: when enabled, the system sends transaction details to Avalara and receives fully calculated tax breakdown; admin only manages integration credentials and product tax code mapping — no manual rate maintenance required.
- Tax-exempt customers: admin can mark specific bookings or accounts as tax-exempt with reason code and exemption certificate reference.
- Tax report: total collected by type, period, location for remittance.

**Vehicle License Recovery Fee (VLF)**
- Flat per-day or % of rental rate; state-specific applicability; maximum charge cap where regulated.
- Configured alongside ACRF/CFC in the Location Fee module.

### 27.12 OTA / GDS Rate Management

**GDS Rate Filing**
- Rate codes designated as "GDS-eligible" at creation (adds required fields: ACRISS Rate Category Code, Rate Identifier for GDS, Rate Access Code, GDS description up to 24 chars for Sabre).
- GDS Filing Module: select rate codes, target GDSes (Sabre / Amadeus / Travelport), date range → Submit Filing → system generates and transmits XML messages → receives acknowledgment with filed status.
- Error log: rejected rates with error codes and corrections needed.
- Rate update filing: when rates change, run an updated filing for the affected codes and date ranges.
- Availability updates: transmitted near-real-time (or batch) as reservations are made.

**Channel Availability Configuration**
Per rate code, toggles per channel with channel-specific price adjustment (% markup or discount vs. base rate). Start/end visibility dates per channel can differ from rate code effective dates.

**Rate Parity Monitoring**
- Automated searches (daily or more frequent) comparing own direct rate to major OTAs for same search parameters.
- Results: direct rate vs. Expedia, Priceline, Cars.com, etc. per class per pickup date.
- Parity status: maintained (green), direct > OTA (red flag), direct < OTA (yellow).
- Alert threshold: "notify if direct rate exceeds any OTA rate by more than $5/day."
- Links each disparity to the relevant rate code for quick correction.

**Net Rate Configuration**
- Rate code type = "Net Rate" / "Wholesale" — not visible on direct channels.
- Net rate grid: class rates at the net level (what operator receives).
- OTA partner assignment; markup policy documented (contractual, not technically enforced in the system).
- Commission accounting: % commission field on the OTA channel assignment for commission-model OTAs.

---

## 28. Damage & Claims Administration

### 28.1 Return Inspection Workflow

**Pre-Return Preparation**
Before the customer arrives, the return agent pulls the existing rental agreement — system displays the pre-rental inspection record (photos, GOAL walk-around condition checkboxes, fuel level, mileage out, pre-existing damage notations) as the baseline comparison.

**Return Walk-Around**
1. Agent directs vehicle to inspection bay (covered, adequately lit).
2. Clockwise walk from driver front corner: body panels, glass, tires, interior, undercarriage (if customer reported unusual event).
3. New damage is photographed immediately: close-up of damage, wide shot showing damage in context of panel, shot showing license plate in same frame.
4. Damage noted on a Vehicle Damage Report (VDR) in the system — digital, linked to the rental agreement.

**Customer Acknowledgment**
- Customer present and invited to walk with agent.
- If customer agrees damage is new: digital signature on VDR.
- If customer disputes at the counter: agent notes dispute on VDR, escalates to manager immediately, does not allow customer to leave without (a) manager presence, (b) copy of VDR given to customer, (c) customer contact information confirmed.

**System Entry at Return**
1. Agent creates a damage incident in the system — auto-populated: rental agreement number, vehicle ID, return date/time, returning agent ID, customer ID.
2. Agent enters: damage description (structured fields: type, panel/zone, severity), photos uploaded, customer acknowledgment status.
3. System flags vehicle as "Damage Hold" — removed from available fleet until cleared.

**Automated Pre/Post Comparison**
- System displays pre-rental condition record side-by-side with the post-rental entry.
- Checkbox comparison: if a zone was "OK" at checkout and is now "Damaged," the system highlights the discrepancy automatically.
- Photo comparison panel: pre-rental photos on the left, post-rental photos on the right, per zone.
- Any discrepancy generates a "potential new damage" flag requiring agent resolution.

### 28.2 Damage Severity Classification

| Severity | Definition | Repair Cost Range | Who Handles |
|---|---|---|---|
| Minor (Cosmetic) | Single-panel scratch/scuff, < 6 inches, no structural damage | < $500 | Counter agent + branch claims coordinator |
| Moderate | Panel dent requiring filler/repaint, crack, broken single component (mirror, trim) | $500–$2,500 | Branch claims coordinator, manager approval |
| Major / Structural | Frame damage, multiple-panel, airbag deployment, flooding, rollover | > $2,500 | Regional claims manager + corporate risk |
| Total Loss | Repair cost > ACV (Actual Cash Value) | Exceeds ACV | Corporate risk/insurance + total loss adjuster |

**Specialty damage triggers** (separate sub-workflows): glass (chip repair vs. windshield replacement), tire (road hazard coverage check), interior (burn/flood/biological contamination), theft (partial or total).

**Escalation hierarchy:**
```
Counter Agent → documents, photographs, creates VDR, enters system, assigns severity
Branch Claims Coordinator → reviews within 24h, orders estimate, notifies customer, handles Minor claims
Regional Claims Manager → reviews Moderate/Major, approves repairs above threshold, handles insurer comms, reviews disputed claims
Corporate Risk / Legal → total loss, litigation threats, large subrogation, compliance-related data requests
```

### 28.3 Damage Claim Lifecycle

**Claim Creation**
- Auto-triggered by: agent flagging new damage at return, post-return lot inspection finding unreported damage, customer roadside self-report, third-party property damage report.
- System-generated claim reference number (format: CLM-YYYYMMDD-XXXXX).
- Required fields: linked rental agreement, vehicle ID + VIN, damage discovery date/time, discovered-by staff ID, damage description per zone using the vehicle diagram, damage type, customer presence and acknowledgment status, minimum 4 photos, pre-rental inspection reference, CDW/insurance status (pulled from rental agreement), estimated severity.

**Repair Estimate Process**
1. Claim coordinator sends vehicle to preferred body shop partner.
2. Body shop produces itemized estimate (labor hours × labor rate, parts cost with OEM/aftermarket flag, paint materials, sublet costs) using CCC ONE, Mitchell Estimating, or Audatex.
3. Admin enters estimate: repair facility, estimate date, labor hours/rate, parts cost, sublet, total, estimated repair duration (days — used for LOU calculation), PDF upload.
4. Multiple estimates: Minor claims = 1 estimate; Moderate/Major = 2 estimates, some policies require 3 if above $2,500 or $5,000.
5. Estimate comparison view: tabular format showing variance by line item with the approved/selected estimate flagged. Estimates differing > 15–20% trigger supplemental re-inspection.

**Authorization Levels (typical tiered structure)**

| Approver | Authorization Limit |
|---|---|
| Counter Agent | $0 (no repair authorization) |
| Branch Manager | Up to $500–$1,000 |
| Claims Coordinator | Up to $2,500 |
| Regional Claims Manager | Up to $10,000 |
| Corporate Risk / VP | Above $10,000 |
| Total Loss | Always requires corporate + insurer |

Authorization workflow: coordinator submits estimate → system auto-routes to correct approver based on dollar amount → approver reviews (photos, rental agreement, CDW status, estimate) → approve/reject with notes → system generates repair authorization document → body shop cannot commence until authorization is in system.

**Work Order Linkage**
- Repair authorization → system creates a work order linked to the claim ID.
- Vehicle status: Damage Hold → In Repair.
- Body shop marks complete → work order closed → vehicle becomes Ready for Inspection.
- Fleet manager inspects, approves quality → Available (or sends back for rework).
- Final repair invoice linked to claim; actual cost vs. estimated cost reconciled.

### 28.4 Loss of Use (LOU) Calculation

```
LOU Amount = Daily Rental Rate × Down Days × Utilization Factor

- Daily Rental Rate: operator's published or average daily rate for that class
- Down Days: from damage discovery through return to Available status
- Utilization Factor: if fleet utilization ≥ 80%, full LOU justified; below 80%, LOU is pro-rated
```

**LOU tracking in system:**
- System records: date vehicle taken out of service (damage hold date), date returned to available fleet.
- Running LOU total displayed on claim screen from day one.
- Admin can set manual LOU start/end dates if vehicle was partially usable or if delays fell outside the repair scope.
- System generates LOU summary document for inclusion in the claim package (shows utilization rate documentation, daily rate substantiation, repair timeline).

**Insurance company documentation requirements for LOU:**
- Fleet utilization report for the relevant period at the relevant location (pulled from system).
- Vehicle class utilization breakdown.
- Repair duration documentation (shop's promised vs. actual completion).
- Lost rentals log (reservations turned away due to shortage).
- Daily rate substantiation (rate schedule, competitive market documentation).

### 28.5 CDW / Insurance Claim Processing

**When customer had CDW**
- Confirm CDW was on the agreement and was not voided (voiding reasons: unauthorized driver, DUI, off-road use per agreement restrictions, non-reported accident delay).
- Check CDW exclusions (glass, tires, overhead, undercarriage may be excluded).
- Fully covered: no customer billing; record internally as CDW-absorbed loss.
- Deductible owed: bill deductible to card on file or send invoice.
- CDW voided: full customer recovery.
- Claim disposition flags: "CDW Covered" / "CDW — Deductible Applicable" / "CDW Voided."

**When customer has own insurance**
1. Obtain: carrier name, policy number, policyholder name, claims phone, policy dates.
2. File third-party claim with carrier; receive carrier claim number.
3. Send documentation package: rental agreement, pre-rental inspection, post-rental VDR + photos, estimate(s) + final invoice, LOU calculation, police report (if applicable), customer acknowledgment.
4. Admin tracks: carrier claim number, adjuster name, correspondence log (date, method, summary, next action + due date, uploaded documents).
5. Settlement offer received → compare to demand → accept/negotiate/dispute.
6. Settlement received → apply to claim → close with "Resolved — Insurance" disposition.

**When customer used credit card coverage**
- Customer submits claim to card issuer; card issuer's benefits administrator contacts operator requesting documentation package.
- Package: same as insurance claim + confirmation which card was used for payment.
- Track: card issuer claim number, benefits admin contact, documentation sent date, payment received.
- Note: card issuer pays the operator directly; customer is not involved in the payment step.

**Subrogation**
- Flag claim as "Subrogation Pending" when a third party (at-fault driver, manufacturer, etc.) may owe the operator.
- Subrogation target: third-party carrier, policy number, insured name.
- Separate correspondence log for subrogation target.
- Recovery received reduces operator's net loss on the claim.
- Subrogation recovery reporting feeds finance reconciliation.

### 28.6 Chargeback Handling

**Chargeback notification**: received from payment processor via webhook → system auto-creates or flags the associated claim → admin receives alert with response deadline.

**Evidence package** (auto-compiled by system):
1. Signed rental agreement
2. Pre-rental inspection record
3. Post-rental VDR + all photos
4. Customer signature on VDR (if obtained)
5. Repair estimate or final invoice
6. Timeline of customer notifications sent
7. CDW waiver confirmation
8. Transaction record (what was charged and when)

Package exported as single PDF formatted for card network submission.

**Timeline management**: response deadline displayed as countdown on claim screen; alerts at 7 days, 3 days, 1 day before deadline. Response submitted date logged.

**Resolution recording**: Win (chargeback reversed — "Recovered — Chargeback Win"), Loss (chargeback upheld — "Loss — Chargeback"), option to escalate to card network arbitration.

### 28.7 Customer Notification Workflow

**Initial notification (within 24–72 hours, varies by jurisdiction)**
- Letter/email: damage found, description, estimate being obtained, customer may be held liable per rental agreement, CDW/insurance status.
- Template auto-populated from claim details; coordinator reviews and sends.
- Method: email (primary) + certified mail for large claims (provides proof of delivery).

**Estimate notification**: repair estimate amount, LOU estimate, total demand amount, payment options, response deadline.

**Demand letter**: formal demand with documentation package; final deadline (typically 30 days) before collections or legal referral.

**Communication log per claim**: every notification logged with date sent, method, amount, staff who sent it. Customer response status tracked: Pending / Acknowledged / Payment Promised / Payment Received / Disputed / Unresponsive / Referred to Collections.

### 28.8 Claims Reporting

**Reports available to claims managers:**

- **Open Claims Aging**: all open claims sorted by days open (0–30, 31–60, 61–90, 90+); columns: Claim ID, Rental Agreement, Customer, Vehicle, Damage Type, Amount, CDW Status, Insurance Filed, Last Action Date, Coordinator.
- **Recovery Rate Report**: total incidents, claimed amounts, recovered amounts, recovery rate % — segmented by CDW-absorbed, insurance recovery, direct customer recovery, chargeback outcomes.
- **LOU Report**: total LOU claimed/recovered/absorbed by period, location, vehicle class; average days down per incident.
- **Chargeback Win/Loss Rate**: total received, won, lost, $ recovered, $ lost, win rate %; by reason code; by location.
- **Damage Incident Frequency**: incidents per 100 rentals, by location, vehicle class, rental duration.
- **Claims Cost Report**: total damage cost (repair + LOU) broken down by covered/recovered/net loss; by period, location, vehicle class.

**Regional manager rollup**: summary KPIs per location (incidents per 100 rentals, open claims count, recovery rate, LOU days, net loss $) with drill-down to location claim list; trend charts month-over-month; benchmarking vs. regional and system average.

---

## 29. User & Staff Management

### 29.1 Staff Account Lifecycle

**Creating a new staff account:**
- Required: legal name, employee ID (or auto-generated), email (login), phone (2FA), role assignment, home location, multi-location access list, start date, employment type, supervisor (for approval workflows), commission plan.
- System sends time-limited activation email; staff sets their own password; optional 2FA enrollment required on first login.

**Password reset**: self-service via email link (time-limited, single-use); admin-initiated password reset trigger. Admin cannot see passwords — only force a reset.

**Suspension**: status → Suspended; all active sessions for the user are immediately terminated; user cannot log in; data and audit trail are preserved. Reversible (unlike deletion).

**Offboarding**: accounts are suspended rather than deleted to preserve audit trail. For GDPR deletion: anonymize the user record (replace PII with placeholder like "Former Employee #12345"). Reassign all open tasks/claims owned by the departing staff member before suspension.

### 29.2 Role-Based Access Control (RBAC)

Standard role hierarchy with permission scopes:

| Role | Key Capabilities | Cannot Do |
|---|---|---|
| Counter Agent | Create/view/modify reservations; check in/out; process payments; record damage | Edit rates; access reports; view other agents' transactions; access customer financial data beyond current transaction |
| Senior Agent / Lead | All agent capabilities + discretionary discounts up to threshold; small refunds; location utilization view; minor system override | Rate creation; system config; staff management |
| Branch Manager | Full agent + location reporting; staff scheduling; rate override (within limits); refund approval to threshold; minor damage claims; vehicle fleet management for their location; local DNR additions | System config; cross-location access beyond scope |
| Claims Coordinator | Full damage claims access across assigned locations; repair estimate/authorization within threshold; insurance/CDW processing; LOU; customer notification; claims reporting | Rental operations; rate changes; fleet management |
| Regional Manager | Read access all locations in region; regional reporting; branch manager overrides; cross-location fleet reassignment; staff account management for region | System configuration |
| Fleet Manager | Vehicle status; maintenance scheduling; work orders; vehicle acquisition/disposal; compliance documents | Rental pricing; customer data; financial reports |
| Finance / Accounting | Financial reports; refund/credit approval; payment reconciliation | Operational workflow items (reservations, check-in/out) |
| System Administrator | All system configuration; user account management; integration management; audit log access; notification templates | Rental operations in most configurations (principle of least privilege) |
| Super Admin / Owner | Full access | — |

**Location scope** is separate from role capabilities: a claims coordinator may have "manage claims" permission scoped only to locations 3, 7, and 12. A regional manager has "view reports" scoped to all locations in Region: Southeast. Global permissions (system config, user management) are always restricted to System Admin and Super Admin.

### 29.3 Staff Activity & Commission Tracking

**Activity logging**: every action is logged with timestamp, user ID, action type, record affected, before/after values, IP address, session ID. Filterable by user, date range, action type, location, specific record ID. Export to CSV.

**Per-agent performance metrics**: rentals processed, upsell conversion rate (CDW sold %, GPS %, fuel %), average transaction value.

**Commission plan configuration**: rules per role/location (e.g., 3% of extras sold, $2/CDW upsell). Period-end commission report shows earned commission by plan component per agent. Optional leaderboard (location-level ranking by upsell conversion).

---

## 30. Location & Branch Management

### 30.1 Adding a New Location

**Required configuration sections:**

**Identity & Contact**: location name, short code (used in system IDs and reservation numbers), legal entity association, physical address, GPS coordinates, phone, email, airport code (if applicable).

**Operational Settings**: location type (airport/downtown/neighborhood/delivery-only/hub), hours of operation per day of week, holiday schedule (one-off exceptions per date), time zone, after-hours key drop (enabled/disabled), minimum rental age (may override corporate default), allowed vehicle classes, maximum fleet size.

**Financial Settings**: applicable tax template, currency, payment methods accepted, security deposit rules.

**Policy Overrides**: turnaround buffer per vehicle class (time between return and next available pickup), no-show grace period, local cancellation policy, local extras catalog (which extras offered at this location).

**Staff & Management**: assign branch manager; assign location to a region/district.

**Integrations**: OTA channels this location feeds; telematics provider; body shop partner associations.

### 30.2 Hours of Operation & Booking Availability

- Hours per day: open time, close time, or "closed all day."
- Holiday schedule: one-off date exceptions.
- Online booking availability: system prevents new bookings for pickup times outside operating hours (configurable: hard block vs. soft warning).
- Last rental out time: set earlier than closing (e.g., last rental out 30 minutes before close).
- After-hours returns: key drop allows returns after close; no after-hours check-out by default.

### 30.3 Extras Catalog per Location

Global extras catalog is configured system-wide, but availability is controlled per location:
- Enable/disable any extra per location.
- Set location-specific pricing (overriding corporate price).
- Set inventory limits for physical extras (GPS, child seats): total units / currently rented / available / in service tracked per location.

### 30.4 Branch Closure Management

**Temporary closure (weather, maintenance):**
1. Admin sets closure date range and reason.
2. System blocks new bookings for the closure period.
3. Existing reservations in the closure window are flagged.
4. Customer service contacts affected customers: reschedule, transfer to nearest location, or cancel without penalty.
5. Fleet may be reassigned to other locations or held.

**Permanent closure:**
1. Set permanent closure date; all future reservations must be resolved before that date.
2. Fleet redistribution workflow to other locations.
3. Staff accounts suspended or reassigned.
4. Location status → "Closed" (retains historical data; no new transactions).
5. OTA channels for that location deactivated.

---

## 31. Customer Service Administration

### 31.1 Customer Lookup & Profile

**Search by**: first/last name (partial match), email, phone, driver's license number + state, loyalty membership number, reservation/rental agreement number, credit card last 4 (restricted access), customer ID.

**Customer profile view**: full rental history (agreement number, location, vehicle, dates, rate, extras, total charged, return condition), linked damage claims, payment history (charges, refunds, credits), complaint/case history, loyalty points history, communication history, agent notes log.

### 31.2 Modifying an Active Reservation

- Admin opens reservation; modifies: pickup/return date-time, vehicle class (upgrade/downgrade), location, add/remove extras, change rate code (with appropriate permission).
- System re-quotes rate for new parameters; agent confirms with customer.
- Modification reason code required.
- Version history preserved: original terms → modified terms, agent ID + timestamp.
- Customer receives modification confirmation.

### 31.3 Rate Override & Goodwill Discounts

**Rate override**: change base rate to a specific dollar amount or apply a % override. Requires permission level commensurate with discount size.

**Goodwill discount tiers**:
- Small (up to 10% / $25): agent-level, no approval.
- Medium (up to 25% / $100): senior agent or manager approval.
- Large (free rental day or > $100): manager approval required.

Every override/discount requires reason code + free-text justification. Full audit trail. Reports: total goodwill discounts by agent, reason, location, period.

### 31.4 Refund & Credit Administration

**Refund (to original payment)**: amount, reason code, free text. Approval routing: small refunds (agent authority), large refunds (manager or finance). Processes via payment gateway integration or records for offline processing. Customer notified; audit trail logged.

**Account credit (future rental)**: applied to customer's account as dollar credit; appears on next rental; configurable expiry (typically 12 months); visible on customer profile.

**Approval workflow**: below agent threshold = auto-approved immediately; above threshold = routes to manager approval queue with notification.

### 31.5 Do Not Rent (DNR) List Management

**Adding a customer to DNR:**
- Required: reason code (fraud, damage non-payment, abusive behavior, insurance fraud, DUI in rental, etc.), free-text description, supporting documentation upload, effective date, expiration date or permanent flag, added-by agent ID.
- Scope: location-level / regional / system-wide.
- Customer is not notified (confidential operational record).

**DNR check**: system cross-checks at reservation creation and at check-out. Match triggers agent/manager alert; reservation is blocked or flagged for review.

**DNR review queue**: entries older than X months are flagged for periodic review — is the restriction still warranted? Manager can remove with reason.

**DNR reporting**: total active entries, new additions per period, reason code distribution, blocked reservation attempts.

### 31.6 Complaint Management

- Complaint linked to customer profile + optionally to a rental agreement.
- Fields: category (vehicle quality / service attitude / billing / damage dispute / booking error / etc.), severity (Low / Medium / High / Escalated), description, desired resolution.
- Status workflow: Open → In Progress → Pending Customer Response → Resolved / Closed.
- Resolution notes + resolution type (refund, goodwill, apology, no action, etc.).
- SLA timer per severity; auto-escalate to manager if SLA is breached.
- Reports: complaint volume by category, average resolution time, SLA compliance rate, root-cause trends.

---

## 32. Reporting & Dashboard Administration

### 32.1 Role-Sensitive Main Dashboard

Dashboard panels are filtered by the viewer's role:

**Branch Manager home dashboard**: today's pickups/returns due; current on-rent count; overdue returns; fleet availability by class; revenue today/week/month (vs. prior period); open damage claims; reservations needing attention; low-inventory alerts; staff on shift.

**Regional Manager**: rollup view — same metrics aggregated across region; location comparison table; anomaly alerts (locations deviating significantly from trends).

**System Admin**: system health (integration status, error counts, active sessions); recent user activity alerts; pending approval queue.

### 32.2 Scheduled Reports

- Admin selects a report, configures parameters (location scope, date range type — e.g., "last week"), output format (PDF / CSV / Excel).
- Schedule: daily, weekly (day of week), monthly (day of month).
- Recipients: email address list (can include non-system users for email-only distribution).
- Enable/disable without deleting the schedule.
- Delivery log: history of scheduled sends, success/failure status, timestamp.

### 32.3 Custom Report Builder

- Drag-and-drop field selector: choose from available data dimensions and measures.
- Filter builder with AND/OR logic.
- Grouping, sorting, chart type selection (bar, line, pie, table).
- Save as named report (personal or shared).
- Saved reports appear alongside standard reports — no developer involvement required.
- Complex analytics: handled via data export + external BI tool (no SQL exposure in the UI).

### 32.4 Data Export

- Any report or data view: export to CSV, Excel, or PDF.
- Export actions logged in audit trail (who exported what, when).
- Sensitive exports (customer PII, financial data) require additional authorization or generate a security alert.

### 32.5 Hierarchical Data Navigation

- System → Region → Location → Specific Record
- Regional reports aggregate with drill-down: click a location in a regional summary to open the same report filtered to that location.
- Role-based report access: reports not shown in menu if user has no access (enforced at UI layer and API layer independently).

---

## 33. System Configuration Management

### 33.1 Notification Template Administration

- Template list: name, type, last modified, last modified by.
- Editor: WYSIWYG or raw HTML editor with merge variable insertion UI ({{customer_name}}, {{rental_agreement_number}}, {{pickup_date}}, etc.).
- Preview with sample data; test send to an email address before publishing.
- Multi-language variants: system selects based on customer language preference.
- Template versioning: previous versions saved; admin can roll back.
- Publish workflow: Draft → Preview → Publish (optionally requires second admin approval).

### 33.2 Cancellation Policy Configuration

- Multiple named policies: "Flexible", "Standard 48-hour", "Non-refundable", "Peak Season".
- Each policy defines window tiers and fee rules: cancel > 48h = full refund; cancel 24–48h = 50% refund; cancel < 24h = no refund; no-show = full charge + no-show fee.
- Policies assigned to: rate codes, booking channels, customer tiers, specific locations.
- Assignment priority order (when multiple assignments conflict, priority determines which policy applies).
- Effective dating: changes apply to new bookings only, not existing.

### 33.3 Operational Policy Settings

**Turnaround buffer**: per vehicle class per location — minimum time between scheduled return and next available pickup. Temporary override capability for peak events.

**No-show grace period**: per location — how long after scheduled pickup time the system holds the vehicle before triggering no-show processing (e.g., 30 minutes standard, 60 minutes for prepaid). After grace period: reservation flagged, vehicle optionally released to availability, no-show fee process triggered.

**Fee schedule**: fee types (late return per hour/flat; no-show fee; young driver surcharge per day; one-way drop fee; additional driver fee; out-of-hours fee; cleaning fee; refueling service charge per gallon + service markup). Per-location fee overrides; future effective dates for fee schedule changes.

**System-wide settings**: date/time format, distance unit (miles/km), fuel unit (gallons/liters), fiscal year start month, default pagination size, session timeout duration, password complexity policy (min length, complexity, expiry), 2FA requirements (all users / admin roles only / optional), concurrent session limit.

### 33.4 Currency & Exchange Rate Management

- Base currency per legal entity; supported currencies list.
- Exchange rates: manually entered or pulled from a rate feed (ECB or open exchange rates API).
- Rate update frequency: daily, weekly, or on-demand.
- Rate history stored for financial reconciliation.
- Display currency (customer view) vs. billing currency (transaction currency); display rate applied on the customer side.

---

## 34. Loyalty Program Administration

### 34.1 Points Balance Adjustment

- Find member profile → Points Adjustment form.
- Adjustment type: bonus / correction / expiration override / forfeiture reversal.
- Amount (positive = add, negative = subtract), reason code + free text, authorized-by.
- Logged as a transaction in member's points history: date, type, amount, reason, admin ID.
- Member notification: configurable (notify or not per adjustment type).

### 34.2 Manual Tier Override

- Admin can override the system-calculated tier.
- Fields: new tier, effective date, expiration date (for temporary upgrade) or permanent flag.
- Reason: complaint resolution, VIP designation, promotional upgrade, error correction.
- If temporary: system auto-reverts to calculated tier at expiration.
- If permanent override: system does not auto-downgrade at period end.

### 34.3 Promotional Campaign Configuration

- Campaign: name, description, start/end date, eligibility (all members / specific tiers / new members / specific locations), trigger (rental completed / rental at specific location / specific class / referral), reward (bonus points flat or multiplier, bonus tier night credit), max reward per member, budget cap (max total points to issue).
- System evaluates eligible transactions automatically and awards bonus points.
- Campaign performance report: transactions enrolled, members earned, total points issued, budget consumed.

### 34.4 Loyalty Program Reporting

- **Enrollment**: new members per period, total active members, enrollment conversion rate.
- **Activity**: active members (rented in last 12 months), average rentals per active member.
- **Earn/Redemption**: average points per rental, total issued; total redeemed, redemption rate, average redemption value.
- **Breakage**: points expired without redemption (liability reduction for accounting).
- **Tier distribution**: count per tier, movement between tiers per period.
- **Financial impact**: estimated liability (unredeemed points at redemption value), redemption cost per period.

---

## 35. Compliance & Document Administration

### 35.1 Vehicle Document Management

**Document types**: vehicle registration, fleet insurance certificate, emission/safety inspection certificate, commercial vehicle permit, roadworthiness certification.

**Upload workflow (per vehicle):**
1. Vehicle profile → Documents tab → select document type.
2. Upload file (PDF/JPG).
3. Enter: document number, issuing authority, issue date, expiry date.
4. System sets alert thresholds: 60 / 30 / 7 days before expiry.
5. Document status: Current / Expiring Soon / Expired.

**System enforcement**: if a required document is expired, vehicle is flagged. Optionally blocks the vehicle from being rented until renewed (configurable per document type and jurisdiction).

### 35.2 Compliance Dashboard & Bulk Renewal

**Expiring Documents Fleet View**: list of all vehicles with any document expiring within X days (configurable). Filters: by location, document type, expiry window (next 30/60 days, already expired). Sortable by expiry date. Bulk action: select multiple vehicles, trigger task or reminder for fleet manager.

**Bulk Renewal Workflow:**
1. Admin selects multiple vehicles from expiring documents list.
2. Selects document type to renew.
3. For each selected vehicle: uploads new document file, enters document number, new expiry date.
4. If a single document applies to all selected (e.g., fleet-wide insurance certificate): single upload to all.
5. System updates each vehicle's document record.
6. Audit log: who performed the bulk renewal, when, what was changed.

**Compliance Status Matrix Report**: rows = vehicles, columns = document types, cells = status (Current/Expiring/Expired). Filter by location, status, document type, vehicle class. Export to Excel for regulatory submission or internal audit.

---

## 36. Integration & API Administration

### 36.1 OTA Channel Configuration

Per OTA partner (Expedia, Booking.com, Rentalcars, Kayak, etc.):
- Enable/disable toggle.
- Credentials: API key, shared secret, merchant ID (stored encrypted).
- Rate plan mapping: which internal rate codes map to OTA rate categories.
- Location mapping: internal location codes to OTA location codes.
- Inventory allocation: % of fleet to make available on this channel.
- Markup/adjustment: rate adjustment applied to this channel.
- Cancellation policy for this channel's bookings.
- Sync frequency: real-time push or scheduled pull.
- Connection test: on saving credentials, system sends a ping to OTA API and displays connection status: Connected / Connection Error / Credentials Expired.

### 36.2 Telematics Provider Integration

Per provider: API endpoint, credentials, vehicle matching method (by VIN or plate number). Vehicle mapping: link each telematics device to the internal vehicle ID. Admin can enable/disable data fields accepted and stored. Alert configuration: fuel below X%, vehicle outside geofence, fault code detected.

### 36.3 API Key Management

- API key list: name/description, associated partner, created date, last used, expiry, permissions scope.
- Create: name, partner, scope (read-only / booking management / fleet data / etc.), expiry.
- Key value shown only once at creation (copy-it-now pattern); stored hashed.
- Rotate: generate new value; old key deactivated after a configurable grace period.
- Revoke: immediate deactivation.
- Per-key rate limiting: max requests per minute/hour.
- Per-key IP whitelist (optional).
- Usage log: last N requests per key (timestamp, endpoint, response status).

### 36.4 Webhook Management

- Webhook list: URL, event types subscribed, status, last delivery.
- Create: URL, shared secret (for HMAC signature verification), event type subscriptions (reservation.created / rental.closed / damage.reported / payment.received / etc.).
- Test delivery: send a sample payload to verify endpoint is reachable.
- Delivery log: timestamp, event type, HTTP response code, latency, success/failure.
- Retry policy: exponential backoff on failure (1m, 5m, 30m, 2h) for up to 24 hours.
- Enable/disable without deleting the webhook.

### 36.5 Integration Health Monitoring

- Status board: all integrations with current status (healthy / degraded / down).
- Status determined by: last successful API call timestamp, error rate in last hour, last sync timestamp.
- Alert threshold: if OTA feed hasn't synced in X minutes, admin is alerted (email + dashboard).
- Error log: recent API errors with error message and response from integration partner.
- Manual re-sync trigger: admin can force a re-pull of data from a channel.

---

## 37. Audit & Security Administration

### 37.1 Audit Log Viewer

**Fields captured for every event**: timestamp (UTC), actor (user ID, name, role, IP, session ID), action type (create/read/update/delete/login/logout/export/config change), resource type and ID, change detail (before/after values for each changed field), result (success/failure).

**Search and filter**: date range, actor, action type, resource type, resource ID, location, IP address, success/failure, free text.

**Export**: filtered results to CSV or PDF; export itself is logged.

**Immutability**: audit logs are write-once; no user (including Super Admin) can modify or delete an entry. Enforced at the data layer (append-only storage or cryptographic chaining). Minimum retention: 2–5 years.

### 37.2 Security Alerts & Monitoring

**Failed login threshold**: X failed attempts in Y minutes → account lockout (temporary, configurable duration) + email alert to account owner + alert to System Admin.

**Unusual access patterns (configurable detection rules)**:
- Login from a new country or IP range not seen for this user in 90 days.
- Login during unusual hours for this user's historical pattern.
- Bulk data export (large record count) by a user who rarely exports.
- Multiple accounts logged in from the same IP simultaneously (potential credential sharing).
- Mass update or delete actions in a short time window (potential insider threat).

**Alert queue**: visible to System Admin with timestamp, user, alert type, details, status (New / Reviewed / Dismissed / Escalated). Admin can mark reviewed + add notes. Retention: minimum 1 year.

### 37.3 Session Management

- Active sessions list: user name, role, location, IP address, login time, last activity.
- Force logout: admin can terminate any session; user's next action prompts re-authentication.
- Session timeout policy: global inactivity timeout (e.g., 30 minutes) with role-based exceptions.
- Concurrent session limit: optionally limit users to 1 active session at a time.
- All forced logouts logged in audit trail.

### 37.4 Data Privacy Compliance (GDPR/CCPA)

**Data Subject Access Request (DSAR)**:
- Admin searches by customer email/ID → system generates comprehensive export of all personal data: profile, rental history, communications, loyalty account, damage claims, complaint records, audit log entries related to this customer.
- Output: structured JSON + readable PDF summary.
- Export is logged; target turnaround: 30 days (GDPR).

**Right to Erasure (Right to Be Forgotten)**:
- Admin reviews request; checks for legal holds (active disputes, unpaid claims, regulatory retention requirements).
- If no hold: system anonymizes the customer record (replaces PII with placeholder; retains transactional records for accounting).
- Anonymization is logged with a non-PII reference; cannot be undone.

**Regulatory / Law Enforcement Requests**:
- Data export scoped to specific records, customer, or date range.
- Chain-of-custody documentation generated (what was exported, when, by whom, in response to what request reference number).
- Export logged with regulatory request reference.

---

## 38. Cross-Cutting Admin System Requirements

### 38.1 Approval Queue / Workflow Engine

A generalized approval queue serves multiple modules:

- Item types: refund requests, discount overrides, damage claim authorization, repair work order, account credit issuance, DNR addition, rate code activation.
- Routing rules: based on amount, item type, location, and role hierarchy (auto-routed, no manual assignment).
- Queue UI: approver sees all pending items; can approve, reject, or return-for-revision with notes.
- SLA timers on approval queues with auto-escalation.
- Notification to submitter on approval/rejection.
- All approval decisions logged with rationale.

### 38.2 Document Management Sub-System

All modules generate and consume documents (rental agreements, damage reports, repair estimates, insurance correspondence, compliance certificates, customer notifications, demand letters):
- All documents linked to the relevant record (rental, claim, vehicle, customer).
- Versioned: Draft → Final.
- Access-controlled: who can view/download each document type.
- Retained per configurable retention policy.
- Bulk export capability for legal/compliance requests.

### 38.3 Centralized Notification Engine

- Channels: email, SMS, in-app notification.
- Templates managed as in Section 33.1.
- Delivery tracking: sent, delivered, opened (email), failed.
- User notification preferences: customers and staff configure preferences where permitted.
- Suppression: do-not-email lists, regulatory opt-outs.
- Scheduled delivery: notifications can be queued for specific send times.

### 38.4 Multi-Tenancy / Franchise Configuration Model

If the system serves multiple operators (SaaS platform for multiple rental companies):
- **Data isolation**: each operator's data is strictly isolated at the row level.
- **Configuration cascade**: Platform defaults → Operator defaults → Regional defaults → Location settings (each level can override the level above).
- **Billing isolation**: each operator billed separately for platform usage.
- **Scope separation**: Platform-level Super Admin (vendor) vs. Operator-level Super Admin (tenant) — operator admins cannot see other operators' data.
- **Royalty/franchise reporting**: if operators are franchisees of a master brand, royalty calculation reports based on gross revenue per operator.

---

*Admin workflows section produced via three specialized research agents — June 2026. Covers: fleet/vehicle entry admin, rate/pricing admin (including GDS filing, yield rules, corporate accounts, promotional codes), damage/claims admin (full lifecycle from discovery through subrogation and chargeback), and general system administration (RBAC, location management, customer service tools, audit, compliance, and integration management). Cross-referenced against Infor Flex, CARS+, Rentworks/BARS, HQ Rental Software, TSD, Navotar, enterprise CDP/corporate rate practices, OTA Alliance XML, GDS CARS filing protocols, Visa/MC chargeback frameworks, and GDPR/CCPA compliance requirements.*

---

# PART III — COMMERCIAL DEPLOYMENT COMPLETIONS

*This section documents gaps identified during a five-agent commercial readiness review (June 2026). Each section adds requirements that were absent from Parts I and II but are necessary for a day-1 production deployment. Agents reviewed: commercial launch readiness, customer experience, counter operations, technical architecture, and financial/regulatory compliance.*

---

## 39. Platform & Commercial Deployment Requirements

### 39.1 Operator Onboarding Wizard

A new rental company signing up to the platform must be guided through a mandatory, linear setup sequence before their first rental can be processed. This is distinct from the vehicle-level entry wizard (§26.1) — it operates at the company level and gates the entire platform.

**Onboarding wizard steps (enforced in order):**

**Step 1 — Company Profile**
- Legal company name, trading name/DBA, company registration number, VAT/tax ID, primary address, billing address, country of operation.
- Time zone (default for new locations), currency (default billing currency).
- Company logo upload (used on rental agreements, receipts, and customer-facing emails).
- Primary contact: name, title, email, phone.

**Step 2 — First Location**
- Mirrors the full location setup form (§30.1) but simplified to the minimum required fields: name, address, time zone, location type, operating hours.
- Additional fields can be configured post-wizard in Location Settings.

**Step 3 — Payment Gateway Connection**
- Guide to connect Stripe or Adyen (the two supported gateways).
- Step-by-step credential entry with inline validation (system sends a $0.00 test authorization to confirm connectivity).
- Pre-auth configuration: hold duration, MCC 7512 activation, refund timing.
- System displays a green "Payment Ready" confirmation before proceeding.

**Step 4 — First Vehicle Class & Rate**
- Admin selects at least one vehicle class (or creates one).
- System prompts: "You need at least one active rate code to take a booking. Would you like to create one now?"
- Guided mini rate-code creation: class, daily rate, currency — enough to price a rental. Full rate management (yield rules, GDS filing, etc.) is configured post-wizard.

**Step 5 — Rental Agreement Template**
- Upload or use the default template.
- Required fields: operator name, logo, T&C text, signature block.
- Preview of a rendered rental agreement before proceeding.

**Step 6 — First Staff Account**
- Admin invites at least one Counter Agent (separate from the Super Admin who is completing setup).
- System sends activation email.

**Step 7 — Day-Zero Readiness Gate**
System-enforced checklist. Platform will not allow a rental to be processed until all items are green:
- [ ] Company profile complete
- [ ] At least one location configured with operating hours
- [ ] Payment gateway connected and test-authorized
- [ ] At least one active rate code
- [ ] At least one vehicle in Available status
- [ ] Tax template assigned to the first location
- [ ] Rental agreement template approved
- [ ] At least one Counter Agent account activated
- [ ] Notification email credentials configured (SendGrid/SES)

**Post-wizard state**: operator lands on the branch manager dashboard with a "Setup Checklist" side panel that shows optional next steps (add more vehicles, configure OTA channels, set up loyalty program, etc.). The side panel can be dismissed once all required items are complete.

**Progress persistence**: the wizard saves state after each completed step so an admin can exit and resume later without losing progress.

### 39.2 SaaS Billing & Subscription Management

The platform must have a billing model for its own revenue. This is entirely separate from the rental operator's customer billing.

**Subscription tiers (recommended structure):**

| Tier | Positioning | Limits |
|---|---|---|
| Starter | Single location, small fleet | 1 location, up to 25 vehicles, no GDS/OTA integration, no telematics |
| Professional | Multi-location, growing operator | Up to 5 locations, up to 150 vehicles, OTA integration, basic yield |
| Enterprise | Large fleet, franchise networks | Unlimited locations and vehicles, GDS filing, telematics, EV, franchise module |

**Billing features required:**
- Subscription plan selection at onboarding (with a 14-day free trial, no credit card required for trial).
- Trial mode: full feature access during trial; a "Trial — X days remaining" banner displayed; email reminders at T-7, T-3, T-1 days before trial expiry.
- Plan upgrade/downgrade: operator can self-serve change their plan from Account → Billing. Prorated charges applied mid-cycle.
- Billing portal: operator views current plan, usage metrics (locations, vehicles, monthly transactions, API calls), invoices/receipts, and updates payment method.
- Usage-based overage: if an operator on Starter exceeds 25 vehicles, the system notifies them and prompts upgrade. Does not block operations immediately — 7-day grace period before enforcement.
- Annual vs. monthly billing option (annual = 2 months free).
- Platform billing uses Stripe Billing (separate from the rental operator's own Stripe account).

**Feature gating:**
- Feature flags per subscription tier. Features not available on the current plan are visible but disabled (grayed out) with a "Upgrade to Professional" prompt — not hidden entirely.
- Admin cannot accidentally configure a feature that is not in their plan.
- Trial accounts have full access to all features (Enterprise-level) for evaluation purposes.

**Operator billing dashboard:**
- Current plan name and renewal date.
- Usage this billing period: locations, vehicles, reservations, API calls.
- Invoice history (downloadable PDF).
- Payment method management.
- Cancel subscription (with a retention flow: "Before you go, here's what you'll lose...").

### 39.3 Data Migration Tooling

Operators switching from another system need structured migration tooling beyond the vehicle CSV import (§26.2).

**Migration modules required for day-1:**

**Customer Profile Migration**
- CSV import for existing customer records: first name, last name, email, phone, date of birth, driver's license number + state/country, loyalty tier (mapped to internal tiers), stored notes.
- Deduplication check: before import, system identifies potential duplicates (same email, same license number) and surfaces them for admin review/merge decision.
- Post-import: customers are created without stored payment tokens (tokens cannot be migrated between payment processors — customers must re-enter cards at next rental, with a notification explaining why).

**Reservation/Rental History Migration**
- CSV import for historical closed rentals: confirmation number, customer email, vehicle class, pickup/return dates and locations, total amount, payment method (text description only — no live payment data).
- Historical records are imported as "Closed — Historical" status and do not affect availability calculations.
- Used for: loyalty point recalculation, customer rental history view, AR aging history.

**Rate Structure Migration**
- Rate code import template: rate code name, type, effective dates, class rates per tier (daily/weekly/monthly), location assignments.
- Migration wizard maps source system class codes (e.g., TSD class codes) to SIPP codes.
- Imported rate codes land in Draft status; admin reviews and activates.

**Corporate Account Migration**
- CSV import: company name, CDP code, primary contact, billing terms, class rates per tier, location assignments.
- Existing CDP codes can be preserved (imported exactly as-is) or remapped.

**Loyalty Points Balance Migration**
- CSV import: customer email, points balance, tier name, tier qualifying days.
- System maps imported tier names to the internal tier configuration.
- Points are imported as a single historical "Migration Balance" transaction in the member's history.

**Migration support workflow:**
- Each migration module has: template download → upload + validation → preview → confirm import → import log.
- A "Migration Progress" dashboard shows the status of each migration module (Not Started / In Progress / Complete / Errors Requiring Review).
- Migration can be run incrementally (e.g., vehicles first, then customers, then history) without re-running completed modules.

### 39.4 Staff Training Mode

A training/sandbox environment where counter agents can practice without affecting live data.

**Training mode features:**
- Toggle in Account Settings (Super Admin only): "Enable Training Mode for this location."
- When enabled, a clearly visible "TRAINING MODE" banner appears on all screens at that location (red banner, cannot be dismissed).
- All transactions created in training mode are tagged as training records and excluded from all reports.
- Training records do not generate real payment authorizations (a simulated payment gateway responds with success/failure based on test card numbers).
- Training records do not send real customer notifications.
- A "Reset Training Data" button clears all training-mode records for that location on demand.
- Rental agreements created in training mode are watermarked "TRAINING — NOT A VALID AGREEMENT."

**Scenario library:**
- Pre-loaded training scenarios accessible to Counter Agents: "Standard Checkout," "Return with Damage," "Customer Dispute," "Walk-In without Reservation," "CDW Declination," "No-Show Processing."
- Each scenario has step-by-step instructions visible in a side panel while the agent completes the workflow in the live UI.

**Certification path (optional):**
- After completing a defined set of training scenarios, the agent is marked "Certified" in their staff profile.
- Branch managers can require certification before granting full access to live operations.

### 39.5 In-App Help & Support System

**Contextual help:**
- Help icon (?) on every major screen that opens a context-specific help article.
- Help articles are served from a knowledge base (integrated with Intercom, Zendesk, or a native KB).
- Articles are searchable from a global help search bar (Cmd+K / Ctrl+K).

**Guided product tours:**
- First-login tour per role: Counter Agent (focuses on reservation lookup and checkout), Branch Manager (focuses on dashboard and reporting), System Admin (focuses on configuration).
- Tours use coach marks (highlight + tooltip) over real UI elements.
- Tours can be re-launched from the help menu ("Take the tour again").

**In-app support ticket:**
- "Contact Support" button in the help menu and in every error state.
- Opens a support form: subject, description, priority (Low/Medium/High/Urgent), screenshot attachment (auto-captures the current screen).
- Ticket is submitted to the platform vendor's support queue (Zendesk or Intercom).
- Operator sees ticket status in an in-app "My Tickets" view: Open / Awaiting Response / Resolved.

**Platform vendor SLA tiers:**
- Urgent (counter unable to process rentals): 1-hour response, 4-hour resolution target.
- High (major feature unavailable): 4-hour response, 8-hour resolution.
- Medium (important but workaround exists): 8-hour response, 2-day resolution.
- Low (question, minor issue): 24-hour response, 5-day resolution.

**Live chat:**
- During business hours (configurable per plan tier), live chat is available via Intercom widget.
- Outside business hours, live chat falls back to "Leave a message" which creates a support ticket.

### 39.6 External Status Page

- Public status page at `status.[platform-domain].com`.
- Displays: overall system status (Operational / Degraded / Outage), per-component status (Booking Engine, Payment Processing, OTA Sync, Telematics Feed, Notification Delivery, API).
- Incident history: past 90 days of incidents with start time, resolution time, and post-mortem summary.
- Scheduled maintenance: upcoming maintenance windows posted at least 48 hours in advance.
- Subscribe to updates: email or SMS subscription per component.
- Status page updates are pushed automatically by the internal monitoring system (§36.5) when alert thresholds are breached; status is also manually overridable by the platform operations team.

### 39.7 Operator Legal & DPA Acceptance

**Terms of Service and Privacy Policy:**
- Displayed in full at account creation with a mandatory "I agree to the Terms of Service and Privacy Policy" checkbox (cannot be pre-checked).
- Agreement recorded: timestamp, user ID, IP address, version of ToS accepted.
- When ToS is updated (new version): all operators are notified by email and shown the updated ToS at next login with a required re-acceptance step. Cannot access the platform until accepted.
- Acceptance log retained permanently (for contract enforceability).

**Data Processing Agreement (DPA):**
- For any operator with EU/UK customers, a DPA (per GDPR Article 28) must be in place before any personal data is processed.
- DPA flow: at account creation, operator is presented with the platform vendor's standard DPA. "Accept DPA" button records acceptance with timestamp, user ID, and DPA version.
- DPA version history stored.
- Custom DPA option: for Enterprise operators who require a negotiated DPA, a "Request Custom DPA" workflow submits a request to the platform's legal team. Operations are blocked for EU/UK data until DPA is in place.

**Operator Insurance Requirement (optional):**
- For platforms that require proof of commercial auto liability insurance from operators (mitigating platform liability), an insurance certificate upload workflow is included in onboarding.
- Certificate of Insurance (COI) is uploaded; admin enters carrier name, policy number, coverage amount, expiry date.
- System alerts when COI is within 60/30/7 days of expiry.
- Optional enforcement: if COI is expired and enforcement is enabled, operator's ability to create new reservations is suspended until renewed COI is uploaded.

---

## 40. Customer Experience Completions

### 40.1 Web Self-Service "Manage My Booking" Portal

A browser-based portal accessible to customers who booked via any channel without requiring a native mobile app.

**Access methods:**
- Link in booking confirmation email: "Manage My Booking" → deep links to the reservation with a time-limited signed token (no password required for basic access).
- Account login at `bookings.[operator-domain].com`: customer enters email + password (or uses magic link / social login — see §40.2) to access all their reservations.

**Features available without account (token-based):**
- View reservation details: vehicle class, location, dates, rate, extras, total.
- Cancel the reservation (subject to cancellation policy; refund calculation shown before confirmation).
- Download/print confirmation PDF.
- Add extras that were not selected at booking (up to 24 hours before pickup).

**Features requiring account login:**
- View all reservations (past and upcoming).
- Modify reservation: change dates, vehicle class, location, or extras. System re-quotes on modification.
- Manage additional drivers.
- View and download receipts from past rentals.
- Manage loyalty points and tier status.
- Update contact information.
- Update saved payment methods.
- Submit a post-rental dispute or question.

**Guest checkout to account conversion:**
- After any token-based action, the portal shows: "Create an account to access all your bookings and earn loyalty rewards" with a one-click conversion that pre-fills email and sets a password.

### 40.2 Guest Checkout & Social Login

**Guest checkout (no account required):**
- The online booking engine must allow completion of a reservation without creating an account.
- Guest checkout collects: first name, last name, email, phone, date of birth (for age verification), driver's license number (optional at booking — can be provided at counter).
- At booking completion, the system offers (but does not require) account creation: "Save your details for faster booking next time and earn loyalty rewards."
- Guest reservations are accessible via the token link in the confirmation email (§40.1).

**Social login (account-based bookings):**
- Google Sign-In and Apple Sign-In supported as account creation and login options.
- Social login email is used as the account email; system checks for an existing account with that email before creating a new one (prevents duplicate accounts).
- For returning customers: if a guest booking was made with the same email as a social login, the system prompts to link the bookings to the new account on first social login.
- Social login tokens are not stored by the platform — authentication is delegated entirely to Google/Apple.

**Magic link login (alternative to password):**
- Customer enters email on the login page → receives a time-limited (15 minutes) magic link → clicking the link logs them in without a password.
- Useful for customers who have an account but do not remember their password.

### 40.3 Roadside Breakdown & Emergency Assistance Customer Flow

**Customer-initiated contact:**
- Roadside assistance phone number displayed prominently in:
  - The customer mobile app (§20.1) as a one-tap emergency call button on the rental status screen.
  - The booking confirmation email and rental agreement.
  - An SMS sent at the start of the rental ("Your rental is active. For emergencies, call [number]").

**In-app breakdown reporting flow (mobile app):**
1. Customer taps "Roadside Emergency" on the rental status screen.
2. App displays two options: "Call for Assistance" (one-tap call to RSA provider) or "Report a Problem."
3. "Report a Problem" flow: customer selects problem type (flat tire / out of fuel / locked out / mechanical failure / accident / other); enters current location (auto-detected via GPS or manual entry); optionally uploads a photo; submits.
4. System creates a mid-rental incident record linked to the rental agreement.
5. Branch manager and fleet manager are notified immediately (push notification + email).
6. Customer receives a confirmation: "We've received your report. Help is on the way. Reference: [INC-XXXXX]. You can track your request here."

**Replacement vehicle dispatch workflow (operator side):**
1. Branch manager receives incident alert → reviews situation → decides: dispatch roadside assistance, or dispatch a replacement vehicle.
2. If replacement: manager initiates a vehicle swap from the incident record (see §41.5).
3. Customer is notified of the replacement vehicle details (plate, color, model) and estimated arrival time.
4. On swap completion, the rental agreement is transferred to the new vehicle automatically.

**RSA provider integration:**
- If the operator uses a third-party RSA provider (Agero, Allstate Roadside, etc.), the system can optionally dispatch via their API rather than requiring manual phone calls.
- Integration: incident record triggers an API call to the RSA provider with vehicle location and problem type; RSA provider returns an ETA and service tracking number.
- ETA and tracking link are shown to the customer in the app and sent via SMS.

### 40.4 Accident Reporting (Customer-Side Flow)

**Customer-side accident flow is triggered either from the app during the rental or at the counter on return.**

**In-app accident report (during rental):**
1. Customer taps "Report an Accident" in the app (accessible from rental status screen or the emergency button).
2. Step 1 — Incident basics: date, time, location (GPS auto-fill or manual), brief description of what happened.
3. Step 2 — Third-party information (if other vehicle involved): other driver's name, phone, insurer, policy number, plate number, state.
4. Step 3 — Police report: Was police called? (Y/N). If yes: department name, report number, jurisdiction.
5. Step 4 — Photos: upload at least 2 photos of each involved vehicle, plus damage close-ups. Minimum 4 total. App camera opens directly.
6. Step 5 — Witness information: optional name and phone for any witnesses.
7. Submission creates a damage claim record (status: "Mid-Rental — Pending Return Inspection") linked to the rental agreement.
8. Customer receives: confirmation email with their report summary and the incident reference number, a reminder to keep the third-party info safe, and instructions on what to expect next (inspection at return, insurer contact).

**Key disclosures displayed at the start of the accident report flow:**
- "Do not admit fault at the scene."
- "Do not sign any documents from third parties."
- "If anyone is injured, call 911 immediately before using this form."

**Counter-side intake at return:**
- The check-in workflow (§6.3) includes a mandatory prompt before beginning the walk-around: "Was the vehicle involved in any incident, accident, or unusual event during the rental?" (Y/N).
- If Yes: agent opens the accident intake form with the same fields as the in-app form. System checks if a mid-rental report already exists; if so, it is displayed for review/supplement rather than creating a duplicate.

### 40.5 Accessibility Requirements (WCAG 2.1 AA)

All customer-facing web interfaces (booking engine, manage-my-booking portal, loyalty portal) and staff-facing admin interfaces must comply with WCAG 2.1 Level AA.

**Minimum requirements:**
- **Perceivable**: all images have descriptive alt text; all form fields have associated labels; color is not the sole means of conveying information (e.g., availability heatmap must use patterns or labels in addition to color); minimum contrast ratio of 4.5:1 for normal text, 3:1 for large text.
- **Operable**: all functionality accessible via keyboard alone (no mouse required); no keyboard traps; focus indicators visible on all interactive elements; no content that flashes more than 3 times per second.
- **Understandable**: language declared in HTML; error messages identify the field and describe how to fix the error; form labels and instructions are provided before the field.
- **Robust**: markup is valid HTML5; all custom components have appropriate ARIA roles, states, and properties; tested with NVDA/VoiceOver screen readers.

**Testing requirements before launch:**
- Automated scan with axe-core integrated into CI pipeline — zero WCAG 2.1 AA violations permitted to merge.
- Manual keyboard navigation test of the complete booking flow.
- Screen reader test (NVDA on Windows, VoiceOver on macOS/iOS) of the booking flow and manage-my-booking portal.
- Color contrast audit with a tool such as Colour Contrast Analyser.

**Responsive design:**
- All interfaces must be fully functional at viewport widths from 320px (smallest iPhone SE) to 2560px.
- Touch targets minimum 44×44 CSS pixels for all interactive elements.

### 40.6 Post-Rental Feedback (CSAT/NPS)

**Automated survey trigger:**
- 24 hours after a rental is closed, the system sends a post-rental feedback email to the customer.
- Subject line: "How was your rental with [Operator Name]?"
- Email contains an embedded single-question NPS survey: "On a scale of 0–10, how likely are you to recommend [Operator Name] to a friend or colleague?" — clickable score buttons that take the customer to a follow-up form.

**Follow-up form (web, no login required):**
- Score displayed with a thank-you message and a single open-text field: "What's the most important reason for your score?"
- For scores 0–6 (Detractors): additional prompt: "What could we have done better?" + optional "Contact me about this" checkbox (if checked, creates a complaint record in §31.6 and assigns to the branch manager).
- For scores 9–10 (Promoters): optional prompt: "Would you like to share your experience on Google Reviews?" with a direct link to the operator's Google Business profile.

**Operator-side NPS dashboard:**
- NPS score per location, per period, with trend chart.
- Response rate percentage.
- Verbatim comment feed (filterable by score range, location, period).
- Promoter / Passive / Detractor breakdown.
- Comments linked to the rental agreement for context (agent who handled the rental, vehicle class, duration).
- Detractors with "contact me" flag appear in the complaint queue (§31.6) automatically.

**CSAT on specific interactions:**
- Optional: a single-question "How satisfied were you with your check-in experience?" (1–5 stars) can be added to the return receipt email.
- Results appear in staff performance metrics (§29.3) as per-agent average CSAT.

### 40.7 Canonical Notification Event List

All notification events the system must fire, with channel, timing, and trigger. (Templates are configured per §33.1.)

| # | Event | Channel | Timing | Trigger |
|---|---|---|---|---|
| 1 | Booking confirmation | Email + SMS | Immediate | Reservation confirmed |
| 2 | Modification confirmation | Email | Immediate | Reservation modified |
| 3 | Cancellation confirmation | Email | Immediate | Reservation cancelled |
| 4 | Pre-rental reminder | Email + SMS | T-48h before pickup | Scheduled job |
| 5 | Pickup-day reminder + instructions | Email + SMS | T-4h before pickup | Scheduled job |
| 6 | Online check-in invitation | Email + push | T-24h before pickup | Scheduled job |
| 7 | No-show notice | SMS | T+60min after grace period | Scheduled job |
| 8 | Rental active confirmation | SMS + push | At vehicle check-out | Rental agreement activated |
| 9 | Return reminder | SMS + push | 2h before scheduled return | Scheduled job |
| 10 | Overdue return alert | SMS | At overdue threshold | Scheduled job |
| 11 | Extension confirmation | Email | Immediate | Rental extended |
| 12 | EV low battery alert | Push | SOC < 20% | Telematics event |
| 13 | Return receipt / invoice | Email + push | At rental close | Rental closed |
| 14 | Damage notice (initial) | Email | Within 24–72h of damage discovery | Claims coordinator action |
| 15 | Damage estimate notice | Email | When estimate obtained | Claims coordinator action |
| 16 | Damage demand letter | Email + certified mail | As specified in claim | Claims coordinator action |
| 17 | Loyalty points earned | Email + push | Within 24h of rental close | Points posted |
| 18 | Loyalty tier upgrade | Email + push | Immediate | Tier threshold crossed |
| 19 | Loyalty tier downgrade warning | Email | 30 days before period end | Scheduled job |
| 20 | Post-rental NPS survey | Email | T+24h after return | Scheduled job |
| 21 | Toll charge notification | Email | When toll event is billed | Toll processing |
| 22 | Traffic violation notice | Email | When fine is received | Admin action |
| 23 | Pre-auth expiry warning | Internal (agent dashboard) | 3 days before expiry | Scheduled job |
| 24 | Account credit issued | Email | Immediate | Credit posted |
| 25 | Password reset | Email | Immediate | User-initiated |
| 26 | New device login alert | Email | Immediate | Login from new device |
| 27 | Staff activation invitation | Email | Immediate | Account created |
| 28 | Corporate invoice issued | Email | Per billing cycle | Invoice generated |
| 29 | Roadside incident confirmation | SMS + push | Immediate | Incident submitted |
| 30 | Replacement vehicle dispatched | SMS + push | Immediate | Dispatch confirmed |

---

## 41. Counter Operations Completions

### 41.1 Shift Opening & Closing Procedures

**Shift Start Workflow (agent-initiated)**
1. Agent logs in → system detects this is the first login for their shift → "Start Shift" prompt appears (cannot be skipped).
2. Shift start checklist (agent confirms each item):
   - [ ] Cash drawer counted and opening balance confirmed (amount entered if cash accepted; $0 if card-only location).
   - [ ] Fleet lot count: expected vehicles on lot shown from system; agent confirms count matches (or notes discrepancies — see §41.7).
   - [ ] Pending pickups review: list of all reservations due for pickup in the next 4 hours displayed; agent acknowledges.
   - [ ] Overdue returns review: any rentals past their return time displayed; agent reviews and notes action taken.
3. Shift officially opened; shift start time, agent ID, opening cash balance, and fleet count snapshot logged.

**Shift End Workflow (agent-initiated or manager-triggered)**
1. Agent selects "End Shift" from the menu (or manager triggers end-of-shift from the staff panel).
2. Shift end checklist:
   - [ ] Open transactions review: any rentals checked out during this shift that are still active (not a blocker, but requires acknowledgment).
   - [ ] Cash count: agent counts cash in drawer; enters total. System shows: opening balance + cash collected during shift − cash refunds = expected closing balance. Variance is flagged if > $5.
   - [ ] Damage incidents: any damage incidents discovered during this shift shown for acknowledgment.
3. Shift end report generated: total rentals checked out, total check-ins, total cash collected, total card collected, discounts given, extras sold, damage incidents, any unresolved variances.
4. Report emailed to branch manager and archived.

**End-of-Day Close (branch manager or senior agent)**
- Runs after the last shift ends.
- Produces the Daily Settlement Summary (§18.3) across all shifts.
- Confirms: total transactions match payment processor settlement report (if settlement file is available).
- Any variances are flagged for next-day resolution.
- System marks the business day closed for reporting purposes.

### 41.2 Walk-In / Walk-Up Rental Flow

Counter agents must be able to create a rental for a customer who walks in with no prior reservation.

**Walk-up counter flow:**
1. Agent selects "New Walk-Up Rental" from the counter dashboard (distinct from "New Reservation" which is advance-booking).
2. **Customer lookup**: agent searches by name, email, phone, or license number. If found, existing profile loads (loyalty tier, DNR check, prior damage history). If not found, agent creates a new customer profile on the spot (first name, last name, email, phone, DL number, DOB).
3. **Availability check**: system displays real-time availability at this location right now (current time as pickup, with a default return time of +24h that the agent adjusts). Agent selects vehicle class.
4. **Walk-up rate applied automatically**: the walk-up counter rate code (configured per location — typically the highest-demand rate tier) is applied. Agent can apply a different rate code with appropriate permissions.
5. **Extras selection**: same extras screen as the online flow.
6. **Payment capture**: agent captures card on file (tap/insert reader or manual entry) or processes cash deposit. Pre-authorization placed immediately. System confirms auth before proceeding.
7. **Rental agreement**: generated and displayed for digital signature (counter tablet or agent-printed). Customer signs; RA is immediately emailed to the customer.
8. **Vehicle assignment**: agent assigns a specific vehicle unit from the available fleet for that class. System marks vehicle as On Rent.
9. **Key handover**: agent records key handover time and hands physical keys. Rental is now active.

**Walk-up pricing display**: walk-up rate is shown to the customer on the counter-facing display (customer-side monitor), with itemized breakdown: base rate × days + extras + taxes + total. Customer verbally or digitally confirms before payment is charged.

### 41.3 Driver's License Validation & Failure Flows

**Validation modalities at the counter:**
- **Barcode scan (primary for US licenses)**: US state driver's licenses have a PDF417 barcode on the back that encodes all DL fields. Counter app supports barcode scan via a USB barcode scanner or mobile camera. Scanned data auto-populates: license number, first name, last name, DOB, address, issue date, expiry date, class, restrictions, state.
- **Magnetic stripe read**: older US licenses have a magnetic stripe; a card reader captures the same data.
- **Manual entry (fallback)**: agent manually enters license data for foreign licenses, damaged barcodes, or international driving permits.
- **Document upload**: agent captures a photo of the license (front and back) for the customer record using the counter app camera or a document scanner.

**AAMVA integration (US):**
- For US licenses, the system optionally connects to the AAMVA (American Association of Motor Vehicle Administrators) network via a licensed AAMVA service provider (e.g., Samba Safety, Verisk/ISO) to validate the license in real time against the issuing state's DMV.
- Validation returns: license valid/invalid, suspension status, expiry confirmed, DUI/major conviction flag.
- If AAMVA returns a suspension or revocation: rental is blocked. Agent sees: "License is suspended or revoked per DMV records. Rental cannot proceed." Manager override is not available (this is a hard block — legal liability issue).

**Failure flows:**
- **Expired license**: system compares DL expiry date to today's date. If expired: agent is shown a hard block: "Driver's license expired [date]. Rental cannot proceed." No override.
- **License type insufficient**: if the renter's license class does not cover the selected vehicle (e.g., a motorcycle-only license), agent is warned.
- **Foreign license**: system accepts manual entry. If the customer's country requires an International Driving Permit (IDP) alongside their home license (required for US rentals for citizens of most non-English-speaking countries), agent is prompted: "An International Driving Permit is required for rentals by citizens of [country]. Has the customer presented a valid IDP?"
- **International Driving Permit**: IDP is valid only alongside the home country license, not as a standalone document. If IDP presented alone: agent is blocked from proceeding; prompt explains IDP must accompany home license.
- **Under-minimum-age**: if scanned DOB calculates age below the location's minimum rental age: hard block. Young driver surcharge: if DOB calculates age in the surcharge tier, surcharge is automatically added to the rental and itemized on the RA.
- **DNR match on license number**: if the scanned license number matches a DNR record: agent and manager are alerted; rental is blocked until manager reviews and decides.

### 41.4 Overdue Return Management

**Real-time overdue dashboard (always visible on branch manager's home screen):**
- List of all currently active rentals past their scheduled return time, sorted by hours overdue.
- Columns: rental agreement #, customer name, phone, vehicle, class, scheduled return time, hours overdue, last GPS location (if telematics equipped), pre-auth status (valid/expiring/expired).

**Escalation protocol (configurable thresholds):**

| Threshold | Automated Action | Agent Action Required |
|---|---|---|
| 30 min overdue | SMS to customer: "Your rental was due at [time]. Please return or extend." | Agent reviews; no action required if SMS sent |
| 2 hours overdue | Second SMS + email: "Your rental is overdue. Late fees are accruing. Please call us." | Agent attempts phone contact; logs call attempt in system |
| 4 hours overdue | Manager alert (push + email) | Manager calls customer; logs outcome (reached/no answer/extension agreed) |
| 1 day overdue | Manager escalation; pre-auth refresh triggered | Manager reviews GPS location; initiates missing vehicle protocol if unreachable |
| 3 days overdue | System flags as "Potential Missing Vehicle" | Manager contacts police if customer unreachable and vehicle GPS shows stationary unknown location |

**Pre-auth refresh on overdue rentals:**
- When the original pre-auth is within 3 days of expiry and the vehicle has not been returned: system automatically places an incremental authorization for an additional hold amount (configurable, e.g., 3 additional days' rate).
- System logs the incremental auth; agent is notified if any auth fails.
- If auth fails (card declined): agent is alerted immediately to contact the customer before the vehicle is further at risk.

**Late fee accrual:**
- Late fees accrue at the configured rate (§33.3) from the moment the grace period expires.
- Running late fee total is visible on the rental record in real time.
- Late fees are added to the final charge at return; if the customer calls and manager waives the fee, manager records the waiver with a reason code.

### 41.5 Vehicle Swap Mid-Rental

Triggered when a customer returns a vehicle mid-rental due to mechanical failure, accident, or documented preference change.

**Vehicle swap workflow:**
1. Agent opens the active rental agreement → selects "Vehicle Swap."
2. **Reason for swap**: dropdown — Mechanical Failure / Accident / Customer Preference / Upgrade Resolution / Fleet Recall. Reason is required.
3. **Partial close of original vehicle**: system calculates charges on the original vehicle from rental start to swap date/time. These are recorded as a partial rental record (not invoiced yet — the full invoice is produced at the end of the replacement rental).
4. **Replacement vehicle selection**: agent selects an available vehicle from the same class (or a higher class if no same-class is available — upgrade rules apply). Vehicle must pass the same availability checks as a new rental.
5. **Pre-delivery inspection on replacement vehicle**: agent must complete an abbreviated inspection (using the mobile inspection app) before handing over the replacement. If the swap is due to an accident, a full inspection of the returned (damaged) vehicle is also required and triggers a damage claim.
6. **New RA for replacement vehicle**: system generates a new rental agreement for the replacement vehicle. It inherits: original rate code and terms, original rental start date for billing continuity, customer profile and loyalty data.
7. **Link**: the two rental agreements are permanently linked as a swap pair. The original agreement shows "Swapped to [RA#]"; the replacement shows "Swap from [RA#]". The linked pair is visible in the customer's rental history as a single rental journey.
8. **Pre-auth transfer**: if the original pre-auth is still valid, system records the new vehicle's VIN against the existing hold. If the original auth has expired or needs refreshing (common in mechanical failure scenarios that take time to resolve), a new pre-auth is placed on the replacement.
9. **Invoice**: issued only at the end of the replacement rental; combines charges from both vehicles. Line items are separated: "Vehicle 1 [plate] — [date range] — [amount]" and "Vehicle 2 [plate] — [date range] — [amount]."

### 41.6 Cash Handling & Reconciliation

**Cash deposit (at check-out):**
- Agent selects "Cash" as payment method on the rental agreement.
- System displays the required cash deposit amount (configurable per location; typically 1.5× the total estimated rental value + a fixed buffer, e.g., minimum $200).
- Agent confirms cash received; enters the physical amount received from the customer.
- System records: cash deposit amount, date/time, agent ID. A deposit receipt is printed or emailed to the customer.
- Vehicle cannot be released until cash deposit is recorded as received.
- Cash deposit is held as a liability in the system (not revenue).

**Cash deposit return (at check-in):**
- System calculates: deposit held − total charges (rental + extras + fees + taxes + any damage charges) = refund due.
- Agent returns cash from the drawer; records the returned amount.
- If charges exceed the deposit: customer pays the difference by card (agent cannot collect more cash than needed).
- Cash return is recorded; receipt printed or emailed.

**Cash reconciliation (per shift):**
- Opening cash balance (from shift start) + cash received during shift − cash refunded during shift = expected closing balance.
- Agent counts actual cash in drawer at shift close; enters amount.
- Variance (expected vs. actual) is flagged. Agent must provide a note explaining any variance > configured tolerance (e.g., $5).
- Persistent variance history is visible to branch manager.

**Petty cash:**
- A petty cash fund is configurable per location (e.g., $200 float).
- Petty cash disbursements are recorded: amount, reason, agent, date.
- Monthly petty cash reconciliation report: opening balance + replenishments − disbursements = expected balance vs. physical count.

### 41.7 Daily Lot Audit (Fleet Inventory Count)

**Lot audit feature (available in counter app and mobile inspection app):**
- At shift start (or on demand), agent initiates a "Lot Audit" session.
- System displays all vehicles that should be on the lot at this location based on their current status: Available, Cleaning, Ready for Inspection, Admin Hold, Damage Hold. (Vehicles On Rent, In Maintenance off-site, or at another location are excluded.)
- Agent walks the lot and checks off each vehicle by scanning its barcode/QR (sticker on windshield or key fob) or manually entering the plate/unit number.
- As vehicles are checked, they are marked "Physically Verified" in the audit session.

**Discrepancy handling:**
- **Vehicle expected on lot but not found**: agent marks as "Not Located." System flags as "Lot Discrepancy — Missing from Lot." Manager is notified; investigation begins (telematics check, last agent who touched the record, etc.).
- **Vehicle found on lot but not in system**: agent scans a vehicle that does not appear in the audit list. Agent selects "Unexpected Vehicle Found" and records the plate. System creates a discrepancy record for investigation (could be a mis-filed return, a delivery that wasn't entered, or a wrong-lot drop on a one-way).
- **Vehicle found at wrong location**: if telematics shows a vehicle's GPS location is at a different branch, it is flagged in the audit list with a note.

**Audit report**: after the agent marks all found vehicles and submits the audit, the system generates: vehicles verified, vehicles missing, unexpected vehicles found, audit completion time, agent ID. Stored as a daily record per location.

### 41.8 One-Way Vehicle Handoff

**Inbound notification to receiving branch:**
- When a one-way reservation is created (§16.2), the receiving (drop-off) branch receives a notification: "Inbound vehicle expected: [RA#] [Class] — Customer [Name] — Expected return: [Date/Time]."
- Notification channels: branch manager dashboard alert + email.
- Inbound vehicles appear in a dedicated "Inbound One-Ways" panel on the receiving branch's dashboard, sorted by expected return date/time.

**Vehicle arrival at receiving branch:**
- When the customer arrives to return a one-way vehicle, the receiving branch agent processes the return check-in normally (§6.3).
- After check-in, the vehicle's home location is updated to the receiving branch (or left at the receiving branch temporarily pending rebalancing).
- The original branch's fleet count decreases; the receiving branch's fleet count increases. Both dashboards update in real time.

**Failed arrival (one-way no-show):**
- If the expected vehicle has not arrived within 2 hours of the expected return time: receiving branch receives an alert.
- Agent contacts the originating branch; originating branch contacts the customer.
- If the vehicle's GPS shows it is not en route: escalated to manager.

---

## 42. Technical Architecture Specifications

### 42.1 PCI DSS Compliance Scope

**SAQ type determination:**
- If the platform uses hosted payment fields (Stripe Elements / Adyen Drop-In) where card data is entered directly into an iframe served by the payment gateway and never touches the platform's servers: **SAQ A** applies (the simplest PCI scope — 22 requirements).
- If the platform serves any page that contains the payment form (even with hosted fields), there is a risk of JavaScript skimming; platform must also satisfy **SAQ A-EP** requirements, including web application scanning.
- **Recommendation**: implement payment via Stripe Checkout redirect or Adyen hosted page to achieve the cleanest SAQ A scope and reduce the platform's PCI burden to the minimum.

**CDE scope:**
- Explicitly out of scope: all platform servers, databases, and network segments. No cardholder data (PAN, CVV, expiry) is ever transmitted to or stored on platform infrastructure. All payment data flows directly between the customer's browser and the payment gateway's servers.
- In scope: the platform's web server that serves the page containing the payment iframe (limited SAQ A-EP scope). Mitigation: Content Security Policy (CSP) headers to prevent unauthorized script execution.

**Ongoing PCI requirements:**
- Quarterly external vulnerability scan by an Approved Scanning Vendor (ASV). Scans must produce a "passing" result before each quarter's compliance attestation.
- Annual penetration test by a qualified security assessor (PCI DSS 4.0 Requirement 11.4.6).
- Annual Self-Assessment Questionnaire (SAQ A or A-EP) completed and signed by the platform CTO.
- P2PE for counter card readers: all physical card readers at rental counters must use point-to-point encryption (P2PE) validated devices (e.g., Stripe Terminal with P2PE, Adyen Terminal API). This eliminates counter hardware from CDE scope.

### 42.2 Performance SLA Targets

**System availability:**
- Target: 99.9% uptime per calendar month (≤ 43.8 minutes downtime/month). Measured as HTTP 200 response rate on the booking engine health endpoint, averaged over the month.
- Planned maintenance windows: excluded from uptime calculation if announced ≥ 48h in advance on the status page (§39.6). Maximum 4 hours of planned maintenance per month, between 02:00–06:00 local time of the majority tenant's time zone.

**Response time targets:**

| Operation | P50 Target | P95 Target | P99 Target |
|---|---|---|---|
| Availability search (single location) | 400ms | 900ms | 1,500ms |
| Rate quote (full tax calculation) | 200ms | 600ms | 1,000ms |
| Reservation creation (with payment auth) | 800ms | 1,800ms | 3,000ms |
| Admin dashboard load | 600ms | 1,200ms | 2,000ms |
| Report generation (standard) | 2s | 8s | 15s |
| Report generation (large/export) | Async — notify when ready |

**Load capacity:**
- System must sustain 500 concurrent active users system-wide without degradation below the P95 targets above.
- Peak load test requirement: must pass a 2× normal peak load test (1,000 concurrent users) with no errors and P99 < 2× normal P99 before any production deployment.
- Database: availability overlap query must execute in < 50ms at 10,000 reservations per location per month.

**Degraded mode behavior:**
- If the availability cache is unavailable (Redis down): system falls back to direct database query (slower, but correct). A warning banner is shown to agents: "System is operating in reduced-performance mode. Availability may take longer to load."
- If payment gateway is unreachable: booking engine disables payment step and shows: "Payment processing is temporarily unavailable. Please try again in a few minutes." No bookings are lost; reservation is held in "Pending Payment" status.
- If telematics feed is down: rental operations continue normally; telematics-dependent features (GPS map, fuel level) show "Data unavailable."

### 42.3 Counter Offline Mode

When internet connectivity is lost at a branch, counter operations must be able to continue for at least 4 hours.

**Offline-capable operations (Service Worker + local cache):**
- View existing reservations for today's pickup/return (pre-cached at shift start).
- Check out a pre-existing reservation (rental agreement is generated locally; pre-auth cannot be placed — see below).
- Record a vehicle return (check-in data queued for sync).
- Complete a damage inspection (inspection app already has offline support — §20.3).
- View vehicle availability from the last sync snapshot.

**Operations that require connectivity (hard dependencies):**
- New payment pre-authorization (requires online gateway connection). In offline mode: agent can manually record a card number (last 4 only — no full PAN) as a "deferred authorization" note, flag the rental as "Auth Pending," and place the auth when connectivity is restored. The rental agreement is generated but marked "Pending Payment Authorization."
- Walk-up rentals for new customers (no cached customer profile): agent manually creates a minimal local record; it syncs to the server when connectivity is restored.
- New reservations.
- Real-time availability updates to OTA channels.

**Offline sync on reconnect:**
- When connectivity is restored, the counter app queues all offline actions and syncs them to the server in chronological order.
- Sync conflicts (e.g., a vehicle was also checked out online during the offline period): system flags the conflict for manager review; the offline action is not automatically applied.
- Agent is notified of sync completion and any conflicts requiring resolution.

**Offline indicator:** a clearly visible "Offline Mode" banner (yellow) is shown on all screens when operating offline. It disappears when connectivity is restored and sync completes.

### 42.4 Database Integrity Constraints

**Critical constraints that must be defined at the schema level:**

**Vehicle availability overlap prevention (anti-double-booking):**
```sql
-- PostgreSQL exclusion constraint using range type
ALTER TABLE vehicle_blocks 
ADD CONSTRAINT no_overlapping_blocks 
EXCLUDE USING gist (
  vehicle_id WITH =,
  tstzrange(start_time, end_time) WITH &&
);
```
This constraint makes double-booking physically impossible at the database level, even under concurrent requests. Application-level locking alone is insufficient.

**Reservation state machine enforcement:**
- A check constraint on `reservations.status` enforces the valid state set: `QUOTE, PENDING, CONFIRMED, MODIFIED, ACTIVE, RETURNING, CLOSED, CANCELLED, NO_SHOW`.
- A trigger validates state transitions: `CONFIRMED → ACTIVE` is valid; `CLOSED → ACTIVE` is not. Invalid transitions raise an exception before the update is applied.

**VIN uniqueness per tenant:**
```sql
UNIQUE (tenant_id, vin)
```
Prevents the same VIN from being added twice to the same operator's fleet.

**Confirmation number uniqueness:**
```sql
UNIQUE (confirmation_number)  -- system-wide, not per tenant
```
Confirmation numbers are referenced by customers and must be globally unique.

**Soft-delete strategy:**
- All entities that are referenced in audit logs, rental agreements, or financial records use soft-delete: a `deleted_at` timestamp column. Hard delete is never performed on these entities.
- Entities eligible for GDPR erasure: PII columns in the `customers` table are replaced with anonymized placeholders; the customer row itself is retained with `anonymized_at` set. The rental history, financial records, and audit logs retain the internal `customer_id` but no longer display PII.
- A `deleted_at IS NULL` partial index is applied to all high-frequency queries to exclude soft-deleted records without full-table scans.

**Key indexes for high-frequency queries:**
```sql
-- Availability search (most critical)
CREATE INDEX idx_vehicle_blocks_vehicle_time 
  ON vehicle_blocks (vehicle_id, start_time, end_time) 
  WHERE deleted_at IS NULL;

-- Reservation lookup by confirmation number
CREATE UNIQUE INDEX idx_reservations_confirmation 
  ON reservations (confirmation_number);

-- Customer lookup by license number + state
CREATE INDEX idx_customers_license 
  ON customers (license_number, license_state) 
  WHERE deleted_at IS NULL;

-- Rental history by customer (most recent first)
CREATE INDEX idx_reservations_customer_date 
  ON reservations (customer_id, pickup_datetime DESC) 
  WHERE deleted_at IS NULL;
```

### 42.5 Data Retention Schedule

| Data Type | Minimum Retention | Maximum Retention (GDPR) | Archival Tier |
|---|---|---|---|
| Rental agreements (closed) | 7 years (tax/legal) | 7 years | Warm (1yr), Cold (2–7yr) |
| Financial transactions | 7 years | 7 years | Warm (1yr), Cold (2–7yr) |
| Customer PII (active customers) | Duration of relationship | Relationship + 1yr | Hot |
| Customer PII (inactive, no pending claims) | 3 years post last rental | 3 years | Warm then purge |
| Audit logs | 3 years (min) | Indefinite (no PII) | Warm (1yr), Cold (2–3yr) |
| Damage claim records | 5 years (limitation period) | 5 years | Warm (1yr), Cold (2–5yr) |
| Inspection photos | 5 years | 5 years | Hot (1yr), Cold (2–5yr) |
| Telematics GPS events | 1 year | 1 year | Hot (30d), Cold (31d–1yr) |
| Security event / login logs | 1 year | 1 year | Warm |
| Pre-auth records (settled) | 13 months (card network requirement) | 13 months | Warm |
| Loyalty point history | Duration of membership | Membership + 3yr | Hot |
| Staff activity logs | 2 years | 2 years | Warm |
| Communication/notification logs | 1 year | 1 year | Warm |

**Automated lifecycle management:**
- A nightly job evaluates each record against its retention policy.
- Records approaching the archival threshold are moved to a lower-cost storage tier (S3 Standard → S3 Glacier Instant Retrieval → S3 Glacier Deep Archive).
- Records reaching the maximum retention limit are permanently deleted (hard delete of archived records; soft-delete already applied to live records). Deletions are logged in the audit system (record type, record count, deletion date) without retaining the data itself.
- Legal hold flag: any record can be placed under a legal hold (preventing automatic deletion) by a System Admin. Holds are reviewed quarterly.

### 42.6 Multi-Currency Rounding & Edge Cases

**Rounding rule:**
- All monetary calculations use **half-up rounding** (i.e., 2.225 rounds to 2.23, never 2.22). Applied at the final step of each calculation, never to intermediate values.
- Intermediate calculations (base rate × days, tax × base, etc.) are computed to 6 decimal places before rounding to 2 decimal places at the line-item level.
- Total = sum of rounded line items (not rounding the total independently — prevents penny discrepancies).

**Partial refund across exchange rate changes:**
- The refund is calculated in the original billing currency at the original exchange rate at the time of booking.
- Example: customer booked in EUR (rate 1.08 USD/EUR), refund is due after the rate moved to 1.12 — the refund is issued in EUR at the original EUR amount, not recalculated in USD. The payment gateway handles the currency conversion; the platform records the EUR amount.
- If the payment gateway cannot refund in the original currency (rare): a manual refund note is created; finance team processes the refund manually. The system records the manual refund with the amount in both currencies and the exchange rate used.

**VAT reclaim (EU business customers):**
- For EU operators, B2B rental invoices must include: operator's VAT registration number, customer's VAT registration number (entered on the corporate account), the net amount, the VAT amount, and the total amount — all required by EU VAT Directive Article 226.
- Invoice template must support the EU B2B invoice format. Corporate accounts have a "VAT Number" field; when populated, the invoice uses the B2B format with VAT shown separately.

**GST/HST (Canadian operators):**
- Canada federal GST (5%) applies to all provinces.
- Provincial HST rates vary: ON=13%, BC=12%, AB=5% (GST only, no PST on rentals), QC: GST(5%) + QST(9.975%) separately.
- Tax template must support multi-rate stacking with separate line items for each component.
- QST requires a separate QST registration number on invoices.

### 42.7 Deployment & Database Migration Safety

**Deployment strategy: blue/green:**
- Two identical production environments (Blue and Green). At any time, one is live (receiving traffic) and one is idle.
- New deployments go to the idle environment. After smoke tests pass, traffic is switched via load balancer in < 30 seconds (zero-downtime cutover).
- The previous environment remains running for 15 minutes after cutover — rollback is a single load-balancer switch with no re-deployment needed.
- Blue/green requires the database schema to be compatible with both the old and new application code during the cutover window.

**Zero-downtime database migrations (expand-contract pattern):**
- **No breaking schema changes in a single deployment.** All schema changes follow the expand-contract pattern:
  - Phase 1 (Expand): add new column with `DEFAULT` and `NULL` allowed. Deploy new code that writes to both old and new columns. Old code reads the old column; new code reads the new column.
  - Phase 2 (Backfill): background job populates the new column for all existing rows.
  - Phase 3 (Contract): once all rows are populated, drop the old column in a separate deployment.
- Renaming a column or table is treated as a breaking change and always uses expand-contract.
- A migration CI gate runs `pgmigrate dry-run` against the production schema before any merge; migrations that would cause a table lock > 5 seconds are rejected.

**Infrastructure as Code:**
- All AWS infrastructure defined in Terraform. No manual console changes permitted in production.
- Terraform state stored in S3 + DynamoDB locking.
- Infrastructure changes go through the same PR review process as application code.
- `terraform plan` output is posted to the PR as a comment; explicit approval from a senior engineer required before `terraform apply`.

---

## 43. Financial & Regulatory Completions

### 43.1 AR Dunning & Collections Workflow

**Dunning sequence for corporate direct-bill accounts:**

| Day Past Due | Action | Channel | System Action |
|---|---|---|---|
| Invoice issued | Invoice sent | Email + EDI | AR record created |
| Due date | — | — | Overdue timer starts |
| +7 days | Payment reminder | Email | Auto-sent from AR system |
| +15 days | Second reminder | Email + phone prompt to AR team | Account flagged "Overdue" in dashboard |
| +30 days | Formal notice: payment required within 15 days | Email (with PDF invoice attached) | AR team task created |
| +45 days | Pre-collection warning | Email + certified letter | New bookings for this account flagged for manager approval |
| +60 days | Final demand | Email + certified letter | New bookings blocked for this account |
| +75 days | Refer to collections | Collections export | Account status → "Collections"; account manager notified |

**Dunning content**: each dunning communication references the invoice number(s), original due date, amount outstanding, and payment instructions. Payment link included in email notifications.

**Bad debt write-off:**
1. AR team manager initiates write-off from the AR record.
2. Required: write-off amount, reason code (Uncollectable / Collection Agency Handoff / Legal Write-Off), supporting note.
3. Approval required from Finance Manager for write-offs above a configurable threshold (e.g., > $500).
4. System posts journal entry: Dr Allowance for Doubtful Accounts (or Bad Debt Expense) / Cr Accounts Receivable.
5. The original invoice is marked "Written Off" (not deleted — preserved for audit).
6. If the debt is later recovered: a recovery posting reverses the write-off.

**Collection agency handoff:**
- Export: list of accounts referred to collections, with: company name, contact, invoice numbers, amounts, invoice dates, dunning history log.
- Export format: CSV with fields matching the collection agency's intake template (configurable per agency).
- Once handed off: account status → "In Collections." No further dunning emails are sent by the system (the agency takes over contact).

### 43.2 Corporate Invoice Dispute & Credit Note

**Dispute submission (corporate account user):**
- Corporate customer can flag a line item as disputed from their invoice view in the booking portal.
- Dispute form: invoice number, line items disputed (checkboxes), reason (Billing Error / Service Not Received / Rate Discrepancy / Unauthorized Charge / Other), supporting description, optional attachment.
- Dispute creates a ticket in the AR team's queue.

**Internal dispute resolution workflow:**
- AR team reviews the disputed invoice against the rental agreement(s).
- Status: Open → Under Review → Resolved (Accepted / Partially Accepted / Rejected).
- Resolution timeline SLA: 5 business days for disputes < $500; 10 business days for disputes > $500.
- If accepted: credit note is generated.

**Credit note (invoice reversal):**
- Credit notes are formal financial documents (not just system credits).
- Content: operator name and VAT number, customer company name and VAT number, credit note number (sequential, separate series from invoice numbers), reference to original invoice number, list of line items being credited (with amounts and reason), total credit amount, date.
- Credit note is emailed to the corporate account's billing contact as a PDF.
- Credit note reduces the outstanding AR balance. If the invoice is already paid, the credit note creates a credit balance applied to the next invoice.
- Credit note is posted to the GL: Dr Revenue (specific account matching the original revenue category) / Cr Accounts Receivable.

### 43.3 Accounting Journal Entry Specifications

The following double-entry journal entries are defined for all significant transaction types. All entries use the GL account codes defined in §8.7.

| Transaction | Debit | Credit |
|---|---|---|
| Pre-authorization placed | Pre-Auth Liability (memo only — no cash movement) | — |
| Customer deposit received (cash) | Cash (1100) | Customer Deposit Liability (2200) |
| Rental revenue earned (daily, ASC 606) | Deferred Revenue (2300) | Rental Revenue (4100) |
| Extras/ancillary revenue earned | Deferred Revenue (2300) | Ancillary Revenue (4200) |
| Tax collected | Accounts Receivable / Cash | Tax Payable (2400) |
| Rental invoice settled (card) | Cash / Payment Gateway Clearing | Deferred Revenue (2300) |
| Deposit applied to charges at return | Customer Deposit Liability (2200) | Rental Revenue (4100) |
| Deposit returned to customer | Customer Deposit Liability (2200) | Cash (1100) |
| Partial refund issued | Rental Revenue (4100) | Cash / Gateway Clearing |
| Damage charge billed to customer | Accounts Receivable (1200) | Damage Recovery Revenue (4400) |
| Damage charge collected | Cash / Gateway Clearing | Accounts Receivable (1200) |
| CDW absorption of damage (no customer billing) | CDW Claims Expense (6300) | — |
| Chargeback loss | Chargeback Loss Expense (6400) | Cash / Gateway Clearing |
| Chargeback win (reversal) | Cash / Gateway Clearing | Chargeback Loss Expense (6400) |
| Chargeback fee | Bank Charges Expense (6500) | Cash |
| Fleet depreciation (monthly) | Depreciation Expense (6100) | Accumulated Depreciation (1600) |
| Vehicle disposal — gain | Cash / Proceeds Receivable | Vehicle Asset (1500) + Accumulated Depreciation (1600) + Gain on Disposal (4500) |
| Vehicle disposal — loss | Cash / Proceeds Receivable + Loss on Disposal (6200) | Vehicle Asset (1500) + Accumulated Depreciation (1600) |
| Bad debt write-off | Bad Debt Expense / Allowance for Doubtful Accounts | Accounts Receivable (1200) |
| Loyalty points liability accrual | Loyalty Points Expense (6600) | Loyalty Points Liability (2500) |
| Loyalty points redeemed | Loyalty Points Liability (2500) | Rental Revenue (4100) — discount |
| Loyalty points expired (breakage) | Loyalty Points Liability (2500) | Breakage Income (4600) |

### 43.4 Tax Remittance Filing Workflow

**Tax remittance report per jurisdiction:**
- System generates a tax remittance report per taxing authority per filing period (monthly, quarterly, or annually per jurisdiction).
- Report format: matches the structure of the jurisdiction's official return where possible (e.g., California BOE-531, New York DTF-802, Texas Form 01-117).
- Report includes: operator name and tax registration number, filing period, each tax type (sales tax / rental surcharge / county tax / city tax / airport concession fee, etc.) with: taxable gross receipts, exempt receipts, net taxable amount, tax rate, tax due.
- Separate remittance reports for airport concession fees (filed to airport authority, not state tax authority) — different format, different recipient, different cadence (typically monthly to the airport authority).

**Tax remittance workflow:**
1. Admin selects jurisdiction and filing period → system generates the remittance report.
2. Admin reviews report, verifies total against the tax collected in the GL (Tax Payable account balance for that jurisdiction and period).
3. If amounts match: admin marks the report "Verified" and initiates payment.
4. Payment methods: ACH/EFT to the tax authority (bank details stored per jurisdiction), or manual filing via the authority's online portal (system generates a downloadable file in the required format).
5. After payment: admin enters payment confirmation details (confirmation number, payment date, amount) — report status → "Filed & Paid."
6. System posts journal entry: Dr Tax Payable / Cr Cash.
7. Filing history is retained indefinitely (statute of limitations for tax audits is typically 3–7 years).

**Avalara tax filing (optional):** when Avalara is integrated, Avalara Returns can be enabled to automate filing directly from Avalara's platform. The admin reviews the proposed return, approves it, and Avalara files and remits electronically. The system records the Avalara filing reference number.

### 43.5 End-of-Day Financial Reconciliation

**EOD close checklist (finance team or senior manager):**
1. **Payment processor settlement match**: import the Stripe/Adyen daily settlement CSV → system matches each settlement line to a transaction record → any unmatched items are flagged as exceptions requiring investigation.
2. **Cash reconciliation**: confirm that the sum of cash collected per shift (§41.1) equals the cash deposited to bank. Variance flagged.
3. **Pre-auth verification**: confirm that all pre-auth holds captured today have corresponding reservation records; any orphaned auths are flagged for release.
4. **Revenue posting**: confirm that ASC 606 daily revenue recognition entries have posted for all active rentals.
5. **Tax accrual**: confirm Tax Payable account has increased by the tax collected today.
6. **AR update**: confirm that any corporate invoices issued today have been posted to AR.
7. **Open exceptions**: list of any unresolved items from previous days. Must be < 5 days old before an escalation flag is set.

**EOD reconciliation report:**
- Total transactions by payment method.
- Total revenue by category.
- Total tax collected by jurisdiction.
- Pre-auth outstanding (total held vs. total settled).
- Cash variance (expected vs. counted).
- Unmatched payment processor items.
- Exceptions from prior days.

### 43.6 Fraud Detection & 3D Secure

**Card-level rules (configured by operator in payment settings):**
- **AVS (Address Verification System)**: for US cards, require AVS match on billing ZIP code. Decline if AVS returns "No Match" for transactions above a configurable threshold (e.g., > $200). Configurable per location.
- **CVV requirement**: require CVV for all card-not-present transactions (online booking). A CVV mismatch auto-declines the transaction.
- **International card rule**: optionally require a higher security deposit for cards issued outside the operator's home country.
- **Prepaid card rule**: optionally block prepaid/gift cards (identified via card BIN lookup) — commonly used in fraud. If blocked: customer is shown a message asking them to use a non-prepaid card.

**Velocity checks:**
- Same card number used in > 3 bookings within 24 hours: flag for review and optionally require manual approval.
- Same customer email address used in > 2 bookings at different locations within 1 hour: fraud alert to admin.
- Same IP address used in > 5 bookings within 30 minutes: block and alert (bot detection).
- New account (registered < 24 hours ago) making a booking > $500: flag for manual review.

**3D Secure 2 (3DS2):**
- Required for all EU/UK card-not-present transactions under PSD2 Strong Customer Authentication (SCA).
- Stripe or Adyen handles the 3DS2 challenge flow; the platform must ensure the booking flow can handle: authentication success (proceed to booking), authentication failure (display error, allow retry), and frictionless authentication (no challenge — most common for low-risk transactions).
- For US operators: 3DS2 is optional but recommended; it provides chargeback liability shift — if the card issuer approves via 3DS, the operator is not liable for that chargeback.

### 43.7 Chargeback Financial Accounting

**On chargeback received:**
- System receives a webhook from the payment processor indicating a dispute.
- A chargeback record is created automatically linked to the original transaction and rental agreement.
- A provisional accounting entry is created (not yet permanent): Dr Chargeback Disputed (contra-asset, temporary) / Cr Accounts Receivable.

**On chargeback loss (operator loses the dispute):**
- Provisional entry is reversed; permanent loss entry is posted:
  - Dr Chargeback Loss Expense / Cr Cash (the funds are withdrawn from the operator's merchant account by the card network)
  - Dr Bank Charges Expense / Cr Cash (chargeback fee from payment processor)
- Chargeback Loss Expense is a P&L line item visible in the finance dashboard.

**On chargeback win (operator wins the dispute):**
- Provisional entry is reversed; recovery entry is posted:
  - Dr Cash / Cr Chargeback Disputed (contra-asset cleared — funds returned to merchant account)
- No P&L impact; the original revenue remains.

**Chargeback reporting for finance:**
- Total chargebacks received, total won, total lost, total fees, net chargeback loss (lost chargebacks + all fees − recovered amounts).
- By reason code, by location, by period.
- Chargeback rate: chargebacks received / total transactions. Visa and Mastercard have monitoring programs that flag merchants with a chargeback rate > 1% (Visa VDMP, Mastercard MDMP) — operators approaching this threshold receive an alert.

### 43.8 State-Specific Regulatory Overlays (US)

The jurisdiction compliance matrix (§19.3) must be populated with the following behavioral requirements — not just document expiry tracking.

**California (Civil Code §1936):**
- Before a CDW is offered, the operator must inform the customer whether their personal auto insurance or credit card covers rental car damage. A specific disclosure statement must be read or presented.
- If the customer's existing coverage is confirmed: CDW declination is standard.
- Maximum CDW daily charge is set by California law (currently $29/day for vehicles ≤ 35 MSRP, with adjustments — verify current rate annually).
- Towing costs included in CDW coverage by California law (operator cannot charge separately for towing if CDW was purchased).
- Rental of a vehicle with an open recall: California law prohibits renting a vehicle subject to a safety recall if the recall has been open for more than 24 hours after the manufacturer notification.

**New York:**
- Credit card surcharge is prohibited for consumer transactions in New York (GBL §518). The platform must ensure that no surcharge is assessed for card payments on New York location rentals.
- Mandatory minimum insurance: New York requires that a rental car come with minimum liability coverage of $25,000/$50,000/$10,000 included in the base rate. Operators cannot charge separately for this minimum coverage.
- Additional disclosure requirements for CDW, SLI, and PAI at the counter.

**Florida:**
- Florida no-fault insurance (PIP) interacts with rental car liability. Renters who have their own Florida PIP coverage extend it to rental cars; operators must not sell unnecessary SLI if the customer's PIP already covers them.
- Required disclosure: "Florida law requires us to inform you that you may not need the supplemental liability insurance we offer if you already have liability insurance coverage."

**Massachusetts:**
- No-show fees exceeding a certain amount may be regulated under Massachusetts consumer protection law. Operators should consult legal counsel before setting no-show fees above $25.

**Configuration approach:**
- A "State Compliance Overlay" module is added to Location Settings. For each US state, a pre-populated compliance checklist is provided covering: mandatory disclosures, fee limits, insurance requirements, and prohibited practices.
- These overlays appear as prompts in the counter agent's checkout workflow (e.g., at the extras selection screen, a California-specific disclosure dialog appears before CDW is presented).
- Compliance templates are reviewed and updated annually by the platform's legal team.

### 43.9 Insurance Product Regulatory Compliance

**Product classification by state:**
- In most US states, CDW/LDW is classified as a **contract provision** (not insurance) — the operator agrees to waive their damage claim rights against the renter. No insurance license is required to offer it.
- In **New York**, CDW is regulated as insurance and requires the rental company to hold a limited lines insurance license to sell it, or partner with a licensed insurer.
- **PAI (Personal Accident Insurance)** and **SLI (Supplemental Liability Insurance)** are always insurance products in all states — they must be underwritten by a licensed insurer, and the rental company must hold appropriate licensing (limited lines insurance producer license) to sell them, or the products must be sold through an MGA (Managing General Agent) relationship.

**Regulatory features required:**

**MGA integration workflow:**
- The platform supports an "MGA Mode" where protection products (SLI, PAI) are configured as products underwritten by an external MGA. The MGA provides: rate tables, policy terms, and filing requirements.
- At point of sale, the protection product transaction is transmitted to the MGA's API to generate a policy and policy number.
- The policy number is printed on the rental agreement.
- The operator receives a commission on each protection product sold; MGA remits commissions monthly.

**Declination acknowledgment form:**
- When a customer declines CDW, the system generates a "CDW Declination Record" — a separate sub-section of the rental agreement.
- Content (per California requirements): "I have been offered the collision damage waiver at $X/day. I have been informed that my personal auto insurance policy or credit card may provide coverage for rental vehicle damage. I decline the collision damage waiver and accept personal responsibility for any damage to the vehicle."
- Customer signature is captured separately on this declination record (digital signature on tablet, or initial box on printed RA).
- Declination records are stored and are a key exhibit in chargeback defense (demonstrating the customer was informed and chose to decline coverage).

**Mandatory product disclosures:**
- Before any protection product is presented to the customer at the counter or online, the booking engine displays a disclosure screen: what the product covers, what it excludes, the daily cost, and a note that existing coverage may be duplicative.
- Customer must scroll to the bottom of the disclosure and click "I have read the disclosure" before proceeding to accept or decline the product.
- Disclosure acknowledgment is logged: timestamp, product, agent/channel, customer ID, rental agreement number.

---

*Commercial readiness gap analysis performed by 5 parallel review agents — June 2026. Domains reviewed: (1) commercial launch readiness & operator onboarding, (2) customer experience & user journeys, (3) counter operations & daily workflows, (4) technical architecture & compliance, (5) financial workflows & regulatory compliance. All Critical and Important gaps from all 5 reports have been resolved as actionable requirements in this Part III.*
