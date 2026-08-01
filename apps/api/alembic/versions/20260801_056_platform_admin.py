"""platform administrator flag

Revision ID: 056_platform_admin
Revises: 055_pending_verification
Create Date: 2026-08-01

Managing tenants is a cross-tenant power and must not be reachable from any
tenant-level role.

Every self-registered workspace gets a SYSTEM_ADMIN as its first user, and a
workspace can promote its own users to SUPER_ADMIN. If tenant administration
were gated on either of those roles, any customer could list, suspend or delete
every other customer — so this is a separate flag that no tenant-facing endpoint
can set. It is granted deliberately, here or by a database operator.

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

import os

from alembic import op

revision: str = '056_platform_admin'
down_revision: str | None = '055_pending_verification'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE staff_users "
        "ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false"
    )
    # Partial index: the set of platform admins is tiny and looked up on every
    # platform request.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_staff_users_platform_admin "
        "ON staff_users (user_id) WHERE is_platform_admin"
    )

    # Seed the first platform admin so the console is reachable. Override with
    # PLATFORM_ADMIN_EMAIL at migration time; defaults to the development admin.
    email = os.getenv("PLATFORM_ADMIN_EMAIL", "admin@test.com").replace("'", "''")
    op.execute(
        f"""
        UPDATE staff_users
           SET is_platform_admin = true
         WHERE lower(email) = lower('{email}')
           AND tenant_id = '00000000-0000-0000-0000-000000000001'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_staff_users_platform_admin")
    op.execute("ALTER TABLE staff_users DROP COLUMN IF EXISTS is_platform_admin")
