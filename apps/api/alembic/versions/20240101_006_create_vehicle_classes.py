"""create vehicle_classes table

Revision ID: 006_vehicle_classes
Revises: 005_locations
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '006_vehicle_classes'
down_revision: str | None = '005_locations'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.vehicle_classes (
          class_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id        UUID REFERENCES public.tenants (tenant_id),
          sipp_prefix      CHAR(1) NOT NULL,
          name             TEXT    NOT NULL,
          description      TEXT,
          sort_order       INT     NOT NULL DEFAULT 0,
          is_active        BOOLEAN NOT NULL DEFAULT true,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

          CONSTRAINT uq_class_tenant_sipp UNIQUE (tenant_id, sipp_prefix)
        )
    """)

    op.execute("""
        CREATE INDEX idx_vehicle_classes_tenant ON public.vehicle_classes (tenant_id) WHERE is_active = true
    """)

    # RLS allowing NULL tenant_id (system-wide reference rows visible to all tenants)
    op.execute("ALTER TABLE public.vehicle_classes ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.vehicle_classes FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.vehicle_classes
          USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)



def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.vehicle_classes CASCADE")
