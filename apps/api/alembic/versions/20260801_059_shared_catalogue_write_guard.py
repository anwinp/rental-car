"""stop tenants deleting or hijacking shared catalogue rows

Revision ID: 059_shared_write_guard
Revises: 058_invitation_lookup
Create Date: 2026-08-01

Migration 053 gave the shared catalogues a single FOR ALL policy:

    USING      (tenant_id IS NULL OR tenant_id = current_tenant)
    WITH CHECK (tenant_id = current_tenant)

The WITH CHECK correctly stops a tenant *creating* a global row. The USING
clause, though, is what Postgres uses to decide which rows a statement may
*see* — and that includes the rows DELETE removes and the rows UPDATE
rewrites. WITH CHECK is never consulted for DELETE at all.

So the asymmetry that made globals readable also made them destroyable:

    DELETE FROM notification_templates      -- 35 shared rows -> 0
    UPDATE vehicle_classes SET tenant_id=me -- 12 global classes claimed

Both were reproduced against the local stack as the unprivileged app_user with
a tenant adopted. The first is how tenant deletion once wiped every tenant's
catalogue; the second lets one tenant quietly take the shared catalogue away
from everyone else.

The fix is to stop using one policy for four different verbs. Postgres ORs
together multiple permissive policies for the same command, so each command
gets exactly the reach it needs:

    SELECT  USING (NULL OR mine)   -- read shared + own
    INSERT  WITH CHECK (mine)      -- create only own
    UPDATE  USING (mine) CHECK (mine)  -- change only own, and it stays own
    DELETE  USING (mine)           -- remove only own

Phase: contract
Lock risk: low (policy swap, no table rewrite)
Reversible: yes — downgrade restores the permissive FOR ALL policy
"""
from __future__ import annotations

from alembic import op

revision: str = '059_shared_write_guard'
down_revision: str | None = '058_invitation_lookup'
branch_labels = None
depends_on = None

# Catalogues that legitimately hold platform-wide rows (tenant_id IS NULL)
# alongside per-tenant ones.
SHARED_TABLES = (
    "vehicle_classes",
    "extras_catalog",
    "notification_templates",
    "tax_templates",
)

_CURRENT = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"


def upgrade() -> None:
    for table in SHARED_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")

        # Read: shared rows plus your own.
        op.execute(
            f"CREATE POLICY tenant_select ON {table} FOR SELECT "
            f"USING (tenant_id IS NULL OR tenant_id = {_CURRENT})"
        )
        # Create: only your own. A NULL tenant_id is refused.
        op.execute(
            f"CREATE POLICY tenant_insert ON {table} FOR INSERT "
            f"WITH CHECK (tenant_id = {_CURRENT})"
        )
        # Modify: only rows you own, and they must remain yours. The USING
        # clause here is what stops `SET tenant_id = me` on a shared row —
        # the row is simply not visible to the UPDATE.
        op.execute(
            f"CREATE POLICY tenant_update ON {table} FOR UPDATE "
            f"USING (tenant_id = {_CURRENT}) "
            f"WITH CHECK (tenant_id = {_CURRENT})"
        )
        # Remove: only your own. Shared rows are out of reach even for an
        # unscoped `DELETE FROM <table>`.
        op.execute(
            f"CREATE POLICY tenant_delete ON {table} FOR DELETE "
            f"USING (tenant_id = {_CURRENT})"
        )


def downgrade() -> None:
    for table in SHARED_TABLES:
        for name in ("tenant_select", "tenant_insert", "tenant_update", "tenant_delete"):
            op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (tenant_id IS NULL OR tenant_id = {_CURRENT}) "
            f"WITH CHECK (tenant_id = {_CURRENT})"
        )
