"""create rate_codes table with RLS

Revision ID: 012_rate_codes
Revises: 011_customers
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '012_rate_codes'
down_revision: str | None = '011_customers'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    # RLS
    op.execute("ALTER TABLE public.rate_codes ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.rate_codes FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.rate_codes
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.rate_codes NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.rate_codes CASCADE")
