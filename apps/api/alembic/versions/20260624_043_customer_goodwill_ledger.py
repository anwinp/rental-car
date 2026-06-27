"""create customer_goodwill_ledger table

Revision ID: 20260624_043
Revises: 20260624_042
Create Date: 2026-06-24
"""
from alembic import op

revision = "20260624_043"
down_revision = "20260624_042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS public.customer_goodwill_ledger (
            ledger_id           UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id           UUID          NOT NULL,
            customer_id         UUID          NOT NULL,
            rental_agreement_id UUID          NOT NULL,
            amount              NUMERIC(10,2) NOT NULL CHECK (amount > 0),
            issued_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
            session_id          TEXT          NOT NULL,
            issued_by_agent     TEXT          NOT NULL,
            notes               TEXT
        )
    """)
    # Primary query: rolling 90-day sum per customer
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_goodwill_customer_90d
            ON public.customer_goodwill_ledger (tenant_id, customer_id, issued_at DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_goodwill_ra
            ON public.customer_goodwill_ledger (rental_agreement_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.customer_goodwill_ledger")
