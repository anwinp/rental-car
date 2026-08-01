"""give app_user LOGIN so the application stops running as a superuser

Revision ID: 052_app_user_runtime
Revises: 051_complete_rls
Create Date: 2026-08-01

MT-01. The application connected as the database owner, which is a superuser,
and superusers bypass row-level security unconditionally — FORCE ROW LEVEL
SECURITY included. Every policy in this schema was therefore decorative.

migration 002 already created `app_user` (NOLOGIN, no BYPASSRLS). This grants it
LOGIN and the privileges it needs, so the runtime connection can drop to it.

Split of responsibilities after this migration:

    owner (rcm)  DDL, migrations, seeding. Superuser, bypasses RLS by design.
    app_user     every web request. No superuser, no BYPASSRLS, RLS applies.

The password comes from APP_DB_PASSWORD when set, so real deployments supply
their own; it falls back to a development default otherwise.

Phase: expand
Lock risk: none
Reversible: yes (revokes LOGIN; the role is retained)
"""
from __future__ import annotations

import os

from alembic import op

revision: str = '052_app_user_runtime'
down_revision: str | None = '051_complete_rls'
branch_labels = None
depends_on = None

_DEV_FALLBACK = "rcm_app_dev_password"


def _resolve_password() -> str:
    """The password for the runtime role, refusing to invent one in production.

    This used to fall back to a constant that is committed to this repository,
    with APP_DB_PASSWORD documented nowhere and set by no deploy script. The
    result was a login-capable role, holding full DML on every tenant's data,
    whose password was public — and which could not be rotated by changing an
    environment variable, because nothing read one.

    Failing the migration is the right outcome: a deploy that cannot set this
    should stop, not quietly install a known credential.
    """
    supplied = os.getenv("APP_DB_PASSWORD")
    if supplied:
        return supplied

    env = (os.getenv("ENV") or os.getenv("ENVIRONMENT") or "development").lower()
    if env in ("production", "prod", "staging"):
        raise RuntimeError(
            "APP_DB_PASSWORD must be set when running migrations in "
            f"{env}. The runtime role app_user owns read/write access to every "
            "tenant's data; it must not be created with the development "
            "fallback password, which is public in the repository."
        )
    return _DEV_FALLBACK


def upgrade() -> None:
    password = _resolve_password().replace("'", "''")

    op.execute(
        f"""
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            CREATE ROLE app_user LOGIN PASSWORD '{password}';
          ELSE
            ALTER ROLE app_user LOGIN PASSWORD '{password}';
          END IF;
        END $$;
        """
    )

    # Explicitly strip the two attributes that would silently defeat RLS.
    op.execute("ALTER ROLE app_user NOSUPERUSER")
    op.execute("ALTER ROLE app_user NOBYPASSRLS")

    op.execute("GRANT USAGE ON SCHEMA public TO app_user")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user")
    op.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user")

    # The audit schema is append-only for the application.
    op.execute("GRANT USAGE ON SCHEMA audit TO app_user")
    op.execute("GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA audit TO app_user")

    # Anything created by later migrations should be reachable without a re-grant.
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT USAGE, SELECT ON SEQUENCES TO app_user"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA audit "
        "GRANT INSERT, SELECT ON TABLES TO app_user"
    )


def downgrade() -> None:
    op.execute("ALTER ROLE app_user NOLOGIN")
