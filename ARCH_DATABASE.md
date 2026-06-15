# Rental Car Manager — Database Architecture Reference

> PostgreSQL 16+ · Alembic migrations · pg_partman · pg_cron · PgBouncer (transaction mode)
> GAP-002: DNR scope uses `REGIONAL` not `BRAND` — see enum definition.
> GAP-003: `CHARGING` is a **vehicle_block_type**, not a vehicle_status. Vehicle statuses = 13 total.

---

## 1. Migration Ordering Table

| # | Alembic Filename | depends_on | Description |
|---|---|---|---|
| 1 | 20240101_001_create_extensions.py | — | uuid-ossp, btree_gist, pgcrypto, pg_partman, pg_cron |
| 2 | 20240101_002_create_schemas_roles.py | 001 | public/audit/archive schemas; REVOKE; app_service role |
| 3 | 20240101_003_create_enum_types.py | 002 | All 15 enum types |
| 4 | 20240101_004_create_tenants.py | 003 | tenants table + idx |
| 5 | 20240101_005_create_locations.py | 004 | locations table + RLS |
| 6 | 20240101_006_create_vehicle_classes.py | 005 | vehicle_classes table |
| 7 | 20240101_007_create_staff_roles_users.py | 005,003 | staff_roles + staff_users tables |
| 8 | 20240101_008_create_vehicles.py | 005,006,003 | vehicles table (50+ cols) + 5 indexes + RLS |
| 9 | 20240101_009_create_vehicle_status_log.py | 008,007 | vehicle_status_log table |
| 10 | 20240101_010_create_vehicle_blocks.py | 008,007,001 | vehicle_blocks + exclusion constraint + RLS |
| 11 | 20240101_011_create_customers.py | 005,003 | customers table + GIN index + RLS |
| 12 | 20240101_012_create_rate_codes.py | 005,003 | rate_codes + RLS |
| 13 | 20240101_013_create_rate_schedule_items.py | 012 | rate_schedule_items (FK CASCADE) |
| 14 | 20240101_014_create_extras_catalog.py | 002 | extras_catalog table |
| 15 | 20240101_015_create_tax_templates.py | 005 | tax_templates; backfill FK on locations |
| 16 | 20240101_016_create_notification_templates.py | 002 | notification_templates table |
| 17 | 20240101_017_create_reservations.py | 011,008,012,003 | reservations + 5 indexes + RLS |
| 18 | 20240101_018_create_reservation_versions.py | 017 | reservation_versions table |
| 19 | 20240101_019_create_rental_agreements.py | 017,008,011 | rental_agreements + RLS |
| 20 | 20240101_020_create_payments.py | 019,003 | payments + RLS |
| 21 | 20240101_021_create_processed_webhooks.py | 002 | processed_webhooks (Stripe idempotency) |
| 22 | 20240101_022_create_damage_claims.py | 019,008,011,003 | damage_claims + RLS |
| 23 | 20240101_023_create_audit_events.py | 002,003 | audit.audit_events partitioned + REVOKE |
| 24 | 20240101_024_partman_audit_events.py | 023 | pg_partman config for audit_events |
| 25 | 20240101_025_create_telematics_events.py | 002 | telematics_events partitioned + pg_partman |
| 26 | 20240101_026_create_notification_log.py | 002 | notification_log partitioned + pg_partman |
| 27 | 20240101_027_create_audit_trigger.py | 023,017–022 | audit.log_changes() + 7 triggers |
| 28 | 20240101_028_create_archive_tables.py | 019,017,020,022,011 | archive schema mirror tables |
| 29 | 20240101_029_create_archive_job.py | 028 | archive.run_archive_job() + pg_cron |
| 30 | 20240101_030_create_critical_indexes.py | 010–022,023 | 10 indexes via CREATE INDEX CONCURRENTLY |
| 31 | 20240101_031_rls_remaining_tables.py | 013,014,015,016,018,025,026 | RLS on 6 remaining tables |
| 32 | 20240101_032_seed_vehicle_classes.py | 006 | 12 SIPP classes (ON CONFLICT DO NOTHING) |
| 33 | 20240101_033_seed_reference_data.py | 014,015,016,007,032 | extras, tax template, roles, notif templates |
| 34 | 20240101_034_pgbouncer_config.py | 002 | Validation marker; pgbouncer.ini managed externally |

---

## 2. Extension & Schema Setup

```sql
-- DB-001: extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_partman" SCHEMA partman;
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- DB-003: schemas + roles
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS archive;

-- Revoke write access to audit/archive from PUBLIC and all app roles
REVOKE CREATE ON SCHEMA audit   FROM PUBLIC;
REVOKE CREATE ON SCHEMA archive FROM PUBLIC;

-- app_service: internal role that bypasses tenant RLS for cross-tenant operations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
    CREATE ROLE app_service NOLOGIN;
  END IF;
END
$$;

-- app_user: the runtime database user used by the API and workers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public  TO app_user, app_service;
GRANT USAGE ON SCHEMA audit   TO app_service;
GRANT USAGE ON SCHEMA archive TO app_service;

-- app_user gets SELECT/INSERT/UPDATE/DELETE on public; INSERT only on audit
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public  TO app_user;
GRANT INSERT                          ON ALL TABLES IN SCHEMA audit   TO app_service;

-- app_service bypasses RLS for network-wide DNR and cross-tenant reporting
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

---

## 3. Enum Types

```sql
-- DB-002: all 15 enum types

-- GAP-002: DNR scope uses REGIONAL (not BRAND) — customers.dnr_scope CHECK constraint uses this list
-- GAP-003: CHARGING is a vehicle_block_type; vehicle_status has 13 values

-- 1. reservation lifecycle (§3.1)
CREATE TYPE reservation_status AS ENUM (
  'QUOTE', 'PENDING', 'CONFIRMED', 'MODIFIED',
  'CHECKED_OUT', 'EXTENDED', 'RETURNED', 'CLOSED',
  'CANCELLED', 'NO_SHOW', 'DISPUTED'
);

-- 2. vehicle operational state — 13 statuses (GAP-003: CHARGING is NOT here)
CREATE TYPE vehicle_status AS ENUM (
  'STAGING', 'AVAILABLE', 'ON_RENT', 'RETURNING',
  'READY_FOR_INSPECTION', 'CLEANING', 'MAINTENANCE',
  'IN_REPAIR', 'DAMAGE_HOLD', 'ADMIN_HOLD',
  'PENDING_DISPOSAL', 'DISPOSED', 'PENDING_DELIVERY'
);

-- 3. vehicle calendar block type — CHARGING is here (GAP-003)
CREATE TYPE vehicle_block_type AS ENUM (
  'RESERVATION', 'TURNAROUND', 'MAINTENANCE', 'RECALL_HOLD',
  'IN_TRANSIT', 'HOLD', 'INSPECTION', 'STAGING', 'CHARGING'
);

-- 4. damage severity
CREATE TYPE damage_severity AS ENUM (
  'GRADE_1_COSMETIC', 'GRADE_2_MINOR', 'GRADE_3_MODERATE',
  'GRADE_4_SEVERE', 'GRADE_5_TOTAL_LOSS'
);

-- 5. damage claim lifecycle
CREATE TYPE claim_status AS ENUM (
  'OPEN', 'ESTIMATE_SENT', 'CUSTOMER_ACKNOWLEDGED',
  'REPAIR_IN_PROGRESS', 'REPAIR_COMPLETE', 'INVOICED',
  'PAID', 'DISPUTED', 'IN_LITIGATION', 'WRITTEN_OFF'
);

-- 6. payment methods
CREATE TYPE payment_method AS ENUM (
  'CREDIT_CARD', 'DEBIT_CARD', 'DIGITAL_WALLET',
  'CASH', 'DIRECT_BILL', 'ACH', 'WIRE', 'FUEL_CARD'
);

-- 7. payment transaction status
CREATE TYPE payment_status AS ENUM (
  'PENDING', 'AUTHORIZED', 'CAPTURED', 'REFUNDED',
  'PARTIALLY_REFUNDED', 'VOIDED', 'DECLINED', 'EXPIRED'
);

-- 8. staff roles
CREATE TYPE user_role AS ENUM (
  'CUSTOMER', 'CORPORATE_BOOKER', 'COUNTER_AGENT', 'SENIOR_AGENT',
  'BRANCH_MANAGER', 'REGIONAL_MANAGER', 'FLEET_MANAGER',
  'MAINTENANCE_TECH', 'CLAIMS_COORDINATOR', 'FINANCE',
  'SYSTEM_ADMIN', 'SUPER_ADMIN', 'API_PARTNER'
);

-- 9. rate types
CREATE TYPE rate_type AS ENUM (
  'RACK', 'CORPORATE', 'GOVERNMENT', 'INSURANCE_REPLACEMENT',
  'PROMOTIONAL', 'OTA_NET', 'WHOLESALE', 'MEMBERSHIP',
  'TOUR_OPERATOR', 'LOYALTY_REDEMPTION', 'WEEKEND_SPECIAL'
);

-- 10. fleet / acquisition type
CREATE TYPE fleet_type AS ENUM (
  'OWNED', 'LEASED', 'PROGRAM_CAR', 'COURTESY'
);

-- 11. depreciation method
CREATE TYPE depreciation_method AS ENUM (
  'STRAIGHT_LINE', 'UNITS_OF_PRODUCTION', 'MACRS'
);

-- 12. fuel type
CREATE TYPE fuel_type AS ENUM (
  'GASOLINE', 'DIESEL', 'HYBRID', 'PHEV', 'BEV', 'HYDROGEN', 'LPG'
);

-- 13. transmission type
CREATE TYPE transmission_type AS ENUM (
  'AUTOMATIC', 'MANUAL', 'CVT', 'DCT'
);

-- 14. KYC status
CREATE TYPE kyc_status AS ENUM (
  'UNVERIFIED', 'TIER_1_PENDING', 'TIER_1_COMPLETE',
  'TIER_2_PENDING', 'TIER_2_COMPLETE', 'FAILED', 'FLAGGED'
);

-- 15. audit action type
CREATE TYPE audit_action AS ENUM (
  'INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
  'EXPORT', 'CONFIG_CHANGE', 'STATE_TRANSITION'
);
```

---

## 4. Core Tables DDL

### tenants

```sql
CREATE TABLE public.tenants (
  tenant_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug                 TEXT NOT NULL UNIQUE,
  legal_name           TEXT NOT NULL,
  trading_name         TEXT,
  company_reg_no       TEXT,
  vat_tax_id           TEXT,
  primary_email        TEXT NOT NULL,
  primary_phone        TEXT,
  billing_address      JSONB NOT NULL DEFAULT '{}',
  logo_url             TEXT,
  default_currency     CHAR(3)     NOT NULL DEFAULT 'USD',
  default_timezone     TEXT        NOT NULL DEFAULT 'America/New_York',
  subscription_tier    TEXT        NOT NULL DEFAULT 'STARTER'
                         CHECK (subscription_tier IN ('STARTER','PROFESSIONAL','ENTERPRISE')),
  trial_ends_at        TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  tos_accepted_at      TIMESTAMPTZ,
  tos_version          TEXT,
  dpa_accepted_at      TIMESTAMPTZ,
  status               TEXT        NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE','SUSPENDED','CANCELLED','TRIAL')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

CREATE INDEX idx_tenants_slug ON public.tenants (slug) WHERE deleted_at IS NULL;
```

### locations

```sql
CREATE TABLE public.locations (
  location_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants (tenant_id),
  short_code           TEXT NOT NULL,
  name                 TEXT NOT NULL,
  location_type        TEXT NOT NULL CHECK (location_type IN (
                         'AIRPORT','DOWNTOWN','NEIGHBORHOOD',
                         'HOTEL','DEALER','DROP_HUB','DELIVERY_ONLY')),
  address_line1        TEXT NOT NULL,
  address_line2        TEXT,
  city                 TEXT NOT NULL,
  state_province       TEXT,
  country_code         CHAR(2)     NOT NULL,
  postal_code          TEXT,
  latitude             NUMERIC(9,6),
  longitude            NUMERIC(9,6),
  airport_code         CHAR(3),
  phone                TEXT,
  email                TEXT,
  timezone             TEXT        NOT NULL DEFAULT 'America/New_York',
  currency             CHAR(3)     NOT NULL DEFAULT 'USD',
  hours_of_operation   JSONB       NOT NULL DEFAULT '{}',
  holiday_schedule     JSONB       NOT NULL DEFAULT '[]',
  tax_template_id      UUID,
  no_show_grace_minutes INT        NOT NULL DEFAULT 120,
  turnaround_minutes_by_class JSONB NOT NULL DEFAULT '{}',
  overbooking_buffer_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  region_id            UUID,
  parent_location_id   UUID REFERENCES public.locations (location_id),
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,

  CONSTRAINT uq_location_tenant_code UNIQUE (tenant_id, short_code)
);

CREATE INDEX idx_locations_tenant ON public.locations (tenant_id) WHERE deleted_at IS NULL;
```

### vehicle_classes

```sql
CREATE TABLE public.vehicle_classes (
  class_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID REFERENCES public.tenants (tenant_id),  -- NULL = system-wide reference
  sipp_prefix      CHAR(1) NOT NULL,
  name             TEXT    NOT NULL,
  description      TEXT,
  sort_order       INT     NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_class_tenant_sipp UNIQUE (tenant_id, sipp_prefix)
);

CREATE INDEX idx_vehicle_classes_tenant ON public.vehicle_classes (tenant_id) WHERE is_active = true;
```

### staff_roles

```sql
CREATE TABLE public.staff_roles (
  role_key         TEXT PRIMARY KEY,
  display_name     TEXT NOT NULL,
  permissions_json JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### staff_users

```sql
CREATE TABLE public.staff_users (
  user_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants (tenant_id),
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  role             user_role NOT NULL,
  home_location_id UUID REFERENCES public.locations (location_id),
  pin_hash         TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,

  CONSTRAINT uq_staff_email_tenant UNIQUE (tenant_id, email)
);

CREATE INDEX idx_staff_tenant ON public.staff_users (tenant_id) WHERE deleted_at IS NULL;
```

### vehicles

```sql
CREATE TABLE public.vehicles (
  vehicle_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants (tenant_id),

  vin                     CHAR(17)    NOT NULL,
  plate_number            TEXT,
  plate_jurisdiction      TEXT,
  plate_expiry            DATE,
  title_number            TEXT,
  fleet_number            TEXT,
  unit_number             TEXT,

  make                    TEXT        NOT NULL,
  model                   TEXT        NOT NULL,
  trim                    TEXT,
  model_year              SMALLINT    NOT NULL CHECK (model_year BETWEEN 1900 AND 2100),
  body_style              TEXT,
  exterior_color          TEXT,
  exterior_color_code     TEXT,
  interior_color          TEXT,
  transmission            transmission_type NOT NULL,
  drive_type              TEXT CHECK (drive_type IN ('FWD','RWD','AWD','4WD')),
  engine_displacement_l   NUMERIC(4,2),
  cylinder_count          SMALLINT,
  fuel_type               fuel_type   NOT NULL,
  fuel_tank_capacity_gal  NUMERIC(6,2),
  battery_capacity_kwh    NUMERIC(6,2),
  epa_range_miles         INT,
  charge_port_type        TEXT,
  doors                   SMALLINT,
  seats                   SMALLINT,
  luggage_large_bags      SMALLINT,
  luggage_small_bags      SMALLINT,

  sipp_code               CHAR(4),
  vehicle_class_id        UUID NOT NULL REFERENCES public.vehicle_classes (class_id),
  pool_id                 UUID,

  home_location_id        UUID NOT NULL REFERENCES public.locations (location_id),
  current_location_id     UUID REFERENCES public.locations (location_id),
  status                  vehicle_status NOT NULL DEFAULT 'STAGING',
  odometer_current        INT         NOT NULL DEFAULT 0,
  odometer_unit           TEXT        NOT NULL DEFAULT 'MILES' CHECK (odometer_unit IN ('MILES','KM')),
  fuel_level_pct          SMALLINT    CHECK (fuel_level_pct BETWEEN 0 AND 100),
  soc_pct                 SMALLINT    CHECK (soc_pct BETWEEN 0 AND 100),
  in_service_date         DATE,

  acquisition_cost        NUMERIC(12,2),
  residual_value          NUMERIC(12,2),
  book_value              NUMERIC(12,2),
  depreciation_method     depreciation_method NOT NULL DEFAULT 'STRAIGHT_LINE',
  useful_life_months      INT,
  estimated_life_miles    INT,
  fleet_type              fleet_type  NOT NULL DEFAULT 'OWNED',
  lease_reference         TEXT,
  target_disposal_miles   INT,
  target_disposal_months  INT,

  options_packages        JSONB       NOT NULL DEFAULT '[]',
  photos                  JSONB       NOT NULL DEFAULT '[]',
  telematics_device_id    TEXT,
  telematics_provider     TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ,

  CONSTRAINT uq_vehicle_vin_tenant UNIQUE (tenant_id, vin)
);

CREATE INDEX idx_vehicles_tenant_status   ON public.vehicles (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_home_location   ON public.vehicles (home_location_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_current_location ON public.vehicles (current_location_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_class           ON public.vehicles (vehicle_class_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_sipp            ON public.vehicles (sipp_code) WHERE deleted_at IS NULL;
```

### vehicle_status_log

```sql
CREATE TABLE public.vehicle_status_log (
  log_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  vehicle_id          UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  previous_status     vehicle_status NOT NULL,
  new_status          vehicle_status NOT NULL,
  reason_code         TEXT NOT NULL,
  reason_detail       TEXT,
  linked_record_type  TEXT,
  linked_record_id    UUID,
  changed_by          UUID NOT NULL REFERENCES public.staff_users (user_id),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vsl_vehicle ON public.vehicle_status_log (vehicle_id, changed_at DESC);
CREATE INDEX idx_vsl_tenant  ON public.vehicle_status_log (tenant_id,  changed_at DESC);
```

### vehicle_blocks

```sql
-- Requires: CREATE EXTENSION IF NOT EXISTS btree_gist (DB-001)
CREATE TABLE public.vehicle_blocks (
  block_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants (tenant_id),
  vehicle_id     UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  block_type     vehicle_block_type NOT NULL,
  start_time     TIMESTAMPTZ NOT NULL,
  end_time       TIMESTAMPTZ NOT NULL,
  reservation_id UUID,
  work_order_id  UUID,
  is_hard_block  BOOLEAN     NOT NULL DEFAULT false,
  notes          TEXT,
  created_by     UUID        NOT NULL REFERENCES public.staff_users (user_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,

  CONSTRAINT chk_block_end_after_start CHECK (end_time > start_time),

  -- Prevents double-booking under any concurrency (uses btree_gist, half-open [) range)
  CONSTRAINT no_overlapping_vehicle_blocks EXCLUDE USING gist (
    vehicle_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (deleted_at IS NULL)
);

CREATE INDEX idx_vb_vehicle_time ON public.vehicle_blocks
  USING gist (vehicle_id, tstzrange(start_time, end_time, '[)'))
  WHERE deleted_at IS NULL;

CREATE INDEX idx_vb_reservation ON public.vehicle_blocks (reservation_id) WHERE deleted_at IS NULL;
```

### customers

```sql
CREATE TABLE public.customers (
  customer_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES public.tenants (tenant_id),

  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  email_verified       BOOLEAN     NOT NULL DEFAULT false,
  mobile_phone         TEXT,
  alt_phone            TEXT,
  date_of_birth        DATE,
  gender               TEXT,
  nationality          CHAR(2),
  mailing_address      JSONB,
  billing_address      JSONB,

  license_number       TEXT,
  license_country      CHAR(2),
  license_state        TEXT,
  license_class        TEXT,
  license_issued_date  DATE,
  license_expiry       DATE,
  license_image_url    TEXT,
  idp_required         BOOLEAN     NOT NULL DEFAULT false,

  account_status       TEXT        NOT NULL DEFAULT 'ACTIVE'
                         CHECK (account_status IN ('ACTIVE','SUSPENDED','BLACKLISTED','ANONYMIZED')),
  account_type         TEXT        NOT NULL DEFAULT 'INDIVIDUAL'
                         CHECK (account_type IN ('INDIVIDUAL','CORPORATE_EMPLOYEE',
                                'TRAVEL_AGENT','INSURANCE_CLAIMANT','LOYALTY_MEMBER')),
  kyc_status           kyc_status  NOT NULL DEFAULT 'UNVERIFIED',
  corporate_account_id UUID,

  loyalty_number       TEXT UNIQUE,
  loyalty_tier         TEXT DEFAULT 'MEMBER'
                         CHECK (loyalty_tier IN ('MEMBER','SILVER','GOLD','PLATINUM','CHAIRMAN')),
  loyalty_points       INT         NOT NULL DEFAULT 0,
  loyalty_tier_expiry  DATE,

  -- GAP-002: REGIONAL replaces BRAND in dnr_scope
  dnr_flag             BOOLEAN     NOT NULL DEFAULT false,
  dnr_reason           TEXT,
  dnr_scope            TEXT CHECK (dnr_scope IN ('LOCATION','REGIONAL','NETWORK')),
  dnr_expiry           DATE,
  dnr_added_by         UUID REFERENCES public.staff_users (user_id),
  dnr_incident_ref     UUID,

  preferred_class_id   UUID REFERENCES public.vehicle_classes (class_id),
  preferred_transmission transmission_type,
  comm_opt_email       BOOLEAN     NOT NULL DEFAULT true,
  comm_opt_sms         BOOLEAN     NOT NULL DEFAULT true,
  comm_opt_marketing   BOOLEAN     NOT NULL DEFAULT false,
  language_code        CHAR(5)     NOT NULL DEFAULT 'en-US',

  anonymized_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_customers_email_tenant ON public.customers (tenant_id, lower(email))
  WHERE deleted_at IS NULL AND anonymized_at IS NULL;
CREATE INDEX idx_customers_license ON public.customers (license_number, license_country)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_loyalty ON public.customers (loyalty_number)
  WHERE loyalty_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_customers_phone   ON public.customers (mobile_phone) WHERE deleted_at IS NULL;
```

### reservations

```sql
CREATE TABLE public.reservations (
  reservation_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants (tenant_id),
  confirmation_number     TEXT NOT NULL,
  status                  reservation_status NOT NULL DEFAULT 'QUOTE',
  version                 INT  NOT NULL DEFAULT 1,

  customer_id             UUID NOT NULL REFERENCES public.customers (customer_id),
  corporate_account_id    UUID,

  pickup_location_id      UUID NOT NULL REFERENCES public.locations (location_id),
  dropoff_location_id     UUID NOT NULL REFERENCES public.locations (location_id),
  pickup_datetime         TIMESTAMPTZ NOT NULL,
  return_datetime         TIMESTAMPTZ NOT NULL,
  actual_return_datetime  TIMESTAMPTZ,

  vehicle_class_id        UUID NOT NULL REFERENCES public.vehicle_classes (class_id),
  assigned_vehicle_id     UUID REFERENCES public.vehicles (vehicle_id),

  rate_code_id            UUID REFERENCES public.rate_codes (rate_code_id),
  cdp_code                TEXT,
  promo_code              TEXT,
  currency                CHAR(3)     NOT NULL DEFAULT 'USD',
  base_rate_daily         NUMERIC(10,2),
  base_total              NUMERIC(10,2),
  extras_total            NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  location_fees_total     NUMERIC(10,2) NOT NULL DEFAULT 0,
  taxes_total             NUMERIC(10,2) NOT NULL DEFAULT 0,
  grand_total             NUMERIC(10,2),
  deposit_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
  extras_snapshot         JSONB       NOT NULL DEFAULT '[]',
  taxes_snapshot          JSONB       NOT NULL DEFAULT '[]',

  channel                 TEXT        NOT NULL DEFAULT 'DIRECT_WEB'
                            CHECK (channel IN ('DIRECT_WEB','MOBILE_APP','CALL_CENTER','COUNTER',
                                   'WALK_UP','OTA','GDS','KIOSK','API')),
  ota_booking_ref         TEXT,
  insurance_replacement_flag BOOLEAN  NOT NULL DEFAULT false,
  flight_number           TEXT,
  special_instructions    TEXT,
  cancellation_policy_id  UUID,

  no_show_fee_charged     NUMERIC(10,2),
  no_show_at              TIMESTAMPTZ,

  loyalty_points_earned   INT         NOT NULL DEFAULT 0,
  loyalty_points_redeemed INT         NOT NULL DEFAULT 0,
  is_training             BOOLEAN     NOT NULL DEFAULT false,
  booking_agent_id        UUID REFERENCES public.staff_users (user_id),

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ,

  CONSTRAINT chk_return_after_pickup CHECK (return_datetime > pickup_datetime),
  CONSTRAINT uq_confirmation_number  UNIQUE (confirmation_number)
);

CREATE INDEX idx_res_tenant_status   ON public.reservations (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_res_customer        ON public.reservations (customer_id, pickup_datetime DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_res_pickup_location ON public.reservations (pickup_location_id, pickup_datetime) WHERE deleted_at IS NULL;
CREATE INDEX idx_res_vehicle         ON public.reservations (assigned_vehicle_id) WHERE assigned_vehicle_id IS NOT NULL;
CREATE INDEX idx_res_corporate       ON public.reservations (corporate_account_id) WHERE corporate_account_id IS NOT NULL;
```

### reservation_versions

```sql
CREATE TABLE public.reservation_versions (
  version_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  reservation_id      UUID NOT NULL REFERENCES public.reservations (reservation_id),
  version_number      INT  NOT NULL,
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
  changed_by          UUID NOT NULL,
  changed_by_type     TEXT NOT NULL CHECK (changed_by_type IN ('STAFF','CUSTOMER','SYSTEM')),
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_res_version UNIQUE (reservation_id, version_number)
);

CREATE INDEX idx_resv_reservation ON public.reservation_versions (reservation_id, version_number DESC);
```

### rental_agreements

```sql
CREATE TABLE public.rental_agreements (
  ra_id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants (tenant_id),
  ra_number               TEXT NOT NULL UNIQUE,
  reservation_id          UUID NOT NULL REFERENCES public.reservations (reservation_id),

  customer_id             UUID NOT NULL REFERENCES public.customers (customer_id),
  checking_out_agent_id   UUID REFERENCES public.staff_users (user_id),
  checking_in_agent_id    UUID REFERENCES public.staff_users (user_id),

  vehicle_id              UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  vin_at_checkout         CHAR(17)    NOT NULL,
  plate_at_checkout       TEXT,
  odometer_out            INT         NOT NULL,
  fuel_level_out_pct      SMALLINT,
  soc_pct_out             SMALLINT,

  odometer_in             INT,
  fuel_level_in_pct       SMALLINT,
  soc_pct_in              SMALLINT,
  actual_return_datetime  TIMESTAMPTZ,
  return_location_id      UUID REFERENCES public.locations (location_id),

  rate_snapshot           JSONB NOT NULL DEFAULT '{}',
  extras_snapshot         JSONB NOT NULL DEFAULT '[]',
  mileage_plan            JSONB NOT NULL DEFAULT '{}',
  fuel_policy             TEXT  CHECK (fuel_policy IN ('FULL_TO_FULL','PREPAY','SAME_TO_SAME','EV_PLAN')),
  additional_drivers      JSONB NOT NULL DEFAULT '[]',

  customer_signature_url  TEXT,
  customer_signed_at      TIMESTAMPTZ,
  esignature_hash         TEXT,
  declination_signature_url TEXT,

  preauth_id              UUID,
  preauth_amount          NUMERIC(10,2),

  swapped_from_ra_id      UUID REFERENCES public.rental_agreements (ra_id),
  swapped_to_ra_id        UUID REFERENCES public.rental_agreements (ra_id),

  status                  TEXT        NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE','EXTENDED','RETURNED','CLOSED','DISPUTED')),

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ra_reservation ON public.rental_agreements (reservation_id);
CREATE INDEX idx_ra_customer    ON public.rental_agreements (customer_id, created_at DESC);
CREATE INDEX idx_ra_vehicle     ON public.rental_agreements (vehicle_id, created_at DESC);
CREATE INDEX idx_ra_status      ON public.rental_agreements (tenant_id, status)
  WHERE status IN ('ACTIVE','EXTENDED');
```

### payments

```sql
CREATE TABLE public.payments (
  payment_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
  rental_agreement_id UUID REFERENCES public.rental_agreements (ra_id),
  reservation_id      UUID REFERENCES public.reservations (reservation_id),
  invoice_id          UUID,

  payment_type        TEXT          NOT NULL CHECK (payment_type IN (
                        'PREAUTH','CAPTURE','INCREMENTAL_AUTH',
                        'REFUND','VOID','CHARGEBACK','CHARGEBACK_REVERSAL')),
  payment_method      payment_method NOT NULL,
  status              payment_status NOT NULL DEFAULT 'PENDING',

  amount              NUMERIC(10,2) NOT NULL,
  currency            CHAR(3)       NOT NULL DEFAULT 'USD',
  refunded_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,

  gateway             TEXT          NOT NULL CHECK (gateway IN ('STRIPE','ADYEN','BRAINTREE','MANUAL')),
  gateway_payment_id  TEXT,
  gateway_auth_code   TEXT,
  network_txn_id      TEXT,
  card_last4          CHAR(4),
  card_brand          TEXT,
  card_expiry_month   SMALLINT,
  card_expiry_year    SMALLINT,
  payment_token       TEXT,          -- tokenized; no raw PAN stored

  authorized_at       TIMESTAMPTZ,
  captured_at         TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  auth_expiry_at      TIMESTAMPTZ,

  requires_approval   BOOLEAN       NOT NULL DEFAULT false,
  approved_by         UUID REFERENCES public.staff_users (user_id),
  approved_at         TIMESTAMPTZ,
  notes               TEXT,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_ra      ON public.payments (rental_agreement_id, created_at DESC);
CREATE INDEX idx_payments_status  ON public.payments (tenant_id, status, auth_expiry_at)
  WHERE status IN ('AUTHORIZED','PENDING');
CREATE INDEX idx_payments_gateway ON public.payments (gateway, gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;
```

### processed_webhooks

```sql
CREATE TABLE public.processed_webhooks (
  event_id    TEXT        PRIMARY KEY,   -- Stripe event ID; natural dedup key
  gateway     TEXT        NOT NULL DEFAULT 'STRIPE',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### damage_claims

```sql
CREATE TABLE public.damage_claims (
  claim_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants (tenant_id),
  claim_reference         TEXT NOT NULL,
  rental_agreement_id     UUID NOT NULL REFERENCES public.rental_agreements (ra_id),
  vehicle_id              UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
  customer_id             UUID NOT NULL REFERENCES public.customers (customer_id),

  discovered_at           TIMESTAMPTZ NOT NULL,
  discovered_by           UUID NOT NULL REFERENCES public.staff_users (user_id),
  discovery_type          TEXT NOT NULL CHECK (discovery_type IN (
                            'RETURN_INSPECTION','POST_RETURN_AUDIT',
                            'MID_RENTAL_CUSTOMER_REPORT','THIRD_PARTY_REPORT')),

  damage_zone             TEXT NOT NULL,
  damage_type             TEXT NOT NULL,
  severity                damage_severity NOT NULL,
  damage_description      TEXT,
  photos                  JSONB NOT NULL DEFAULT '[]',
  pre_rental_inspection_id UUID,
  customer_acknowledged   BOOLEAN     NOT NULL DEFAULT false,
  customer_ack_signature_url TEXT,

  cdw_on_agreement        BOOLEAN     NOT NULL DEFAULT false,
  cdw_voided              BOOLEAN     NOT NULL DEFAULT false,
  cdw_void_reason         TEXT,
  claim_type              TEXT CHECK (claim_type IN (
                            'CUSTOMER_CHARGE','CDW_WAIVER','THIRD_PARTY_INSURANCE',
                            'CREDIT_CARD_BENEFIT','OPERATOR_ABSORBED')),

  repair_estimate         NUMERIC(10,2),
  repair_actual           NUMERIC(10,2),
  loss_of_use_days        INT         NOT NULL DEFAULT 0,
  loss_of_use_rate        NUMERIC(10,2),
  loss_of_use_total       NUMERIC(10,2),
  admin_fee               NUMERIC(10,2) NOT NULL DEFAULT 0,
  diminished_value        NUMERIC(10,2),
  total_claim_amount      NUMERIC(10,2),
  amount_collected        NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_written_off      NUMERIC(10,2),

  third_party_carrier     TEXT,
  third_party_policy_number TEXT,
  subrogation_claim_number  TEXT,
  subrogation_recovery    NUMERIC(10,2),

  status                  claim_status NOT NULL DEFAULT 'OPEN',
  assigned_to             UUID REFERENCES public.staff_users (user_id),
  repair_facility         TEXT,
  repair_start_date       DATE,
  repair_end_date         DATE,
  work_order_id           UUID,

  chargeback_id           UUID,
  chargeback_response_due TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_claim_reference_tenant UNIQUE (tenant_id, claim_reference)
);

CREATE INDEX idx_claims_tenant_status ON public.damage_claims (tenant_id, status);
CREATE INDEX idx_claims_ra            ON public.damage_claims (rental_agreement_id);
CREATE INDEX idx_claims_vehicle       ON public.damage_claims (vehicle_id, created_at DESC);
CREATE INDEX idx_claims_customer      ON public.damage_claims (customer_id);
```

### rate_codes

```sql
CREATE TABLE public.rate_codes (
  rate_code_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants (tenant_id),
  code                     TEXT NOT NULL,
  description              TEXT NOT NULL,
  rate_type                rate_type NOT NULL,
  market_segment           TEXT CHECK (market_segment IN ('LEISURE','BUSINESS','GOVERNMENT')),
  currency                 CHAR(3)     NOT NULL DEFAULT 'USD',
  status                   TEXT        NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  valid_from               DATE        NOT NULL,
  valid_until              DATE        NOT NULL,
  blackout_dates           JSONB       NOT NULL DEFAULT '[]',
  day_of_week_modifiers    JSONB       NOT NULL DEFAULT '{}',

  location_scope           TEXT        NOT NULL DEFAULT 'ALL'
                             CHECK (location_scope IN ('ALL','SPECIFIC')),
  location_ids             UUID[]      NOT NULL DEFAULT '{}',
  vehicle_class_scope      TEXT        NOT NULL DEFAULT 'ALL'
                             CHECK (vehicle_class_scope IN ('ALL','SPECIFIC')),
  vehicle_class_ids        UUID[]      NOT NULL DEFAULT '{}',

  min_rental_days          INT         NOT NULL DEFAULT 1,
  max_rental_days          INT,
  advance_booking_hours_min INT,
  advance_booking_hours_max INT,
  min_driver_age           SMALLINT,
  prepay_required          BOOLEAN     NOT NULL DEFAULT false,
  refundable               BOOLEAN     NOT NULL DEFAULT true,
  cancellation_policy_id   UUID,
  is_combinable            BOOLEAN     NOT NULL DEFAULT false,
  max_uses_total           INT,
  max_uses_per_customer    INT,
  uses_count               INT         NOT NULL DEFAULT 0,

  corporate_account_id     UUID,
  cdp_code                 TEXT,
  gds_eligible             BOOLEAN     NOT NULL DEFAULT false,
  acriss_rate_category     TEXT,
  gds_description          VARCHAR(24),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,

  CONSTRAINT uq_rate_code_tenant UNIQUE (tenant_id, code),
  CONSTRAINT chk_valid_range     CHECK (valid_until > valid_from)
);
```

### rate_schedule_items

```sql
CREATE TABLE public.rate_schedule_items (
  item_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL,
  rate_code_id         UUID NOT NULL REFERENCES public.rate_codes (rate_code_id) ON DELETE CASCADE,
  vehicle_class_id     UUID NOT NULL REFERENCES public.vehicle_classes (class_id),
  location_id          UUID REFERENCES public.locations (location_id),
  days_min             INT         NOT NULL DEFAULT 1,
  days_max             INT,
  price_per_day        NUMERIC(10,2) NOT NULL,
  price_per_week       NUMERIC(10,2),
  price_per_month      NUMERIC(10,2),
  extra_day_rate       NUMERIC(10,2),
  free_miles_per_day   INT,
  overage_rate_per_mile NUMERIC(8,4)
);

CREATE INDEX idx_rsi_rate_code ON public.rate_schedule_items (rate_code_id, vehicle_class_id);
```

### extras_catalog

```sql
CREATE TABLE public.extras_catalog (
  extra_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES public.tenants (tenant_id),  -- NULL = system reference
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  extra_type    TEXT NOT NULL CHECK (extra_type IN ('INSURANCE','EQUIPMENT','FUEL','TOLL','SERVICE')),
  pricing_type  TEXT NOT NULL CHECK (pricing_type IN ('PER_DAY','PER_RENTAL','FLAT')),
  default_price NUMERIC(10,2),
  tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (tax_treatment IN ('TAXABLE','EXEMPT')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_extra_code UNIQUE (tenant_id, code)
);
```

### tax_templates

```sql
CREATE TABLE public.tax_templates (
  template_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES public.tenants (tenant_id),  -- NULL = system seed
  name          TEXT NOT NULL,
  is_seed       BOOLEAN NOT NULL DEFAULT false,
  jurisdictions JSONB NOT NULL DEFAULT '[]',  -- [{name,type,rate,base,amount,taxable}]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_tax_template_name UNIQUE (tenant_id, name)
);

-- Backfill FK on locations (run after tax_templates is created)
ALTER TABLE public.locations
  ADD CONSTRAINT fk_locations_tax_template
  FOREIGN KEY (tax_template_id) REFERENCES public.tax_templates (template_id);
```

### notification_templates

```sql
CREATE TABLE public.notification_templates (
  template_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID REFERENCES public.tenants (tenant_id),  -- NULL = system default
  event_code   TEXT NOT NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','PUSH')),
  subject      TEXT,
  body_html    TEXT,
  body_text    TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_notif_template UNIQUE (tenant_id, event_code, channel)
);
```

### notification_log (partitioned)

```sql
CREATE TABLE public.notification_log (
  log_id        UUID        NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL,
  customer_id   UUID,
  staff_user_id UUID,
  event_code    TEXT        NOT NULL,
  channel       TEXT        NOT NULL CHECK (channel IN ('EMAIL','SMS','PUSH')),
  recipient     TEXT        NOT NULL,
  subject       TEXT,
  body_hash     TEXT,        -- SHA-256 of rendered body (GDPR: body not stored)
  status        TEXT        NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','BOUNCED')),
  gateway_msg_id TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY   (log_id, created_at)
) PARTITION BY RANGE (created_at);
```

### audit.audit_events (partitioned)

```sql
CREATE TABLE audit.audit_events (
  event_id       UUID        NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id      UUID,
  event_time     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  actor_user_id  UUID,
  actor_role     user_role,
  actor_ip       INET,
  actor_session  TEXT,

  action         audit_action NOT NULL,
  resource_type  TEXT        NOT NULL,
  resource_id    TEXT        NOT NULL,
  resource_tenant UUID,

  old_data       JSONB,
  new_data       JSONB,
  changed_fields TEXT[],

  request_id     TEXT,
  app_version    TEXT,

  PRIMARY KEY (event_id, event_time)
) PARTITION BY RANGE (event_time);

-- Immutability: revoke all mutation rights
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM app_service;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM app_user;
```

### telematics_events (partitioned)

```sql
CREATE TABLE public.telematics_events (
  event_id      UUID        NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL,
  vehicle_id    UUID        NOT NULL,
  device_id     TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  lat           NUMERIC(9,6),
  lng           NUMERIC(9,6),
  speed_mph     NUMERIC(5,1),
  heading_deg   SMALLINT,
  odometer      INT,
  fuel_pct      SMALLINT,
  soc_pct       SMALLINT,
  payload       JSONB       NOT NULL DEFAULT '{}',
  PRIMARY KEY   (event_id, occurred_at)
) PARTITION BY RANGE (occurred_at);
```

### archive schema mirror tables

```sql
-- Pattern: LIKE public.X INCLUDING ALL + archived_at column
CREATE TABLE archive.rental_agreements (LIKE public.rental_agreements INCLUDING ALL);
ALTER TABLE archive.rental_agreements ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE archive.reservations (LIKE public.reservations INCLUDING ALL);
ALTER TABLE archive.reservations ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE archive.payments (LIKE public.payments INCLUDING ALL);
ALTER TABLE archive.payments ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE archive.damage_claims (LIKE public.damage_claims INCLUDING ALL);
ALTER TABLE archive.damage_claims ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE archive.customers (LIKE public.customers INCLUDING ALL);
ALTER TABLE archive.customers ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- S3 object registry for Glacier-archived records
CREATE TABLE archive.object_registry (
  registry_id   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_table  TEXT        NOT NULL,
  source_id     UUID        NOT NULL,
  tenant_id     UUID        NOT NULL,
  s3_bucket     TEXT        NOT NULL,
  s3_key        TEXT        NOT NULL,
  s3_arn        TEXT        NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_from_pg_at TIMESTAMPTZ
);
```

---

## 5. Row-Level Security

-- Pattern for standard tables (tenant_id NOT NULL):
--   ALTER TABLE public.X ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.X FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON public.X
--     USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
--   ALTER TABLE public.X NO FORCE ROW LEVEL SECURITY FOR ROLE app_service;
-- Applied to: vehicles, vehicle_blocks, customers, reservations, reservation_versions,
--   rental_agreements, payments, damage_claims, rate_codes, rate_schedule_items,
--   notification_log, telematics_events

```sql
-- Standard tables (tenant_id IS NOT NULL): repeated per table
DO $rls$
DECLARE
  _t TEXT;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'vehicles','vehicle_blocks','customers','reservations','reservation_versions',
    'rental_agreements','payments','damage_claims','rate_codes','rate_schedule_items',
    'notification_log','telematics_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', _t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = current_setting(''app.current_tenant_id'',true)::uuid)',
      _t
    );
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY FOR ROLE app_service', _t);
  END LOOP;
END
$rls$;

-- Tables allowing NULL tenant_id (system-wide reference rows visible to all tenants)
ALTER TABLE public.vehicle_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_classes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.vehicle_classes
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);
ALTER TABLE public.vehicle_classes NO FORCE ROW LEVEL SECURITY FOR ROLE app_service;

ALTER TABLE public.extras_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extras_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.extras_catalog
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);
ALTER TABLE public.extras_catalog NO FORCE ROW LEVEL SECURITY FOR ROLE app_service;
```

---

## 6. Audit Trigger Function

```sql
-- Complete SECURITY DEFINER function reading all 5 GUC variables
CREATE OR REPLACE FUNCTION audit.log_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = audit, public
AS $$
DECLARE
  _old_data  JSONB;
  _new_data  JSONB;
  _changed   TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    _new_data := row_to_json(NEW)::JSONB;
    _old_data := NULL;
    _changed  := ARRAY(SELECT jsonb_object_keys(_new_data));

  ELSIF TG_OP = 'UPDATE' THEN
    _old_data := row_to_json(OLD)::JSONB;
    _new_data := row_to_json(NEW)::JSONB;
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
    tenant_id,
    action,
    resource_type,
    resource_id,
    actor_user_id,
    actor_role,
    actor_ip,
    actor_session,
    old_data,
    new_data,
    changed_fields,
    request_id,
    app_version
  ) VALUES (
    -- GUC 1: tenant context
    current_setting('app.current_tenant_id', true)::UUID,
    -- action derived from trigger operation
    TG_OP::audit_action,
    TG_TABLE_NAME,
    COALESCE(
      (row_to_json(COALESCE(NEW, OLD)) ->> TG_ARGV[0]),
      'unknown'
    ),
    -- GUC 2: acting user
    current_setting('app.current_user_id',   true)::UUID,
    -- GUC 3: role
    current_setting('app.current_role',      true)::user_role,
    -- GUC 4: client IP
    current_setting('app.client_ip',         true)::INET,
    -- GUC 5: session / correlation
    current_setting('app.session_id',        true),
    _old_data,
    _new_data,
    _changed,
    current_setting('app.request_id',        true),
    current_setting('app.app_version',       true)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger installation on 7 tables (pass PK column name as TG_ARGV[0])
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

The 5 GUC variables set by `app/core/database.py` on each connection:

| GUC Key | Value Source |
|---|---|
| `app.current_tenant_id` | JWT `tenant_id` claim |
| `app.current_user_id` | JWT `sub` claim |
| `app.current_role` | JWT `role` claim |
| `app.client_ip` | `X-Forwarded-For` header (first IP) |
| `app.session_id` | JWT `jti` |
| `app.request_id` | `X-Request-ID` header injected by middleware |
| `app.app_version` | `APP_VERSION` env var |

---

## 7. Partitioning Config

```sql
-- audit.audit_events: monthly, premake 3 future months
SELECT partman.create_parent(
  p_parent_table    => 'audit.audit_events',
  p_control         => 'event_time',
  p_type            => 'range',
  p_interval        => 'monthly',
  p_premake         => 3,
  p_start_partition => '2025-01-01'
);

-- telematics_events: monthly, 12-month retention, auto-drop expired
SELECT partman.create_parent(
  p_parent_table         => 'public.telematics_events',
  p_control              => 'occurred_at',
  p_type                 => 'range',
  p_interval             => 'monthly',
  p_premake              => 2,
  p_retention            => '12 months',
  p_retention_keep_table => false
);

-- notification_log: monthly, 12-month retention, auto-drop expired
SELECT partman.create_parent(
  p_parent_table         => 'public.notification_log',
  p_control              => 'created_at',
  p_type                 => 'range',
  p_interval             => 'monthly',
  p_premake              => 2,
  p_retention            => '12 months',
  p_retention_keep_table => false
);

-- pg_cron: nightly partition maintenance at 02:30 UTC
SELECT cron.schedule(
  'partman-maintenance',
  '30 2 * * *',
  $$SELECT partman.run_maintenance_proc()$$
);

-- Manual partition check (run to verify upcoming partitions exist)
SELECT parent_table, partition_interval, premake, last_partition
  FROM partman.part_config
 ORDER BY parent_table;

-- Pre-create partitions on demand (if premake falls behind)
SELECT partman.create_partition_time(
  p_parent_table => 'audit.audit_events',
  p_partition_times => ARRAY[
    date_trunc('month', now()),
    date_trunc('month', now() + INTERVAL '1 month'),
    date_trunc('month', now() + INTERVAL '2 months')
  ]
);
```

---

## 8. Indexes

All indexes use `CREATE INDEX CONCURRENTLY` in migrations to avoid `ACCESS EXCLUSIVE` lock.

| table | index name | columns | type | partial? | why |
|---|---|---|---|---|---|
| `vehicle_blocks` | `idx_vb_vehicle_time` | `(vehicle_id, tstzrange(start_time,end_time,'[)'))` | GiST | `WHERE deleted_at IS NULL` | Availability overlap query — the hottest query |
| `reservations` | `idx_res_confirmation` | `(confirmation_number)` | UNIQUE B-tree | no | Counter lookup by conf# |
| `customers` | `idx_customers_license` | `(license_number, license_country)` | B-tree | `WHERE deleted_at IS NULL` | Counter checkout + DNR check |
| `reservations` | `idx_res_customer_pickup` | `(customer_id, pickup_datetime DESC)` | B-tree | `WHERE deleted_at IS NULL` | Customer rental history |
| `vehicles` | `idx_vehicles_class_location_status` | `(vehicle_class_id, current_location_id, status)` | B-tree | `WHERE deleted_at IS NULL AND status='AVAILABLE'` | Availability matrix rebuild |
| `payments` | `idx_payments_expiring_auths` | `(tenant_id, auth_expiry_at)` | B-tree | `WHERE status='AUTHORIZED' AND payment_type='PREAUTH'` | Nightly re-auth Celery job |
| `damage_claims` | `idx_claims_tenant_status_assigned` | `(tenant_id, status, assigned_to)` | B-tree | `WHERE status NOT IN ('PAID','WRITTEN_OFF')` | Claims coordinator dashboard |
| `audit.audit_events` | `idx_audit_resource` | `(tenant_id, resource_type, resource_id, event_time DESC)` | B-tree | no | DSAR export + compliance lookup |
| `customers` | `idx_customers_fulltext` | `to_tsvector('english', first_name\|\|' '\|\|last_name\|\|' '\|\|email)` | GIN | `WHERE deleted_at IS NULL AND anonymized_at IS NULL` | Customer service search bar |
| `reservations` | `idx_res_active` | `(tenant_id, pickup_datetime, status)` | B-tree | `WHERE deleted_at IS NULL` | Dashboard active reservation queries |

---

## 9. Archive Strategy

### Retention Rules

| table | retention in public | archive target | legal hold check |
|---|---|---|---|
| `rental_agreements` | 1 year after CLOSED | `archive.rental_agreements` | audit.audit_events action='LEGAL_HOLD' on ra_id |
| `reservations` | 1 year after CANCELLED/CLOSED | `archive.reservations` | same pattern |
| `payments` | 1 year after final status | `archive.payments` | linked to RA legal hold |
| `damage_claims` | 2 years after PAID/WRITTEN_OFF | `archive.damage_claims` | litigation hold check |
| `customers` | 3 years after last rental (anonymized on request) | `archive.customers` | GDPR erasure flag |
| `archive.*` (all) | 7 years from archived_at | S3 Glacier via export job | legal_hold flag blocks hard delete |
| `telematics_events` | 12 months (partition auto-drop) | no archive; S3 export only | n/a |
| `notification_log` | 12 months (partition auto-drop) | no archive | n/a |

### archive.run_archive_job() procedure

```sql
CREATE OR REPLACE PROCEDURE archive.run_archive_job()
LANGUAGE plpgsql AS $$
DECLARE
  _legal_hold_ids TEXT[] := ARRAY(
    SELECT DISTINCT resource_id FROM audit.audit_events
     WHERE resource_type = 'rental_agreements'
       AND action = 'CONFIG_CHANGE' AND new_data->>'flag' = 'LEGAL_HOLD'
  );
  _rows_archived INT := 0;
BEGIN
  -- Step 1: copy CLOSED RAs >1yr into archive (skip legal holds and already-archived)
  INSERT INTO archive.rental_agreements
  SELECT ra.*, now()
    FROM public.rental_agreements ra
   WHERE ra.status = 'CLOSED'
     AND ra.actual_return_datetime < now() - INTERVAL '1 year'
     AND ra.ra_id NOT IN (SELECT ra_id FROM archive.rental_agreements)
     AND ra.ra_id::TEXT != ALL(_legal_hold_ids);
  GET DIAGNOSTICS _rows_archived = ROW_COUNT;

  -- Step 2: soft-delete archived RAs from public
  UPDATE public.rental_agreements SET deleted_at = now()
   WHERE status = 'CLOSED' AND actual_return_datetime < now() - INTERVAL '1 year'
     AND deleted_at IS NULL;

  -- Step 3: archive terminal reservations with no open RA
  INSERT INTO archive.reservations
  SELECT r.*, now()
    FROM public.reservations r
   WHERE r.status IN ('CANCELLED','CLOSED','NO_SHOW')
     AND r.updated_at < now() - INTERVAL '1 year'
     AND r.reservation_id NOT IN (SELECT reservation_id FROM archive.reservations)
     AND NOT EXISTS (
       SELECT 1 FROM public.rental_agreements ra
        WHERE ra.reservation_id = r.reservation_id AND ra.status IN ('ACTIVE','EXTENDED','DISPUTED')
     );
  UPDATE public.reservations SET deleted_at = now()
   WHERE status IN ('CANCELLED','CLOSED','NO_SHOW') AND updated_at < now() - INTERVAL '1 year'
     AND deleted_at IS NULL;

  -- Step 4: hard-delete archive rows past 7-year retention (no legal hold)
  DELETE FROM archive.rental_agreements
   WHERE archived_at < now() - INTERVAL '7 years'
     AND ra_id::TEXT != ALL(_legal_hold_ids);

  -- Step 5: log run
  INSERT INTO audit.audit_events (action, resource_type, resource_id, new_data)
  VALUES ('CONFIG_CHANGE','archive_job','nightly',
          jsonb_build_object('ran_at',now(),'rows_archived',_rows_archived));
  COMMIT;
END;
$$;

SELECT cron.schedule('archive-nightly','0 2 * * *',$$CALL archive.run_archive_job()$$);
```

---

## 10. Alembic Configuration

### alembic/env.py

```python
from __future__ import annotations
import asyncio
from logging.config import fileConfig
from typing import Any
from sqlalchemy import pool, MetaData
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context
from app.models import Base  # noqa: E402

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

naming_convention: dict[str, Any] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
target_metadata = Base.metadata

_PARTITION_PREFIXES = ("audit_events_p", "telematics_events_p", "notification_log_p")

def include_object(obj: Any, name: str, type_: str, reflected: bool, compare_to: Any) -> bool:
    if type_ == "table":
        schema = getattr(obj, "schema", None) or "public"
        if schema in ("public", "audit", "archive"):
            return not any(name.startswith(p) for p in _PARTITION_PREFIXES)
    return True

_CTX_KWARGS: dict[str, Any] = dict(
    target_metadata=target_metadata, compare_type=True,
    compare_server_default=True, include_schemas=True,
    version_table_schema="public", render_as_batch=False,
    naming_convention=naming_convention, include_object=include_object,
)

def run_migrations_offline() -> None:
    context.configure(url=config.get_main_option("sqlalchemy.url"),
                      literal_binds=True, dialect_opts={"paramstyle": "named"}, **_CTX_KWARGS)
    with context.begin_transaction():
        context.run_migrations()

def do_run_migrations(connection: Any) -> None:
    context.configure(connection=connection, transaction_per_migration=True, **_CTX_KWARGS)
    with context.begin_transaction():
        context.run_migrations()

async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.", poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()

if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

### Naming Conventions Dict

```python
# NAMING_CONVENTION — also used as MetaData(naming_convention=...) in models
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",        "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
```

### Migration Template Header

```python
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

Phase: [expand | backfill | contract]
Lock risk: [low | medium | high — justify if high]
Reversible: [yes | no — if no, explain]
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

---

## 11. check_lock_safety.py

```python
#!/usr/bin/env python3
"""CI gate: rejects Alembic --sql output with locking violations. Exit 0=ok, 1=fail.
Usage: alembic upgrade --sql head | python scripts/check_lock_safety.py
"""
from __future__ import annotations
import re
import sys

LARGE_TABLES = {
    "reservations", "rental_agreements", "vehicles", "customers",
    "payments", "damage_claims", "audit_events", "telematics_events",
    "notification_log", "vehicle_blocks", "vehicle_status_log", "reservation_versions",
}

VIOLATIONS: list[str] = []


def _table(m: re.Match[str]) -> str:
    return m.group(1).lower()


def check_set_not_null(line: str, lineno: int) -> None:
    """Rejects direct SET NOT NULL on large tables — use ADD CHECK NOT VALID + VALIDATE first."""
    m = re.search(
        r"alter\s+table\s+(?:public\.)?(\w+)\s+alter\s+column\s+\w+\s+set\s+not\s+null",
        line, re.IGNORECASE,
    )
    if m and _table(m) in LARGE_TABLES:
        VIOLATIONS.append(
            f"Line {lineno}: SET NOT NULL on '{_table(m)}' without VALIDATE CONSTRAINT. "
            f"Use expand-contract: ADD CHECK NOT VALID -> VALIDATE -> SET NOT NULL."
        )


def check_create_index(line: str, lineno: int) -> None:
    """Rejects CREATE INDEX without CONCURRENTLY (takes ShareLock, blocks writes)."""
    if re.search(r"\bcreate\s+(?:unique\s+)?index\s+(?!concurrently\b)", line, re.IGNORECASE):
        if "create table" not in line.lower():
            VIOLATIONS.append(f"Line {lineno}: CREATE INDEX without CONCURRENTLY — use CREATE INDEX CONCURRENTLY.")


def check_drop_column(line: str, lineno: int) -> None:
    """Rejects DROP COLUMN on large tables — requires ACCESS EXCLUSIVE lock."""
    m = re.search(r"alter\s+table\s+(?:public\.)?(\w+)\s+drop\s+column", line, re.IGNORECASE)
    if m and _table(m) in LARGE_TABLES:
        VIOLATIONS.append(
            f"Line {lineno}: DROP COLUMN on '{_table(m)}' — use expand-contract pattern."
        )


def check_full_table_rewrite(line: str, lineno: int) -> None:
    """Rejects ALTER COLUMN TYPE on large tables (may force full rewrite)."""
    m = re.search(
        r"alter\s+table\s+(?:public\.)?(\w+)\s+alter\s+column\s+\w+\s+type\s+",
        line, re.IGNORECASE,
    )
    if m and _table(m) in LARGE_TABLES:
        VIOLATIONS.append(
            f"Line {lineno}: ALTER COLUMN TYPE on '{_table(m)}' — use expand-contract: add column, backfill, drop old."
        )


def main() -> int:
    for lineno, line in enumerate(sys.stdin.read().splitlines(), start=1):
        s = line.strip()
        if not s or s.startswith("--"):
            continue
        check_set_not_null(s, lineno)
        check_create_index(s, lineno)
        check_drop_column(s, lineno)
        check_full_table_rewrite(s, lineno)

    if VIOLATIONS:
        for v in VIOLATIONS:
            print(f"ERROR: {v}", file=sys.stderr)
        print(f"\n{len(VIOLATIONS)} violation(s). Migration rejected.", file=sys.stderr)
        return 1
    print("check_lock_safety.py: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## 12. Seed Data

```sql
-- All inserts are idempotent via ON CONFLICT DO NOTHING

-- ── DB-032: 12 SIPP vehicle classes (tenant_id NULL = system-wide reference)
INSERT INTO public.vehicle_classes (class_id, tenant_id, sipp_prefix, name, sort_order) VALUES
  ('00000000-0000-0000-0001-000000000001', NULL, 'M', 'Mini',            1),
  ('00000000-0000-0000-0001-000000000002', NULL, 'E', 'Economy',          2),
  ('00000000-0000-0000-0001-000000000003', NULL, 'C', 'Compact',          3),
  ('00000000-0000-0000-0001-000000000004', NULL, 'I', 'Intermediate',     4),
  ('00000000-0000-0000-0001-000000000005', NULL, 'S', 'Standard',         5),
  ('00000000-0000-0000-0001-000000000006', NULL, 'F', 'Fullsize',         6),
  ('00000000-0000-0000-0001-000000000007', NULL, 'P', 'Premium',          7),
  ('00000000-0000-0000-0001-000000000008', NULL, 'L', 'Luxury',           8),
  ('00000000-0000-0000-0001-000000000009', NULL, 'U', 'SUV',              9),
  ('00000000-0000-0000-0001-000000000010', NULL, 'V', 'Minivan',         10),
  ('00000000-0000-0000-0001-000000000011', NULL, 'W', 'Wagon/Estate',    11),
  ('00000000-0000-0000-0001-000000000012', NULL, 'X', 'Special/Exotic',  12)
ON CONFLICT (tenant_id, sipp_prefix) DO NOTHING;

-- ── DB-032: 9 extras catalog (tenant_id NULL = system reference)
INSERT INTO public.extras_catalog (extra_id, tenant_id, code, name, extra_type, pricing_type, tax_treatment) VALUES
  ('00000000-0000-0000-0002-000000000001', NULL, 'CDW',  'Collision Damage Waiver',          'INSURANCE', 'PER_DAY',    'TAXABLE'),
  ('00000000-0000-0000-0002-000000000002', NULL, 'LDW',  'Loss Damage Waiver',               'INSURANCE', 'PER_DAY',    'TAXABLE'),
  ('00000000-0000-0000-0002-000000000003', NULL, 'SLI',  'Supplemental Liability Insurance', 'INSURANCE', 'PER_DAY',    'TAXABLE'),
  ('00000000-0000-0000-0002-000000000004', NULL, 'PAI',  'Personal Accident Insurance',      'INSURANCE', 'PER_RENTAL', 'TAXABLE'),
  ('00000000-0000-0000-0002-000000000005', NULL, 'RSA',  'Roadside Assistance',              'INSURANCE', 'PER_DAY',    'TAXABLE'),
  ('00000000-0000-0000-0002-000000000006', NULL, 'GPS',  'GPS Navigation Unit',              'EQUIPMENT', 'PER_DAY',    'TAXABLE'),
  ('00000000-0000-0000-0002-000000000007', NULL, 'CSS',  'Child Safety Seat',                'EQUIPMENT', 'PER_DAY',    'TAXABLE'),
  ('00000000-0000-0000-0002-000000000008', NULL, 'TOLL', 'Toll Pass',                        'TOLL',      'PER_DAY',    'TAXABLE'),
  ('00000000-0000-0000-0002-000000000009', NULL, 'PPFP', 'Pre-Purchase Fuel Plan',           'FUEL',      'PER_RENTAL', 'TAXABLE')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ── DB-032: California Airport tax template (1 seed)
INSERT INTO public.tax_templates (template_id, tenant_id, name, is_seed, jurisdictions) VALUES
  ('00000000-0000-0000-0003-000000000001', NULL, 'US-CA-Airport', true, '[
    {"name":"CA State Sales Tax",      "type":"SALES_TAX",        "rate":0.0725, "base":"RENTAL",  "taxable":true},
    {"name":"CA Tourism Surcharge",    "type":"STATE_SURCHARGE",  "rate":0.035,  "base":"RENTAL",  "taxable":true},
    {"name":"Airport Concession Fee",  "type":"CONCESSION",       "rate":0.1111, "base":"RENTAL",  "taxable":false},
    {"name":"Customer Facility Charge","type":"FLAT_PER_DAY",     "amount":5.99, "taxable":false}
  ]'::JSONB)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ── DB-032: All staff roles with permissions_json
INSERT INTO public.staff_roles (role_key, display_name, permissions_json) VALUES
  ('CUSTOMER',          'Customer (Self-Service)', '{"self":["read","update"]}'::JSONB),
  ('CORPORATE_BOOKER',  'Corporate Booker',        '{"reservations":["read","create"],"customers":["read"]}'::JSONB),
  ('COUNTER_AGENT',     'Counter Agent',           '{"reservations":["read","create","update"],"customers":["read","create","update"],"payments":["create"],"vehicles":["read"]}'::JSONB),
  ('SENIOR_AGENT',      'Senior Agent',            '{"reservations":["*"],"customers":["*"],"payments":["create","refund"],"vehicles":["read","update"],"damage_claims":["read","create"]}'::JSONB),
  ('BRANCH_MANAGER',    'Branch Manager',          '{"reservations":["*"],"customers":["*"],"payments":["*"],"vehicles":["read","update"],"damage_claims":["*"],"reports":["location"],"rate_codes":["read"]}'::JSONB),
  ('REGIONAL_MANAGER',  'Regional Manager',        '{"reservations":["*"],"customers":["*"],"payments":["*"],"vehicles":["*"],"damage_claims":["*"],"reports":["regional"],"rate_codes":["*"]}'::JSONB),
  ('FLEET_MANAGER',     'Fleet Manager',           '{"vehicles":["*"],"vehicle_blocks":["*"],"maintenance":["*"],"reports":["fleet"]}'::JSONB),
  ('MAINTENANCE_TECH',  'Maintenance Technician',  '{"vehicles":["read","update"],"maintenance":["read","create","update"],"vehicle_blocks":["create","update"]}'::JSONB),
  ('CLAIMS_COORDINATOR','Claims Coordinator',      '{"damage_claims":["*"],"customers":["read"],"rental_agreements":["read"],"payments":["read"]}'::JSONB),
  ('FINANCE',           'Finance',                 '{"payments":["*"],"invoices":["*"],"reports":["financial"],"damage_claims":["read"]}'::JSONB),
  ('SYSTEM_ADMIN',      'System Admin',            '{"*":["*"]}'::JSONB),
  ('SUPER_ADMIN',       'Super Admin',             '{"*":"*"}'::JSONB),
  ('API_PARTNER',       'API Partner',             '{"reservations":["read","create"],"vehicles":["read"],"rate_codes":["read"]}'::JSONB)
ON CONFLICT (role_key) DO NOTHING;

-- ── DB-032: 30 notification templates (event_code + channel + subject + body placeholder)
INSERT INTO public.notification_templates (template_id, tenant_id, event_code, channel, subject, body_html) VALUES
  ('00000000-0000-0000-0004-000000000001', NULL, 'booking.confirmed',           'EMAIL', 'Your booking is confirmed — {{confirmation_number}}', '<p>Hi {{first_name}}, reservation {{confirmation_number}} is confirmed for {{pickup_datetime}}.</p>'),
  ('00000000-0000-0000-0004-000000000002', NULL, 'booking.confirmed',           'SMS',   NULL, 'Rental {{confirmation_number}} confirmed. Pick up: {{pickup_location}} at {{pickup_datetime}}.'),
  ('00000000-0000-0000-0004-000000000003', NULL, 'booking.modified',            'EMAIL', 'Your reservation has been updated — {{confirmation_number}}', '<p>Hi {{first_name}}, reservation {{confirmation_number}} has been updated.</p>'),
  ('00000000-0000-0000-0004-000000000004', NULL, 'booking.cancelled',           'EMAIL', 'Reservation cancelled — {{confirmation_number}}', '<p>Your reservation {{confirmation_number}} has been cancelled.</p>'),
  ('00000000-0000-0000-0004-000000000005', NULL, 'booking.cancelled',           'SMS',   NULL, 'Reservation {{confirmation_number}} cancelled. Reply HELP for support.'),
  ('00000000-0000-0000-0004-000000000006', NULL, 'booking.reminder_24h',        'EMAIL', 'Reminder: your rental starts tomorrow', '<p>Hi {{first_name}}, your rental starts tomorrow at {{pickup_datetime}}.</p>'),
  ('00000000-0000-0000-0004-000000000007', NULL, 'booking.reminder_24h',        'SMS',   NULL, 'Reminder: rental {{confirmation_number}} starts tomorrow at {{pickup_time}}.'),
  ('00000000-0000-0000-0004-000000000008', NULL, 'checkout.receipt',            'EMAIL', 'Your rental agreement — {{ra_number}}', '<p>Thank you, {{first_name}}. Rental agreement {{ra_number}} is attached.</p>'),
  ('00000000-0000-0000-0004-000000000009', NULL, 'return.receipt',              'EMAIL', 'Your rental receipt — {{ra_number}}', '<p>Thanks for returning. Receipt for {{ra_number}} is attached.</p>'),
  ('00000000-0000-0000-0004-000000000010', NULL, 'return.receipt',              'SMS',   NULL, 'Return complete for {{ra_number}}. Charged: {{currency}} {{grand_total}}. Thank you!'),
  ('00000000-0000-0000-0004-000000000011', NULL, 'damage.initial_notice',       'EMAIL', 'Important: damage notice regarding your rental {{ra_number}}', '<p>Dear {{first_name}}, damage recorded on return of {{ra_number}}. Reference: {{claim_reference}}.</p>'),
  ('00000000-0000-0000-0004-000000000012', NULL, 'damage.estimate_sent',        'EMAIL', 'Damage estimate — {{claim_reference}}', '<p>Estimate of {{currency}} {{repair_estimate}} prepared for {{claim_reference}}.</p>'),
  ('00000000-0000-0000-0004-000000000013', NULL, 'damage.invoiced',             'EMAIL', 'Damage invoice — {{claim_reference}}', '<p>Invoice for {{currency}} {{total_claim_amount}} issued for {{claim_reference}}.</p>'),
  ('00000000-0000-0000-0004-000000000014', NULL, 'payment.preauth_placed',      'EMAIL', 'Pre-authorization placed on your card', '<p>Pre-auth of {{currency}} {{preauth_amount}} placed for {{ra_number}}.</p>'),
  ('00000000-0000-0000-0004-000000000015', NULL, 'payment.captured',            'EMAIL', 'Payment confirmed — {{ra_number}}', '<p>Payment of {{currency}} {{amount}} for {{ra_number}} processed.</p>'),
  ('00000000-0000-0000-0004-000000000016', NULL, 'payment.refund_issued',       'EMAIL', 'Refund issued — {{ra_number}}', '<p>Refund of {{currency}} {{refunded_amount}} issued for {{ra_number}}.</p>'),
  ('00000000-0000-0000-0004-000000000017', NULL, 'payment.preauth_expiring',    'EMAIL', 'Action required: please return your vehicle', '<p>Pre-auth for {{ra_number}} expires soon. Please return or contact us.</p>'),
  ('00000000-0000-0000-0004-000000000018', NULL, 'preauth.expiring',            'SMS',   NULL, 'Rental {{ra_number}}: pre-auth expires soon. Return vehicle or call us.'),
  ('00000000-0000-0000-0004-000000000019', NULL, 'loyalty.points_earned',       'EMAIL', 'You earned {{points}} loyalty points', '<p>Hi {{first_name}}, you earned {{points}} points on {{ra_number}}. Total: {{loyalty_points}}.</p>'),
  ('00000000-0000-0000-0004-000000000020', NULL, 'loyalty.tier_upgrade',        'EMAIL', 'Congratulations — you''ve reached {{new_tier}}!', '<p>Hi {{first_name}}, you''ve been upgraded to {{new_tier}} status!</p>'),
  ('00000000-0000-0000-0004-000000000021', NULL, 'loyalty.tier_expiry_warning', 'EMAIL', 'Your loyalty tier expires soon', '<p>Hi {{first_name}}, your {{loyalty_tier}} status expires on {{tier_expiry_date}}.</p>'),
  ('00000000-0000-0000-0004-000000000022', NULL, 'account.kyc_approved',        'EMAIL', 'Identity verification approved', '<p>Hi {{first_name}}, your identity has been verified.</p>'),
  ('00000000-0000-0000-0004-000000000023', NULL, 'account.kyc_rejected',        'EMAIL', 'Identity verification — action required', '<p>Hi {{first_name}}, we could not verify your identity. Please contact support.</p>'),
  ('00000000-0000-0000-0004-000000000024', NULL, 'account.password_reset',      'EMAIL', 'Password reset request', '<p>Click <a href="{{reset_url}}">here</a> to reset your password. Expires in 1 hour.</p>'),
  ('00000000-0000-0000-0004-000000000025', NULL, 'account.dnr_flagged',         'EMAIL', 'Account status notice', '<p>Your account has been flagged. Contact {{support_email}} for details.</p>'),
  ('00000000-0000-0000-0004-000000000026', NULL, 'vehicle.overdue',             'EMAIL', 'Your rental is overdue — {{ra_number}}', '<p>Hi {{first_name}}, rental {{ra_number}} was due at {{return_datetime}}. Please return immediately.</p>'),
  ('00000000-0000-0000-0004-000000000027', NULL, 'vehicle.overdue',             'SMS',   NULL, 'OVERDUE: Rental {{ra_number}} due at {{return_time}}. Call {{branch_phone}} immediately.'),
  ('00000000-0000-0000-0004-000000000028', NULL, 'document.license_expiring',   'EMAIL', 'Your driver''s license expires soon', '<p>Hi {{first_name}}, your license expires on {{license_expiry}}. Update before your next rental.</p>'),
  ('00000000-0000-0000-0004-000000000029', NULL, 'fleet.recall_detected',       'EMAIL', 'Safety recall notice — vehicle {{unit_number}}', '<p>NHTSA recall ({{recall_campaign}}) detected for {{unit_number}} (VIN: {{vin}}).</p>'),
  ('00000000-0000-0000-0004-000000000030', NULL, 'extension.approved',          'EMAIL', 'Rental extension confirmed — {{ra_number}}', '<p>Hi {{first_name}}, rental {{ra_number}} extended to {{new_return_datetime}}.</p>')
ON CONFLICT (tenant_id, event_code, channel) DO NOTHING;
```

---

## 13. PgBouncer Config

```ini
; pgbouncer.ini — transaction mode; track_extra_parameters required for app.* GUCs

[databases]
rental_car = host=postgres port=5433 dbname=rental_car

[pgbouncer]
listen_addr          = *
listen_port          = 5432
auth_type            = scram-sha-256
auth_file            = /etc/pgbouncer/userlist.txt
pool_mode            = transaction
default_pool_size    = 20
min_pool_size        = 5
max_client_conn      = 500
reserve_pool_size    = 5
reserve_pool_timeout = 3
; track_extra_parameters keeps app.* GUCs sticky across transaction-mode pool reuse
track_extra_parameters = app.current_tenant_id,app.current_user_id,app.current_role,app.client_ip,app.session_id,app.request_id,app.app_version
server_idle_timeout  = 600
server_connect_timeout = 15
server_login_retry   = 15
query_timeout        = 30
query_wait_timeout   = 120
admin_users          = pgbouncer_admin
stats_users          = pgbouncer_stats
logfile              = /var/log/pgbouncer/pgbouncer.log
pidfile              = /var/run/pgbouncer/pgbouncer.pid
log_connections      = 0
log_disconnections   = 0
log_pooler_errors    = 1
client_tls_sslmode   = require
client_tls_key_file  = /etc/pgbouncer/server.key
client_tls_cert_file = /etc/pgbouncer/server.crt
server_tls_sslmode   = require
```

---

## 14. Test Queries

| constraint | test SQL | expected result |
|---|---|---|
| Exclusion (`no_overlapping_vehicle_blocks`) | Two INSERTs on same vehicle with overlapping `[2025-06-01,2025-06-03)` and `[2025-06-02,2025-06-04)` | Second INSERT: `ERROR 23P01 exclusion constraint "no_overlapping_vehicle_blocks" violated` |
| VIN uniqueness (`uq_vehicle_vin_tenant`) | Two INSERTs with same `vin='1HGCM82633A004352'` and same `tenant_id` | Second INSERT: `ERROR 23505 duplicate key value violates unique constraint "uq_vehicle_vin_tenant"` |
| Audit rejects UPDATE | `SET ROLE app_user; UPDATE audit.audit_events SET action='DELETE' WHERE event_id=$id;` | `ERROR 42501: permission denied for table audit_events` |
| Audit rejects DELETE | `SET ROLE app_user; DELETE FROM audit.audit_events WHERE tenant_id=$tenant;` | `ERROR 42501: permission denied for table audit_events` |
| RLS isolation | `SET app.current_tenant_id='<tenant_A>'; SELECT count(*) FROM public.reservations;` while tenant_B rows exist | Returns only tenant_A count; tenant_B rows invisible |
| RLS cross-tenant filter | `SET app.current_tenant_id='<tenant_A>'; SELECT * FROM public.customers WHERE tenant_id='<tenant_B>';` | 0 rows — no error, RLS silently filters |
| Reservation CHECK (`chk_return_after_pickup`) | INSERT with `pickup_datetime='2025-06-10 10:00'`, `return_datetime='2025-06-08 10:00'` | `ERROR 23514: violates check constraint "chk_return_after_pickup"` |
| Confirmation# uniqueness (`uq_confirmation_number`) | Two INSERTs with same `confirmation_number='RES-20250601-ABCDE'` | Second INSERT: `ERROR 23505 duplicate key "uq_confirmation_number"` |
| Soft-delete releases exclusion | `UPDATE vehicle_blocks SET deleted_at=now() WHERE block_id=$id;` then re-insert same window | Second INSERT succeeds — soft-deleted block excluded from `WHERE (deleted_at IS NULL)` predicate |
| Audit trigger diff capture | `UPDATE reservations SET status='CONFIRMED' WHERE reservation_id=$id;` then `SELECT changed_fields FROM audit.audit_events WHERE resource_id=$id ORDER BY event_time DESC LIMIT 1;` | Returns `{status}` — only changed field in array |
