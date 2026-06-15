"""create telematics_events partitioned table with pg_partman config

Revision ID: 025_telematics_events
Revises: 024_partman_audit_events
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '025_telematics_events'
down_revision: str | None = '024_partman_audit_events'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.telematics_events (
          event_id      UUID        NOT NULL DEFAULT uuid_generate_v4(),
          tenant_id     UUID        NOT NULL,
          vehicle_id    UUID        NOT NULL,
          device_id     TEXT        NOT NULL,
          event_type    TEXT        NOT NULL,
          occurred_at   TIMESTAMPTZ NOT NULL,
          lat           NUMERIC(9,6),
          lng           NUMERIC(9,6),
          speed_mph     NUMERIC(5,1),
          heading_deg   SMALLINT,
          odometer      INT,
          fuel_pct      SMALLINT,
          soc_pct       SMALLINT,
          payload       JSONB       NOT NULL DEFAULT '{}',
          PRIMARY KEY   (event_id, occurred_at)
        ) PARTITION BY RANGE (occurred_at)
    """)

    # telematics_events: monthly, 12-month retention, auto-drop expired
    op.execute("""
        SELECT partman.create_parent(
          p_parent_table         => 'public.telematics_events',
          p_control              => 'occurred_at',
          p_type                 => 'range',
          p_interval             => 'monthly',
          p_premake              => 2,
          p_retention            => '12 months',
          p_retention_keep_table => false
        )
    """)

    # RLS
    op.execute("ALTER TABLE public.telematics_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.telematics_events FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.telematics_events
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.telematics_events NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("""
        DELETE FROM partman.part_config WHERE parent_table = 'public.telematics_events'
    """)
    op.execute("DROP TABLE IF EXISTS public.telematics_events CASCADE")
