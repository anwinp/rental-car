"""create locations table with RLS

Revision ID: 005_locations
Revises: 004_tenants
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '005_locations'
down_revision: str | None = '004_tenants'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    op.execute("""
        CREATE INDEX idx_locations_tenant ON public.locations (tenant_id) WHERE deleted_at IS NULL
    """)

    # RLS for locations (tenant_id IS NOT NULL)
    op.execute("ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.locations FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.locations
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)



def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.locations CASCADE")
