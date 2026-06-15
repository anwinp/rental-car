"""create extensions

Revision ID: 001_extensions
Revises: None
Create Date: 2024-01-01

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '001_extensions'
down_revision: str | None = None
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "btree_gist"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "pg_partman" SCHEMA partman')
    op.execute('CREATE EXTENSION IF NOT EXISTS "pg_cron"')


def downgrade() -> None:
    op.execute('DROP EXTENSION IF EXISTS "pg_cron"')
    op.execute('DROP EXTENSION IF EXISTS "pg_partman"')
    op.execute('DROP EXTENSION IF EXISTS "pgcrypto"')
    op.execute('DROP EXTENSION IF EXISTS "btree_gist"')
    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp"')
