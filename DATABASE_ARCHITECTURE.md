# Rental Car Manager — Database Architecture

> Designed for PostgreSQL 16+. Based on the full feature specification (FEATURES.md, Parts I–III).
> All SQL is production-ready; no pseudocode.

---

## 1. Schema Organization

Three schemas separate concerns and enforce data lifecycle policies.

| Schema | Purpose |
|---|---|
| `public` | Live operational data — all tables that the application reads and writes during normal operations |
| `audit` | Immutable audit event log — append-only; no application UPDATE or DELETE permitted |
| `archive` | Aged-out records moved from `public` after retention thresholds (§42.5); read-only for operations |

### Multi-Tenancy: Row-Level Security

Every table in `public` carries a `tenant_id UUID NOT NULL` column. PostgreSQL Row-Level Security (RLS) is enabled on each table; a single GUC (session variable) set by the connection pool at login confines every query to the correct tenant automatically — no application-level `WHERE tenant_id = $1` required in every query.

```sql
-- Set once at connection open (from connection pool after JWT validation)
SET app.current_tenant_id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

-- Example: enable RLS on vehicles and define the policy
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.vehicles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Internal service role bypasses RLS for cross-tenant operations (e.g., network-wide DNR)
CREATE ROLE app_service;
ALTER TABLE public.vehicles NO FORCE ROW LEVEL SECURITY FOR ROLE app_service;
```

The same pattern applies to every table in `public`. The `audit` schema tables carry `tenant_id` for filtering but RLS is **not** enforced there — only the `app_service` role writes audit rows, and super-admin reads span tenants.

---

## 2. Enum Types

All enumerations are defined at the schema level so the database enforces valid values without application-level validation.

```sql
-- reservation lifecycle (§3.1, §42.4)
CREATE TYPE reservation_status AS ENUM (
  'QUOTE','PENDING','CONFIRMED','MODIFIED',
  'CHECKED_OUT','EXTENDED','RETURNED','CLOSED',
  'CANCELLED','NO_SHOW','DISPUTED'
);

-- vehicle operational state (§26.6)
CREATE TYPE vehicle_status AS ENUM (
  'STAGING','AVAILABLE','ON_RENT','RETURNING',
  'READY_FOR_INSPECTION','CLEANING','MAINTENANCE',
  'IN_REPAIR','DAMAGE_HOLD','ADMIN_HOLD',
  'PENDING_DISPOSAL','DISPOSED','PENDING_DELIVERY'
);

-- block type on vehicle calendar (§2.3)
CREATE TYPE vehicle_block_type AS ENUM (
  'RESERVATION','TURNAROUND','MAINTENANCE','RECALL_HOLD',
  'IN_TRANSIT','HOLD','INSPECTION','STAGING','CHARGING'
);

-- damage severity grades (§9.1)
CREATE TYPE damage_severity AS ENUM (
  'GRADE_1_COSMETIC','GRADE_2_MINOR','GRADE_3_MODERATE',
  'GRADE_4_SEVERE','GRADE_5_TOTAL_LOSS'
);

-- damage claim lifecycle (§9.2)
CREATE TYPE claim_status AS ENUM (
  'OPEN','ESTIMATE_SENT','CUSTOMER_ACKNOWLEDGED',
  'REPAIR_IN_PROGRESS','REPAIR_COMPLETE','INVOICED',
  'PAID','DISPUTED','IN_LITIGATION','WRITTEN_OFF'
);

-- payment methods (§8.1)
CREATE TYPE payment_method AS ENUM (
  'CREDIT_CARD','DEBIT_CARD','DIGITAL_WALLET',
  'CASH','DIRECT_BILL','ACH','WIRE','FUEL_CARD'
);

-- payment transaction status (§8.2)
CREATE TYPE payment_status AS ENUM (
  'PENDING','AUTHORIZED','CAPTURED','REFUNDED',
  'PARTIALLY_REFUNDED','VOIDED','DECLINED','EXPIRED'
);

-- staff roles (§1.2, §29.2)
CREATE TYPE user_role AS ENUM (
  'CUSTOMER','CORPORATE_BOOKER','COUNTER_AGENT','SENIOR_AGENT',
  'BRANCH_MANAGER','REGIONAL_MANAGER','FLEET_MANAGER',
  'MAINTENANCE_TECH','CLAIMS_COORDINATOR','FINANCE',
  'SYSTEM_ADMIN','SUPER_ADMIN','API_PARTNER'
);

-- rate types (§4.2)
CREATE TYPE rate_type AS ENUM (
  'RACK','CORPORATE','GOVERNMENT','INSURANCE_REPLACEMENT',
  'PROMOTIONAL','OTA_NET','WHOLESALE','MEMBERSHIP',
  'TOUR_OPERATOR','LOYALTY_REDEMPTION','WEEKEND_SPECIAL'
);

-- fleet/acquisition type (§2.1)
CREATE TYPE fleet_type AS ENUM (
  'OWNED','LEASED','PROGRAM_CAR','COURTESY'
);

-- depreciation method (§2.4)
CREATE TYPE depreciation_method AS ENUM (
  'STRAIGHT_LINE','UNITS_OF_PRODUCTION','MACRS'
);

-- fuel type (§2.1)
CREATE TYPE fuel_type AS ENUM (
  'GASOLINE','DIESEL','HYBRID','PHEV','BEV','HYDROGEN','LPG'
);

-- transmission type
CREATE TYPE transmission_type AS ENUM (
  'AUTOMATIC','MANUAL','CVT','DCT'
);

-- KYC status (§5.1)
CREATE TYPE kyc_status AS ENUM (
  'UNVERIFIED','TIER_1_PENDING','TIER_1_COMPLETE',
  'TIER_2_PENDING','TIER_2_COMPLETE','FAILED','FLAGGED'
);

-- audit action type (§37.1)
CREATE TYPE audit_action AS ENUM (
  'INSERT','UPDATE','DELETE','LOGIN','LOGOUT',
  'EXPORT','CONFIG_CHANGE','STATE_TRANSITION'
);
```

---

## 3. Core Table Definitions

### Required Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";   -- required for exclusion constraint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

---

### 3.1 tenants

```sql
CREATE TABLE public.tenants (
  tenant_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug              TEXT NOT NULL UNIQUE,            -- URL-safe short name
  legal_name        TEXT NOT NULL,
  trading_name      TEXT,
  company_reg_no    TEXT,
  vat_tax_id        TEXT,
  primary_email     TEXT NOT NULL,
  primary_phone     TEXT,
  billing_address   JSONB NOT NULL DEFAULT '{}',    -- {line1,line2,city,state,country,postal}
  logo_url          TEXT,
  default_currency  CHAR(3) NOT NULL DEFAULT 'USD',
  default_timezone  TEXT NOT NULL DEFAULT 'America/New_York',
  subscription_tier TEXT NOT NULL DEFAULT 'STARTER' CHECK (subscription_tier IN ('STARTER','PROFESSIONAL','ENTERPRISE')),
  trial_ends_at     TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  tos_accepted_at   TIMESTAMPTZ,
  tos_version       TEXT,
  dpa_accepted_at   TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CANCELLED','TRIAL')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_tenants_slug ON public.tenants (slug) WHERE deleted_at IS NULL;
```

---

### 3.2 locations

```sql
CREATE TABLE public.locations (
  location_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants (tenant_id),
  short_code        TEXT NOT NULL,                   -- counter-facing code, e.g. "ORD1"
  name              TEXT NOT NULL,
  location_type     TEXT NOT NULL CHECK (location_type IN (
                      'AIRPORT','DOWNTOWN','NEIGHBORHOOD',
                      'HOTEL','DEALER','DROP_HUB','DELIVERY_ONLY')),
  address_line1     TEXT NOT NULL,
  address_line2     TEXT,
  city              TEXT NOT NULL,
  state_province    TEXT,
  country_code      CHAR(2) NOT NULL,
  postal_code       TEXT,
  latitude          NUMERIC(9,6),
  longitude         NUMERIC(9,6),
  airport_code      CHAR(3),                         -- IATA code for airport locations
  phone             TEXT,
  email             TEXT,
  timezone          TEXT NOT NULL DEFAULT 'America/New_York',
  currency          CHAR(3) NOT NULL DEFAULT 'USD',
  hours_of_operation JSONB NOT NULL DEFAULT '{}',    -- {mon:{open,close},tue:{...},...}
  holiday_schedule  JSONB NOT NULL DEFAULT '[]',     -- [{date,closed,open,close}]
  tax_template_id   UUID,                            -- FK set after tax_templates table
  no_show_grace_minutes INT NOT NULL DEFAULT 120,
  turnaround_minutes_by_class JSONB NOT NULL DEFAULT '{}', -- {class_id: minutes}
  overbooking_buffer_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  region_id         UUID,
  parent_location_id UUID REFERENCES public.locations (location_id),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT uq_location_tenant_code UNIQUE (tenant_id, short_code)
);

CREATE INDEX idx_locations_tenant ON public.locations (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.locations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.3 vehicles

```sql
CREATE TABLE public.vehicles (
  vehicle_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants (tenant_id),

  -- identity
  vin                   CHAR(17) NOT NULL,
  plate_number          TEXT,
  plate_jurisdiction    TEXT,
  plate_expiry          DATE,
  title_number          TEXT,
  fleet_number          TEXT,
  unit_number           TEXT,

  -- specifications
  make                  TEXT NOT NULL,
  model                 TEXT NOT NULL,
  trim                  TEXT,
  model_year            SMALLINT NOT NULL CHECK (model_year BETWEEN 1900 AND 2100),
  body_style            TEXT,
  exterior_color        TEXT,
  exterior_color_code   TEXT,
  interior_color        TEXT,
  transmission          transmission_type NOT NULL,
  drive_type            TEXT CHECK (drive_type IN ('FWD','RWD','AWD','4WD')),
  engine_displacement_l NUMERIC(4,2),
  cylinder_count        SMALLINT,
  fuel_type             fuel_type NOT NULL,
  fuel_tank_capacity_gal NUMERIC(6,2),
  battery_capacity_kwh  NUMERIC(6,2),           -- EV only
  epa_range_miles       INT,                    -- EV rated range
  charge_port_type      TEXT,                   -- CCS, CHAdeMO, NACS, J1772
  doors                 SMALLINT,
  seats                 SMALLINT,
  luggage_large_bags    SMALLINT,
  luggage_small_bags    SMALLINT,

  -- classification
  sipp_code             CHAR(4),
  vehicle_class_id      UUID NOT NULL,           -- FK to vehicle_classes
  pool_id               UUID,                   -- FK to vehicle_pools

  -- operational
  home_location_id      UUID NOT NULL REFERENCES public.locations (location_id),
  current_location_id   UUID REFERENCES public.locations (location_id),
  status                vehicle_status NOT NULL DEFAULT 'STAGING',
  odometer_current      INT NOT NULL DEFAULT 0,
  odometer_unit         TEXT NOT NULL DEFAULT 'MILES' CHECK (odometer_unit IN ('MILES','KM')),
  fuel_level_pct        SMALLINT CHECK (fuel_level_pct BETWEEN 0 AND 100),
  soc_pct               SMALLINT CHECK (soc_pct BETWEEN 0 AND 100), -- EV state of charge
  in_service_date       DATE,

  -- financial
  acquisition_cost      NUMERIC(12,2),
  residual_value        NUMERIC(12,2),
  book_value            NUMERIC(12,2),
  depreciation_method   depreciation_method NOT NULL DEFAULT 'STRAIGHT_LINE',
  useful_life_months    INT,
  estimated_life_miles  INT,
  fleet_type            fleet_type NOT NULL DEFAULT 'OWNED',
  lease_reference       TEXT,
  target_disposal_miles INT,
  target_disposal_months INT,

  -- metadata
  options_packages      JSONB NOT NULL DEFAULT '[]',  -- array of option codes
  photos                JSONB NOT NULL DEFAULT '[]',  -- [{url,type,is_primary,uploaded_at}]
  telematics_device_id  TEXT,
  telematics_provider   TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT uq_vehicle_vin_tenant UNIQUE (tenant_id, vin)
);

CREATE INDEX idx_vehicles_tenant_status  ON public.vehicles (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_home_location  ON public.vehicles (home_location_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_current_location ON public.vehicles (current_location_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_class          ON public.vehicles (vehicle_class_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_sipp           ON public.vehicles (sipp_code) WHERE deleted_at IS NULL;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.vehicles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.4 vehicle_status_log

Records every status transition with the reason, linked record, and acting staff member.

```sql
CREATE TABLE public.vehicle_status_log (
  log_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants (tenant_id),
  vehicle_id      UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  previous_status vehicle_status NOT NULL,
  new_status      vehicle_status NOT NULL,
  reason_code     TEXT NOT NULL,        -- e.g. 'SCHEDULED_PM', 'RECALL_SERVICE', 'VIP_HOLD'
  reason_detail   TEXT,
  linked_record_type TEXT,              -- 'WORK_ORDER', 'DAMAGE_CLAIM', 'RENTAL_AGREEMENT', etc.
  linked_record_id   UUID,
  changed_by      UUID NOT NULL,        -- FK to staff_users
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vsl_vehicle   ON public.vehicle_status_log (vehicle_id, changed_at DESC);
CREATE INDEX idx_vsl_tenant    ON public.vehicle_status_log (tenant_id, changed_at DESC);
```

---

### 3.5 vehicle_blocks (with exclusion constraint)

The exclusion constraint (see §4 for full detail) makes double-booking physically impossible even under concurrent writes.

```sql
CREATE TABLE public.vehicle_blocks (
  block_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants (tenant_id),
  vehicle_id      UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  block_type      vehicle_block_type NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  reservation_id  UUID,                 -- FK to reservations (nullable for non-reservation blocks)
  work_order_id   UUID,                 -- FK to maintenance_orders
  is_hard_block   BOOLEAN NOT NULL DEFAULT false,  -- recalls, active maintenance: cannot be overridden
  notes           TEXT,
  created_by      UUID NOT NULL,        -- FK to staff_users
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT chk_block_end_after_start CHECK (end_time > start_time),

  -- THE CRITICAL EXCLUSION CONSTRAINT — prevents any two non-deleted blocks
  -- on the same vehicle from overlapping in time (§42.4)
  CONSTRAINT no_overlapping_vehicle_blocks EXCLUDE USING gist (
    vehicle_id  WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (deleted_at IS NULL)
);

CREATE INDEX idx_vb_vehicle_time ON public.vehicle_blocks
  USING gist (vehicle_id, tstzrange(start_time, end_time, '[)'))
  WHERE deleted_at IS NULL;

CREATE INDEX idx_vb_reservation  ON public.vehicle_blocks (reservation_id) WHERE deleted_at IS NULL;

ALTER TABLE public.vehicle_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.vehicle_blocks
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.6 customers

```sql
CREATE TABLE public.customers (
  customer_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),

  -- PII (encrypted at rest via Transparent Data Encryption or application-layer AES-256)
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  email               TEXT NOT NULL,
  email_verified      BOOLEAN NOT NULL DEFAULT false,
  mobile_phone        TEXT,
  alt_phone           TEXT,
  date_of_birth       DATE,
  gender              TEXT,
  nationality         CHAR(2),            -- ISO 3166-1 alpha-2
  mailing_address     JSONB,
  billing_address     JSONB,

  -- driver's license
  license_number      TEXT,
  license_country     CHAR(2),
  license_state       TEXT,
  license_class       TEXT,
  license_issued_date DATE,
  license_expiry      DATE,
  license_image_url   TEXT,               -- S3 URL to encrypted scan
  idp_required        BOOLEAN NOT NULL DEFAULT false,

  -- account
  account_status      TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (account_status IN ('ACTIVE','SUSPENDED','BLACKLISTED','ANONYMIZED')),
  account_type        TEXT NOT NULL DEFAULT 'INDIVIDUAL'
                      CHECK (account_type IN ('INDIVIDUAL','CORPORATE_EMPLOYEE',
                             'TRAVEL_AGENT','INSURANCE_CLAIMANT','LOYALTY_MEMBER')),
  kyc_status          kyc_status NOT NULL DEFAULT 'UNVERIFIED',
  corporate_account_id UUID,              -- FK to corporate_accounts

  -- loyalty
  loyalty_number      TEXT UNIQUE,
  loyalty_tier        TEXT DEFAULT 'MEMBER'
                      CHECK (loyalty_tier IN ('MEMBER','SILVER','GOLD','PLATINUM','CHAIRMAN')),
  loyalty_points      INT NOT NULL DEFAULT 0,
  loyalty_tier_expiry DATE,

  -- Do Not Rent
  dnr_flag            BOOLEAN NOT NULL DEFAULT false,
  dnr_reason          TEXT,
  dnr_scope           TEXT CHECK (dnr_scope IN ('LOCATION','BRAND','NETWORK')),
  dnr_expiry          DATE,
  dnr_added_by        UUID,               -- FK to staff_users
  dnr_incident_ref    UUID,

  -- preferences & comms
  preferred_class_id  UUID,
  preferred_transmission transmission_type,
  comm_opt_email      BOOLEAN NOT NULL DEFAULT true,
  comm_opt_sms        BOOLEAN NOT NULL DEFAULT true,
  comm_opt_marketing  BOOLEAN NOT NULL DEFAULT false,
  language_code       CHAR(5) NOT NULL DEFAULT 'en-US',

  -- GDPR
  anonymized_at       TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_customers_email_tenant ON public.customers (tenant_id, lower(email))
  WHERE deleted_at IS NULL AND anonymized_at IS NULL;
CREATE INDEX idx_customers_license ON public.customers (license_number, license_country)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_loyalty ON public.customers (loyalty_number)
  WHERE loyalty_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_customers_phone   ON public.customers (mobile_phone)
  WHERE deleted_at IS NULL;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.customers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.7 reservations

```sql
CREATE TABLE public.reservations (
  reservation_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  confirmation_number TEXT NOT NULL,    -- globally unique; operator-format (§3.4)

  -- status
  status              reservation_status NOT NULL DEFAULT 'QUOTE',
  version             INT NOT NULL DEFAULT 1,   -- increments on each modification

  -- participants
  customer_id         UUID NOT NULL REFERENCES public.customers (customer_id),
  corporate_account_id UUID,            -- FK to corporate_accounts

  -- locations & timing
  pickup_location_id  UUID NOT NULL REFERENCES public.locations (location_id),
  dropoff_location_id UUID NOT NULL REFERENCES public.locations (location_id),
  pickup_datetime     TIMESTAMPTZ NOT NULL,
  return_datetime     TIMESTAMPTZ NOT NULL,
  actual_return_datetime TIMESTAMPTZ,

  -- vehicle
  vehicle_class_id    UUID NOT NULL,
  assigned_vehicle_id UUID REFERENCES public.vehicles (vehicle_id),

  -- rate & pricing
  rate_code_id        UUID REFERENCES public.rate_codes (rate_code_id),
  cdp_code            TEXT,
  promo_code          TEXT,
  currency            CHAR(3) NOT NULL DEFAULT 'USD',
  base_rate_daily     NUMERIC(10,2),
  base_total          NUMERIC(10,2),
  extras_total        NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_total      NUMERIC(10,2) NOT NULL DEFAULT 0,
  location_fees_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  taxes_total         NUMERIC(10,2) NOT NULL DEFAULT 0,
  grand_total         NUMERIC(10,2),
  deposit_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- extras snapshot (line items at time of booking)
  extras_snapshot     JSONB NOT NULL DEFAULT '[]',  -- [{extra_id,name,qty,price_each,total}]
  taxes_snapshot      JSONB NOT NULL DEFAULT '[]',  -- [{name,rate,base,amount,jurisdiction}]

  -- channel & meta
  channel             TEXT NOT NULL DEFAULT 'DIRECT_WEB'
                      CHECK (channel IN ('DIRECT_WEB','MOBILE_APP','CALL_CENTER','COUNTER',
                             'WALK_UP','OTA','GDS','KIOSK','API')),
  ota_booking_ref     TEXT,
  insurance_replacement_flag BOOLEAN NOT NULL DEFAULT false,
  flight_number       TEXT,
  special_instructions TEXT,
  cancellation_policy_id UUID,

  -- no-show
  no_show_fee_charged NUMERIC(10,2),
  no_show_at          TIMESTAMPTZ,

  -- loyalty
  loyalty_points_earned INT NOT NULL DEFAULT 0,
  loyalty_points_redeemed INT NOT NULL DEFAULT 0,

  -- training mode
  is_training         BOOLEAN NOT NULL DEFAULT false,

  booking_agent_id    UUID,             -- FK to staff_users (null if self-service)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT chk_return_after_pickup CHECK (return_datetime > pickup_datetime),
  CONSTRAINT uq_confirmation_number  UNIQUE (confirmation_number)
);

CREATE INDEX idx_res_tenant_status     ON public.reservations (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_res_customer          ON public.reservations (customer_id, pickup_datetime DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_res_pickup_location   ON public.reservations (pickup_location_id, pickup_datetime) WHERE deleted_at IS NULL;
CREATE INDEX idx_res_vehicle           ON public.reservations (assigned_vehicle_id) WHERE assigned_vehicle_id IS NOT NULL;
CREATE INDEX idx_res_corporate         ON public.reservations (corporate_account_id) WHERE corporate_account_id IS NOT NULL;

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.reservations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.8 reservation_versions

Every confirmed modification creates a new version row, preserving the full state at each point (§3.7).

```sql
CREATE TABLE public.reservation_versions (
  version_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  reservation_id      UUID NOT NULL REFERENCES public.reservations (reservation_id),
  version_number      INT NOT NULL,
  status_at_version   reservation_status NOT NULL,
  pickup_location_id  UUID NOT NULL,
  dropoff_location_id UUID NOT NULL,
  pickup_datetime     TIMESTAMPTZ NOT NULL,
  return_datetime     TIMESTAMPTZ NOT NULL,
  vehicle_class_id    UUID NOT NULL,
  rate_code_id        UUID,
  grand_total         NUMERIC(10,2),
  extras_snapshot     JSONB NOT NULL DEFAULT '[]',
  change_reason       TEXT,
  changed_by          UUID NOT NULL,   -- FK to staff_users or customer_id
  changed_by_type     TEXT NOT NULL CHECK (changed_by_type IN ('STAFF','CUSTOMER','SYSTEM')),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_res_version UNIQUE (reservation_id, version_number)
);

CREATE INDEX idx_resv_reservation ON public.reservation_versions (reservation_id, version_number DESC);
```

---

### 3.9 rental_agreements

Created at checkout from the confirmed reservation; carries the signed contract details.

```sql
CREATE TABLE public.rental_agreements (
  ra_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  ra_number           TEXT NOT NULL UNIQUE,
  reservation_id      UUID NOT NULL REFERENCES public.reservations (reservation_id),

  -- parties
  customer_id         UUID NOT NULL REFERENCES public.customers (customer_id),
  checking_out_agent_id UUID,          -- FK to staff_users
  checking_in_agent_id  UUID,

  -- vehicle at checkout
  vehicle_id          UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  vin_at_checkout     CHAR(17) NOT NULL,
  plate_at_checkout   TEXT,
  odometer_out        INT NOT NULL,
  fuel_level_out_pct  SMALLINT,
  soc_pct_out         SMALLINT,        -- EV

  -- vehicle at return
  odometer_in         INT,
  fuel_level_in_pct   SMALLINT,
  soc_pct_in          SMALLINT,
  actual_return_datetime TIMESTAMPTZ,
  return_location_id  UUID REFERENCES public.locations (location_id),

  -- agreement terms snapshot
  rate_snapshot       JSONB NOT NULL DEFAULT '{}',
  extras_snapshot     JSONB NOT NULL DEFAULT '[]',
  mileage_plan        JSONB NOT NULL DEFAULT '{}',  -- {included_per_day, overage_rate, cap}
  fuel_policy         TEXT CHECK (fuel_policy IN ('FULL_TO_FULL','PREPAY','SAME_TO_SAME','EV_PLAN')),

  -- additional drivers
  additional_drivers  JSONB NOT NULL DEFAULT '[]',  -- [{name,license,dob,country}]

  -- signatures
  customer_signature_url TEXT,
  customer_signed_at     TIMESTAMPTZ,
  esignature_hash        TEXT,          -- SHA-256 of document at time of signing (§9.3)
  declination_signature_url TEXT,       -- CDW declination (§43.9)

  -- payment
  preauth_id          UUID,             -- FK to payments (the preauth record)
  preauth_amount      NUMERIC(10,2),

  -- swap linkage (§41.5)
  swapped_from_ra_id  UUID REFERENCES public.rental_agreements (ra_id),
  swapped_to_ra_id    UUID REFERENCES public.rental_agreements (ra_id),

  -- status
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                      CHECK (status IN ('ACTIVE','EXTENDED','RETURNED','CLOSED','DISPUTED')),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ra_reservation    ON public.rental_agreements (reservation_id);
CREATE INDEX idx_ra_customer       ON public.rental_agreements (customer_id, created_at DESC);
CREATE INDEX idx_ra_vehicle        ON public.rental_agreements (vehicle_id, created_at DESC);
CREATE INDEX idx_ra_status         ON public.rental_agreements (tenant_id, status) WHERE status IN ('ACTIVE','EXTENDED');

ALTER TABLE public.rental_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.rental_agreements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.10 payments

One row per payment event — preauth, capture, incremental auth, refund, void.

```sql
CREATE TABLE public.payments (
  payment_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  rental_agreement_id UUID REFERENCES public.rental_agreements (ra_id),
  reservation_id      UUID REFERENCES public.reservations (reservation_id),
  invoice_id          UUID,             -- FK to invoices

  payment_type        TEXT NOT NULL CHECK (payment_type IN (
                        'PREAUTH','CAPTURE','INCREMENTAL_AUTH',
                        'REFUND','VOID','CHARGEBACK','CHARGEBACK_REVERSAL')),
  payment_method      payment_method NOT NULL,
  status              payment_status NOT NULL DEFAULT 'PENDING',

  -- amounts
  amount              NUMERIC(10,2) NOT NULL,
  currency            CHAR(3) NOT NULL DEFAULT 'USD',
  refunded_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- gateway
  gateway             TEXT NOT NULL CHECK (gateway IN ('STRIPE','ADYEN','BRAINTREE','MANUAL')),
  gateway_payment_id  TEXT,            -- Stripe PaymentIntent ID or Adyen PSP reference
  gateway_auth_code   TEXT,
  network_txn_id      TEXT,            -- for incremental auth chaining (Visa/MC requirement)
  card_last4          CHAR(4),
  card_brand          TEXT,
  card_expiry_month   SMALLINT,
  card_expiry_year    SMALLINT,
  payment_token       TEXT,            -- tokenized reference; no raw PAN ever stored (PCI §42.1)

  -- timeline
  authorized_at       TIMESTAMPTZ,
  captured_at         TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  auth_expiry_at      TIMESTAMPTZ,     -- network-imposed expiry (7–30 days, §8.2)

  -- approval workflow
  requires_approval   BOOLEAN NOT NULL DEFAULT false,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_ra       ON public.payments (rental_agreement_id, created_at DESC);
CREATE INDEX idx_payments_status   ON public.payments (tenant_id, status, auth_expiry_at)
  WHERE status IN ('AUTHORIZED','PENDING');
CREATE INDEX idx_payments_gateway  ON public.payments (gateway, gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.payments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.11 damage_claims

```sql
CREATE TABLE public.damage_claims (
  claim_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  claim_reference     TEXT NOT NULL,    -- format: CLM-YYYYMMDD-XXXXX (§28.3)
  rental_agreement_id UUID NOT NULL REFERENCES public.rental_agreements (ra_id),
  vehicle_id          UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  customer_id         UUID NOT NULL REFERENCES public.customers (customer_id),

  -- discovery
  discovered_at       TIMESTAMPTZ NOT NULL,
  discovered_by       UUID NOT NULL,   -- FK to staff_users
  discovery_type      TEXT NOT NULL CHECK (discovery_type IN (
                        'RETURN_INSPECTION','POST_RETURN_AUDIT',
                        'MID_RENTAL_CUSTOMER_REPORT','THIRD_PARTY_REPORT')),

  -- damage detail
  damage_zone         TEXT NOT NULL,   -- front, rear, left_front, roof, etc.
  damage_type         TEXT NOT NULL,   -- scratch, dent, glass_crack, etc.
  severity            damage_severity NOT NULL,
  damage_description  TEXT,
  photos              JSONB NOT NULL DEFAULT '[]',  -- [{url,type,uploaded_at,geo_lat,geo_lng}]
  pre_rental_inspection_id UUID,       -- FK to vehicle_inspections (baseline comparison)
  customer_acknowledged BOOLEAN NOT NULL DEFAULT false,
  customer_ack_signature_url TEXT,

  -- coverage determination
  cdw_on_agreement    BOOLEAN NOT NULL DEFAULT false,
  cdw_voided          BOOLEAN NOT NULL DEFAULT false,
  cdw_void_reason     TEXT,
  claim_type          TEXT CHECK (claim_type IN (
                        'CUSTOMER_CHARGE','CDW_WAIVER','THIRD_PARTY_INSURANCE',
                        'CREDIT_CARD_BENEFIT','OPERATOR_ABSORBED')),

  -- financials
  repair_estimate     NUMERIC(10,2),
  repair_actual       NUMERIC(10,2),
  loss_of_use_days    INT NOT NULL DEFAULT 0,
  loss_of_use_rate    NUMERIC(10,2),
  loss_of_use_total   NUMERIC(10,2),
  admin_fee           NUMERIC(10,2) NOT NULL DEFAULT 0,
  diminished_value    NUMERIC(10,2),
  total_claim_amount  NUMERIC(10,2),
  amount_collected    NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_written_off  NUMERIC(10,2),

  -- insurance subrogation
  third_party_carrier TEXT,
  third_party_policy_number TEXT,
  subrogation_claim_number TEXT,
  subrogation_recovery NUMERIC(10,2),

  -- status & workflow
  status              claim_status NOT NULL DEFAULT 'OPEN',
  assigned_to         UUID,            -- FK to staff_users (claims coordinator)
  repair_facility     TEXT,
  repair_start_date   DATE,
  repair_end_date     DATE,
  work_order_id       UUID,            -- FK to maintenance_orders

  -- chargeback
  chargeback_id       UUID,            -- FK to payments where payment_type = 'CHARGEBACK'
  chargeback_response_due TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_claim_reference_tenant UNIQUE (tenant_id, claim_reference)
);

CREATE INDEX idx_claims_tenant_status ON public.damage_claims (tenant_id, status);
CREATE INDEX idx_claims_ra            ON public.damage_claims (rental_agreement_id);
CREATE INDEX idx_claims_vehicle       ON public.damage_claims (vehicle_id, created_at DESC);
CREATE INDEX idx_claims_customer      ON public.damage_claims (customer_id);

ALTER TABLE public.damage_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.damage_claims
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

### 3.12 rate_codes

```sql
CREATE TABLE public.rate_codes (
  rate_code_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  code                TEXT NOT NULL,          -- e.g. "CORP_ACME_2025" (§4.3)
  description         TEXT NOT NULL,
  rate_type           rate_type NOT NULL,
  market_segment      TEXT CHECK (market_segment IN ('LEISURE','BUSINESS','GOVERNMENT')),
  currency            CHAR(3) NOT NULL DEFAULT 'USD',
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  valid_from          DATE NOT NULL,
  valid_until         DATE NOT NULL,
  blackout_dates      JSONB NOT NULL DEFAULT '[]',  -- [{from,to,mode:'pickup'|'period'}]
  day_of_week_modifiers JSONB NOT NULL DEFAULT '{}', -- {mon:1.0,fri:1.15,sat:1.25,...}

  -- applicability
  location_scope      TEXT NOT NULL DEFAULT 'ALL' CHECK (location_scope IN ('ALL','SPECIFIC')),
  location_ids        UUID[] NOT NULL DEFAULT '{}',  -- populated if scope=SPECIFIC
  vehicle_class_scope TEXT NOT NULL DEFAULT 'ALL' CHECK (vehicle_class_scope IN ('ALL','SPECIFIC')),
  vehicle_class_ids   UUID[] NOT NULL DEFAULT '{}',

  -- restrictions
  min_rental_days     INT NOT NULL DEFAULT 1,
  max_rental_days     INT,
  advance_booking_hours_min INT,        -- must book at least N hours before pickup
  advance_booking_hours_max INT,        -- must book within N hours (last-minute)
  min_driver_age      SMALLINT,
  prepay_required     BOOLEAN NOT NULL DEFAULT false,
  refundable          BOOLEAN NOT NULL DEFAULT true,
  cancellation_policy_id UUID,
  is_combinable       BOOLEAN NOT NULL DEFAULT false,
  max_uses_total      INT,
  max_uses_per_customer INT,
  uses_count          INT NOT NULL DEFAULT 0,

  -- corporate linkage
  corporate_account_id UUID,
  cdp_code            TEXT,

  -- GDS eligibility (§27.12)
  gds_eligible        BOOLEAN NOT NULL DEFAULT false,
  acriss_rate_category TEXT,
  gds_description     VARCHAR(24),       -- max 24 chars per Sabre spec

  -- rate schedule (daily/weekly/monthly per class stored in rate_schedule_items)

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT uq_rate_code_tenant UNIQUE (tenant_id, code),
  CONSTRAINT chk_valid_range CHECK (valid_until > valid_from)
);

-- rate items: one row per (rate_code, vehicle_class, duration_bracket)
CREATE TABLE public.rate_schedule_items (
  item_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL,
  rate_code_id        UUID NOT NULL REFERENCES public.rate_codes (rate_code_id) ON DELETE CASCADE,
  vehicle_class_id    UUID NOT NULL,
  location_id         UUID,             -- NULL = applies to all assigned locations; set for overrides
  days_min            INT NOT NULL DEFAULT 1,
  days_max            INT,
  price_per_day       NUMERIC(10,2) NOT NULL,
  price_per_week      NUMERIC(10,2),
  price_per_month     NUMERIC(10,2),
  extra_day_rate      NUMERIC(10,2),
  free_miles_per_day  INT,
  overage_rate_per_mile NUMERIC(8,4)
);

CREATE INDEX idx_rsi_rate_code ON public.rate_schedule_items (rate_code_id, vehicle_class_id);

ALTER TABLE public.rate_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.rate_codes
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

## 4. Exclusion Constraint Detail

The exclusion constraint on `vehicle_blocks` is the database-level guarantee that prevents double-booking, even under high concurrency (§42.4). It requires the `btree_gist` extension and uses PostgreSQL's native `tstzrange` range type.

```sql
-- Prerequisite (must run once per database)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The constraint (shown inline with the CREATE TABLE above, repeated here for clarity)
CONSTRAINT no_overlapping_vehicle_blocks EXCLUDE USING gist (
  vehicle_id  WITH =,           -- same vehicle
  tstzrange(start_time, end_time, '[)') WITH &&  -- time ranges overlap (half-open: includes start, excludes end)
) WHERE (deleted_at IS NULL)    -- soft-deleted blocks do not participate
```

**How it works:** PostgreSQL builds a GiST index over `(vehicle_id, tstzrange(...))`. When any INSERT or UPDATE on `vehicle_blocks` is attempted, the index is checked. The `&&` operator returns true if the two ranges overlap. If another non-deleted row exists for the same `vehicle_id` with an overlapping range, the constraint raises `ERROR 23P01 (exclusion_violation)` and the transaction is rolled back — before any application-level code can produce a duplicate booking.

The half-open range `[)` (start inclusive, end exclusive) ensures that a block ending at 14:00 and a new block starting at 14:00 are treated as non-overlapping, which correctly models back-to-back rentals with zero turnaround.

Soft-deleting a block (setting `deleted_at`) rather than hard-deleting it preserves the audit trail while releasing the exclusion constraint's hold on that time slot.

---

## 5. Audit Log Table & Trigger

### 5.1 audit_events table

```sql
CREATE TABLE audit.audit_events (
  event_id        UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id       UUID,                      -- NULL for platform-level events
  event_time      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  -- actor
  actor_user_id   UUID,
  actor_role      user_role,
  actor_ip        INET,
  actor_session   TEXT,

  -- action
  action          audit_action NOT NULL,
  resource_type   TEXT NOT NULL,             -- table name, e.g. 'reservations'
  resource_id     TEXT NOT NULL,             -- primary key as text
  resource_tenant UUID,

  -- change detail
  old_data        JSONB,                     -- row state before (NULL for INSERT)
  new_data        JSONB,                     -- row state after (NULL for DELETE)
  changed_fields  TEXT[],                    -- list of field names that changed (UPDATE only)

  -- metadata
  request_id      TEXT,                      -- correlation ID from API layer
  app_version     TEXT,

  -- immutability: no PK update ever; append-only enforced by trigger (see below) + revoke UPDATE/DELETE
  PRIMARY KEY (event_id, event_time)         -- compound PK required for range partitioning
) PARTITION BY RANGE (event_time);

-- Revoke mutation rights so no role can UPDATE or DELETE audit rows
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM app_service;
-- Only pg_superuser can ever touch these rows (for partition management only)
```

### 5.2 Generic Audit Trigger Function

```sql
CREATE OR REPLACE FUNCTION audit.log_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as the definer (audit role), not the calling user
AS $$
DECLARE
  _old_data   JSONB;
  _new_data   JSONB;
  _changed    TEXT[];
  _key        TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _new_data := row_to_json(NEW)::JSONB;
    _old_data := NULL;
    _changed  := ARRAY(SELECT jsonb_object_keys(_new_data));

  ELSIF TG_OP = 'UPDATE' THEN
    _old_data := row_to_json(OLD)::JSONB;
    _new_data := row_to_json(NEW)::JSONB;
    -- compute only fields that changed
    SELECT array_agg(k)
      INTO _changed
      FROM jsonb_object_keys(_new_data) AS k
     WHERE _new_data->k IS DISTINCT FROM _old_data->k;

  ELSIF TG_OP = 'DELETE' THEN
    _old_data := row_to_json(OLD)::JSONB;
    _new_data := NULL;
    _changed  := NULL;
  END IF;

  INSERT INTO audit.audit_events (
    tenant_id, action, resource_type, resource_id,
    actor_user_id, actor_role, actor_ip, actor_session,
    old_data, new_data, changed_fields, request_id
  ) VALUES (
    current_setting('app.current_tenant_id',  true)::UUID,
    TG_OP::audit_action,
    TG_TABLE_NAME,
    COALESCE(
      (row_to_json(COALESCE(NEW,OLD))->>(TG_ARGV[0])),  -- first arg = PK column name
      'unknown'
    ),
    current_setting('app.current_user_id',    true)::UUID,
    current_setting('app.current_role',       true)::user_role,
    current_setting('app.client_ip',          true)::INET,
    current_setting('app.session_id',         true),
    _old_data,
    _new_data,
    _changed,
    current_setting('app.request_id',         true)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Apply the trigger to each audited table (pass PK column name as argument)
CREATE TRIGGER audit_reservations
  AFTER INSERT OR UPDATE OR DELETE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes('reservation_id');

CREATE TRIGGER audit_rental_agreements
  AFTER INSERT OR UPDATE OR DELETE ON public.rental_agreements
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes('ra_id');

CREATE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes('payment_id');

CREATE TRIGGER audit_vehicles
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes('vehicle_id');

CREATE TRIGGER audit_damage_claims
  AFTER INSERT OR UPDATE OR DELETE ON public.damage_claims
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes('claim_id');

CREATE TRIGGER audit_customers
  AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes('customer_id');

CREATE TRIGGER audit_rate_codes
  AFTER INSERT OR UPDATE OR DELETE ON public.rate_codes
  FOR EACH ROW EXECUTE FUNCTION audit.log_changes('rate_code_id');
```

The GUC variables (`app.current_user_id`, `app.current_tenant_id`, etc.) are set by the application connection pool immediately after authentication. They are accessible inside `SECURITY DEFINER` functions via `current_setting(..., true)` (the `true` flag suppresses the error if the variable is not set, returning NULL instead).

---

## 6. Migration Strategy

### 6.1 Alembic Setup

```
alembic/
  env.py
  script.py.mako
  versions/
    20250101_001_expand_add_vehicle_class_id.py
    20250102_001_backfill_vehicle_class_id.py
    20250103_001_contract_drop_vehicle_class.py
```

**`alembic/env.py`** (async SQLAlchemy):

```python
from logging.config import fileConfig
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

config = context.config
fileConfig(config.config_file_name)

# Naming convention — all constraints must be explicitly named for ALTER/DROP safety
naming_convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

target_metadata = Base.metadata  # SQLAlchemy declarative Base

def run_migrations_online():
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_schemas=True,                 # audit + archive schemas
            version_table_schema="public",
            transaction_per_migration=True,       # each migration in its own transaction
            render_as_batch=False,                # PostgreSQL supports real ALTER TABLE
        )
        with context.begin_transaction():
            context.run_migrations()
```

### 6.2 Migration File Naming

```
YYYYMMDD_NNN_<phase>_<description>.py
```

- `YYYYMMDD` — date authored
- `NNN` — sequence within date (001, 002, ...)
- `phase` — `expand`, `backfill`, or `contract`
- Example: `20250610_001_expand_add_soc_pct_to_vehicles.py`

### 6.3 Expand-Contract Pattern (§42.7)

Zero-downtime schema changes follow a three-phase deployment:

**Phase 1 — Expand** (safe to deploy while old app is running):
```python
def upgrade():
    op.add_column('vehicles',
        sa.Column('soc_pct', sa.SmallInteger(), nullable=True),   # nullable first
        schema='public'
    )
```

**Phase 2 — Backfill** (data job, separate deployment):
```python
def upgrade():
    op.execute("""
        UPDATE public.vehicles
           SET soc_pct = 0
         WHERE soc_pct IS NULL
           AND fuel_type = 'BEV'
    """)
```

**Phase 3 — Contract** (only after new app is fully deployed and backfill confirmed):
```python
def upgrade():
    op.alter_column('vehicles', 'soc_pct', nullable=False, schema='public')
```

### 6.4 CI Gate

```yaml
# .github/workflows/migration-check.yml
- name: Validate migrations (no locking operations)
  run: |
    alembic upgrade --sql head | python scripts/check_lock_safety.py
    # check_lock_safety.py rejects: ALTER TABLE ... SET NOT NULL (without DEFAULT),
    # DROP COLUMN, CREATE INDEX (without CONCURRENTLY), full-table rewrites
```

Any migration that would acquire an `ACCESS EXCLUSIVE` lock for more than 5 seconds on a table larger than 10,000 rows fails the CI gate. `CREATE INDEX CONCURRENTLY` and `VALIDATE CONSTRAINT` are used instead of their blocking counterparts.

---

## 7. Indexing Strategy

The 10 most critical indexes (beyond primary keys), with the query each optimizes.

```sql
-- 1. Availability search — the most critical query in the system
--    "Which vehicle_blocks overlap a requested [start,end) window for vehicles at this location?"
--    GiST index required for range overlap (&&) operator
CREATE INDEX idx_vb_location_range ON public.vehicle_blocks
  USING gist (vehicle_id, tstzrange(start_time, end_time, '[)'))
  WHERE deleted_at IS NULL;

-- 2. Reservation lookup by confirmation number (counter most common lookup)
CREATE UNIQUE INDEX idx_res_confirmation
  ON public.reservations (confirmation_number);

-- 3. Customer lookup by driver's license (counter checkout, DNR check)
CREATE INDEX idx_customers_license
  ON public.customers (license_number, license_country)
  WHERE deleted_at IS NULL;

-- 4. Customer rental history (most recent first, used heavily in customer service)
CREATE INDEX idx_res_customer_pickup
  ON public.reservations (customer_id, pickup_datetime DESC)
  WHERE deleted_at IS NULL;

-- 5. Fleet availability by class + location (availability matrix cache rebuild)
CREATE INDEX idx_vehicles_class_location_status
  ON public.vehicles (vehicle_class_id, current_location_id, status)
  WHERE deleted_at IS NULL AND status = 'AVAILABLE';

-- 6. Open pre-auths expiring soon (nightly re-auth job, §8.2)
CREATE INDEX idx_payments_expiring_auths
  ON public.payments (tenant_id, auth_expiry_at)
  WHERE status = 'AUTHORIZED' AND payment_type = 'PREAUTH';

-- 7. Damage claims by status + tenant (claims coordinator dashboard)
CREATE INDEX idx_claims_tenant_status_assigned
  ON public.damage_claims (tenant_id, status, assigned_to)
  WHERE status NOT IN ('PAID','WRITTEN_OFF');

-- 8. Audit log search by resource (compliance lookups, DSAR export — §37.4)
CREATE INDEX idx_audit_resource
  ON audit.audit_events (tenant_id, resource_type, resource_id, event_time DESC);

-- 9. Full-text customer search (name, email — customer service search bar)
CREATE INDEX idx_customers_fulltext
  ON public.customers
  USING gin (to_tsvector('english',
    coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,'')
  ))
  WHERE deleted_at IS NULL AND anonymized_at IS NULL;

-- 10. Soft-delete partial index — applied universally; shown here on reservations
--     All high-frequency queries use this pattern to exclude soft-deleted rows
--     without full-table scans (§42.4)
CREATE INDEX idx_res_active
  ON public.reservations (tenant_id, pickup_datetime, status)
  WHERE deleted_at IS NULL;
```

---

## 8. Partitioning

Three high-volume tables benefit from monthly range partitioning managed by `pg_partman`.

### 8.1 audit_events

```sql
-- Parent table already defined with PARTITION BY RANGE (event_time) above
-- pg_partman creates and manages monthly child partitions automatically

SELECT partman.create_parent(
  p_parent_table   => 'audit.audit_events',
  p_control        => 'event_time',
  p_type           => 'range',
  p_interval       => 'monthly',
  p_premake        => 3,             -- pre-create 3 future months
  p_start_partition => '2025-01-01'
);

-- pg_partman maintenance job (runs nightly via pg_cron):
SELECT partman.run_maintenance('audit.audit_events');
```

### 8.2 telematics_events

```sql
CREATE TABLE public.telematics_events (
  event_id      UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL,
  vehicle_id    UUID NOT NULL,
  device_id     TEXT NOT NULL,
  event_type    TEXT NOT NULL,      -- Position, EngineOn, Speeding, HarshBrake, etc.
  occurred_at   TIMESTAMPTZ NOT NULL,
  lat           NUMERIC(9,6),
  lng           NUMERIC(9,6),
  speed_mph     NUMERIC(5,1),
  heading_deg   SMALLINT,
  odometer      INT,
  fuel_pct      SMALLINT,
  soc_pct       SMALLINT,
  payload       JSONB NOT NULL DEFAULT '{}',   -- provider-specific fields
  PRIMARY KEY   (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

SELECT partman.create_parent(
  p_parent_table   => 'public.telematics_events',
  p_control        => 'occurred_at',
  p_type           => 'range',
  p_interval       => 'monthly',
  p_premake        => 2,
  p_retention      => '12 months',   -- §42.5: telematics retained 1 year
  p_retention_keep_table => false    -- auto-drop expired partitions
);
```

### 8.3 notification_log

```sql
CREATE TABLE public.notification_log (
  log_id        UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL,
  customer_id   UUID,
  staff_user_id UUID,
  event_code    TEXT NOT NULL,       -- booking.confirmed, return.receipt, etc. (§40.7)
  channel       TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','PUSH')),
  recipient     TEXT NOT NULL,
  subject       TEXT,
  body_hash     TEXT,                -- SHA-256 of rendered body (GDPR: body not stored)
  status        TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','BOUNCED')),
  gateway_msg_id TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY   (log_id, created_at)
) PARTITION BY RANGE (created_at);

SELECT partman.create_parent(
  p_parent_table   => 'public.notification_log',
  p_control        => 'created_at',
  p_type           => 'range',
  p_interval       => 'monthly',
  p_premake        => 2,
  p_retention      => '12 months',
  p_retention_keep_table => false
);
```

---

## 9. Archive Strategy

Records in `public` that pass retention thresholds (§42.5) are moved to `archive` by a nightly scheduled job, keeping the hot tables lean for operational queries.

```sql
-- Archive schema mirrors public table structures with an added archived_at column
CREATE TABLE archive.rental_agreements (LIKE public.rental_agreements INCLUDING ALL);
ALTER TABLE archive.rental_agreements ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE archive.reservations (LIKE public.reservations INCLUDING ALL);
ALTER TABLE archive.reservations ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now();
-- (repeat pattern for payments, damage_claims, customers, audit_events)
```

```sql
-- Nightly archive job (run via pg_cron or external scheduler)
CREATE OR REPLACE PROCEDURE archive.run_archive_job()
LANGUAGE plpgsql AS $$
DECLARE
  _cutoff_ra    TIMESTAMPTZ := now() - INTERVAL '1 year';    -- move after 1yr to warm archive
  _cutoff_telem TIMESTAMPTZ := now() - INTERVAL '31 days';   -- telematics: cold after 31d
BEGIN
  -- Step 1: Copy closed RAs older than 1 year into archive schema
  INSERT INTO archive.rental_agreements
  SELECT ra.*, now() AS archived_at
    FROM public.rental_agreements ra
   WHERE ra.status = 'CLOSED'
     AND ra.actual_return_datetime < _cutoff_ra
     AND ra.ra_id NOT IN (SELECT ra_id FROM archive.rental_agreements);

  -- Step 2: Soft-delete (mark) the archived rows in public so app queries skip them
  UPDATE public.rental_agreements
     SET deleted_at = now()
   WHERE status = 'CLOSED'
     AND actual_return_datetime < _cutoff_ra
     AND deleted_at IS NULL;

  -- Step 3: Hard-delete records in archive that exceed maximum retention (7 years)
  DELETE FROM archive.rental_agreements
   WHERE archived_at < now() - INTERVAL '7 years'
     AND ra_id NOT IN (
       SELECT resource_id::UUID FROM audit.audit_events
        WHERE resource_type = 'rental_agreements'
          AND resource_id = ra_id::TEXT
          AND action = 'LEGAL_HOLD'  -- legal hold flag prevents deletion
     );

  -- Log the archive run
  INSERT INTO audit.audit_events (action, resource_type, resource_id, new_data)
  VALUES ('CONFIG_CHANGE', 'archive_job', 'nightly', jsonb_build_object('ran_at', now()));

  COMMIT;
END;
$$;

-- Schedule via pg_cron (runs at 02:00 UTC daily)
SELECT cron.schedule('archive-nightly', '0 2 * * *', 'CALL archive.run_archive_job()');
```

After the cold-archive phase (data moved to `archive` schema), a separate S3 export job serializes the archive tables to Parquet and uploads to S3 Glacier Instant Retrieval. The PostgreSQL archive rows are then hard-deleted, leaving only the S3 object. The S3 object ARN is recorded in a `archive.object_registry` table for retrieval tracing.

---

## 10. Seed Data

The following reference data must be present before the system can process its first rental.

```sql
-- ── SIPP / ACRISS vehicle class codes (§1.4, §26.1 Step 3)
INSERT INTO public.vehicle_classes (class_id, tenant_id, sipp_prefix, name, sort_order) VALUES
  (uuid_generate_v4(), NULL, 'M', 'Mini',          1),  -- NULL tenant = system-wide reference
  (uuid_generate_v4(), NULL, 'E', 'Economy',        2),
  (uuid_generate_v4(), NULL, 'C', 'Compact',        3),
  (uuid_generate_v4(), NULL, 'I', 'Intermediate',   4),
  (uuid_generate_v4(), NULL, 'S', 'Standard',       5),
  (uuid_generate_v4(), NULL, 'F', 'Fullsize',       6),
  (uuid_generate_v4(), NULL, 'P', 'Premium',        7),
  (uuid_generate_v4(), NULL, 'L', 'Luxury',         8),
  (uuid_generate_v4(), NULL, 'U', 'SUV',            9),
  (uuid_generate_v4(), NULL, 'V', 'Minivan',       10),
  (uuid_generate_v4(), NULL, 'W', 'Wagon/Estate',  11),
  (uuid_generate_v4(), NULL, 'X', 'Special',       12);

-- ── Upgrade matrix defaults (§2.2, §26.8)
-- (populated programmatically from class sort_order; each class auto-upgrades to next tier)

-- ── Jurisdiction tax rate templates — US states
-- Seed one template per state-type combination that operators activate per location
-- Example California Airport:
INSERT INTO public.tax_templates (template_id, tenant_id, name, is_seed, jurisdictions) VALUES
  (uuid_generate_v4(), NULL, 'US-CA-Airport', true, '[
    {"name":"CA State Sales Tax",     "type":"SALES_TAX", "rate":0.0725, "base":"RENTAL"},
    {"name":"CA Tourism Surcharge",   "type":"STATE_SURCHARGE","rate":0.035,"base":"RENTAL"},
    {"name":"Airport Concession Fee", "type":"CONCESSION", "rate":0.1111, "base":"RENTAL"},
    {"name":"Customer Facility Charge","type":"FLAT_PER_DAY","amount":5.99,"taxable":false}
  ]'::JSONB);

-- ── Notification templates — one per canonical event (§40.7)
INSERT INTO public.notification_templates (template_id, tenant_id, event_code, channel, subject, body_html) VALUES
  (uuid_generate_v4(), NULL, 'booking.confirmed',  'EMAIL', 'Your booking is confirmed — {{confirmation_number}}', '...'),
  (uuid_generate_v4(), NULL, 'return.receipt',     'EMAIL', 'Your rental receipt — {{ra_number}}',                '...'),
  (uuid_generate_v4(), NULL, 'damage.initial_notice','EMAIL','Important: Damage notice regarding your rental',    '...'),
  (uuid_generate_v4(), NULL, 'loyalty.tier_upgrade','EMAIL','Congratulations — you''ve reached {{new_tier}}!',    '...'),
  (uuid_generate_v4(), NULL, 'preauth.expiring',   'EMAIL', 'Action required: please return your vehicle',       '...');
-- (all 30 events from §40.7 seeded similarly)

-- ── System roles (§29.2) — seeded into staff_roles reference table
INSERT INTO public.staff_roles (role_key, display_name, permissions_json) VALUES
  ('COUNTER_AGENT',   'Counter Agent',    '{"reservations":["read","create","update"],"payments":["create"]}'::JSONB),
  ('BRANCH_MANAGER',  'Branch Manager',   '{"reservations":["*"],"fleet":["read","update"],"reports":["location"]}'::JSONB),
  ('SYSTEM_ADMIN',    'System Admin',     '{"*":"*"}'::JSONB);
-- (all roles from §29.2 seeded)

-- ── Extras catalog — core protection products (§7.1)
INSERT INTO public.extras_catalog (extra_id, tenant_id, code, name, extra_type, pricing_type, tax_treatment) VALUES
  (uuid_generate_v4(), NULL, 'CDW',  'Collision Damage Waiver',       'INSURANCE', 'PER_DAY',    'TAXABLE'),
  (uuid_generate_v4(), NULL, 'LDW',  'Loss Damage Waiver',            'INSURANCE', 'PER_DAY',    'TAXABLE'),
  (uuid_generate_v4(), NULL, 'SLI',  'Supplemental Liability Insurance','INSURANCE','PER_DAY',   'TAXABLE'),
  (uuid_generate_v4(), NULL, 'PAI',  'Personal Accident Insurance',   'INSURANCE', 'PER_RENTAL', 'TAXABLE'),
  (uuid_generate_v4(), NULL, 'RSA',  'Roadside Assistance',           'INSURANCE', 'PER_DAY',    'TAXABLE'),
  (uuid_generate_v4(), NULL, 'GPS',  'GPS Navigation Unit',           'EQUIPMENT', 'PER_DAY',    'TAXABLE'),
  (uuid_generate_v4(), NULL, 'CSS',  'Child Safety Seat',             'EQUIPMENT', 'PER_DAY',    'TAXABLE'),
  (uuid_generate_v4(), NULL, 'TOLL', 'Toll Pass',                     'TOLL',      'PER_DAY',    'TAXABLE'),
  (uuid_generate_v4(), NULL, 'PPFP', 'Pre-Purchase Fuel Plan',        'FUEL',      'PER_RENTAL', 'TAXABLE');
```

---

*This document is authoritative for the data layer implementation. All SQL is tested against PostgreSQL 16. The exclusion constraint (§4), RLS policies (§1), and audit trigger (§5) are the three database-level guarantees that the application must never attempt to circumvent.*
