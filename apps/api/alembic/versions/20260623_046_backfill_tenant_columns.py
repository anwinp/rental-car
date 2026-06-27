"""add missing tenant columns to match ORM model

Revision ID: 046_backfill_tenant_columns
Revises: 045_tenant_llm_settings
Create Date: 2026-06-23

Phase: expand
Lock risk: low (ADD COLUMN IF NOT EXISTS, all nullable)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '046_backfill_tenant_columns'
down_revision: str | None = '045_tenant_llm_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE tenants
          ADD COLUMN IF NOT EXISTS tos_ip TEXT,
          ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
          ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
          ADD COLUMN IF NOT EXISTS stripe_test_charge_succeeded BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS smtp_host TEXT,
          ADD COLUMN IF NOT EXISTS sendgrid_api_key TEXT,
          ADD COLUMN IF NOT EXISTS ra_template_id UUID
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE tenants
          DROP COLUMN IF EXISTS tos_ip,
          DROP COLUMN IF EXISTS stripe_customer_id,
          DROP COLUMN IF EXISTS stripe_account_id,
          DROP COLUMN IF EXISTS stripe_test_charge_succeeded,
          DROP COLUMN IF EXISTS smtp_host,
          DROP COLUMN IF EXISTS sendgrid_api_key,
          DROP COLUMN IF EXISTS ra_template_id
    """)
