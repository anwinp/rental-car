"""link every location to a tax template

Revision ID: 067_location_tax
Revises: 066_catalogue_delete
Create Date: 2026-08-02

`locations.tax_template_id` has existed since the table was created and was
never populated — 0 of 22 rows. Combined with a pricing engine that returned
Decimal("0") for every quote, nothing surfaced it.

Now that quotes actually compute tax, an unlinked location falls back to the
tenant's first template. That fallback is deliberate — returning zero would
reintroduce the silent under-collection — but it is a guess, and it guesses
wrong for a tenant running both airport and downtown branches, where one carries
a concession fee the other must not.

This links each location to its tenant's template so the common case is right by
data rather than by fallback. Tenants with exactly one template (all of them
today) are unambiguous.

Phase: expand
Lock risk: low — single UPDATE over a small table
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '067_location_tax'
down_revision: str | None = '066_catalogue_delete'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE locations l
           SET tax_template_id = t.template_id
          FROM (
            SELECT DISTINCT ON (tenant_id) tenant_id, template_id
              FROM tax_templates
             ORDER BY tenant_id, created_at
          ) t
         WHERE t.tenant_id = l.tenant_id
           AND l.tax_template_id IS NULL
        """
    )


def downgrade() -> None:
    # Only unlink what this migration could have set — a template chosen later
    # by a human should survive a downgrade.
    op.execute(
        """
        UPDATE locations l
           SET tax_template_id = NULL
          FROM (
            SELECT DISTINCT ON (tenant_id) tenant_id, template_id
              FROM tax_templates
             ORDER BY tenant_id, created_at
          ) t
         WHERE t.tenant_id = l.tenant_id
           AND l.tax_template_id = t.template_id
        """
    )
