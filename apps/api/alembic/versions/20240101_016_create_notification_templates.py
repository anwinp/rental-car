"""create notification_templates table

Revision ID: 016_notification_templates
Revises: 015_tax_templates
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '016_notification_templates'
down_revision: str | None = '015_tax_templates'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.notification_templates (
          template_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id    UUID REFERENCES public.tenants (tenant_id),
          event_code   TEXT NOT NULL,
          channel      TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','PUSH')),
          subject      TEXT,
          body_html    TEXT,
          body_text    TEXT,
          is_active    BOOLEAN NOT NULL DEFAULT true,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

          CONSTRAINT uq_notif_template UNIQUE (tenant_id, event_code, channel)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.notification_templates CASCADE")
