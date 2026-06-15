"""create rental_agreements table with RLS

Revision ID: 019_rental_agreements
Revises: 018_reservation_versions
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '019_rental_agreements'
down_revision: str | None = '018_reservation_versions'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    op.execute("""
        CREATE INDEX idx_ra_reservation ON public.rental_agreements (reservation_id)
    """)
    op.execute("""
        CREATE INDEX idx_ra_customer ON public.rental_agreements (customer_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_ra_vehicle ON public.rental_agreements (vehicle_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_ra_status ON public.rental_agreements (tenant_id, status)
          WHERE status IN ('ACTIVE','EXTENDED')
    """)

    # RLS
    op.execute("ALTER TABLE public.rental_agreements ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.rental_agreements FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.rental_agreements
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.rental_agreements NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.rental_agreements CASCADE")
