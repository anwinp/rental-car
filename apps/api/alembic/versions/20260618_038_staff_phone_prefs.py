"""Add phone fields to staff_users and preferred_channel to customers

Revision ID: 038_staff_phone_prefs
Revises: 037_add_tasks_table
Create Date: 2026-06-18

Phase: expand
Lock risk: low (new columns)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '038_staff_phone_prefs'
down_revision: str | None = '037_add_tasks_table'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS phone_number TEXT")
    op.execute("ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ")
    op.execute("ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS preferred_channel TEXT NOT NULL DEFAULT 'EMAIL'")
    # CONCURRENTLY cannot run inside a transaction — create index separately via psql if needed
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_users_phone_tenant
          ON public.staff_users (tenant_id, phone_number)
          WHERE phone_number IS NOT NULL AND deleted_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_staff_users_phone_tenant")
    op.execute("ALTER TABLE public.staff_users DROP COLUMN IF EXISTS phone_number")
    op.execute("ALTER TABLE public.staff_users DROP COLUMN IF EXISTS phone_verified")
    op.execute("ALTER TABLE public.staff_users DROP COLUMN IF EXISTS phone_verified_at")
    op.execute("ALTER TABLE public.customers DROP COLUMN IF EXISTS preferred_channel")
