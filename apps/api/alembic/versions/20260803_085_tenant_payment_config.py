"""per-tenant merchant configuration

Revision ID: 085_tenant_payment_config
Revises: 084_corporate_invoices
Create Date: 2026-08-03

Where a tenant's rental income goes. Until now there was nowhere to say, so it
went to ours: the gateway factory resolved a provider *name* and the client used
the platform's key.

Two ways in, per PAYMENTS_STRATEGY.md §4, and the table holds both:

  * **managed** — the tenant completes provider-hosted onboarding and we keep
    only an account id. No secret of theirs is ever stored. `connected_account_id`.
  * **credentials** — the tenant supplies keys for a processor they already
    have. Ciphertext in `secrets_enc`, via secrets_box.

`secrets_enc` is jsonb rather than a column per field because the fields differ
per provider — Adyen needs a merchant account and an HMAC key, Tyro needs
terminal ids, and a schema that enumerated them would need a migration per
provider. The registry names the keys; this stores them.

**is_live is not is_configured.** A tenant can save a configuration that has
never successfully talked to their processor. Going live is a separate,
deliberate act gated on `verified_at`, so that pasting a key does not silently
begin taking real money against credentials nobody has exercised.

Phase: expand
Lock risk: none — new table
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '085_tenant_payment_config'
down_revision: str | None = '084_corporate_invoices'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS tenant_payment_config (
            tenant_id       uuid PRIMARY KEY
                            REFERENCES tenants(tenant_id) ON DELETE CASCADE,

            -- Registry key: 'stripe', 'adyen', 'tyro'. Not an enum — adding a
            -- provider should be a registry entry and an adapter, not a
            -- migration.
            provider        text NOT NULL,

            -- How the tenant got here. Determines which columns below matter.
            onboarding      text NOT NULL DEFAULT 'credentials',

            -- The connected account a charge lands on, for managed onboarding.
            -- Null under 'credentials': the keys themselves say whose account
            -- it is.
            connected_account_id text,

            -- Ciphertext, keyed by the registry's field names. Never selected
            -- into a response — the API returns hints, held separately.
            secrets_enc     jsonb NOT NULL DEFAULT '{}'::jsonb,
            secret_hints    jsonb NOT NULL DEFAULT '{}'::jsonb,

            -- Non-secret settings that still vary per provider: merchant
            -- account name, live URL prefix, terminal id.
            settings        jsonb NOT NULL DEFAULT '{}'::jsonb,

            -- TEST or LIVE. Derived from the credentials where the provider
            -- makes that visible (sk_test_ vs sk_live_), so it cannot disagree
            -- with what is actually configured.
            mode            text NOT NULL DEFAULT 'TEST',

            -- Off until a verification has succeeded. See the note above: a
            -- saved config and a working one are different things.
            is_live         boolean NOT NULL DEFAULT false,
            verified_at     timestamptz,
            verify_error    text,

            -- Deposit policy lives with the tenant, not the gateway: whether a
            -- deposit is taken at all, how much, when, and whether it rides on
            -- the rental authorisation or its own. Defaults are "no deposit",
            -- because taking one is a decision.
            deposit_policy  jsonb NOT NULL DEFAULT '{}'::jsonb,

            created_at      timestamptz NOT NULL DEFAULT now(),
            updated_at      timestamptz NOT NULL DEFAULT now(),
            updated_by      uuid,

            CONSTRAINT tenant_payment_config_mode
                CHECK (mode IN ('TEST', 'LIVE')),
            CONSTRAINT tenant_payment_config_onboarding
                CHECK (onboarding IN ('managed', 'credentials')),
            -- Cannot be live without having verified. The gate is in the
            -- database as well as the handler, because "is this allowed to
            -- charge real money" should not depend on one code path being
            -- correct.
            CONSTRAINT tenant_payment_config_live_needs_verify
                CHECK (is_live = false OR verified_at IS NOT NULL)
        )
        """
    )

    op.execute("ALTER TABLE tenant_payment_config ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_payment_config FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON tenant_payment_config "
        "USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid) "
        "WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)"
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_payment_config TO app_user"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tenant_payment_config")
