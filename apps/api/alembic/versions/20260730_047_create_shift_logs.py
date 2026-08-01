"""create shift_logs table

Revision ID: 047_create_shift_logs
Revises: 046_backfill_tenant_columns
Create Date: 2026-07-30

The table existed in the original dev database but was never captured in a
migration, so a database built from the migration chain alone was missing it and
seed_realistic.py failed with UndefinedTableError. Definition mirrors the dev
table exactly (no RLS, no FKs, as found).

Phase: expand
Lock risk: low (CREATE TABLE IF NOT EXISTS)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '047_create_shift_logs'
down_revision: str | None = '046_backfill_tenant_columns'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS shift_logs (
            shift_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id             UUID NOT NULL,
            location_id           UUID NOT NULL,
            agent_id              UUID NOT NULL,
            shift_type            TEXT NOT NULL,
            opening_cash          NUMERIC(12,2),
            closing_cash          NUMERIC(12,2),
            expected_cash         NUMERIC(12,2),
            cash_variance         NUMERIC(12,2),
            fleet_count           INTEGER,
            pending_pickups_count INTEGER,
            notes                 TEXT,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_shift_logs_tenant_id ON shift_logs (tenant_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shift_logs")
