"""create tax_templates table and backfill FK on locations

Revision ID: 015_tax_templates
Revises: 014_extras_catalog
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table + FK on locations which is empty at this point)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '015_tax_templates'
down_revision: str | None = '014_extras_catalog'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.tax_templates (
          template_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id     UUID REFERENCES public.tenants (tenant_id),
          name          TEXT NOT NULL,
          is_seed       BOOLEAN NOT NULL DEFAULT false,
          jurisdictions JSONB NOT NULL DEFAULT '[]',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

          CONSTRAINT uq_tax_template_name UNIQUE (tenant_id, name)
        )
    """)

    # Backfill FK on locations now that tax_templates exists
    op.execute("""
        ALTER TABLE public.locations
          ADD CONSTRAINT fk_locations_tax_template
          FOREIGN KEY (tax_template_id) REFERENCES public.tax_templates (template_id)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS fk_locations_tax_template")
    op.execute("DROP TABLE IF EXISTS public.tax_templates CASCADE")
