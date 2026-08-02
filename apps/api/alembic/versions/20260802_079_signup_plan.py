"""remember which plan somebody chose before they paid for it

Revision ID: 079_signup_plan
Revises: 078_subscriptions
Create Date: 2026-08-02

A plan picked on the pricing page has to survive registration and email
verification before there is any opportunity to pay for it. This is where that
choice waits.

Deliberately NOT subscription_tier. Writing the chosen plan there at signup
would hand a new workspace Growth's caps and Growth's integrations the moment
they typed an email address, with payment an optional step afterwards — pick
Enterprise, never pay, keep unlimited everything. The tier stays on the free
default until a Stripe webhook confirms money moved; this column only records
what they were heading for, so the product can offer them the right checkout
once their address is confirmed.

Cleared when the subscription goes live, so a workspace that has paid stops
being prompted to.

Phase: expand
Lock risk: none
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '079_signup_plan'
down_revision: str | None = '078_subscriptions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS signup_plan_code text
                REFERENCES plans(code) ON UPDATE CASCADE ON DELETE SET NULL
        """
    )
    # ON DELETE SET NULL rather than RESTRICT: an unpaid intention should never
    # stop a plan being retired from the catalogue. The workspace simply stops
    # being prompted for something that no longer exists.


def downgrade() -> None:
    op.execute("ALTER TABLE tenants DROP COLUMN IF EXISTS signup_plan_code")
