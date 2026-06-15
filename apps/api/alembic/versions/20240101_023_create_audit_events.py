"""create audit.audit_events partitioned table with immutability REVOKE

Revision ID: 023_audit_events
Revises: 022_damage_claims
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table in audit schema)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '023_audit_events'
down_revision: str | None = '022_damage_claims'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE audit.audit_events (
          event_id       UUID        NOT NULL DEFAULT uuid_generate_v4(),
          tenant_id      UUID,
          event_time     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

          actor_user_id  UUID,
          actor_role     user_role,
          actor_ip       INET,
          actor_session  TEXT,

          action         audit_action NOT NULL,
          resource_type  TEXT        NOT NULL,
          resource_id    TEXT        NOT NULL,
          resource_tenant UUID,

          old_data       JSONB,
          new_data       JSONB,
          changed_fields TEXT[],

          request_id     TEXT,
          app_version    TEXT,

          PRIMARY KEY (event_id, event_time)
        ) PARTITION BY RANGE (event_time)
    """)

    # Immutability: revoke all mutation rights
    op.execute("REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM PUBLIC")
    op.execute("REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM app_service")
    op.execute("REVOKE UPDATE, DELETE, TRUNCATE ON audit.audit_events FROM app_user")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit.audit_events CASCADE")
