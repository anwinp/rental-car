"""scope invitations and verifications without breaking token redemption

Revision ID: 064_invite_verify_rls
Revises: 063_rbac_vocabulary
Create Date: 2026-08-02

Migration 058 took RLS off staff_invitations, and email_verifications never had
it, because both are read before any session exists: someone accepting an
invitation or confirming an address has no tenant bound, so a
`tenant_id = current_tenant` policy matched nothing and every valid token
reported "no longer valid".

That reasoning was right about the constraint and wrong about the remedy.
Removing the policy entirely also exposes the tables to sessions that DO have a
tenant bound. An exhaustive separation audit found these as the only two read
leaks out of 31 tenant-scoped tables — a signed-in workspace could read every
other workspace's pending invitations (address, role, token hash) and email
verifications:

    chris@coastlinecarhire.example.com   COUNTER_AGENT    hash=cd30c053fd...
    anwinp@yahoo.com                     (verification)   hash=8eb49a6c27...

That is a customer list and a hiring signal, readable by any tenant.

The fix is the policy shape already used for `tenants` in migration 062:
permit when nothing is bound, scope to your own rows when something is. Token
redemption runs unbound and still works; an authenticated request always has a
tenant bound by the time it reaches these tables, so it sees only its own.

The unbound paths remain protected by what they are rather than by RLS: a
lookup by SHA-256 token hash, where the token exists only in the recipient's
inbox. That has not changed — this migration removes the *additional* exposure
to bound sessions, which nothing needed.

Phase: contract
Lock risk: low
Reversible: yes (and restores the leak, which is why it should not be)
"""
from __future__ import annotations

from alembic import op

revision: str = '064_invite_verify_rls'
down_revision: str | None = '063_rbac_vocabulary'
branch_labels = None
depends_on = None

_CURRENT = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"
_UNBOUND = f"({_CURRENT} IS NULL)"

TABLES = ("staff_invitations", "email_verifications")


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_or_unbound ON {table}")
        op.execute(
            f"CREATE POLICY tenant_or_unbound ON {table} "
            f"USING ({_UNBOUND} OR tenant_id = {_CURRENT}) "
            f"WITH CHECK ({_UNBOUND} OR tenant_id = {_CURRENT})"
        )

    # The archive schema holds retired copies of customers, payments,
    # reservations, rental agreements and damage claims — the same PII as the
    # live tables, and none of it had RLS. It is safe today only because
    # app_user has no USAGE on the schema, so the audit could not even read it.
    #
    # That is one GRANT away from being wrong, and the grant is exactly what
    # anyone would add to build an "view archived rentals" feature. Applying the
    # policy now means the protection is already in place if that day comes;
    # the archival job runs as the owner and is unaffected.
    op.execute(
        """
        DO $$
        DECLARE t record;
        BEGIN
            FOR t IN
                SELECT c.oid::regclass AS rel
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'archive' AND c.relkind = 'r'
                  AND EXISTS (SELECT 1 FROM pg_attribute a
                               WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                                 AND NOT a.attisdropped)
            LOOP
                PERFORM public.apply_tenant_rls(t.rel);
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_or_unbound ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
