"""email verification tokens for self-service signups

Revision ID: 054_email_verifications
Revises: 053_shared_catalogues
Create Date: 2026-08-01

External sign-up creates a tenant and sends mail from an unauthenticated
endpoint, so the address must be proven before the workspace becomes usable.
Tenants now start PENDING_VERIFICATION and activate on confirmation.

Only a SHA-256 hash of the token is stored. The token itself exists in the
email and nowhere else, so a database leak does not hand over the ability to
activate arbitrary workspaces.

No RLS: a tenant that cannot log in yet has no session with which to read this,
and the lookup happens by token hash before any tenant context exists.

Phase: expand
Lock risk: none (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '054_email_verifications'
down_revision: str | None = '053_shared_catalogues'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS email_verifications (
            verification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id       UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            user_id         UUID NOT NULL,
            email           TEXT NOT NULL,
            token_hash      TEXT NOT NULL,
            expires_at      TIMESTAMPTZ NOT NULL,
            consumed_at     TIMESTAMPTZ,
            sent_count      INTEGER NOT NULL DEFAULT 1,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # Verification looks the row up by hash, so this index is the hot path.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_email_verification_token "
        "ON email_verifications (token_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_email_verification_tenant "
        "ON email_verifications (tenant_id)"
    )
    # Resend needs the newest outstanding token for an address.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_email_verification_email "
        "ON email_verifications (lower(email)) WHERE consumed_at IS NULL"
    )

    # Track confirmation on the user as well, so a second admin invited later
    # can be verified independently of the workspace itself.
    op.execute("ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ")

    # Existing tenants predate verification and are already trusted; only new
    # signups start unverified.
    op.execute(
        "UPDATE staff_users SET email_verified_at = now() WHERE email_verified_at IS NULL"
    )

    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON email_verifications TO app_user")


def downgrade() -> None:
    op.execute("ALTER TABLE staff_users DROP COLUMN IF EXISTS email_verified_at")
    op.execute("DROP TABLE IF EXISTS email_verifications")
