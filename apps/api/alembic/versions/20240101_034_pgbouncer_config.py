"""PgBouncer config validation marker

Revision ID: 034_pgbouncer_config
Revises: 033_seed_reference_data
Create Date: 2024-01-01

Phase: expand
Lock risk: low (no DDL; validation marker only)
Reversible: yes

Note: pgbouncer.ini is managed externally (infrastructure/pgbouncer.ini).
This migration serves as a validation marker in the Alembic chain to confirm
all database schema migrations have been applied before the application boots.

PgBouncer settings required for app.* GUC sticky parameters in transaction mode:
  pool_mode = transaction
  track_extra_parameters = app.current_tenant_id,app.current_user_id,app.current_role,
                           app.client_ip,app.session_id,app.request_id,app.app_version
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '034_pgbouncer_config'
down_revision: str | None = '033_seed_reference_data'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # Validation marker: confirm schemas and roles exist
    op.execute("""
        DO $$
        BEGIN
          -- Verify audit schema exists
          IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'audit') THEN
            RAISE EXCEPTION 'audit schema missing — run preceding migrations first';
          END IF;

          -- Verify archive schema exists
          IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'archive') THEN
            RAISE EXCEPTION 'archive schema missing — run preceding migrations first';
          END IF;

          -- Verify app_user role exists
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            RAISE EXCEPTION 'app_user role missing — run preceding migrations first';
          END IF;

          -- Verify app_service role exists
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
            RAISE EXCEPTION 'app_service role missing — run preceding migrations first';
          END IF;

          RAISE NOTICE 'PgBouncer config marker: all schema prerequisites confirmed. '
                       'Ensure pgbouncer.ini is configured with: '
                       'pool_mode=transaction and track_extra_parameters for app.* GUCs.';
        END
        $$
    """)


def downgrade() -> None:
    pass
