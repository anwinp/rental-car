"""allow PENDING_VERIFICATION as a tenant status

Revision ID: 055_pending_verification
Revises: 054_email_verifications
Create Date: 2026-08-01

Self-service signups now start unverified, but tenants_status_check only
permitted ACTIVE / SUSPENDED / CANCELLED / TRIAL, so registration failed at the
insert. Adds the new state to the constraint.

The login path already refuses every status other than ACTIVE and TRIAL, so a
workspace in this state cannot be signed into.

Phase: expand
Lock risk: low (constraint revalidation on a small table)
Reversible: yes, provided no tenant is currently in the new state
"""
from __future__ import annotations

from alembic import op

revision: str = '055_pending_verification'
down_revision: str | None = '054_email_verifications'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check")
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_status_check "
        "CHECK (status = ANY (ARRAY["
        "'ACTIVE'::text, 'SUSPENDED'::text, 'CANCELLED'::text, "
        "'TRIAL'::text, 'PENDING_VERIFICATION'::text]))"
    )


def downgrade() -> None:
    # Park any unverified tenants somewhere the old constraint accepts, rather
    # than failing the downgrade outright.
    op.execute(
        "UPDATE tenants SET status = 'SUSPENDED' WHERE status = 'PENDING_VERIFICATION'"
    )
    op.execute("ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check")
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_status_check "
        "CHECK (status = ANY (ARRAY["
        "'ACTIVE'::text, 'SUSPENDED'::text, 'CANCELLED'::text, 'TRIAL'::text]))"
    )
