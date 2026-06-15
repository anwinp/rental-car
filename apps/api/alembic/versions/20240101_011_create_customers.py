"""create customers table with GIN index and RLS

Revision ID: 011_customers
Revises: 010_vehicle_blocks
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '011_customers'
down_revision: str | None = '010_vehicle_blocks'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    op.execute("""
        CREATE UNIQUE INDEX idx_customers_email_tenant ON public.customers (tenant_id, lower(email))
          WHERE deleted_at IS NULL AND anonymized_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_customers_license ON public.customers (license_number, license_country)
          WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_customers_loyalty ON public.customers (loyalty_number)
          WHERE loyalty_number IS NOT NULL AND deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_customers_phone ON public.customers (mobile_phone) WHERE deleted_at IS NULL
    """)

    # RLS
    op.execute("ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.customers FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.customers
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.customers NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.customers CASCADE")
