"""tenant storefront theme

Revision ID: 086_tenant_theme
Revises: 085_tenant_payment_config
Create Date: 2026-08-03

How a tenant makes the booking site look like theirs — THEMING_STRATEGY.md.

`draft_settings` and `settings` (published) are separate columns on the same
row rather than a versioned table of rows, so publishing is one atomic write
and there is never a moment where "what draft is being edited" and "what is
live" can disagree about which row they mean. The admin UI edits the draft
freely; only /publish copies it across.

`settings` is deliberately narrow — a preset key, a handful of named overrides,
never raw CSS or HTML. The registry (app/domains/theme/presets.py) is what
turns those into the actual token values; this table stores the tenant's
*choices*, not the output. That is what keeps a tenant from ever writing markup
into a page our server renders — the same boundary the corporate invoice PDF
draws around a supplied logo URL, applied to the whole storefront.

logo_url is NOT duplicated here. It already exists on `tenants` and is read by
the invoice PDF; a second copy would be the two-sources-of-truth bug this
codebase keeps finding elsewhere. The theme borrows it.

Phase: expand
Lock risk: none — new table
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '086_tenant_theme'
down_revision: str | None = '085_tenant_payment_config'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS tenant_theme (
            tenant_id       uuid PRIMARY KEY
                            REFERENCES tenants(tenant_id) ON DELETE CASCADE,

            -- Registry key into app/domains/theme/presets.py, e.g. 'meridian'.
            -- Not a foreign key: the registry is code, not a table, the same
            -- choice already made for corporate_invoices.rate_type and the
            -- payment provider registry.
            preset          text NOT NULL DEFAULT 'meridian',

            -- The tenant's overrides on top of the preset: brand colour,
            -- fonts, radius, header/button style, hero copy, legal links.
            -- Never raw CSS — see the module docstring above.
            draft_settings  jsonb NOT NULL DEFAULT '{}'::jsonb,

            -- What the public storefront actually reads. NULL until the first
            -- publish, so a tenant editing a draft for the first time is not
            -- accidentally live with half-finished settings.
            settings        jsonb,
            published_preset text,
            published_at    timestamptz,

            -- Assets the theme needs that `tenants` has no room for. The main
            -- logo is tenants.logo_url; these are the variants nothing else
            -- reads, so duplicating them here is not a second source of truth.
            logo_dark_url   text,
            favicon_url     text,

            updated_at      timestamptz NOT NULL DEFAULT now(),
            updated_by      uuid,
            created_at      timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    op.execute("ALTER TABLE tenant_theme ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_theme FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON tenant_theme "
        "USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid) "
        "WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_theme TO app_user")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tenant_theme")
