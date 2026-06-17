"""create schemas and roles

Revision ID: 002_schemas_roles
Revises: 001_extensions
Create Date: 2024-01-01

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '002_schemas_roles'
down_revision: str | None = '001_extensions'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS audit")
    op.execute("CREATE SCHEMA IF NOT EXISTS archive")

    op.execute("REVOKE CREATE ON SCHEMA audit   FROM PUBLIC")
    op.execute("REVOKE CREATE ON SCHEMA archive FROM PUBLIC")

    op.execute("""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_service') THEN
            CREATE ROLE app_service NOLOGIN;
          END IF;
        END
        $$
    """)

    op.execute("""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            CREATE ROLE app_user NOLOGIN;
          END IF;
        END
        $$
    """)

    op.execute("GRANT USAGE ON SCHEMA public  TO app_user, app_service")
    op.execute("GRANT USAGE ON SCHEMA audit   TO app_service")
    op.execute("GRANT USAGE ON SCHEMA archive TO app_service")

    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user")
    op.execute("GRANT INSERT                          ON ALL TABLES IN SCHEMA audit  TO app_service")
    op.execute("ALTER ROLE app_service BYPASSRLS")

    op.execute("""
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user
    """)


def downgrade() -> None:
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user")
    op.execute("REVOKE ALL ON ALL TABLES IN SCHEMA audit  FROM app_service")
    op.execute("REVOKE USAGE ON SCHEMA public  FROM app_user, app_service")
    op.execute("REVOKE USAGE ON SCHEMA audit   FROM app_service")
    op.execute("REVOKE USAGE ON SCHEMA archive FROM app_service")
    op.execute("DROP SCHEMA IF EXISTS archive CASCADE")
    op.execute("DROP SCHEMA IF EXISTS audit   CASCADE")
