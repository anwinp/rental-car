"""create extras_catalog table

Revision ID: 014_extras_catalog
Revises: 013_rate_schedule_items
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '014_extras_catalog'
down_revision: str | None = '013_rate_schedule_items'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.extras_catalog (
          extra_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id     UUID REFERENCES public.tenants (tenant_id),
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
        )
    """)

    # RLS allowing NULL tenant_id (system reference rows visible to all tenants)
    op.execute("ALTER TABLE public.extras_catalog ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.extras_catalog FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.extras_catalog
          USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.extras_catalog NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.extras_catalog CASCADE")
