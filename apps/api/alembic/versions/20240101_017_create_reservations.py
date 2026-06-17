"""create reservations table with indexes and RLS

Revision ID: 017_reservations
Revises: 016_notification_templates
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '017_reservations'
down_revision: str | None = '016_notification_templates'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.reservations (
          reservation_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id               UUID NOT NULL REFERENCES public.tenants (tenant_id),
          confirmation_number     TEXT NOT NULL,
          status                  reservation_status NOT NULL DEFAULT 'QUOTE',
          version                 INT  NOT NULL DEFAULT 1,

          customer_id             UUID NOT NULL REFERENCES public.customers (customer_id),
          corporate_account_id    UUID,

          pickup_location_id      UUID NOT NULL REFERENCES public.locations (location_id),
          dropoff_location_id     UUID NOT NULL REFERENCES public.locations (location_id),
          pickup_datetime         TIMESTAMPTZ NOT NULL,
          return_datetime         TIMESTAMPTZ NOT NULL,
          actual_return_datetime  TIMESTAMPTZ,

          vehicle_class_id        UUID NOT NULL REFERENCES public.vehicle_classes (class_id),
          assigned_vehicle_id     UUID REFERENCES public.vehicles (vehicle_id),

          rate_code_id            UUID REFERENCES public.rate_codes (rate_code_id),
          cdp_code                TEXT,
          promo_code              TEXT,
          currency                CHAR(3)     NOT NULL DEFAULT 'USD',
          base_rate_daily         NUMERIC(10,2),
          base_total              NUMERIC(10,2),
          extras_total            NUMERIC(10,2) NOT NULL DEFAULT 0,
          discount_total          NUMERIC(10,2) NOT NULL DEFAULT 0,
          location_fees_total     NUMERIC(10,2) NOT NULL DEFAULT 0,
          taxes_total             NUMERIC(10,2) NOT NULL DEFAULT 0,
          grand_total             NUMERIC(10,2),
          deposit_amount          NUMERIC(10,2) NOT NULL DEFAULT 0,
          extras_snapshot         JSONB       NOT NULL DEFAULT '[]',
          taxes_snapshot          JSONB       NOT NULL DEFAULT '[]',

          channel                 TEXT        NOT NULL DEFAULT 'DIRECT_WEB'
                                   CHECK (channel IN ('DIRECT_WEB','MOBILE_APP','CALL_CENTER','COUNTER',
                                          'WALK_UP','OTA','GDS','KIOSK','API')),
          ota_booking_ref         TEXT,
          insurance_replacement_flag BOOLEAN  NOT NULL DEFAULT false,
          flight_number           TEXT,
          special_instructions    TEXT,
          cancellation_policy_id  UUID,

          no_show_fee_charged     NUMERIC(10,2),
          no_show_at              TIMESTAMPTZ,

          loyalty_points_earned   INT         NOT NULL DEFAULT 0,
          loyalty_points_redeemed INT         NOT NULL DEFAULT 0,
          is_training             BOOLEAN     NOT NULL DEFAULT false,
          booking_agent_id        UUID REFERENCES public.staff_users (user_id),

          created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at              TIMESTAMPTZ,

          CONSTRAINT chk_return_after_pickup CHECK (return_datetime > pickup_datetime),
          CONSTRAINT uq_confirmation_number  UNIQUE (confirmation_number)
        )
    """)

    op.execute("""
        CREATE INDEX idx_res_tenant_status ON public.reservations (tenant_id, status) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_res_customer ON public.reservations (customer_id, pickup_datetime DESC) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_res_pickup_location ON public.reservations (pickup_location_id, pickup_datetime) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_res_vehicle ON public.reservations (assigned_vehicle_id) WHERE assigned_vehicle_id IS NOT NULL
    """)
    op.execute("""
        CREATE INDEX idx_res_corporate ON public.reservations (corporate_account_id) WHERE corporate_account_id IS NOT NULL
    """)

    # RLS
    op.execute("ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.reservations FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.reservations
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)



def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.reservations CASCADE")
