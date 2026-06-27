"""Add payment_gateway column to tenants table.

Revision ID: 20260618_040
Revises: 20260618_039
Create Date: 2026-06-18
"""
from alembic import op

revision = "20260618_040"
down_revision = "039_add_promo_codes"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE tenants
          ADD COLUMN IF NOT EXISTS payment_gateway TEXT NOT NULL DEFAULT 'STRIPE';
    """)


def downgrade():
    op.execute("ALTER TABLE tenants DROP COLUMN IF EXISTS payment_gateway;")
