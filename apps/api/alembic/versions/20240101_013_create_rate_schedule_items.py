"""create rate_schedule_items table

Revision ID: 013_rate_schedule_items
Revises: 012_rate_codes
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '013_rate_schedule_items'
down_revision: str | None = '012_rate_codes'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    op.execute("""
        CREATE INDEX idx_rsi_rate_code ON public.rate_schedule_items (rate_code_id, vehicle_class_id)
    """)

    # RLS
    op.execute("ALTER TABLE public.rate_schedule_items ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.rate_schedule_items FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.rate_schedule_items
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)



def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.rate_schedule_items CASCADE")
