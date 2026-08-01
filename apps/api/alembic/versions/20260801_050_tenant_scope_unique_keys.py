"""scope globally-unique columns to the tenant

Revision ID: 050_tenant_scope_uniques
Revises: 049_user_role_enum_values
Create Date: 2026-08-01

MT-06 / MT-08 from MULTI_TENANCY_PLAN.md.

confirmation_number, ra_number and loyalty_number were UNIQUE across the whole
platform. Under multi-tenancy that means one tenant's booking can fail because a
different tenant already used that number, and sequential values leak
cross-tenant volume. Each becomes UNIQUE (tenant_id, <col>).

processed_webhooks had no tenant_id at all, so payment-event idempotency was
shared: one tenant's event id could suppress another tenant's event.

Phase: expand
Lock risk: low on a small table; the index builds are the expensive part
Reversible: yes (re-widening can fail if tenants hold colliding values — expected)
"""
from __future__ import annotations

from alembic import op

revision: str = '050_tenant_scope_uniques'
down_revision: str | None = '049_user_role_enum_values'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── reservations.confirmation_number ─────────────────────────────────────
    op.execute("ALTER TABLE reservations DROP CONSTRAINT IF EXISTS uq_confirmation_number")
    op.execute(
        "ALTER TABLE reservations "
        "ADD CONSTRAINT uq_confirmation_number_tenant "
        "UNIQUE (tenant_id, confirmation_number)"
    )
    # Lookup by confirmation number alone stays common (customer support, OTA
    # callbacks), so keep a non-unique index for it.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reservations_confirmation_number "
        "ON reservations (confirmation_number)"
    )

    # ── rental_agreements.ra_number ──────────────────────────────────────────
    op.execute("ALTER TABLE rental_agreements DROP CONSTRAINT IF EXISTS rental_agreements_ra_number_key")
    op.execute(
        "ALTER TABLE rental_agreements "
        "ADD CONSTRAINT uq_ra_number_tenant UNIQUE (tenant_id, ra_number)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_rental_agreements_ra_number "
        "ON rental_agreements (ra_number)"
    )

    # ── customers.loyalty_number ─────────────────────────────────────────────
    op.execute("ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_loyalty_number_key")
    # Partial: loyalty_number is nullable and most customers have none, so a
    # partial unique index keeps it small and still permits many NULLs.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_loyalty_tenant "
        "ON customers (tenant_id, loyalty_number) WHERE loyalty_number IS NOT NULL"
    )

    # ── processed_webhooks.tenant_id ─────────────────────────────────────────
    op.execute("ALTER TABLE processed_webhooks ADD COLUMN IF NOT EXISTS tenant_id UUID")
    op.execute("ALTER TABLE processed_webhooks DROP CONSTRAINT IF EXISTS processed_webhooks_pkey")
    op.execute("DROP INDEX IF EXISTS uq_processed_webhook_event")
    # Existing rows predate multi-tenancy; attribute them to no tenant rather
    # than guessing. The unique key treats NULL tenant as its own bucket.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_processed_webhook_tenant_event "
        "ON processed_webhooks (tenant_id, gateway, event_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_processed_webhooks_tenant "
        "ON processed_webhooks (tenant_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_processed_webhook_tenant_event")
    op.execute("DROP INDEX IF EXISTS ix_processed_webhooks_tenant")
    op.execute("ALTER TABLE processed_webhooks DROP COLUMN IF EXISTS tenant_id")

    op.execute("DROP INDEX IF EXISTS uq_customers_loyalty_tenant")
    op.execute("ALTER TABLE customers ADD CONSTRAINT customers_loyalty_number_key UNIQUE (loyalty_number)")

    op.execute("DROP INDEX IF EXISTS ix_rental_agreements_ra_number")
    op.execute("ALTER TABLE rental_agreements DROP CONSTRAINT IF EXISTS uq_ra_number_tenant")
    op.execute("ALTER TABLE rental_agreements ADD CONSTRAINT rental_agreements_ra_number_key UNIQUE (ra_number)")

    op.execute("DROP INDEX IF EXISTS ix_reservations_confirmation_number")
    op.execute("ALTER TABLE reservations DROP CONSTRAINT IF EXISTS uq_confirmation_number_tenant")
    op.execute("ALTER TABLE reservations ADD CONSTRAINT uq_confirmation_number UNIQUE (confirmation_number)")
