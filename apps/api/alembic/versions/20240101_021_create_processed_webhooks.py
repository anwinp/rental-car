"""create processed_webhooks table for Stripe idempotency

Revision ID: 021_processed_webhooks
Revises: 020_payments
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '021_processed_webhooks'
down_revision: str | None = '020_payments'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.processed_webhooks (
          event_id    TEXT        PRIMARY KEY,
          gateway     TEXT        NOT NULL DEFAULT 'STRIPE',
          processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.processed_webhooks CASCADE")
