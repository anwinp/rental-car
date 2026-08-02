"""machine credentials, so an integration does not need somebody's password

Revision ID: 082_api_keys
Revises: 081_generated_reports
Create Date: 2026-08-02

There was no machine authentication anywhere in this system. Every route
authenticated a human through a session cookie, and the API_PARTNER role
existed in the user_role enum while granting nothing at all. "API access" was
on the price list regardless.

The alternative people reach for without this is worse than no API: a shared
staff account with a password in somebody's script, which cannot be scoped,
cannot be revoked without locking a person out, and shows up in the audit trail
as a human doing things at 3am.

Design notes worth keeping:

  * **The key is stored as a SHA-256 hash, never in the clear.** A leaked
    database dump must not be a working set of credentials. SHA-256 rather than
    bcrypt deliberately: this is verified on every request, and the secret is 32
    bytes of CSPRNG output rather than a human-chosen password, so there is no
    dictionary to slow down — only length to rely on, and 256 bits is enough.

  * **A short prefix is stored in the clear** purely so a person can tell two
    keys apart in a list. It is not enough to reconstruct anything.

  * **Scopes are on the row, not implied by a role.** A key is for one job and
    should be able to do that job and nothing else.

  * **expires_at is nullable but the UI defaults it.** A credential with no end
    date is one nobody ever revisits.

Phase: expand
Lock risk: none — new table
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '082_api_keys'
down_revision: str | None = '081_generated_reports'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS api_keys (
            key_id      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id   uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,

            -- What a human calls it. "Booking widget", "Ops dashboard".
            label       text NOT NULL,

            -- SHA-256 of the full key. The key itself is shown once, at
            -- creation, and never again by any endpoint.
            key_hash    text NOT NULL,
            -- First few characters, in the clear, so two keys are
            -- distinguishable in a list. Not enough to reconstruct anything.
            key_prefix  text NOT NULL,

            scopes      text[] NOT NULL DEFAULT ARRAY['read']::text[],

            created_by  uuid,
            created_at  timestamptz NOT NULL DEFAULT now(),
            expires_at  timestamptz,
            revoked_at  timestamptz,
            -- So a customer can spot a key that is still live and should not
            -- be, which is the question actually asked during a review.
            last_used_at timestamptz,
            last_used_ip text
        )
        """
    )
    # The lookup is by hash on every authenticated request, so it must be an
    # index, and unique: two rows sharing a hash would be the same credential.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_api_keys_hash ON api_keys (key_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_api_keys_tenant "
        "ON api_keys (tenant_id, created_at DESC)"
    )

    # No RLS, deliberately, and this is the one place it is right to say so.
    # The key is resolved BEFORE any tenant is known — resolving it is what
    # establishes the tenant — so a policy keyed on app.current_tenant_id would
    # have to pass before it could be set. Every read of this table either
    # names a tenant explicitly or is the authentication lookup itself.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO app_user")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS api_keys")
