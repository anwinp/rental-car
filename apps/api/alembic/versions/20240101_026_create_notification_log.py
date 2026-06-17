"""create notification_log partitioned table with pg_partman config

Revision ID: 026_notification_log
Revises: 025_telematics_events
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '026_notification_log'
down_revision: str | None = '025_telematics_events'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.notification_log (
          log_id        UUID        NOT NULL DEFAULT uuid_generate_v4(),
          tenant_id     UUID        NOT NULL,
          customer_id   UUID,
          staff_user_id UUID,
          event_code    TEXT        NOT NULL,
          channel       TEXT        NOT NULL CHECK (channel IN ('EMAIL','SMS','PUSH')),
          recipient     TEXT        NOT NULL,
          subject       TEXT,
          body_hash     TEXT,
          status        TEXT        NOT NULL DEFAULT 'QUEUED'
                          CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','BOUNCED')),
          gateway_msg_id TEXT,
          sent_at       TIMESTAMPTZ,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY   (log_id, created_at)
        ) PARTITION BY RANGE (created_at)
    """)

    # notification_log: monthly partitioning with 12-month retention
    op.execute("""
        SELECT partman.create_parent(
          p_parent_table => 'public.notification_log',
          p_control      => 'created_at',
          p_interval     => '1 month',
          p_premake      => 2
        )
    """)
    op.execute("""
        UPDATE partman.part_config
        SET retention = '12 months', retention_keep_table = false
        WHERE parent_table = 'public.notification_log'
    """)

    # RLS
    op.execute("ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.notification_log FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.notification_log
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)



def downgrade() -> None:
    op.execute("""
        DELETE FROM partman.part_config WHERE parent_table = 'public.notification_log'
    """)
    op.execute("DROP TABLE IF EXISTS public.notification_log CASCADE")
