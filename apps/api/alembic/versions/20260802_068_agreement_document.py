"""store the generated rental agreement document

Revision ID: 068_agreement_doc
Revises: 067_location_tax
Create Date: 2026-08-02

Signature capture was real — customer_signature_url, customer_signed_at and an
esignature_hash are all populated at checkout — but no document was ever
produced. weasyprint has been in requirements.txt the whole time and imported
nowhere, so a signed agreement existed as scattered columns and never as a
thing the operator could hand over, email, or produce in a dispute.

A rental agreement is legally required in most markets and cannot be recreated
after the fact: it has to capture the terms, rates, mileage plan, fuel policy
and signature exactly as they stood at handover. Rendering it later from live
data would produce a different document than the one the customer signed.

This adds the key of the rendered PDF in object storage. The document itself is
generated once, on first request, and the key stored — regenerating on every
view would let a later rate change quietly alter a signed agreement.

Phase: expand
Lock risk: low — nullable column, metadata-only
Reversible: yes
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = '068_agreement_doc'
down_revision: str | None = '067_location_tax'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rental_agreements",
        sa.Column(
            "agreement_pdf_key",
            sa.Text(),
            nullable=True,
            comment="Object-storage key of the rendered agreement. Written once, "
                    "on first generation, so the signed document never changes.",
        ),
    )
    op.add_column(
        "rental_agreements",
        sa.Column(
            "agreement_pdf_generated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("rental_agreements", "agreement_pdf_generated_at")
    op.drop_column("rental_agreements", "agreement_pdf_key")
