"""create vehicle_status_log table

Revision ID: 009_vehicle_status_log
Revises: 008_vehicles
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '009_vehicle_status_log'
down_revision: str | None = '008_vehicles'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    op.execute("""
        CREATE INDEX idx_vsl_vehicle ON public.vehicle_status_log (vehicle_id, changed_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_vsl_tenant ON public.vehicle_status_log (tenant_id, changed_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.vehicle_status_log CASCADE")
