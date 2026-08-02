"""somewhere to keep the platform's own Stripe credentials

Revision ID: 077_billing_config
Revises: 076_plan_features
Create Date: 2026-08-02

Deliberately separate from the Stripe configuration that already exists.
settings.stripe_secret_key is each rental company's gateway, charging their
renters' cards. This is Ceez charging the rental companies. Same vendor, two
accounts, two sets of keys, two sets of webhooks — conflating them would mean a
tenant's refund logic and the platform's subscription logic sharing a
credential, and a mistake in either reaching the other's money.

Secrets are stored encrypted (see core/secrets_box.py) and never returned. The
columns hold ciphertext; the *_hint columns hold the last four characters, which
is all a human needs to confirm they pasted the right key and all anyone else
should ever get.

Single row, enforced by a CHECK rather than by convention. A second row would
be a second configuration that some code path might pick instead, silently.

Phase: expand
Lock risk: none — new table
Reversible: yes, and destructive on the way down: the ciphertext is dropped.
"""
from __future__ import annotations

from alembic import op

revision: str = '077_billing_config'
down_revision: str | None = '076_plan_features'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_billing_config (
            id                     integer PRIMARY KEY DEFAULT 1,

            -- Not a secret: it ships to browsers by design. Stored plainly so
            -- nobody is tempted to decrypt something on a public path.
            publishable_key        text,

            -- Ciphertext. Never selected into a response.
            secret_key_enc         text,
            secret_key_hint        text,
            webhook_secret_enc     text,
            webhook_secret_hint    text,

            -- Derived from the key prefix, not typed by hand: sk_test_ vs
            -- sk_live_. Shown prominently so nobody demonstrates a flow in
            -- test mode and believes money moved.
            mode                   text NOT NULL DEFAULT 'TEST',

            -- Off until deliberately switched on, so pasting a key does not
            -- immediately start charging anyone.
            is_enabled             boolean NOT NULL DEFAULT false,

            -- Result of the last live check against Stripe, so the console can
            -- say "these credentials worked at 14:02" rather than "saved".
            last_verified_at       timestamptz,
            last_verify_error      text,

            updated_at             timestamptz NOT NULL DEFAULT now(),
            updated_by             uuid,

            CONSTRAINT platform_billing_config_singleton CHECK (id = 1),
            CONSTRAINT platform_billing_config_mode CHECK (mode IN ('TEST', 'LIVE'))
        )
        """
    )
    op.execute(
        "INSERT INTO platform_billing_config (id) VALUES (1) ON CONFLICT DO NOTHING"
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON platform_billing_config TO app_user"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS platform_billing_config")
