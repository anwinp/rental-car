"""create payments table with RLS

Revision ID: 020_payments
Revises: 019_rental_agreements
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '020_payments'
down_revision: str | None = '019_rental_agreements'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.payments (
          payment_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id           UUID NOT NULL REFERENCES public.tenants (tenant_id),
          rental_agreement_id UUID REFERENCES public.rental_agreements (ra_id),
          reservation_id      UUID REFERENCES public.reservations (reservation_id),
          invoice_id          UUID,

          payment_type        TEXT          NOT NULL CHECK (payment_type IN (
                                'PREAUTH','CAPTURE','INCREMENTAL_AUTH',
                                'REFUND','VOID','CHARGEBACK','CHARGEBACK_REVERSAL')),
          payment_method      payment_method NOT NULL,
          status              payment_status NOT NULL DEFAULT 'PENDING',

          amount              NUMERIC(10,2) NOT NULL,
          currency            CHAR(3)       NOT NULL DEFAULT 'USD',
          refunded_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,

          gateway             TEXT          NOT NULL CHECK (gateway IN ('STRIPE','ADYEN','BRAINTREE','MANUAL')),
          gateway_payment_id  TEXT,
          gateway_auth_code   TEXT,
          network_txn_id      TEXT,
          card_last4          CHAR(4),
          card_brand          TEXT,
          card_expiry_month   SMALLINT,
          card_expiry_year    SMALLINT,
          payment_token       TEXT,

          authorized_at       TIMESTAMPTZ,
          captured_at         TIMESTAMPTZ,
          refunded_at         TIMESTAMPTZ,
          auth_expiry_at      TIMESTAMPTZ,

          requires_approval   BOOLEAN       NOT NULL DEFAULT false,
          approved_by         UUID REFERENCES public.staff_users (user_id),
          approved_at         TIMESTAMPTZ,
          notes               TEXT,

          created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE INDEX idx_payments_ra ON public.payments (rental_agreement_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_payments_status ON public.payments (tenant_id, status, auth_expiry_at)
          WHERE status IN ('AUTHORIZED','PENDING')
    """)
    op.execute("""
        CREATE INDEX idx_payments_gateway ON public.payments (gateway, gateway_payment_id)
          WHERE gateway_payment_id IS NOT NULL
    """)

    # RLS
    op.execute("ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.payments FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.payments
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.payments NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.payments CASCADE")
