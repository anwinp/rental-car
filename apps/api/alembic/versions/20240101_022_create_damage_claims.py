"""create damage_claims table with RLS

Revision ID: 022_damage_claims
Revises: 021_processed_webhooks
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '022_damage_claims'
down_revision: str | None = '021_processed_webhooks'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.damage_claims (
          claim_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id               UUID NOT NULL REFERENCES public.tenants (tenant_id),
          claim_reference         TEXT NOT NULL,
          rental_agreement_id     UUID NOT NULL REFERENCES public.rental_agreements (ra_id),
          vehicle_id              UUID NOT NULL REFERENCES public.vehicles (vehicle_id),
          customer_id             UUID NOT NULL REFERENCES public.customers (customer_id),

          discovered_at           TIMESTAMPTZ NOT NULL,
          discovered_by           UUID NOT NULL REFERENCES public.staff_users (user_id),
          discovery_type          TEXT NOT NULL CHECK (discovery_type IN (
                                    'RETURN_INSPECTION','POST_RETURN_AUDIT',
                                    'MID_RENTAL_CUSTOMER_REPORT','THIRD_PARTY_REPORT')),

          damage_zone             TEXT NOT NULL,
          damage_type             TEXT NOT NULL,
          severity                damage_severity NOT NULL,
          damage_description      TEXT,
          photos                  JSONB NOT NULL DEFAULT '[]',
          pre_rental_inspection_id UUID,
          customer_acknowledged   BOOLEAN     NOT NULL DEFAULT false,
          customer_ack_signature_url TEXT,

          cdw_on_agreement        BOOLEAN     NOT NULL DEFAULT false,
          cdw_voided              BOOLEAN     NOT NULL DEFAULT false,
          cdw_void_reason         TEXT,
          claim_type              TEXT CHECK (claim_type IN (
                                    'CUSTOMER_CHARGE','CDW_WAIVER','THIRD_PARTY_INSURANCE',
                                    'CREDIT_CARD_BENEFIT','OPERATOR_ABSORBED')),

          repair_estimate         NUMERIC(10,2),
          repair_actual           NUMERIC(10,2),
          loss_of_use_days        INT         NOT NULL DEFAULT 0,
          loss_of_use_rate        NUMERIC(10,2),
          loss_of_use_total       NUMERIC(10,2),
          admin_fee               NUMERIC(10,2) NOT NULL DEFAULT 0,
          diminished_value        NUMERIC(10,2),
          total_claim_amount      NUMERIC(10,2),
          amount_collected        NUMERIC(10,2) NOT NULL DEFAULT 0,
          amount_written_off      NUMERIC(10,2),

          third_party_carrier     TEXT,
          third_party_policy_number TEXT,
          subrogation_claim_number  TEXT,
          subrogation_recovery    NUMERIC(10,2),

          status                  claim_status NOT NULL DEFAULT 'OPEN',
          assigned_to             UUID REFERENCES public.staff_users (user_id),
          repair_facility         TEXT,
          repair_start_date       DATE,
          repair_end_date         DATE,
          work_order_id           UUID,

          chargeback_id           UUID,
          chargeback_response_due TIMESTAMPTZ,

          created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

          CONSTRAINT uq_claim_reference_tenant UNIQUE (tenant_id, claim_reference)
        )
    """)

    op.execute("""
        CREATE INDEX idx_claims_tenant_status ON public.damage_claims (tenant_id, status)
    """)
    op.execute("""
        CREATE INDEX idx_claims_ra ON public.damage_claims (rental_agreement_id)
    """)
    op.execute("""
        CREATE INDEX idx_claims_vehicle ON public.damage_claims (vehicle_id, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_claims_customer ON public.damage_claims (customer_id)
    """)

    # RLS
    op.execute("ALTER TABLE public.damage_claims ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.damage_claims FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.damage_claims
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)
    op.execute("ALTER TABLE public.damage_claims NO FORCE ROW LEVEL SECURITY FOR ROLE app_service")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.damage_claims CASCADE")
