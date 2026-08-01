"""complete RLS coverage and add WITH CHECK to every tenant policy

Revision ID: 051_complete_rls
Revises: 050_tenant_scope_uniques
Create Date: 2026-08-01

Two gaps found while implementing multi-tenancy:

1. Twelve tenant-scoped tables had no row-level security at all — including
   staff_users, tasks, promotion_codes, tax_templates and notification_templates.
   Migration 031 was named "rls_remaining_tables" but predates most of them.

2. Every existing policy had USING but no WITH CHECK. USING filters what a
   tenant can *read*; WITH CHECK constrains what it can *write*. Without it a
   caller could INSERT or UPDATE a row carrying another tenant's id — the read
   side was sealed while the write side was open.

Policies use NULLIF(...,'') so that an empty GUC behaves like an unset one
(no rows) instead of raising on the uuid cast.

`tenants` is deliberately excluded: it is the tenant registry itself, and the
anonymous hostname -> tenant lookup must be able to read it before any tenant
context exists.

Phase: expand
Lock risk: low (ALTER TABLE ... ENABLE RLS takes a brief ACCESS EXCLUSIVE lock)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '051_complete_rls'
down_revision: str | None = '050_tenant_scope_uniques'
branch_labels = None
depends_on = None

# Tenant-scoped tables that had no RLS.
_MISSING = (
    "staff_users",
    "tasks",
    "task_comments",
    "tax_templates",
    "notification_templates",
    "promotion_codes",
    "ota_channels",
    "ota_leads",
    "shift_logs",
    "vehicle_status_log",
    "customer_goodwill_ledger",
)

# Tables that already had RLS but only a USING clause.
_EXISTING = (
    "customers",
    "damage_claims",
    "extras_catalog",
    "locations",
    "payments",
    "rate_codes",
    "rate_schedule_items",
    "rental_agreements",
    "reservation_versions",
    "reservations",
    "vehicle_blocks",
    "vehicle_classes",
    "vehicles",
)

_PREDICATE = (
    "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"
)


def _apply(table: str) -> None:
    op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{table}")
    op.execute(
        f"CREATE POLICY tenant_isolation ON public.{table} "
        f"USING ({_PREDICATE}) WITH CHECK ({_PREDICATE})"
    )


def upgrade() -> None:
    for table in _MISSING + _EXISTING:
        _apply(table)

    # processed_webhooks carries rows from before it was tenant-scoped; those
    # have a NULL tenant_id and must stay visible to the platform.
    op.execute("ALTER TABLE public.processed_webhooks ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.processed_webhooks FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON public.processed_webhooks")
    op.execute(
        "CREATE POLICY tenant_isolation ON public.processed_webhooks "
        f"USING (tenant_id IS NULL OR {_PREDICATE}) "
        f"WITH CHECK (tenant_id IS NULL OR {_PREDICATE})"
    )


def downgrade() -> None:
    for table in _MISSING:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{table}")
        op.execute(f"ALTER TABLE public.{table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY")

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON public.processed_webhooks")
    op.execute("ALTER TABLE public.processed_webhooks DISABLE ROW LEVEL SECURITY")

    # Restore the read-only policy shape on the tables that already had RLS.
    for table in _EXISTING:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON public.{table} "
            "USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)"
        )
