"""align role grants with the resource names the code actually checks

Revision ID: 063_rbac_vocabulary
Revises: 062_tenants_rls
Create Date: 2026-08-02

Three roles were unusable, all for the same reason: the resource names granted
in staff_roles.permissions_json do not all match the names passed to
require_permission() in the routers.

  CLAIMS_COORDINATOR  granted damage_claims:*     code checks "damage"
  FINANCE             granted damage_claims:read  code checks "damage"
  FINANCE_ANALYST     no row at all

Nine other roles grant "damage"; only these two spell it "damage_claims". It is
a seed-data inconsistency, not a modelling decision — and the effect was that a
Claims Coordinator, whose entire purpose is working damage claims, got 403 on
GET /damage/claims while a System Admin got 200. Verified live before this
migration.

FINANCE_ANALYST is worse: it has no permissions row, yet it is the only finance
role offered in the team invite dropdown (FINANCE, which works, is not offered).
Inviting someone as Finance Analyst produced an account where every action
failed. It is given the same grants as FINANCE.

Not addressed here: ten granted resources are never checked by any router —
checkout, fleet, invoices, locations, maintenance, pricing, rental_agreements,
reports, self, and (after this migration) damage_claims. Those grants are inert
rather than harmful: a role that holds them is not thereby permitted anything,
because nothing consults them. Left alone deliberately, since deleting grants
is the direction that breaks access if any of those checks are added later.

Phase: contract
Lock risk: none — 16-row reference table
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '063_rbac_vocabulary'
down_revision: str | None = '062_tenants_rls'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Carry the damage_claims grant over to the name the routers check, keeping
    # the original key so nothing that reads it by the old name breaks.
    op.execute(
        """
        UPDATE staff_roles
           SET permissions_json = permissions_json
                 || jsonb_build_object('damage', permissions_json->'damage_claims'),
               updated_at = now()
         WHERE permissions_json ? 'damage_claims'
           AND NOT permissions_json ? 'damage'
        """
    )

    # FINANCE_ANALYST is invitable through the UI but had no row, so every
    # action by such a user was refused.
    op.execute(
        """
        INSERT INTO staff_roles (role_key, display_name, permissions_json,
                                 created_at, updated_at)
        SELECT 'FINANCE_ANALYST', 'Finance Analyst', permissions_json,
               now(), now()
          FROM staff_roles WHERE role_key = 'FINANCE'
        ON CONFLICT (role_key) DO NOTHING
        """
    )

    # Assessing a damage claim means looking at the pre- and post-rental
    # inspection for the vehicle, and those routes are gated on "vehicles" —
    # correctly, since they are vehicle condition records rather than claims.
    # Without a read grant the coordinator can open a claim and see none of the
    # evidence attached to it.
    op.execute(
        """
        UPDATE staff_roles
           SET permissions_json = permissions_json
                 || jsonb_build_object('vehicles', '["read"]'::jsonb),
               updated_at = now()
         WHERE role_key = 'CLAIMS_COORDINATOR'
           AND NOT permissions_json ? 'vehicles'
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM staff_roles WHERE role_key = 'FINANCE_ANALYST'")
    op.execute(
        """
        UPDATE staff_roles
           SET permissions_json = permissions_json - 'damage',
               updated_at = now()
         WHERE permissions_json ? 'damage_claims'
        """
    )
