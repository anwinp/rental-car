"""give the platform operator an identity of its own

Revision ID: 073_platform_admins
Revises: 072_plan_tiers
Create Date: 2026-08-02

Migration 056 made "platform administrator" a boolean column on staff_users.
That was wrong, and it was wrong in a way that made the console unreachable.

staff_users.tenant_id is NOT NULL. So the operator of the SaaS had to be an
employee of one of its customers. The seeded admin lived inside test-rental-co
with a flag bolted on, which produced three separate problems:

  1. NOBODY COULD SIGN IN AT THE PLATFORM HOST. rcm-admin.ceez.ai carries no
     tenant slug, so no tenant resolves, so /auth/login rejects the request
     before it ever looks at a password. The platform console shipped with a
     sign-in form that could not succeed for any credential. The only way in
     was through a *customer's* hostname.

  2. DELETING A CUSTOMER COULD DELETE THE OPERATOR. Every destructive endpoint
     needed an is_self guard to stop the platform admin purging the workspace
     that held their own account. The guard is a symptom: the identity was
     stored in the thing it administers.

  3. THE BLAST RADIUS RAN BOTH WAYS. Anyone who could write a row in that one
     customer's staff_users table — or restore a backup of it, or exploit a
     single tenant-scoped write bug — was one UPDATE away from control of every
     other customer's data.

Platform identity now lives in its own table with no tenant_id, no role, and no
foreign key into tenant space. It cannot be granted by any tenant-facing
endpoint because it is not reachable from tenant tables at all.

RLS is deliberately NOT enabled here. Every other table is tenant data and RLS
is the boundary; this table is the opposite — rows that belong to no tenant and
must stay readable when no tenant is bound. Access is controlled by grant, and
the only queries that touch it are the platform auth path.

The existing admin is carried across with their password hash intact, so the
password in use today keeps working at the new host. Then the flag is dropped:
leaving it would leave the escalation path open while looking fixed.

Phase: contract — drops staff_users.is_platform_admin. Deploy the API image
that reads platform_admins in the same release; the old code 500s without the
column, the new code 500s without the table.
Lock risk: low — brief ACCESS EXCLUSIVE on staff_users for the column drop
Reversible: yes, with the caveat noted in downgrade()
"""
from __future__ import annotations

from alembic import op

revision: str = '073_platform_admins'
down_revision: str | None = '072_plan_tiers'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_admins (
            admin_id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            email               text        NOT NULL,
            password_hash       text        NOT NULL,
            full_name           text        NOT NULL DEFAULT '',
            is_active           boolean     NOT NULL DEFAULT true,

            -- Mirrors the staff_users vocabulary so the auth service can treat
            -- both with one code path rather than two that drift.
            is_mfa_enabled      boolean     NOT NULL DEFAULT false,
            mfa_secret          text,
            mfa_backup_codes    text[],
            failed_login_count  integer     NOT NULL DEFAULT 0,
            locked_until        timestamptz,
            token_epoch         integer     NOT NULL DEFAULT 0,

            last_login_at       timestamptz,
            password_changed_at timestamptz,
            created_at          timestamptz NOT NULL DEFAULT now(),
            updated_at          timestamptz NOT NULL DEFAULT now(),
            deleted_at          timestamptz
        )
        """
    )
    # One live account per address. Case-insensitive because sign-in is, and a
    # second row differing only in case would be an account nobody could reach
    # deterministically.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_admins_email "
        "ON platform_admins (lower(email)) WHERE deleted_at IS NULL"
    )

    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admins TO app_user"
    )

    # Carry the incumbent across, hash and all, so today's password still works.
    # first_name/last_name collapse to one display field: a platform operator has
    # no org chart to sit in.
    op.execute(
        """
        INSERT INTO platform_admins (
            email, password_hash, full_name, is_active,
            is_mfa_enabled, mfa_secret, mfa_backup_codes, last_login_at
        )
        SELECT s.email,
               s.password_hash,
               btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
               s.is_active,
               s.is_mfa_enabled,
               s.mfa_secret,
               s.mfa_backup_codes,
               s.last_login_at
          FROM staff_users s
         WHERE s.is_platform_admin
           AND s.deleted_at IS NULL
        ON CONFLICT DO NOTHING
        """
    )

    op.execute("DROP INDEX IF EXISTS ix_staff_users_platform_admin")
    op.execute("ALTER TABLE staff_users DROP COLUMN IF EXISTS is_platform_admin")


def downgrade() -> None:
    # Restores the column and re-flags any staff_user whose address matches a
    # platform admin. If an operator was created here and never existed as a
    # tenant employee — which is the normal case from now on — there is no row
    # to flag and that account does not come back. Recording the loss rather
    # than inventing a tenant to put them in.
    op.execute(
        "ALTER TABLE staff_users "
        "ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        """
        UPDATE staff_users s
           SET is_platform_admin = true
          FROM platform_admins p
         WHERE lower(s.email) = lower(p.email)
           AND p.deleted_at IS NULL
           AND s.deleted_at IS NULL
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_staff_users_platform_admin "
        "ON staff_users (user_id) WHERE is_platform_admin"
    )
    op.execute("DROP TABLE IF EXISTS platform_admins")
