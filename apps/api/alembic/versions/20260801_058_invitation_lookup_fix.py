"""take RLS off staff_invitations so a token can be redeemed

Revision ID: 058_invitation_lookup
Revises: 057_staff_invitations
Create Date: 2026-08-01

Migration 057 put row-level security on staff_invitations. That breaks the only
flow the table exists for: accepting an invitation happens BEFORE the invitee
has any session, so there is no tenant bound to the connection and the policy
matches nothing — every valid token reported "no longer valid".

email_verifications was deliberately left without RLS for the same reason; this
makes the two consistent.

Access here is gated by an unguessable secret, not by tenant: the row is found
by SHA-256 token hash, and the token exists only in the recipient's email. Every
tenant-facing query on this table (list, revoke) filters by tenant_id
explicitly, so listing still cannot cross the boundary.

Phase: contract
Lock risk: low
Reversible: yes (and re-breaks acceptance, which is why it should not be)
"""
from __future__ import annotations

from alembic import op

revision: str = '058_invitation_lookup'
down_revision: str | None = '057_staff_invitations'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON staff_invitations")
    op.execute("ALTER TABLE staff_invitations NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE staff_invitations DISABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE staff_invitations FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON staff_invitations "
        "USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) "
        "WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)"
    )
