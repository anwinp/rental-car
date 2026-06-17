"""add MFA and lockout columns to staff_users

Revision ID: 035_staff_users_mfa
Revises: 034_pgbouncer_config
Create Date: 2024-01-01

Phase: expand
Lock risk: low (adding nullable columns with defaults)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '035_staff_users_mfa'
down_revision: str | None = '034_pgbouncer_config'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.staff_users
          ADD COLUMN IF NOT EXISTS is_mfa_enabled      BOOLEAN     NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS mfa_secret           TEXT,
          ADD COLUMN IF NOT EXISTS mfa_backup_codes     TEXT[],
          ADD COLUMN IF NOT EXISTS location_ids         JSONB,
          ADD COLUMN IF NOT EXISTS failed_login_count   INTEGER     NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE public.staff_users
          DROP COLUMN IF EXISTS is_mfa_enabled,
          DROP COLUMN IF EXISTS mfa_secret,
          DROP COLUMN IF EXISTS mfa_backup_codes,
          DROP COLUMN IF EXISTS location_ids,
          DROP COLUMN IF EXISTS failed_login_count,
          DROP COLUMN IF EXISTS locked_until
    """)
