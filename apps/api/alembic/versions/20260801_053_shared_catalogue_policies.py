"""let shared catalogues stay readable while keeping writes tenant-owned

Revision ID: 053_shared_catalogues
Revises: 052_app_user_runtime
Create Date: 2026-08-01

Migration 051 applied one strict policy to every tenant table:

    tenant_id = current_tenant

Four tables carry deliberately GLOBAL rows — tenant_id IS NULL — which every
tenant is meant to share:

    vehicle_classes         12   the SIPP class catalogue
    extras_catalog           9   standard add-ons
    notification_templates  35   default message templates
    tax_templates            1   default tax configuration

Under the strict policy those became invisible to everyone, which breaks
availability search, quoting and notifications for every tenant. Caught by
querying as app_user with a real tenant pinned: visible_classes = 0.

The fix is asymmetric, and the asymmetry is the point:

    USING       tenant_id IS NULL OR tenant_id = current   -- read own + shared
    WITH CHECK  tenant_id = current                        -- write only own

Reading a shared row is intended. WRITING one is not: a tenant that could insert
tenant_id = NULL would publish rows into every other tenant's catalogue. So the
write side stays strict even though the read side is permissive.

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '053_shared_catalogues'
down_revision: str | None = '052_app_user_runtime'
branch_labels = None
depends_on = None

# Tables that legitimately hold platform-wide rows alongside tenant-owned ones.
_SHARED_CATALOGUES = (
    "vehicle_classes",
    "extras_catalog",
    "notification_templates",
    "tax_templates",
)

_CURRENT = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"


def upgrade() -> None:
    for table in _SHARED_CATALOGUES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON public.{table} "
            f"USING (tenant_id IS NULL OR tenant_id = {_CURRENT}) "
            f"WITH CHECK (tenant_id = {_CURRENT})"
        )


def downgrade() -> None:
    for table in _SHARED_CATALOGUES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON public.{table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON public.{table} "
            f"USING (tenant_id = {_CURRENT}) WITH CHECK (tenant_id = {_CURRENT})"
        )
