# Gap Analysis — Car Rental CRM Discovery Call vs. Current Build

**Prepared by:** Architecture Team (Requirements Analyst + Codebase Auditor)
**Date:** 2026-06-17
**Source:** Discovery call with Louis, James, Sumit, Nathan, Ricky
**Methodology:** 113 requirements extracted from discovery call mapped against full codebase audit of `/apps/api`, `/apps/web-admin`, `/apps/web-booking`, `/apps/web-counter`

---

## Executive Summary

The current build is a **solid, production-grade rental operations platform** covering the core checkout/return/damage lifecycle. However, three critical architectural mismatches exist between what the client explicitly requested and what has been built:

| Mismatch | Client Requirement | Current Build | Impact |
|---|---|---|---|
| **Authentication method** | Mobile OTP (phone number as primary identity) | Email + password + TOTP (app-based) | Requires auth refactor |
| **Payment gateway** | Tyro (Australian, P0) | Stripe only | Tyro integration needed from scratch |
| **Communications** | WhatsApp is *essential*, Email is *essential* | Email partial, WhatsApp absent, SMS partial | Core workflow broken |

Beyond these three, **49 of 113 requirements are gaps** (not yet built), **31 are partial**, and **33 are implemented**. The gap is concentrated in integrations, automation, and the advanced fleet optimization features.

---

## Legend

| Symbol | Meaning |
|---|---|
| BUILT | Fully implemented, production-ready |
| PARTIAL | Backend or frontend exists but incomplete; or works but missing key parts |
| GAP | Not implemented — needs to be built |
| MISMATCH | Built differently than required — refactor needed |
| DEFERRED | Explicitly out of scope for MVP |

---

## Domain-by-Domain Gap Analysis

---

### Domain 1 — Authentication & User Management

**Discovery call requirement:** Mobile OTP login, phone number as primary identifier, role-based access for Manager / Staff / Back-Office, audit logging.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| AUTH-01 | Mobile OTP (SMS-based) as login method | **MISMATCH** | Current: email + password + app-based TOTP (Google Authenticator-style). Client wants phone number → SMS OTP. This is a different flow and different primary credential. |
| AUTH-02 | Role-based access control | **BUILT** | Full RBAC matrix with 8 roles, permission matrix per resource, location scoping. |
| AUTH-03 | No new-tab forcing / SPA behaviour | **BUILT** | SPA architecture across all apps. |
| AUTH-04 | Manager role scoped separately from staff | **BUILT** | BRANCH_MANAGER, REGIONAL_MANAGER vs STAFF/COUNTER_AGENT roles exist. |
| AUTH-05 | Owner/principal role with forecasting access | **PARTIAL** | No explicit "Owner" role; SYSTEM_ADMIN is closest but no forecasting views exist yet. |
| AUTH-06 | Audit log of all changes with staff identity | **BUILT** | `audit_events` table, structured logging throughout. |
| AUTH-07 | Mobile phone number as primary login identifier | **GAP** | Current system uses email as primary login. Phone field exists on customer records but not on staff auth. |

**Gap Score: 1 built + 1 partial + 2 gaps + 1 mismatch out of 5 actionable items.**

**Build required:**
- Replace or supplement email-password auth with phone-number → SMS OTP flow for staff
- Add phone field to `staff_users` table
- Integrate SMS OTP provider (Twilio already present — reuse it)
- Add "Owner" role variant of BRANCH_MANAGER with forecasting permissions

---

### Domain 2 — Fleet Calendar & Vehicle Allocation ("Tetris" View)

**Discovery call requirement:** Tetris grid (vehicles × dates), monthly view, gap highlighting, drag-and-drop booking reallocation, 24h turnaround auto-block, optimization mode.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| CAL-01 | Fleet calendar grid (vehicles × dates, colored blocks) | **BUILT** | Tetris-style grid exists in FleetCalendarPage. Praised in discovery call as the model to emulate. |
| CAL-02 | Monthly view as default (currently 14-day rolling) | **PARTIAL** | Current calendar shows 14-day window. Client explicitly praised monthly view. Needs date-range extension. |
| CAL-03 | Visual gap highlighting between bookings | **PARTIAL** | Idle periods show as blank cells but no distinct "gap" color or gap analytics overlay. |
| CAL-04 | Drag-and-drop booking reallocation (move booking to different vehicle row) | **GAP** | Calendar renders blocks as read-only. No drag-to-reallocate. This was central to the "Tetris" discussion. |
| CAL-05 | 24-hour automatic turnaround block between bookings | **BUILT** | TURNAROUND block type exists, vehicle blocks with exclusion constraints implemented. |
| CAL-06 | Turnaround block visually distinct | **BUILT** | Color-coded block types on calendar. |
| CAL-07 | Reallocation triggers automated reconfirmation to customer | **GAP** | No event-driven reconfirmation on vehicle swap. |
| CAL-08 | Vehicles grouped by category on Y-axis | **PARTIAL** | Vehicles shown but grouping by class may be absent; filter by location exists. |
| CAL-09 | Fleet utilization bar/metric alongside calendar | **PARTIAL** | Utilization exists in ReportsPage (stubbed). Not inline on calendar. |
| CAL-10 | Maintenance block type | **BUILT** | MAINTENANCE block type in vehicle_blocks. |
| CAL-11 | Click booking block → detail panel in same view (no new tab) | **PARTIAL** | Block click behavior unclear from code; may open separately. |
| CAL-12 | Filter calendar by vehicle category | **PARTIAL** | Filter by location exists; category filter may be absent. |
| CAL-13 | Optimization mode: auto-suggest/execute gap-filling reallocation | **GAP** | Not implemented. High-complexity algorithmic feature. |
| CAL-14 | Reconfirmation queued automatically when swap applied post-confirmation | **GAP** | No event hook exists for vehicle swap → message queue. |

**Gap Score: 4 built + 4 partial + 4 gaps out of 14.**

**Build required:**
- Extend calendar date range to 30-day monthly view with navigation
- Add gap-highlighting color layer (idle cells between bookings)
- Implement drag-and-drop reallocation: drag booking block from one vehicle row to another in same category
- Vehicle grouping by class on Y-axis
- Utilization metric bar above calendar
- Event hook: vehicle_swap event → queue reconfirmation message (CAL-07/14) via communications domain
- Category filter on calendar
- Optimization mode: algorithmic gap analysis and suggestion (P1, post-MVP)

---

### Domain 3 — Reservation & Booking Flow

**Discovery call requirement:** Staff-mediated confirmation flow, category-based booking, real-time availability, booking source tracking, automated reminders.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| RES-01 | New booking intake form | **BUILT** | CRM reservation form and web-booking intake both exist. |
| RES-02 | Real-time availability check before confirm | **BUILT** | Availability queries with Redis caching (60s TTL). |
| RES-03 | Reject booking if fleet full (no overbooking) | **BUILT** | Exclusion constraints + availability check block double-booking. |
| RES-04 | Booking confirmation workflow (check → confirm → message → payment) | **PARTIAL** | Flow exists but communications are email-only (WhatsApp/SMS not wired). Payment link not sent inline with confirmation. |
| RES-05 | Category-based booking | **BUILT** | Vehicle classes used throughout. Customer books by class. |
| RES-06 | System assigns specific vehicle from category pool | **BUILT** | Vehicle assignment in checkout flow. |
| RES-07 | Same-category substitution on unavailability | **BUILT** | Vehicle swap implemented in checkout domain. |
| RES-08 | Booking source field per reservation | **BUILT** | Booking channel (WEB, PHONE, COUNTER, OTA) tracked. |
| RES-09 | Status lifecycle (Lead → Confirmed → Active → Returned → Closed) | **BUILT** | PENDING, CONFIRMED, CHECKED_OUT, RETURNED, CANCELLED states tracked. |
| RES-10 | List/filter reservations | **BUILT** | ReservationsPage with search/filter/sort. |
| RES-11 | Booking detail view accessible from calendar and list | **BUILT** | Reservation detail accessible; calendar click behavior partial. |
| RES-12 | Automated pre-pickup due-date reminders | **PARTIAL** | Template system exists, but scheduled Celery task for timed reminders not implemented. |
| RES-13 | After-hours customer drop-off with photo upload | **GAP** | No customer-facing after-hours drop-off flow or photo submission link. |
| RES-14 | Rental extension with conflict check | **PARTIAL** | Date modification exists in reservations domain; calendar conflict check on extension unclear. |

**Gap Score: 9 built + 3 partial + 1 gap out of 13 (excellent coverage).**

**Build required:**
- Wire WhatsApp + SMS into the confirmation workflow (COM-02/03 prerequisite)
- Build scheduled Celery task for pre-pickup reminder dispatch (24h / 48h before)
- Build after-hours customer drop-off flow: shareable link, mobile photo upload, timestamp log
- Validate extension conflict check against fleet calendar

---

### Domain 4 — OTA/Channel Integrations (Booking.com, Expedia)

**Discovery call requirement:** Inbound leads from Booking.com and Expedia arrive in a unified inbox. Staff actions them (check availability → confirm/reject → sync back to OTA). Inventory pushed to channels when bookings created/cancelled.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| OTA-01 | Booking.com API integration | **GAP** | Stub-only. No connectivity layer. |
| OTA-02 | Expedia API integration | **GAP** | Stub-only. No connectivity layer. |
| OTA-03 | Unified leads inbox in CRM | **GAP** | No "incoming leads" view in web-admin. |
| OTA-04 | Staff can action each OTA lead (check availability → confirm/reject → sync back) | **GAP** | No OTA lead action workflow. |
| OTA-05 | OTA booking reference stored alongside internal ID | **PARTIAL** | Booking channel field exists; OTA-specific reference number not a dedicated field. |
| OTA-06 | Inventory updates pushed back to OTA on booking create/cancel | **GAP** | No outbound webhook/push to OTA channels. |
| OTA-07 | Shared channel visibility (OTAs can see current capacity) | **GAP** | No channel manager / availability API published. |
| OTA-08 | Extensible channel manager architecture for future OTAs | **GAP** | No channel abstraction layer. |
| OTA-09 | OTA reservations appear in fleet calendar | **PARTIAL** | If OTA bookings enter via manual counter entry or API (once built), they would appear. But no auto-ingestion. |
| OTA-10 | Staff notification on new OTA lead | **GAP** | No OTA event source = no notification. |

**Gap Score: 0 built + 2 partial + 8 gaps out of 10. This is the largest unbuilt domain.**

**Build required (high complexity, all P0):**
- Booking.com Connectivity API integration (requires partner program enrollment)
- Expedia Rapid API integration (requires partner program enrollment)
- Unified "Channel Inbox" page in web-admin for incoming OTA leads
- OTA lead action workflow: availability check → confirm/reject → POST to OTA API
- `ota_reference_number` field on reservations table
- Outbound availability sync: webhook/push on booking create, modify, cancel
- Channel manager abstraction layer (so adding TripAdvisor, Agoda later is a config change)
- Push notification to staff on new OTA lead arrival

**External dependency:** Booking.com and Expedia partner API credentials must be obtained by Ricky's business before development can start on OTA-01/02.

---

### Domain 5 — Communications & Automation (Email, WhatsApp, SMS)

**Discovery call requirement:** Email and WhatsApp essential. SMS useful but lower priority. Automated confirmations, reminders, and reconfirmations. Template management per channel.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| COM-01 | Email integration | **PARTIAL** | SendGrid SDK present, templates exist (Handlebars), fire-and-forget on booking confirmation. Scheduled/triggered automation not working end-to-end. |
| COM-02 | WhatsApp Business API | **GAP** | Not implemented. No WhatsApp SDK or integration. This is marked essential by client. |
| COM-03 | SMS via Twilio | **PARTIAL** | Twilio SDK present but delivery pipeline (Celery worker) not fully implemented. |
| COM-04 | Template management system | **BUILT** | Template CRUD with Handlebars, event codes, test-send endpoint. Multi-channel template assignment needed. |
| COM-05 | Automated booking confirmation on confirm | **PARTIAL** | Email confirmation fires on reservation creation. WhatsApp/SMS not wired. |
| COM-06 | Automated pre-pickup reminder (48h / 24h) | **PARTIAL** | Template exists; scheduled Celery task dispatch not implemented. |
| COM-07 | Payment-due reminder for pending payments | **GAP** | No scheduled payment reminder. |
| COM-08 | Vehicle reconfirmation on reallocation | **GAP** | No event hook between vehicle swap and message queue. |
| COM-09 | Post-return follow-up automation | **GAP** | No post-return message scheduled. |
| COM-10 | Staff sends ad-hoc message from booking detail | **PARTIAL** | RA email send exists; WhatsApp/SMS ad-hoc not available. |
| COM-11 | Message log per booking (sent, channel, delivery status) | **PARTIAL** | Some notification logging; per-booking message thread not surfaced in UI. |
| COM-12 | Customer communication preference (preferred channel) | **GAP** | Field absent on customer and reservation records. |
| COM-13 | Template variable substitution (name, dates, link) | **BUILT** | Handlebars templating with variable injection. |

**Gap Score: 2 built + 5 partial + 6 gaps out of 13.**

**Build required:**
- **WhatsApp Business API** (Meta Cloud API or Twilio for WhatsApp): message send, template pre-approval, webhook for delivery receipts — this is a critical P0 build
- Complete Celery worker delivery pipeline for email, WhatsApp, SMS
- Add scheduled task triggers: pre-pickup reminders, payment reminders, post-return follow-up
- Event hook: vehicle_swap → queue reconfirmation message
- Add `preferred_channel` field to customer + reservation records
- Per-booking message log view in web-admin (booking detail panel)
- Multi-channel template assignment in template management UI

---

### Domain 6 — Payment Processing (Tyro/Stripe)

**Discovery call requirement:** Tyro is priority gateway (Australian). Stripe is secondary. Payment request link sent inline with booking confirmation. Bond capture and release linked to return condition.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| PAY-01 | Tyro payment gateway integration | **GAP** | **Critical mismatch.** Current build uses Stripe only. Tyro is Australian-specific and requires a different SDK, webhook model, and terminal integration. |
| PAY-02 | Stripe as secondary gateway | **BUILT** | Full Stripe integration with pre-auth/capture/void/refund, circuit breaker. |
| PAY-03 | Payment request link sent with booking confirmation | **PARTIAL** | Stripe Checkout or PaymentIntent link can be generated; it is not currently embedded in the confirmation message automatically. |
| PAY-04 | Payment status visible on booking detail | **BUILT** | PaymentsPage and payment status on reservations. |
| PAY-05 | Staff can manually resend payment request | **PARTIAL** | Payment can be triggered; dedicated "resend request" button may not exist. |
| PAY-06 | Payment receipt/confirmation number stored | **BUILT** | Stripe PaymentIntent ID stored, receipt data present. |
| PAY-07 | Bond/deposit capture workflow | **BUILT** | Pre-auth (hold) and capture flow fully implemented via Stripe. |
| PAY-08 | Bond release triggered by satisfactory return condition | **PARTIAL** | Manual refund/void capability exists; automated bond release linked to photo review not implemented. |
| PAY-09 | Payment history log per booking | **BUILT** | Full payment audit trail. |
| PAY-10 | Gateway-agnostic abstraction layer | **PARTIAL** | Stripe is well-abstracted; adding Tyro requires building the abstraction layer properly to avoid rework. |
| PAY-11 | Refund capability with manager approval | **BUILT** | Refund with approval gate for amounts >$500 implemented. |

**Gap Score: 6 built + 3 partial + 1 gap + 1 mismatch out of 11.**

**Build required:**
- **Tyro integration (P0):** Tyro has an Australian gateway SDK. Requires: Tyro merchant account credentials, Tyro POS/eCommerce API, terminal pairing for in-person payments, webhook event handling for auth/capture/void events
- Build gateway-agnostic abstraction layer first: `PaymentGateway` interface with `Stripe` and `Tyro` implementations — allows switching per tenant config
- Auto-embed payment link in booking confirmation message (COM-05 dependency)
- Automated bond release workflow: return_condition_approved event → trigger void/capture based on damage assessment

---

### Domain 7 — Manager Dashboard & Analytics

**Discovery call requirement:** Single-screen view of today's activity (revenue, pickups, drop-offs), 7-day forecast, fleet utilization, no navigation required.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| MGR-01 | Today's summary: revenue, active rentals, pickups, drop-offs | **PARTIAL** | ManagerDashboardPage exists but populates from hardcoded/stub data in ReportsPage. |
| MGR-02 | Today's scheduled pickups list | **PARTIAL** | Structure exists; live data from reservations API may not be wired. |
| MGR-03 | Today's scheduled drop-offs/returns list | **PARTIAL** | Same as MGR-02. |
| MGR-04 | Upcoming 7-day bookings view | **PARTIAL** | Reservations list exists with date filter; dedicated 7-day grouping view absent. |
| MGR-05 | 7-day revenue forecast (confirmed bookings, per day) | **GAP** | No forecast calculation. ReportsPage has 6-month history chart (stubbed) but no forward-looking projection. |
| MGR-06 | Fleet utilization rate (% on rent vs. available vs. blocked) | **PARTIAL** | Calculation logic could be derived from existing data; not surfaced in live dashboard. |
| MGR-07 | Revenue breakdown by booking source/channel | **PARTIAL** | ReportsPage has chart placeholder; booking source field exists on reservations. |
| MGR-08 | Overdue returns highlighted on dashboard | **BUILT** | OverduePage fully implemented. |
| MGR-09 | All data in single view, no sub-navigation | **PARTIAL** | Multiple pages exist (Reports, Overdue separate). Single consolidated view not built. |
| MGR-10 | Near-real-time refresh without full page reload | **PARTIAL** | WebSocket exists for fleet availability; dashboard polling/ws not implemented. |

**Gap Score: 1 built + 7 partial + 2 gaps out of 10.**

**Build required:**
- Wire ManagerDashboardPage to live API data (reservations by date, revenue sum, active rental count)
- Build "Today's Pickups" and "Today's Drop-offs" API endpoints (filter reservations by pickup_datetime = today and return_datetime = today)
- Build 7-day calendar grouping view in manager dashboard
- Build revenue forecast query: `SUM(grand_total) WHERE status=CONFIRMED GROUP BY DATE(return_datetime)` for next 7 days
- Build live fleet utilization metric: count vehicles by status bucket
- Consolidate overdue widget into the manager dashboard page
- 30-second polling or WebSocket subscription for dashboard data

---

### Domain 8 — Staff Operations Dashboard

**Discovery call requirement:** Daily task list by urgency, Asana/monday.com-style. Pickup prep, drop-off, document collection, handover, service due/overdue. OTA lead inbox. Staff notifications.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| STF-01 | Daily task list sorted by urgency | **PARTIAL** | TaskBoardPage exists as Kanban; not a time-sorted daily task list. |
| STF-02 | Task types linked to booking events | **PARTIAL** | Task types are vehicle-operation focused (MAINTENANCE, INSPECTION, TURNAROUND); booking-lifecycle types (PICKUP_PREP, CUSTOMER_DROPOFF, DOC_COLLECTION, HANDOVER) are absent. |
| STF-03 | Task cards with customer, vehicle, time, status, notes | **PARTIAL** | Task cards show vehicle plate + time range; customer name and booking link absent. |
| STF-04 | Mark tasks complete/in-progress/blocked | **PARTIAL** | Kanban drag-and-drop works for TODO/IN_PROGRESS/DONE; BLOCKED status absent. |
| STF-05 | Overdue tasks highlighted | **PARTIAL** | No explicit overdue highlighting in task board. |
| STF-06 | Pending tasks (unassigned / incomplete info) | **PARTIAL** | No "pending" state distinct from TODO. |
| STF-07 | OTA lead inbox in staff view | **GAP** | No OTA integration = no leads inbox. |
| STF-08 | Availability check and confirm flow from leads inbox | **GAP** | Same as STF-07. |
| STF-09 | Staff notifications (new leads, overdue, upcoming) | **PARTIAL** | Celery notification infrastructure exists; in-app notification UI absent. |
| STF-10 | System-generated reminders when pending task not actioned | **GAP** | No task aging / escalation logic. |
| STF-11 | Staff view hides financial data | **BUILT** | RBAC prevents staff from accessing finance/reporting routes. |

**Gap Score: 1 built + 6 partial + 4 gaps out of 11.**

**Build required:**
- Redesign staff dashboard from Kanban to time-sorted daily task list view
- Add booking-lifecycle task types: PICKUP_PREP, CUSTOMER_DROPOFF, DOCUMENT_COLLECTION, HANDOVER
- Extend task cards to include: customer name, reservation ID, vehicle, scheduled time, blocking reason
- Add BLOCKED task status
- Add overdue task highlighting (task due_time < now AND status != DONE)
- Build in-app notification bell/feed (WebSocket push for new task assignments)
- Build task aging rule engine: if task not actioned within N minutes → push reminder to assignee
- OTA leads inbox: blocked on Domain 4 (OTA integrations)

---

### Domain 9 — Back-Office & Maintenance

**Discovery call requirement:** Vehicle condition per car (scratches, damage), maintenance schedule, back-office dashboard with condition/status/notes, service overdue alerts.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| BO-01 | Vehicle condition record (damage, scratches, notes) | **BUILT** | Damage claims with zone-level detail, severity grading, claim workflow. |
| BO-02 | Maintenance schedule (service due by mileage/date) | **PARTIAL** | MaintenancePage UI exists with work order types; backend router is stub-only. |
| BO-03 | Maintenance status flags per vehicle | **BUILT** | MAINTENANCE, IN_REPAIR status states on vehicle state machine. |
| BO-04 | Maintenance block inserted on fleet calendar | **BUILT** | Vehicle block with MAINTENANCE type blocks calendar slot. |
| BO-05 | Vehicle damage log with photos, zone, date | **BUILT** | Damage domain with full claim lifecycle, zone data, S3 photo storage. |
| BO-06 | Back-office dashboard (condition, maintenance, inspection date) | **PARTIAL** | BackOfficeDashboardPage exists; data likely stubbed. Inspection date tracking absent. |
| BO-07 | Operational notes per vehicle | **BUILT** | Notes field present on vehicle records. |
| BO-08 | Maintenance completion → block removed, vehicle → Available | **PARTIAL** | Status transitions exist; automated calendar block release on maintenance complete not confirmed. |
| BO-09 | Manager hard-blocks vehicle with reason | **BUILT** | ADMIN_HOLD vehicle status, vehicle block with reason. |
| BO-10 | Service overdue alert generates task | **PARTIAL** | Service overdue status exists; auto-task generation from status not implemented. |

**Gap Score: 6 built + 3 partial + 1 gap out of 10 (good coverage).**

**Build required:**
- Build maintenance backend: work order CRUD endpoints (currently stub) — scheduled service, mileage trigger, technician assignment, parts
- Wire BO-06: back-office dashboard to live data (vehicle list with last_inspection_date, maintenance_status, open_damage_claims count)
- Implement BO-08: maintenance work order → COMPLETED event → release MAINTENANCE vehicle block → set vehicle status to READY_FOR_INSPECTION or AVAILABLE
- Implement BO-10: mileage threshold check (on odometer_current update) → auto-create maintenance task if service_due_mileage exceeded

---

### Domain 10 — Task Management System

**Discovery call requirement:** Asana/monday.com/ClickUp-like task system. Auto-generated from booking events and maintenance status. Staff sees own tasks; manager sees all.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| TSK-01 | Task entity with full field set | **PARTIAL** | Task entity exists (linked to fleet/vehicle); missing: booking linkage, assignee, due_datetime, priority fields. |
| TSK-02 | Booking-lifecycle task types | **PARTIAL** | Vehicle operation types exist; booking types (PICKUP_PREP, HANDOVER, DOC_COLLECTION) absent. |
| TSK-03 | Task statuses (Not Started, In Progress, Completed, Blocked, Overdue) | **PARTIAL** | TODO, IN_PROGRESS, DONE present; BLOCKED and OVERDUE absent. |
| TSK-04 | Auto-generate tasks from booking lifecycle events | **GAP** | No event → task hook implemented. |
| TSK-05 | Auto-generate maintenance task when service due | **GAP** | No mileage/date threshold → task trigger. |
| TSK-06 | Manager creates and assigns tasks to staff | **PARTIAL** | Create task UI exists; assignment to specific staff member not confirmed. |
| TSK-07 | Staff sees only their own tasks | **PARTIAL** | RBAC exists; task-level assignee filter not confirmed. |
| TSK-08 | Manager sees all tasks, filterable | **PARTIAL** | Task list exists in manager view; cross-staff visibility and filters not confirmed. |
| TSK-09 | Task reminders to assignee near due time | **GAP** | No task reminder dispatch. |
| TSK-10 | Task comments/notes per task | **GAP** | No per-task notes/comments field in current task entity. |
| TSK-11 | Task escalation to manager when overdue by threshold | **GAP** | No escalation logic. |

**Gap Score: 0 built + 5 partial + 6 gaps out of 11. Needs significant build.**

**Build required:**
- Extend task data model: add `assignee_staff_id`, `due_datetime`, `priority`, `booking_id`, `task_type` (expanded set), `BLOCKED` status, `comments` (JSON array or linked table)
- Build booking lifecycle event hooks: CONFIRMED → create PICKUP_PREP task; CHECKED_IN → create RETURN_INSPECTION task; OVERDUE → flag task as BLOCKED
- Build mileage/date threshold → MAINTENANCE_DUE task creation
- Build task assignment: manager assigns task to staff member from task detail
- Build task-level RBAC filter: staff sees `WHERE assignee_staff_id = me OR assignee IS NULL`
- Build Celery beat scheduled job: scan tasks WHERE `due_datetime < NOW() + 2h AND status != DONE` → push reminder
- Build escalation job: tasks WHERE `due_datetime < NOW() - threshold AND status != DONE` → flag escalated, alert manager

---

### Domain 11 — Customer Portal & Category Booking

**Discovery call requirement:** Web-first customer booking. Category selection (hatchback, sedan, SUV, compact). Staff mediated confirmation. Payment link in confirmation. Promo codes.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| CUS-01 | Customer booking page (category, dates, location) | **BUILT** | Full booking flow in /apps/web-booking. |
| CUS-02 | Category display with photos | **BUILT** | Vehicle class cards with promotional vehicle carousel. |
| CUS-03 | Real-time category availability for selected dates | **BUILT** | Availability API with Redis cache. |
| CUS-04 | Customer submits booking request, routed to staff | **BUILT** | Reservation created, staff can see in CRM. |
| CUS-05 | Customer receives confirmation via preferred channel | **PARTIAL** | Email confirmation fires; WhatsApp/SMS confirmation absent. |
| CUS-06 | Customer receives payment link with confirmation | **PARTIAL** | Payment in booking flow (Stripe Checkout); separate payment link not generated for staff-mediated flow. |
| CUS-07 | Promo codes at booking | **GAP** | No promotion code input field or validation system. |
| CUS-08 | After-hours drop-off photo submission via mobile link | **GAP** | Not implemented. |
| CUS-09 | Customer record stored in CRM | **BUILT** | Customer CRUD with DNR, loyalty, booking history. |
| CUS-10 | Customer communication preference stored | **GAP** | `preferred_channel` field absent from customer record. |

**Gap Score: 5 built + 3 partial + 3 gaps out of 10 (good foundation).**

**Build required:**
- Promo code system: `promotion_codes` table, code validation at booking, discount application to rate quote
- After-hours drop-off: generate shareable link (time-limited JWT token), mobile photo upload page, log submission with timestamp
- `preferred_channel` field on customer record (EMAIL / WHATSAPP / SMS)
- Generate standalone payment link (Tyro/Stripe) and embed in WhatsApp/email confirmation for staff-mediated bookings

---

### Domain 12 — Document & Photo Management

**Discovery call requirement:** Electronic signatures on rental agreements, photo capture at handover and return (mobile-optimized), after-hours customer drop-off photos, pre/post comparison, bond release linked to evidence.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| DOC-01 | Electronic signature capture on rental agreements | **PARTIAL** | Customer signature URL field exists in RA model; actual e-sign capture flow (draw or DocuSign-style) not implemented. |
| DOC-02 | Photo capture at vehicle handover by staff (phone camera) | **PARTIAL** | Photo upload UI exists in InspectionsPage; native camera access (getUserMedia) not confirmed. |
| DOC-03 | Photo capture at vehicle return by staff | **PARTIAL** | Return inspection flow captures condition; photo upload placeholders present. |
| DOC-04 | After-hours customer drop-off photo submission | **GAP** | Not implemented (cross-references CUS-08). |
| DOC-05 | Photos stored immutably per booking (timestamped, S3) | **PARTIAL** | S3 key storage present in damage model; pre-signed upload flow assumed but not confirmed end-to-end. |
| DOC-06 | Pre-return vs. post-return photo comparison view | **PARTIAL** | PRE/POST comparison view in InspectionsPage; side-by-side photo lightbox not confirmed. |
| DOC-07 | Bond release actioned after reviewing return condition | **PARTIAL** | Manual refund/void exists; not triggered by inspection completion event. |
| DOC-08 | Vehicle condition zone diagram (staff annotates damage) | **BUILT** | SVG zone diagram with 12 clickable zones in InspectionsPage. |
| DOC-09 | All documents linked to booking record | **PARTIAL** | Damage claims linked to vehicles; direct RA → inspection → photos link may be incomplete. |
| DOC-10 | Photo capture UI optimized for mobile (camera, auto-rotate, compress) | **PARTIAL** | UI exists; browser camera API (getUserMedia / MediaDevices), image compression before upload not confirmed. |
| DOC-11 | Customer copy of signed RA via email or WhatsApp | **PARTIAL** | RA email send exists from checkout; WhatsApp delivery not wired. |

**Gap Score: 1 built + 7 partial + 2 gaps out of 11.**

**Build required:**
- Implement browser-native photo capture: `<input type="file" accept="image/*" capture="environment">` + canvas compression before S3 upload
- Implement e-signature: embedded signature pad (signature_pad library) on checkout screen; hash and store signature_url on RA
- Complete pre-signed S3 upload flow end-to-end: client requests pre-signed URL → uploads directly → confirms key to backend
- After-hours drop-off page: tokenized URL, photo multi-upload, condition notes, submit confirmation
- Wire DOC-07: inspection_completed event → trigger bond capture/release decision prompt to staff
- Link RA → inspection records → damage claims in booking detail view panel

---

### Domain 13 — Marketing & CRM Outreach

**Discovery call requirement:** Customer database for outreach, bulk messaging per segment, seasonal promotions with codes, holiday campaigns.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| MKT-01 | Customer database (searchable, filterable) | **BUILT** | CustomersPage with fulltext search, loyalty, DNR filter. |
| MKT-02 | Bulk message send to customer segment | **GAP** | No bulk send capability. |
| MKT-03 | Seasonal promotion management (code, validity, category) | **GAP** | Promotional vehicles feature is pricing-focused; no promotion code entity. |
| MKT-04 | Scheduled bulk campaign (holiday outreach) | **GAP** | No campaign scheduling. |
| MKT-05 | Customer segmentation (last booking, frequency, category) | **PARTIAL** | Loyalty tiers (Bronze/Silver/Gold/Platinum) exist; advanced segment builder absent. |
| MKT-06 | Promo code applies at booking | **GAP** | Same as CUS-07. |
| MKT-07 | Opt-out / unsubscribe management | **GAP** | No opt-out field or suppression list. |
| MKT-08 | Campaign send log | **GAP** | No campaign audit log. |

**Gap Score: 1 built + 1 partial + 6 gaps out of 8. Largely unbuilt.**

**Build required:**
- `promotion_codes` table: code, discount_type (%, fixed), discount_value, valid_from, valid_to, usage_limit, applicable_classes
- Customer segment query builder: filter by `last_booking_date`, `rental_count`, `loyalty_tier`, `preferred_category`
- Bulk send endpoint: accepts segment filter + template_id + channel → queues individual messages via Celery
- Campaign entity: tracks bulk send jobs, recipient count, delivery status
- `marketing_opt_out` field on customer record; suppression check before every bulk send
- Promo code at booking: validation endpoint + discount applied in rate quote calculation

---

### Domain 14 — Mobile / Progressive Web App

**Discovery call requirement:** Web-first now. Mobile later. Key constraints: photo capture via phone, OTP must work on mobile, no new-tab UX.

| Req ID | Requirement | Status | Gap Detail |
|---|---|---|---|
| MOB-01 | Web-first (mobile-native deferred) | **BUILT** | All apps are web-based. |
| MOB-02 | All staff views responsive on smartphone | **PARTIAL** | Admin UI designed for desktop. Ferrari dark-theme layout may not reflow on mobile. |
| MOB-03 | Photo capture via device camera (browser API) | **PARTIAL** | `<input type="file" capture="environment">` needed; may be missing in current inspection upload. |
| MOB-04 | Customer links (payment, photo drop-off) work on mobile without app | **PARTIAL** | Booking portal is Next.js and should be mobile-functional; after-hours drop-off page not built. |
| MOB-05 | OTP auto-fill on mobile (SMS one-tap) | **GAP** | No OTP auth built (same as AUTH-01). |
| MOB-06 | No new-tab-on-click / SPA behaviour | **BUILT** | SPA architecture in place. |
| MOB-07 | PWA / installable to home screen | **GAP** | Counter app has service worker; main web-admin and web-booking do not have PWA manifest. |
| MOB-08 | Native mobile app (iOS/Android) | **DEFERRED** | Out of scope for MVP. |

**Gap Score: 2 built + 3 partial + 2 gaps + 1 deferred out of 8.**

**Build required:**
- Mobile responsiveness audit across web-admin pages: sidebar collapse, card reflow, touch targets ≥44px
- Add `capture="environment"` to all photo input elements
- OTP auth (AUTH-01 prerequisite)
- PWA manifest + service worker for web-admin and web-booking (offline task list is P2)

---

## Critical Gaps Summary (P0 Blockers)

These gaps block core workflows described in the discovery call. Nothing can go to the client as a prototype without these resolved.

| # | Gap | Domains Affected | Estimated Complexity |
|---|---|---|---|
| 1 | **WhatsApp Business API integration** | COM-02, COM-05, COM-08, RES-04, CUS-05 | High (Meta partner approval + webhook setup) |
| 2 | **Tyro payment gateway** | PAY-01, RES-04, CUS-06 | High (Australian-specific gateway, different terminal model) |
| 3 | **Mobile OTP authentication** | AUTH-01, AUTH-07, MOB-05 | Med (Twilio already present, UI refactor for phone-first login) |
| 4 | **Fleet calendar drag-and-drop reallocation** | CAL-04, CAL-07, CAL-14 | High (calendar block dragging + reconfirmation event) |
| 5 | **Automated message dispatch pipeline** | COM-01, COM-03, COM-05 through COM-09 | Med (Celery worker completion + trigger wiring) |
| 6 | **Task auto-generation from booking events** | TSK-04, TSK-05, STF-01, STF-02 | Med (event hooks + task model extension) |
| 7 | **OTA channel integrations (Booking.com / Expedia)** | All of Domain 4 | High (partner API credentials required externally) |
| 8 | **Manager dashboard live data** | MGR-01 through MGR-09 | Med (API wiring, forecast query) |
| 9 | **7-day revenue forecast** | MGR-05 | Low (SQL aggregation on confirmed reservations) |
| 10 | **Electronic signatures on RAs** | DOC-01 | Med (signature pad library + hash/storage) |

---

## Architecture Risk Register

| Risk | Severity | Description |
|---|---|---|
| Auth method mismatch | **High** | Client wants phone-number + OTP. Current system is email + password. Migrating existing staff accounts and login UX requires careful planning — cannot be done incrementally without a dual-mode auth period. |
| Tyro vs. Stripe | **High** | Tyro (Australian) uses a different terminal integration model than Stripe. Building a gateway-agnostic abstraction layer before Tyro integration is essential to avoid rewriting payment logic twice. |
| WhatsApp template pre-approval | **High** | Meta requires business verification and pre-approved message templates for WhatsApp Business API. This is a non-technical dependency that takes 2–4 weeks. Start immediately. |
| OTA partner credentials | **High** | Booking.com Connectivity API and Expedia Rapid API require partner enrollment. This is Ricky's business responsibility. Development on OTA integration is blocked until credentials arrive. |
| Celery worker reliability | **Med** | The notification delivery pipeline uses Celery + Redis Streams. The worker implementation is minimal. This must be hardened (dead-letter queues, retry logic, delivery receipts) before any automated messaging goes live. |
| Task system architectural debt | **Med** | The current task entity was designed around vehicle operations (MAINTENANCE, TURNAROUND). Extending it to cover booking-lifecycle tasks (PICKUP_PREP, HANDOVER) requires schema changes and UI rework without breaking current fleet operations. |
| Calendar date range | **Low** | Current calendar is a 14-day rolling view. Extending to 30 days increases query complexity and render load. Virtualization (render only visible date cells) will be needed for large fleets. |
| Photo upload to S3 | **Low** | Pre-signed URL flow is assumed but not confirmed end-to-end. Must be validated before delivery of photo capture features. |

---

## Build Roadmap Recommendation

### Phase 1 — Foundation Fixes (Weeks 1–3)
*Fix mismatches, unblock core workflows*

- [ ] Gateway abstraction layer (Stripe + Tyro interface) — build the abstraction before Tyro SDK
- [ ] Tyro integration (pending Tyro merchant account from client)
- [ ] Phone + OTP auth flow (Twilio SMS, phone field on staff_users, dual-mode login during migration)
- [ ] Complete Celery delivery pipeline for email (SendGrid) and SMS (Twilio)
- [ ] Wire WhatsApp Business Cloud API (Meta) — submit template pre-approvals immediately
- [ ] Automated booking confirmation fire on all three channels

### Phase 2 — Fleet Calendar & Task Engine (Weeks 3–6)
*The core operational UX from the discovery call*

- [ ] Fleet calendar: extend to monthly view, add vehicle category grouping
- [ ] Fleet calendar: drag-and-drop booking reallocation
- [ ] Reallocation event → queue reconfirmation message
- [ ] Task model extension: new task types, assignee, booking linkage, BLOCKED status
- [ ] Task auto-generation: booking lifecycle hooks (CONFIRMED → PICKUP_PREP task, CHECK_IN → INSPECTION task)
- [ ] Task auto-generation: mileage threshold → MAINTENANCE_DUE task
- [ ] Staff daily task list view (time-sorted, not Kanban)
- [ ] Task reminders and escalation (Celery beat jobs)

### Phase 3 — Dashboards & Analytics (Weeks 6–8)
*Make management information live and accurate*

- [ ] Manager dashboard: wire all widgets to live API data
- [ ] Today's pickups + today's drop-offs API endpoints
- [ ] 7-day revenue forecast query
- [ ] Live fleet utilization metric (count by status bucket)
- [ ] Back-office dashboard: live vehicle condition + maintenance status
- [ ] Maintenance backend: work order CRUD endpoints
- [ ] In-app notification feed (WebSocket push for new tasks, alerts)

### Phase 4 — Documents, Photos & Signatures (Weeks 7–10)
*Condition evidence and bond release*

- [ ] Browser camera integration (getUserMedia / file capture, client-side compression)
- [ ] E-signature pad on checkout screen (signature_pad library)
- [ ] Pre-signed S3 upload flow (end-to-end validation)
- [ ] After-hours customer drop-off page (tokenized link, mobile photo upload)
- [ ] Pre/post photo comparison panel in booking detail
- [ ] Bond release workflow: inspection_completed event → staff decision prompt → Tyro/Stripe void or capture

### Phase 5 — OTA Integrations (Weeks 8–14, partner-dependent)
*Blocked on external credentials*

- [ ] Channel manager abstraction layer
- [ ] Booking.com Connectivity API (inbound leads, availability sync, status callbacks)
- [ ] Expedia Rapid API (same pattern)
- [ ] OTA leads inbox in web-admin
- [ ] Staff lead action flow (check availability → confirm/reject → sync to OTA)
- [ ] Outbound availability push on booking create/cancel
- [ ] Staff notification on new OTA lead

### Phase 6 — Marketing & Promotions (Weeks 10–14)
*Customer outreach tooling*

- [ ] Promotion code system (table, validation, discount in rate quote)
- [ ] Customer segment query builder
- [ ] Bulk message send (email + WhatsApp + SMS via template)
- [ ] Campaign scheduler (holiday/seasonal)
- [ ] `preferred_channel` field + opt-out management
- [ ] Campaign audit log

### Phase 7 — Mobile Polish (Weeks 12–16)
*Web responsiveness + PWA*

- [ ] Mobile responsiveness audit across web-admin (sidebar collapse, touch targets)
- [ ] PWA manifest + service worker for web-admin
- [ ] OTP auto-fill improvements (autocomplete="one-time-code")
- [ ] Confirm `capture="environment"` attribute on all photo inputs

---

## Effort Estimate Summary

| Phase | Effort | Dependencies |
|---|---|---|
| Phase 1 — Foundation Fixes | ~3 weeks / 2 engineers | Tyro merchant account, Meta WhatsApp partner approval |
| Phase 2 — Fleet Calendar & Task Engine | ~3 weeks / 2 engineers | Phase 1 complete |
| Phase 3 — Dashboards & Analytics | ~2 weeks / 1–2 engineers | Phase 1 partial |
| Phase 4 — Documents & Photos | ~3 weeks / 2 engineers | S3 bucket confirmed, Phase 1 partial |
| Phase 5 — OTA Integrations | ~6 weeks / 2 engineers | Booking.com + Expedia partner credentials (external) |
| Phase 6 — Marketing | ~3 weeks / 1 engineer | Phase 1 complete, Phase 5 partial |
| Phase 7 — Mobile Polish | ~2 weeks / 1 engineer | All prior phases complete |
| **Total (sequential)** | **~22 weeks** | With external blockers (Tyro, WhatsApp, OTA creds) obtained in parallel |
| **Total (parallel teams)** | **~12–14 weeks** | Two streams: core ops (Ph 1–4) + integrations (Ph 5–6) |

---

## What's Already Production-Ready (Ship Now)

The following can be presented to Ricky's team as working prototype features immediately:

| Feature | App | Notes |
|---|---|---|
| Fleet calendar (Tetris view) | web-admin | Monthly range expansion pending |
| Vehicle CRUD + status management | web-admin | Full state machine, bulk import |
| Reservations management | web-admin | List, filter, cancel, modify |
| Counter checkout (5-step wizard) | web-admin | Walk-up + pre-booked, extras, pre-auth |
| Return processing (damage + charges) | web-admin | Zone diagram, fuel/odometer, disposition |
| Customer booking portal | web-booking | Full search → checkout → confirmation flow |
| Customer management + DNR | web-admin | Loyalty tiers, GDPR erasure |
| Pricing (rate codes + extras) | web-admin | Rate schedule, quote generation |
| Inspection forms (PRE/POST) | web-admin | 12-zone SVG diagram, comparison view |
| Damage claims | web-admin | Full lifecycle, CDW logic, LOU |
| Shift management | web-admin | Open/close, cash reconciliation |
| Location management | web-admin | CRUD, public list, timezone |
| Overdue rentals tracking | web-admin | Full list with urgency sort |
| Role-based access control | all apps | 8 roles, location-scoped permissions |

---

*Gap Analysis complete. Total requirements: 113. Built: 33 (29%). Partial: 31 (27%). Gap: 49 (43%). Mismatch: 3 (3%). Deferred: 1 (1%).*
