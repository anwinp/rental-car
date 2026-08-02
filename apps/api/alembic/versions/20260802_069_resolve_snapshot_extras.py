"""let historical snapshots resolve extras names again

Revision ID: 069_snapshot_extras
Revises: 068_agreement_doc
Create Date: 2026-08-02

Migration 065 gave every tenant its own catalogue rows and made the global
template rows invisible to tenants. That was right, and it had a consequence I
did not account for: agreements written BEFORE it stored extras by the global
extra_id, and a tenant-scoped read can no longer resolve those ids to a name.

On a rendered rental agreement the effect is a charge line reading

    —    8.99 USD

which is worse than omitting it. A customer signs a document listing money
against a blank description, and the operator cannot say what it was for.

This adds a narrowly-scoped SECURITY DEFINER lookup that resolves extra ids to
names across the caller's own rows AND the global template rows. It discloses
nothing: template rows belong to no tenant, and the caller must already hold the
id, which it got from its own agreement.

Deliberately not solved by widening the RLS policy — that would put the global
rows back in front of every tenant query and undo 065.

Phase: expand
Lock risk: none
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '069_snapshot_extras'
down_revision: str | None = '068_agreement_doc'
branch_labels = None
depends_on = None


FN = """
CREATE OR REPLACE FUNCTION public.resolve_extra_names(p_ids uuid[])
RETURNS TABLE (extra_id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
    SELECT e.extra_id, e.name
      FROM extras_catalog e
     WHERE e.extra_id = ANY(p_ids)
       AND (
            e.tenant_id IS NULL                                  -- seed template
         OR e.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
       );
$fn$;
"""


def upgrade() -> None:
    op.execute(FN)
    op.execute("GRANT EXECUTE ON FUNCTION public.resolve_extra_names(uuid[]) TO app_user")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS public.resolve_extra_names(uuid[])")
