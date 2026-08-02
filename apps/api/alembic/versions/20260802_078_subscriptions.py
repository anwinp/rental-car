"""what a workspace is paying for, and until when

Revision ID: 078_subscriptions
Revises: 077_billing_config
Create Date: 2026-08-02

tenants.subscription_ends_at has been enforced since migration 075 — the
nightly sweep locks a workspace out when it passes. Nothing wrote it. This is
what writes it: a record of the Stripe subscription behind each workspace, kept
in step by webhooks.

The row is a mirror, not a source of truth. Stripe owns the subscription; this
table exists so the product can answer "is this workspace paid up" without a
network call on every request, and so a support conversation can name the
subscription without opening the Stripe dashboard. When the two disagree,
Stripe is right and the webhook that says so is what corrects this.

Kept separate from tenants for two reasons. A workspace can go through several
subscriptions over its life — cancelled, resubscribed, moved from monthly to
annual — and flattening that into columns on `tenants` would lose the history
the finance questions are actually about. And the columns here are Stripe's
vocabulary, which should not leak into a table half the application reads.

Phase: expand
Lock risk: none — new table
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '078_subscriptions'
down_revision: str | None = '077_billing_config'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS tenant_subscriptions (
            subscription_id     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id           uuid NOT NULL REFERENCES tenants(tenant_id)
                                     ON DELETE CASCADE,

            -- Stripe's identifiers. sub_… and cus_… are what a support
            -- conversation with Stripe actually needs.
            stripe_subscription_id text UNIQUE,
            stripe_customer_id     text,
            stripe_checkout_id     text,

            -- The plan bought. No FK to plans: a plan may be deleted from the
            -- catalogue years after somebody was billed for it, and losing the
            -- record of what they paid for would be worse than a dangling code.
            plan_code           text NOT NULL,

            -- Stripe's own status vocabulary, stored verbatim rather than
            -- mapped. A mapping would need updating every time Stripe adds a
            -- state, and would silently mis-classify the new one until it was.
            status              text NOT NULL DEFAULT 'incomplete',

            amount_cents        integer,
            currency            text,
            interval            text,

            current_period_end  timestamptz,
            cancel_at_period_end boolean NOT NULL DEFAULT false,
            canceled_at         timestamptz,

            created_at          timestamptz NOT NULL DEFAULT now(),
            updated_at          timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tenant_subscriptions_tenant "
        "ON tenant_subscriptions (tenant_id, created_at DESC)"
    )
    # A workspace may hold only one subscription that is actually live. Several
    # cancelled ones are history and perfectly fine.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_subscriptions_active "
        "ON tenant_subscriptions (tenant_id) "
        " WHERE status IN ('trialing', 'active', 'past_due', 'unpaid')"
    )

    # No RLS. This is read by the platform console and by the webhook receiver,
    # neither of which has a tenant bound, and a tenant reads its own
    # subscription through an endpoint that names its own tenant_id explicitly.
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_subscriptions TO app_user"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tenant_subscriptions")
