"""create vehicle_blocks table with exclusion constraint and RLS

Revision ID: 010_vehicle_blocks
Revises: 009_vehicle_status_log
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '010_vehicle_blocks'
down_revision: str | None = '009_vehicle_status_log'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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

          CONSTRAINT no_overlapping_vehicle_blocks EXCLUDE USING gist (
            vehicle_id WITH =,
            tstzrange(start_time, end_time, '[)') WITH &&
          ) WHERE (deleted_at IS NULL)
        )
    """)

    op.execute("""
        CREATE INDEX idx_vb_vehicle_time ON public.vehicle_blocks
          USING gist (vehicle_id, tstzrange(start_time, end_time, '[)'))
          WHERE deleted_at IS NULL
    """)

    op.execute("""
        CREATE INDEX idx_vb_reservation ON public.vehicle_blocks (reservation_id) WHERE deleted_at IS NULL
    """)

    # RLS
    op.execute("ALTER TABLE public.vehicle_blocks ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.vehicle_blocks FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.vehicle_blocks
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)



def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.vehicle_blocks CASCADE")
