# Admin Web App — Feature Backlog

Priority order based on operational impact and revenue cycle completeness.
API endpoints exist for all items unless noted otherwise.

---

## 1. Payment Capture & Receipt [REVENUE-CRITICAL]
**Why:** Without this, no money is collected at return. Completes the revenue cycle.
**Flow:** Return processed → agent reviews final charges → capture Stripe pre-auth → generate invoice → send receipt
**API:** `POST /payments/capture`, `POST /billing/invoice`, `GET /billing/invoice/{id}`
**Page:** `/payments` — per-RA payment panel; capture button, invoice download, refund action
**Scope:** Capture form with final total breakdown, invoice PDF viewer, refund workflow

---

## 2. Vehicle Inspection Form [LEGAL/DISPUTE-CRITICAL]
**Why:** Pre-checkout and post-return damage checklist. Prevents disputes. Legally required.
**Flow:** Pre-checkout → agent walks car → marks damage zones → photos → sign off → RA proceeds
         Post-return → same form → compare pre vs post → flag new damage → open claim
**API:** `POST /damage/inspections`, `GET /damage/inspections/{ra_id}`, `GET /damage/inspections/{ra_id}/comparison`
**Page:** `/inspections` — interactive vehicle diagram (top/front/rear/sides), damage zone picker, photo notes
**Scope:** Inline within checkout and return wizards, plus standalone page for ad-hoc inspections

---

## 3. Damage Claims [FINANCIAL-RECOVERY]
**Why:** When inspection finds new damage, a claim must be opened, tracked, and settled.
**Flow:** Damage flagged → claim opened (severity, description, repair estimate) → status tracked → settled via insurance or customer charge
**API:** `POST /damage/claims`, `GET /damage/claims`, `GET /damage/claims/{id}`, `POST /damage/claims/{id}/status`, `GET /damage/claims/{id}/lou`
**Page:** `/damage` — claims list with status pipeline (OPEN → UNDER_REVIEW → SETTLED/DENIED), claim detail drawer
**Scope:** Claim creation from inspection, status management, LOU (Letter of Undertaking) generation

---

## 4. Reservation Modification & Cancellation [OPS-CRITICAL]
**Why:** Agents constantly change dates, upgrade vehicles, or cancel — no UI for any of this currently.
**Flow:** Modify: find reservation → change dates/class/vehicle → recalculate rate → confirm
         Cancel: find reservation → apply cancellation policy → preview refund → void pre-auth → status → CANCELLED
**API:** `PATCH /reservations/{id}`, `POST /reservations/{id}/cancel` (may need to add)
**Page:** Add action panel to `/reservations` — Edit drawer + Cancel confirmation with refund preview
**Scope:** Date/class/extras modification, cancellation with policy-based fee, pre-auth void

---

## 5. Shift Open / Close [CASH-RECONCILIATION]
**Why:** Agents must open a shift before counter operations; close it at end of day for cash reconciliation.
**Flow:** Open: agent logs in → modal forces shift open (cash count + fleet count) → shift recorded
         Close: agent submits closing cash + card totals → system shows variance → report generated
**API:** `POST /checkout/shift/open`, `POST /checkout/shift/close`, `GET /checkout/shift/current`
**Page:** Shift panel accessible from `/checkout` header — open/close modal, current shift status badge
**Scope:** Open modal with cash/fleet fields, close modal with reconciliation summary, variance alert

---

## 6. Overdue Rentals Dashboard [OPERATIONS]
**Why:** Fleet visibility — know which vehicles are late and by how much before dispatching follow-ups.
**Flow:** List all RAs past return_datetime → sort by days overdue → contact customer → escalate or extend
**API:** `GET /checkout/overdue`
**Page:** `/overdue` tab on Staff Dashboard or standalone — sortable table, days overdue badge, call/extend/flag actions
**Scope:** Overdue list with customer contact, quick-extend action, flag for collections

---

## 7. Maintenance Scheduling [FLEET-HEALTH]
**Why:** Vehicles need scheduled service; system should block rentals during maintenance windows.
**Flow:** Create work order → assign vehicle → schedule date → block vehicle → mark complete → release to fleet
**API:** `/maintenance` domain endpoints
**Page:** `/maintenance` — work order list, schedule calendar view, vehicle timeline
**Scope:** Work order CRUD, vehicle block during maintenance, completion workflow

---

## 8. Customer Payment History [CUSTOMER-SERVICE]
**Why:** Agents need to see past payments, outstanding balances, and invoices during customer interactions.
**Flow:** Open customer profile → Payments tab → list all transactions → download invoice → initiate refund
**API:** `GET /payments/reservation/{reservation_id}` (per reservation); needs customer-level aggregation
**Page:** Add Payments tab to customer detail panel on `/customers`
**Scope:** Transaction list, invoice links, refund initiation, outstanding balance display

---

## 9. No-Show & Early Return Handling [EDGE-CASES]
**Why:** No-shows need fee charging and reservation closure; early returns need prorated refund.
**Flow:** No-show: past pickup time with no checkout → mark no-show → charge fee → release vehicle block
         Early return: customer returns before scheduled date → calculate prorated refund → process
**API:** Needs `POST /reservations/{id}/no-show` and early-return logic in check-in (already handles time calc)
**Page:** Action button on `/reservations` detail panel; early return handled as variant of `/returns`
**Scope:** No-show modal with fee preview, early-return as checkout variant with credit calculation

---

## 10. Corporate Accounts [B2B-REVENUE]
**Why:** Corporate clients need net-30 billing, credit limits, consolidated invoicing, dedicated rates.
**Flow:** Create account → assign rate code → link customers → monthly invoice generation → payment tracking
**API:** `/corporate` domain
**Page:** `/corporate` — account list, account detail with linked customers/reservations, monthly invoice
**Scope:** Account CRUD, customer linking, invoice generation, credit limit enforcement

---

## Implementation Order
| # | Feature | Impact | Effort | Status |
|---|---------|--------|--------|--------|
| 1 | Payment Capture & Receipt | Revenue | M | TODO |
| 2 | Vehicle Inspection Form | Legal/Dispute | M | TODO |
| 3 | Damage Claims | Financial Recovery | M | TODO |
| 4 | Reservation Modification & Cancellation | Ops Daily | L | TODO |
| 5 | Shift Open / Close | Cash Reconciliation | S | TODO |
| 6 | Overdue Rentals Dashboard | Fleet Ops | S | TODO |
| 7 | Maintenance Scheduling | Fleet Health | M | TODO |
| 8 | Customer Payment History | Customer Service | S | TODO |
| 9 | No-Show & Early Return | Edge Cases | S | TODO |
| 10 | Corporate Accounts | B2B Revenue | L | TODO |
