"""add EXECUTIVE, FINANCE_ANALYST, READONLY_AUDITOR to user_role enum

Revision ID: 049_user_role_enum_values
Revises: 048_backfill_drifted_columns
Create Date: 2026-07-30

Found by diffing pg_enum between the original dev database and one built purely
from migrations. These three labels were added to dev by hand; without them the
staff bootstrap fails with "invalid input value for enum user_role".

ADD VALUE IF NOT EXISTS cannot run inside a transaction block on older
PostgreSQL, so each statement gets its own autocommit connection.

Phase: expand
Lock risk: low
Reversible: no (PostgreSQL cannot drop an enum label)
"""
from __future__ import annotations

from alembic import op

revision: str = '049_user_role_enum_values'
down_revision: str | None = '048_backfill_drifted_columns'
branch_labels = None
depends_on = None

_VALUES = ("EXECUTIVE", "FINANCE_ANALYST", "READONLY_AUDITOR")


def upgrade() -> None:
    # autocommit: ALTER TYPE ... ADD VALUE cannot run in a transaction block.
    with op.get_context().autocommit_block():
        for value in _VALUES:
            op.execute(f"ALTER TYPE user_role ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL provides no way to remove a value from an enum type.
    pass
