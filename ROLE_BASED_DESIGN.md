# Role-Based Design — Rental Car Manager

## Personas & Role Mapping

| Persona | DB Role Key | Scope | Landing Page |
|---------|-------------|-------|--------------|
| System Admin | `SYSTEM_ADMIN` | Global, all ops | `/dashboard` |
| CEO / Executive | `EXECUTIVE` | Global, read-only | `/executive` (new) |
| Regional Director | `REGIONAL_MANAGER` | Global, multi-branch ops | `/regional` (new) |
| Branch Manager | `BRANCH_MANAGER` | Location-scoped, full ops | `/dashboard` |
| Counter Agent | `COUNTER_AGENT` | Location-scoped, counter only | `/checkout` |
| Return Agent | `SENIOR_AGENT` | Location-scoped, returns + damage | `/staff` |
| Fleet Manager | `FLEET_MANAGER` | Global fleet, no customer ops | `/back-office` |

---

## Per-Persona Design

### SYSTEM_ADMIN

**Job:** Maintain system integrity, configure business rules, manage access.

**KPIs:** Uptime, failed API calls, user anomalies, OTA sync health, audit log completeness.

**Sidebar navigation:**
- Dashboards: Overview, Operations, Back Office, My Tasks
- Fleet: Vehicles, Calendar, Locations, Maintenance, Damage
- Bookings: Reservations, Customers, Counter Checkout, Shift, Returns, Inspections, Overdue
- Analytics: Payments, Corporate, Pricing, Reports
- System: Settings

**Alert strip:** System errors, payment gateway status, overdue rentals, unresolved critical maintenance.

**All 22 routes accessible.** No restrictions.

---

### EXECUTIVE (CEO)

**Job:** Confirm business is profitable, growing, and free of systemic risk.

**KPIs:**
| Metric | Threshold |
|--------|-----------|
| Fleet Utilization Rate | Target 78–85%, alert <70% |
| Revenue MTD | vs. budget, flag >10% decline |
| RevPAV (Revenue per Available Vehicle) | Track vs. prior period |
| Gross Margin % | Alert if <40% |
| Average Daily Rate (ADR) | Flag if >8% below rate card |
| Fleet Age (avg months) | Alert if avg >36 months |
| Overdue Rentals | Alert any >48h (potential skip) |

**Sidebar navigation:**
- Overview: Executive Summary (`/executive`), Reports
- Fleet: Locations (read-only)
- Analytics: Corporate

**Home dashboard (`/executive` — new page):**
```
+-------------------+-------------------+-------------------+-------------------+
| REVENUE MTD       | UTILIZATION RATE  | FLEET HEALTH      | OVERDUE ALERTS    |
| $412,800          | 76.4%             | 81 / 100          | 7 active          |
| vs last month     | vs last week      | -5 pts this wk    | 2 over 48h        |
+-------------------+-------------------+-------------------+-------------------+
+------------------------------------------+------------------------------------+
| REVENUE TREND (30-day area chart)        | TOP BRANCHES BY REVENUE            |
| Daily bars + 7-day rolling average       | Branch | Revenue | Util%           |
| No customer names or IDs                 | Downtown | $94K  | 82%             |
+------------------------------------------+------------------------------------+
+------------------------------------------+------------------------------------+
| UTILIZATION BY VEHICLE CLASS             | ESCALATION SUMMARY                 |
| Economy |||||||||||||||  88%             | Overdue >48h: 2                    |
| SUV     ||||||||||||     72%             | Critical fleet: 3                  |
| Luxury  |||||||          51%             | Open damage claims: 14             |
+------------------------------------------+------------------------------------+
```

**Alert strip:** Revenue tracking vs. average, overdue count, fleet health score changes.

**Accessible routes:** `/executive`, `/reports`, `/locations` (read-only), `/corporate` (read-only)

**Hidden:** All counter ops, fleet management, customer PII, payments detail, settings, staff, tasks.

---

### REGIONAL_MANAGER (Director)

**Job:** Maximize utilization and revenue across all branches by identifying underperformers and rebalancing fleet.

**KPIs:**
| Metric | Threshold |
|--------|-----------|
| Utilization per Branch | Flag any <70% |
| RevPAV per Branch | Rank weekly, flag bottom quartile |
| Vehicle Class Availability Gap | Alert >2 classes at zero |
| Overdue Count by Branch | Zero tolerance >24h |
| Damage Claim Frequency | >5 per 100 agreements = investigate |
| Corporate Account Renewal Rate | Target >85% |

**Sidebar navigation:**
- Dashboards: Regional Overview (`/regional`), Back Office
- Fleet: Vehicles, Calendar, Locations, Damage
- Bookings: Reservations, Overdue
- Analytics: Reports, Corporate

**Home dashboard (`/regional` — new page):**
```
+----------------+----------------+----------------+----------------+
| BRANCHES       | TOTAL FLEET    | UTILIZATION    | OVERDUE COUNT  |
| 4 managed      | 312 vehicles   | 76.4% avg      | 7 total        |
+----------------+----------------+----------------+----------------+
+--------------------------------------------------------------------+
| BRANCH COMPARISON TABLE (sortable)                                 |
| Branch   | Fleet | Available | Out | Util%  | Overdue | Score     |
| Downtown |  88   |  16       | 72  | 81.8%  |  1      |  A        |
| Airport  |  94   |  22       | 72  | 76.6%  |  3      |  B+       |
+--------------------------------------------------------------------+
+------------------------------------+-------------------------------+
| OVERDUE BY BRANCH (bar chart)      | FLEET STATUS BY BRANCH        |
| Airport ||||   3                   | Stacked: Avail/Out/Maint/Off  |
| Midtown  |||  2                    |                               |
+------------------------------------+-------------------------------+
+--------------------------------------------------------------------+
| ESCALATIONS QUEUE (table)                                          |
| Time | Branch | Type | Severity | Status                          |
+--------------------------------------------------------------------+
```

**Alert strip:** Branch utilization gaps, uncontacted overdue rentals, inter-branch transfer delays.

**Accessible routes:** `/regional`, `/back-office`, `/fleet`, `/fleet-calendar`, `/locations`, `/damage`, `/reservations` (read), `/overdue`, `/reports`, `/corporate`

**Hidden:** Counter checkout, individual customer PII, payments detail, pricing config, settings, tasks (staff-level), shift management.

---

### BRANCH_MANAGER

**Job:** Run the branch profitably today — right vehicles available, staff on task, cash balanced.

**KPIs:**
| Metric | Threshold |
|--------|-----------|
| Today's Utilization Rate | Live, target 78%+ |
| Vehicles Due Back Today | Count vs. expected |
| Overdue Rentals | Action required >4h |
| Shift Cash Variance | Flag >$10 |
| Vehicles in Maintenance | Alert if >15% of fleet |
| Walk-in Conversion Rate | Target >60% |

**Sidebar navigation:**
- Dashboards: Overview (`/dashboard`), Operations, Back Office, Task Board
- Fleet: Vehicles, Calendar, Maintenance, Damage
- Bookings: Reservations, Customers, Overdue, Inspections
- Analytics: Reports

**Home dashboard (`/dashboard`, branch-filtered):**
```
+------------------+------------------+------------------+------------------+
| TODAY PICKUPS    | TODAY RETURNS    | FLEET AVAILABLE  | OVERDUE          |
| 12  [next: 9am]  | 8   [next:11am]  | 22 of 88 ready   | 3                |
+------------------+------------------+------------------+------------------+
+---------------------------------------------+----------------------------+
| FLEET STATUS BOARD (live, this branch)      | STAFF ON SHIFT TODAY       |
| Available  22  ||||||||||||||||             | Counter: 2 agents          |
| Out        61  |||||||||||||||||||||||||    | Returns: 1 agent           |
| Maintenance 3  |||                          |                            |
+---------------------------------------------+----------------------------+
+---------------------------------------------+----------------------------+
| OVERDUE RENTALS (this branch)               | OPEN TASKS                 |
| 3 rows: vehicle, days overdue, last contact | 7 open / 3 overdue         |
+---------------------------------------------+----------------------------+
+---------------------------------------------+----------------------------+
| UPCOMING PICKUPS (next 4 hours)             | DAMAGE CLAIMS              |
| Time | Res ID | Vehicle | Agent Assigned    | Open: 4   Pending: 2       |
+---------------------------------------------+----------------------------+
```

**Alert strip:** Overdue not actioned, damage unresolved, cash variance, vehicle class depleted.

**Accessible routes:** `/dashboard`, `/staff`, `/back-office`, `/task-board`, `/fleet`, `/fleet-calendar`, `/maintenance`, `/damage`, `/reservations`, `/customers`, `/overdue`, `/inspections`, `/reports`

**Hidden:** Pricing config, settings, counter checkout flow, shift terminal (managed via task-board), executive/regional views, corporate account terms.

---

### COUNTER_AGENT

**Job:** Complete fast, accurate rental agreements — qualify customers, assign vehicles, collect payment.

**KPIs:** Check-out time <8 min, ancillary attach rate >35%, upsell conversion >20%, zero payment errors.

**Sidebar navigation:**
- My Shift: Counter Checkout (`/checkout`), My Tasks, Shift
- Bookings: Overdue (read-only)

**Home: lands directly on `/checkout`** with today's pickup queue as a left panel.

```
+--------------------------------------------------------------------+
| SHIFT SUMMARY BAR                                                  |
| Shift: 08:00–16:00 | Checkouts: 7 | Queue: 3 next                 |
+--------------------------------------------------------------------+
+----------------------------------+-----------------------------------+
| TODAY'S PICKUP QUEUE             | ACTIVE CHECKOUT FLOW              |
| Res ID  | Time  | Class    [->]  | Step 1: Verify ID                 |
| #10482  | 09:00 | Economy       | Step 2: Review reservation        |
| #10491  | 09:30 | SUV           | Step 3: Add-ons / damage waiver   |
|                                  | Step 4: Payment capture           |
| [Search by Res ID]               | Step 5: Key handover + sign       |
+----------------------------------+-----------------------------------+
```

**Alert strip:** Pickup now, next 3 pickups, shift end time. No customer names — Res ID only.

**Accessible routes:** `/checkout` (home), `/tasks`, `/shift`, `/overdue` (read-only)

**Hidden:** All financial data, fleet management, customers page, reservations list, reporting, pricing, settings.

---

### RETURN_AGENT (SENIOR_AGENT)

**Job:** Close rental agreements accurately — mileage, fuel, damage, release vehicle to fleet.

**KPIs:** Return processing <5 min, damage capture rate 100%, fuel surcharge accuracy, turnaround time <30 min.

**Sidebar navigation:**
- My Shift: Active Rentals (`/staff`), Process Return, Inspections, My Tasks, Shift
- Fleet: Damage Claims

**Home: `/staff`** (active rentals board filtered to returns queue)

```
+----------------------+----------------------+----------------------+
| ACTIVE RETURNS QUEUE | MY COMPLETED TODAY   | DAMAGE REPORTS OPEN  |
| 5 incoming           | 8 processed          | 3 (2 mine)           |
+----------------------+----------------------+----------------------+
+---------------------------------------------+----------------------------+
| ACTIVE RENTALS BOARD (return-agent view)    | RETURN PROCESSING FLOW     |
| Res ID | Vehicle | Expected Return | Status | Checklist-driven:          |
| Green=on time, Amber=due soon, Red=overdue  | 1. Mileage capture         |
| No payment info, no customer full names     | 2. Fuel level              |
|                                             | 3. Walk-around photos      |
|                                             | 4. Damage flag             |
+---------------------------------------------+ 5. Condition sign-off     |
```

**Alert strip:** Incoming returns, unresolved damage from prior shift, overdue vehicles.

**Accessible routes:** `/staff` (home), `/returns`, `/inspections`, `/damage` (create + own claims), `/tasks`, `/shift`

**Hidden:** Pricing, payments, reservations list, customers page, fleet management, reporting, settings.

---

## Permission Matrix

| Resource | SYSTEM_ADMIN | EXECUTIVE | REGIONAL_MGR | BRANCH_MGR | COUNTER | SENIOR_AGENT |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| vehicles | `*` | R | RCUD | RU | R | RU |
| vehicle_blocks | `*` | — | CU | CU | — | CU |
| reservations | `*` | R | RCUD | RCUD | RCU | RCU |
| customers | `*` | — | RCUD | RCUD | RCU | RCU |
| payments | `*` | R | R+refund | R+refund | RC | RC+refund |
| damage | `*` | R | RCU | RCU | C | RCU |
| tasks | `*` | — | RCUD | RCUD | RCU | RCU |
| reporting | `*` | R | R | R | — | — |
| rate_codes | `*` | R | RCUD | R | — | — |
| notifications | `*` | — | R | R | — | — |
| channels | `*` | — | RU | — | — | — |
| admin:config | yes | — | — | — | — | — |

R=read, C=create, U=update, D=delete

---

## New Pages Required

### `/executive` — ExecutiveDashboardPage
- Revenue MTD/YTD with sparkline vs. prior period
- Fleet utilization rate with trend
- Fleet health score (composite)
- Overdue rentals count (no PII)
- Revenue trend chart (30-day)
- Top branches by revenue (table)
- Utilization by vehicle class (bar chart)
- Escalation summary (counts only, no names)
- **Zero mutation controls** — no create/edit/delete buttons

### `/regional` — RegionalDashboardPage
- Branch comparison table (utilization, ADR, RevPAV, overdue, score)
- Fleet status by branch (stacked bar)
- Overdue by branch (bar chart)
- Escalations queue (links to `/damage` + `/overdue` filtered by branch)
- No customer PII, no individual payment details

---

## Login Redirect Map

| Role | Redirect to |
|------|-------------|
| SYSTEM_ADMIN / SUPER_ADMIN | `/dashboard` |
| EXECUTIVE | `/executive` |
| REGIONAL_MANAGER | `/regional` |
| BRANCH_MANAGER | `/dashboard` |
| COUNTER_AGENT | `/checkout` |
| SENIOR_AGENT | `/staff` |
| FLEET_MANAGER | `/back-office` |
| MAINTENANCE_TECH | `/maintenance` |
| FINANCE_ANALYST | `/reports` |
| CLAIMS_COORDINATOR | `/damage` |

---

## Critical Gaps (P0/P1 — require code fixes)

| Priority | Gap | Fix Required |
|----------|-----|-------------|
| P0 | Pricing endpoints have no RBAC gates | Add `require_permission("rate_codes", "create")` to pricing router write operations |
| P0 | Reservation endpoints have no RBAC gates | Add `require_permission` to PATCH/DELETE reservation endpoints |
| P1 | `damage_claims` DB key ≠ `damage` router resource | Fixed in DB (this migration); confirm router uses `"damage"` |
| P1 | `reporting` DB key ≠ `reporting:read` router check | Align: use `"reporting"` in router, fixed in DB |
| P1 | FLEET_MANAGER missing `vehicles:read` | Fixed in DB |
| P1 | COUNTER_AGENT missing `payments:read` | Fixed in DB |
| P1 | BRANCH_MANAGER missing `vehicle_blocks:create` | Fixed in DB |
| P1 | `channels:*` absent from all roles | Fixed in DB for REGIONAL_MANAGER + SYSTEM_ADMIN |
| P2 | No EXECUTIVE role | Created in DB |
| P2 | Dashboard queries not location-scoped | Add `location_id` filter from JWT claims |
