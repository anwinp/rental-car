"""configure pg_partman for audit.audit_events

Revision ID: 024_partman_audit_events
Revises: 023_audit_events
Create Date: 2024-01-01

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '024_partman_audit_events'
down_revision: str | None = '023_audit_events'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # audit.audit_events: monthly, premake 3 future months
    op.execute("""
        SELECT partman.create_parent(
          p_parent_table    => 'audit.audit_events',
          p_control         => 'event_time',
          p_type            => 'range',
          p_interval        => '1 month',
          p_premake         => 3,
          p_start_partition => '2025-01-01'
        )
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM partman.part_config WHERE parent_table = 'audit.audit_events'
    """)
    op.execute("""
        DELETE FROM partman.part_config_sub WHERE sub_parent = 'audit.audit_events'
    """)
