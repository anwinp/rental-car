"""the corporate accounts everything else was already built for

Revision ID: 083_corporate_accounts
Revises: 082_api_keys
Create Date: 2026-08-02

The corporate domain was a router holding a health endpoint and nothing else,
while "corporate accounts" sat on the price list. What made that odd is how
much of the machinery already existed:

  * rate_codes carries cdp_code AND corporate_account_id
  * reservations carries corporate_account_id AND cdp_code
  * the quote engine already selects a rate by CDP code and falls back to the
    public rate when it does not match
  * CORPORATE_BOOKER has been in the user_role enum all along

So negotiated corporate rates were fully wired into pricing. The only thing
missing was the account itself — the row those foreign keys were pointing at.
This adds it, and the rest lights up.

That ordering matters for what this migration does NOT do: it does not touch
rate selection. The plan for this feature warned that a bolt-on rate mechanism
would quietly quote corporate customers the public price, and the reason that
risk does not apply is that the mechanism was already in the right place.

Phase: expand
Lock risk: low — two new tables and two FK additions to existing columns
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '083_corporate_accounts'
down_revision: str | None = '082_api_keys'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS corporate_accounts (
            corporate_account_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id     uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,

            name          text NOT NULL,
            -- The code a booker quotes to get their negotiated rate. This is
            -- the join to rate_codes.cdp_code, which the pricing engine has
            -- always read — an account without one gets public rates, which is
            -- a legitimate state for an account that only wants invoicing.
            cdp_code      text,

            contact_name  text,
            contact_email text,
            contact_phone text,
            billing_address jsonb NOT NULL DEFAULT '{}'::jsonb,

            -- Invoicing terms. credit_limit is in minor units for the same
            -- reason every other amount here is: floats do not belong near
            -- money.
            payment_terms_days integer NOT NULL DEFAULT 30,
            credit_limit_cents bigint,
            currency      text NOT NULL DEFAULT 'USD',

            -- Whether the counter may close a rental to this account instead of
            -- taking a card. Off by default: extending credit is a decision,
            -- not a default.
            bill_to_account boolean NOT NULL DEFAULT false,

            status        text NOT NULL DEFAULT 'ACTIVE',
            notes         text,
            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now(),
            deleted_at    timestamptz,

            CONSTRAINT corporate_accounts_status_check
                CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
            CONSTRAINT corporate_accounts_terms_check
                CHECK (payment_terms_days BETWEEN 0 AND 180),
            CONSTRAINT corporate_accounts_credit_check
                CHECK (credit_limit_cents IS NULL OR credit_limit_cents >= 0)
        )
        """
    )
    # One live account per CDP code within a workspace. Two accounts sharing a
    # code would make "which negotiated rate applies" ambiguous at the counter.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_corporate_accounts_cdp "
        "ON corporate_accounts (tenant_id, upper(cdp_code)) "
        " WHERE cdp_code IS NOT NULL AND deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_corporate_accounts_tenant "
        "ON corporate_accounts (tenant_id) WHERE deleted_at IS NULL"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS corporate_bookers (
            booker_id     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id     uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            corporate_account_id uuid NOT NULL
                REFERENCES corporate_accounts(corporate_account_id) ON DELETE CASCADE,

            -- A booker is a person at the customer company, not a staff user.
            -- They may never have an account here at all, which is why this is
            -- an email rather than a foreign key into staff_users.
            email         text NOT NULL,
            full_name     text,
            -- Whether this person may commit the account to a rental billed to
            -- it, as opposed to booking and paying by card.
            may_bill_to_account boolean NOT NULL DEFAULT false,

            created_at    timestamptz NOT NULL DEFAULT now(),
            revoked_at    timestamptz
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_corporate_bookers_email "
        "ON corporate_bookers (corporate_account_id, lower(email)) "
        " WHERE revoked_at IS NULL"
    )

    for table in ("corporate_accounts", "corporate_bookers"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid) "
            "WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)"
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO app_user")

    # The columns have existed for a long time pointing at nothing. Now they
    # point somewhere. RESTRICT rather than CASCADE: deleting an account must
    # not silently rewrite the rate a past booking was quoted at.
    op.execute(
        "ALTER TABLE reservations ADD CONSTRAINT reservations_corporate_account_fkey "
        "FOREIGN KEY (corporate_account_id) "
        "REFERENCES corporate_accounts(corporate_account_id) ON DELETE RESTRICT"
    )
    op.execute(
        "ALTER TABLE rate_codes ADD CONSTRAINT rate_codes_corporate_account_fkey "
        "FOREIGN KEY (corporate_account_id) "
        "REFERENCES corporate_accounts(corporate_account_id) ON DELETE RESTRICT"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE rate_codes DROP CONSTRAINT IF EXISTS rate_codes_corporate_account_fkey"
    )
    op.execute(
        "ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_corporate_account_fkey"
    )
    op.execute("DROP TABLE IF EXISTS corporate_bookers")
    op.execute("DROP TABLE IF EXISTS corporate_accounts")
