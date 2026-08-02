"""make the plan catalogue data instead of schema

Revision ID: 074_plans
Revises: 073_platform_admins
Create Date: 2026-08-02

Which plans exist was spread across three places that had to be kept in step by
hand, and were not:

  * a CHECK constraint on tenants.subscription_tier — the authority on what may
    be *assigned*
  * the plan_limits table — the authority on what a plan *allows*
  * a hardcoded 'STARTER' in the signup INSERT — the authority on what a new
    workspace *gets*

Migration 072 fixed the first two disagreeing, which had made GROWTH
unassignable and PROFESSIONAL silently unlimited. That was the symptom. This is
the cause: adding a plan required a schema migration, so nobody could add one,
so the lists drifted.

After this, a plan is a row. Creating one is an INSERT and the catalogue is
administered from the console like any other data.

Three structural changes make that safe:

  * plan_limits becomes `plans`. It now carries price, description, ordering
    and an active flag; a table called plan_limits holding a price is a name
    that lies to the next reader.

  * The CHECK constraint becomes a FOREIGN KEY to plans(code). The database
    now refuses to delete a plan that workspaces are on, rather than trusting
    application code to remember to check — and ON UPDATE CASCADE means a code
    can be renamed without orphaning anybody.

  * `is_default` marks the plan new signups land on, replacing the hardcoded
    literal. A partial unique index allows exactly one.

Prices are left NULL rather than invented. NULL means "not priced here", which
is the truth today; it is not the same as free, and the console shows it as
unset.

Phase: contract — renames a table two modules read. Ship with the API release
that reads `plans`.
Lock risk: low — brief ACCESS EXCLUSIVE for the rename and the constraint swap
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '074_plans'
down_revision: str | None = '073_platform_admins'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE plan_limits RENAME TO plans")
    op.execute("ALTER TABLE plans RENAME COLUMN tier TO code")

    op.execute(
        """
        ALTER TABLE plans
            ADD COLUMN IF NOT EXISTS description    text,
            ADD COLUMN IF NOT EXISTS price_cents    integer,
            ADD COLUMN IF NOT EXISTS currency       text NOT NULL DEFAULT 'USD',
            ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'MONTHLY',
            ADD COLUMN IF NOT EXISTS is_active      boolean NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS is_default     boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS sort_order     integer NOT NULL DEFAULT 100,
            ADD COLUMN IF NOT EXISTS created_at     timestamptz NOT NULL DEFAULT now()
        """
    )
    op.execute(
        "ALTER TABLE plans ADD CONSTRAINT plans_billing_period_check "
        "CHECK (billing_period IN ('MONTHLY','YEARLY','CUSTOM'))"
    )
    op.execute(
        "ALTER TABLE plans ADD CONSTRAINT plans_price_check "
        "CHECK (price_cents IS NULL OR price_cents >= 0)"
    )
    # Caps are NULL for unlimited; a negative one would read as a cap of zero
    # somewhere and lock a customer out of their own account.
    op.execute(
        "ALTER TABLE plans ADD CONSTRAINT plans_caps_check CHECK ("
        " (max_staff     IS NULL OR max_staff     > 0) AND"
        " (max_vehicles  IS NULL OR max_vehicles  > 0) AND"
        " (max_locations IS NULL OR max_locations > 0))"
    )
    # Exactly one default, enforced by the database rather than by whoever
    # remembers to clear the old one.
    # Only rows where is_default is true are indexed, and in those rows the
    # column is always true — so uniqueness on it permits exactly one.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_plans_single_default "
        "ON plans (is_default) WHERE is_default"
    )

    # Ordering and the signup default, matching what the product does today.
    op.execute(
        """
        UPDATE plans SET sort_order = CASE code
            WHEN 'TRIAL' THEN 10 WHEN 'STARTER' THEN 20
            WHEN 'GROWTH' THEN 30 WHEN 'ENTERPRISE' THEN 40 ELSE 100 END,
            description = CASE code
            WHEN 'TRIAL'      THEN 'Evaluation. Same caps as Starter, time-limited.'
            WHEN 'STARTER'    THEN 'A single branch getting started.'
            WHEN 'GROWTH'     THEN 'Several branches and a real fleet.'
            WHEN 'ENTERPRISE' THEN 'No caps. Priced per agreement.'
            ELSE description END,
            billing_period = CASE code WHEN 'ENTERPRISE' THEN 'CUSTOM'
                                       ELSE billing_period END
        """
    )
    op.execute("UPDATE plans SET is_default = true WHERE code = 'STARTER'")

    # Any tier a tenant holds must exist as a row before the FK can be trusted.
    # There should be none, but a deployment elsewhere may differ and this must
    # not fail there.
    op.execute(
        """
        INSERT INTO plans (code, display_name, description, sort_order)
        SELECT DISTINCT t.subscription_tier,
               initcap(lower(t.subscription_tier)),
               'Recovered during migration 074 — review its caps and price.',
               900
          FROM tenants t
         WHERE t.subscription_tier IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM plans p WHERE p.code = t.subscription_tier)
        """
    )

    op.execute(
        "ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_subscription_tier_check"
    )
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_subscription_tier_fkey "
        "FOREIGN KEY (subscription_tier) REFERENCES plans(code) "
        "ON UPDATE CASCADE ON DELETE RESTRICT"
    )

    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO app_user")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_subscription_tier_fkey"
    )
    # Any plan added since 074 is outside the old CHECK's vocabulary, so those
    # tenants move to STARTER rather than blocking the downgrade.
    op.execute(
        "UPDATE tenants SET subscription_tier = 'STARTER' "
        " WHERE subscription_tier NOT IN ('STARTER','TRIAL','GROWTH','ENTERPRISE')"
    )
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_subscription_tier_check "
        "CHECK (subscription_tier IN ('STARTER','TRIAL','GROWTH','ENTERPRISE'))"
    )
    op.execute("DROP INDEX IF EXISTS ux_plans_single_default")
    op.execute(
        """
        ALTER TABLE plans
            DROP CONSTRAINT IF EXISTS plans_billing_period_check,
            DROP CONSTRAINT IF EXISTS plans_price_check,
            DROP CONSTRAINT IF EXISTS plans_caps_check,
            DROP COLUMN IF EXISTS description,
            DROP COLUMN IF EXISTS price_cents,
            DROP COLUMN IF EXISTS currency,
            DROP COLUMN IF EXISTS billing_period,
            DROP COLUMN IF EXISTS is_active,
            DROP COLUMN IF EXISTS is_default,
            DROP COLUMN IF EXISTS sort_order,
            DROP COLUMN IF EXISTS created_at
        """
    )
    op.execute("ALTER TABLE plans RENAME COLUMN code TO tier")
    op.execute("ALTER TABLE plans RENAME TO plan_limits")
