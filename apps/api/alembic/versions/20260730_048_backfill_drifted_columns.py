"""add columns present in dev but missing from the migration chain

Revision ID: 048_backfill_drifted_columns
Revises: 047_create_shift_logs
Create Date: 2026-07-30

Found by diffing information_schema.columns between the original dev database
and a database built purely from migrations: ten columns had been added to dev
by hand and never captured, so a fresh deploy failed (seed_realistic.py hit
UndefinedColumnError on rental_agreements.is_training).

All are nullable — except rental_agreements.is_training, which is NOT NULL with
a false default, so it is safe to add to a populated table.

Phase: expand
Lock risk: low (ADD COLUMN IF NOT EXISTS; the NOT NULL one has a constant default)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '048_backfill_drifted_columns'
down_revision: str | None = '047_create_shift_logs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS oauth_google_sub TEXT
    """)
    op.execute("""
        ALTER TABLE damage_claims
          ADD COLUMN IF NOT EXISTS adjuster_id UUID,
          ADD COLUMN IF NOT EXISTS inspector_id UUID,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS pre_inspection_snapshot JSONB,
          ADD COLUMN IF NOT EXISTS post_inspection_snapshot JSONB,
          ADD COLUMN IF NOT EXISTS zone_data JSONB
    """)
    op.execute("""
        ALTER TABLE rental_agreements
          ADD COLUMN IF NOT EXISTS agent_notes TEXT,
          ADD COLUMN IF NOT EXISTS is_training BOOLEAN NOT NULL DEFAULT false
    """)
    op.execute("""
        ALTER TABLE reservations
          ADD COLUMN IF NOT EXISTS rate_quote_token TEXT
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS oauth_google_sub")
    op.execute("""
        ALTER TABLE damage_claims
          DROP COLUMN IF EXISTS adjuster_id,
          DROP COLUMN IF EXISTS inspector_id,
          DROP COLUMN IF EXISTS notes,
          DROP COLUMN IF EXISTS pre_inspection_snapshot,
          DROP COLUMN IF EXISTS post_inspection_snapshot,
          DROP COLUMN IF EXISTS zone_data
    """)
    op.execute("""
        ALTER TABLE rental_agreements
          DROP COLUMN IF EXISTS agent_notes,
          DROP COLUMN IF EXISTS is_training
    """)
    op.execute("ALTER TABLE reservations DROP COLUMN IF EXISTS rate_quote_token")
