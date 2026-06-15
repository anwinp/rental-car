"""create reservation_versions table

Revision ID: 018_reservation_versions
Revises: 017_reservations
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '018_reservation_versions'
down_revision: str | None = '017_reservations'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
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
        )
    """)

    op.execute("""
        CREATE INDEX idx_resv_reservation ON public.reservation_versions (reservation_id, version_number DESC)
    """)

    # RLS
    op.execute("ALTER TABLE public.reservation_versions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.reservation_versions FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.reservation_versions
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.reservation_versions NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.reservation_versions CASCADE")
