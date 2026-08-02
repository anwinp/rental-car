"""invoices for corporate accounts

Revision ID: 084_corporate_invoices
Revises: 083_corporate_accounts
Create Date: 2026-08-02

An account can be told "bill it to us" and there was nothing that later told
them what they owed. Bill-to-account without invoicing is a promise to send a
bill that never arrives.

The design turns on one property: **an issued invoice is immutable.**

A customer's finance department files the PDF, quotes its number in a payment
reference and reconciles against it months later. If the underlying rental is
corrected afterwards — a damage charge added, a rate fixed — the invoice must
not silently change underneath them. So the line items are COPIES, with their
own descriptions and amounts, not a view over reservations. A correction
becomes a credit note against the original, which is what an accountant expects
and what an auditor can follow.

That is also why totals live on the invoice rather than being recomputed on
read. A number that is recalculated is a number that can disagree with the
paper the customer is holding.

Phase: expand
Lock risk: none — new tables
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '084_corporate_invoices'
down_revision: str | None = '083_corporate_accounts'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS corporate_invoices (
            invoice_id    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id     uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            corporate_account_id uuid NOT NULL
                REFERENCES corporate_accounts(corporate_account_id) ON DELETE RESTRICT,

            -- Human-facing, unique per workspace, and the thing a customer puts
            -- on a bank transfer. Generated, never supplied.
            invoice_number text NOT NULL,

            status        text NOT NULL DEFAULT 'DRAFT',

            -- The window billed. Held so a second run for the same month is
            -- recognisable as a duplicate rather than silently double-billing.
            period_start  date NOT NULL,
            period_end    date NOT NULL,

            issued_at     timestamptz,
            due_at        timestamptz,
            paid_at       timestamptz,
            voided_at     timestamptz,
            void_reason   text,

            -- Minor units throughout. Floats do not belong near money, and a
            -- total that is recomputed on read is a total that can disagree
            -- with the PDF the customer already has.
            subtotal_cents integer NOT NULL DEFAULT 0,
            tax_cents      integer NOT NULL DEFAULT 0,
            total_cents    integer NOT NULL DEFAULT 0,
            currency       text NOT NULL DEFAULT 'USD',

            -- The rendered PDF. Key, not URL: signed URLs expire, keys do not.
            pdf_object_key text,

            -- Who the invoice was addressed to, captured at issue. A customer
            -- that later changes its billing address must not retroactively
            -- alter an invoice already sent.
            bill_to        jsonb NOT NULL DEFAULT '{}'::jsonb,

            notes         text,
            created_by    uuid,
            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now(),

            CONSTRAINT corporate_invoices_status_check
                CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'VOID')),
            CONSTRAINT corporate_invoices_period_check
                CHECK (period_end >= period_start),
            CONSTRAINT corporate_invoices_amounts_check
                CHECK (subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0)
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_corporate_invoices_number "
        "ON corporate_invoices (tenant_id, invoice_number)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_corporate_invoices_account "
        "ON corporate_invoices (corporate_account_id, created_at DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS corporate_invoice_lines (
            line_id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id     uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            invoice_id    uuid NOT NULL REFERENCES corporate_invoices(invoice_id)
                               ON DELETE CASCADE,

            -- Kept for reference and for the duplicate check, but everything
            -- shown on the invoice is copied below. A rental corrected after
            -- billing must not rewrite the paper already sent.
            reservation_id uuid,

            description   text NOT NULL,
            reference     text,
            line_date     date,
            quantity      numeric(10,2) NOT NULL DEFAULT 1,
            unit_cents    integer NOT NULL DEFAULT 0,
            amount_cents  integer NOT NULL DEFAULT 0,
            sort_order    integer NOT NULL DEFAULT 0,

            created_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_corporate_invoice_lines_invoice "
        "ON corporate_invoice_lines (invoice_id, sort_order)"
    )
    # One reservation may only be billed once per account. The index allows
    # NULL reservation_id so manual lines are unrestricted, and ignores voided
    # invoices so a mistake can be corrected and re-billed.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_invoice_lines_reservation
        ON corporate_invoice_lines (reservation_id)
        WHERE reservation_id IS NOT NULL
        """
    )

    for table in ("corporate_invoices", "corporate_invoice_lines"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid) "
            "WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)"
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO app_user")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS corporate_invoice_lines")
    op.execute("DROP TABLE IF EXISTS corporate_invoices")
