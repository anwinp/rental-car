"""make the plan a workspace may hold match the plans that actually exist

Revision ID: 072_plan_tiers
Revises: 071_purge_grants
Create Date: 2026-08-02

Two lists of plans have coexisted since migration 057 and have never agreed.

The CHECK constraint on tenants.subscription_tier permits:

    STARTER | PROFESSIONAL | ENTERPRISE

while plan_limits — the table that decides what a plan actually allows — holds:

    STARTER | TRIAL | GROWTH | ENTERPRISE

Both halves are wrong in opposite directions:

  GROWTH, the mid-tier the pricing model is built around, CANNOT BE ASSIGNED.
  The constraint rejects it. Discovered by building the plan-change endpoint
  and watching a straightforward Starter->Growth upgrade fail with a check
  violation — the first time anything in the product had ever tried to change
  a plan.

  PROFESSIONAL is assignable and has no plan_limits row. assert_within_limit
  LEFT JOINs plan_limits, so a missing row yields a NULL cap, which is read as
  "unlimited". A workspace on the middle plan therefore received Enterprise
  capacity for Starter money, silently, with nothing logged.

This aligns the constraint to the plans that exist, and migrates any tenant
sitting on PROFESSIONAL to GROWTH — the tier whose caps that plan was sold as
having. There are none in this database, but a deployment elsewhere may differ
and the migration must not fail there.

TRIAL is included: it is in plan_limits and the tenant status vocabulary
already anticipates trials, so a workspace should be able to hold it.

Phase: contract
Lock risk: low — brief ACCESS EXCLUSIVE while the constraint is swapped
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '072_plan_tiers'
down_revision: str | None = '071_purge_grants'
branch_labels = None
depends_on = None

_NEW = ("STARTER", "TRIAL", "GROWTH", "ENTERPRISE")
_OLD = ("STARTER", "PROFESSIONAL", "ENTERPRISE")


def _values(vals: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in vals)


def upgrade() -> None:
    # Move anyone on the unmeterable plan to the one it was sold as being.
    op.execute(
        "UPDATE tenants SET subscription_tier = 'GROWTH' "
        " WHERE subscription_tier = 'PROFESSIONAL'"
    )
    op.execute(
        "ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_subscription_tier_check"
    )
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_subscription_tier_check "
        f"CHECK (subscription_tier IN ({_values(_NEW)}))"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE tenants SET subscription_tier = 'STARTER' "
        " WHERE subscription_tier IN ('GROWTH', 'TRIAL')"
    )
    op.execute(
        "ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_subscription_tier_check"
    )
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_subscription_tier_check "
        f"CHECK (subscription_tier IN ({_values(_OLD)}))"
    )
