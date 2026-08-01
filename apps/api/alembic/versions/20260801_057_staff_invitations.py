"""staff invitations and plan limits

Revision ID: 057_staff_invitations
Revises: 056_platform_admin
Create Date: 2026-08-01

Two gaps found reviewing the tenant lifecycle end to end.

1. A workspace could never gain a second user. The only code paths inserting
   into staff_users were registration and the platform console, so every
   self-registered tenant was permanently single-user — while the onboarding
   checklist told them to "invite your team", a step the software could not
   perform. Invitations close that.

2. subscription_tier was written at creation and read by nothing, so every
   workspace was unlimited. plan_limits gives the tier meaning.

Invitation tokens follow the same rules as email verification: only a SHA-256
hash is stored, they expire, and they are single-use.

Phase: expand
Lock risk: none (new tables)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '057_staff_invitations'
down_revision: str | None = '056_platform_admin'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS staff_invitations (
            invitation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id     UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            email         TEXT NOT NULL,
            role          user_role NOT NULL,
            first_name    TEXT NOT NULL DEFAULT '',
            last_name     TEXT NOT NULL DEFAULT '',
            token_hash    TEXT NOT NULL,
            invited_by    UUID,
            expires_at    TIMESTAMPTZ NOT NULL,
            accepted_at   TIMESTAMPTZ,
            revoked_at    TIMESTAMPTZ,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_invitation_token "
        "ON staff_invitations (token_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_staff_invitation_tenant "
        "ON staff_invitations (tenant_id)"
    )
    # One outstanding invitation per address per tenant; re-inviting supersedes.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_invitation_pending "
        "ON staff_invitations (tenant_id, lower(email)) "
        "WHERE accepted_at IS NULL AND revoked_at IS NULL"
    )

    # RLS: an invitation belongs to the workspace that issued it. Acceptance
    # looks the row up by token hash before any session exists, which is why
    # the lookup path adopts the tenant explicitly rather than relying on a
    # caller's context.
    op.execute("ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE staff_invitations FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON staff_invitations")
    op.execute(
        "CREATE POLICY tenant_isolation ON staff_invitations "
        "USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) "
        "WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)"
    )

    # ── Plan limits ──────────────────────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS plan_limits (
            tier            TEXT PRIMARY KEY,
            max_staff       INTEGER,
            max_vehicles    INTEGER,
            max_locations   INTEGER,
            display_name    TEXT NOT NULL,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # NULL means unlimited. Deliberately generous at the free tier: the limit
    # exists to make the tier mean something, not to obstruct evaluation.
    op.execute(
        """
        INSERT INTO plan_limits (tier, max_staff, max_vehicles, max_locations, display_name)
        VALUES
          ('STARTER',    5,   25,   2,    'Starter'),
          ('TRIAL',      5,   25,   2,    'Trial'),
          ('GROWTH',     25,  250,  10,   'Growth'),
          ('ENTERPRISE', NULL, NULL, NULL,'Enterprise')
        ON CONFLICT (tier) DO NOTHING
        """
    )

    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON staff_invitations TO app_user")
    op.execute("GRANT SELECT ON plan_limits TO app_user")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS staff_invitations")
    op.execute("DROP TABLE IF EXISTS plan_limits")
