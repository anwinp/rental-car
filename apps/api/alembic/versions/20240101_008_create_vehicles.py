"""create vehicles table with indexes and RLS

Revision ID: 008_vehicles
Revises: 007_staff_roles_users
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '008_vehicles'
down_revision: str | None = '007_staff_roles_users'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.vehicles (
          vehicle_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id               UUID NOT NULL REFERENCES public.tenants (tenant_id),

          vin                     CHAR(17)    NOT NULL,
          plate_number            TEXT,
          plate_jurisdiction      TEXT,
          plate_expiry            DATE,
          title_number            TEXT,
          fleet_number            TEXT,
          unit_number             TEXT,

          make                    TEXT        NOT NULL,
          model                   TEXT        NOT NULL,
          trim                    TEXT,
          model_year              SMALLINT    NOT NULL CHECK (model_year BETWEEN 1900 AND 2100),
          body_style              TEXT,
          exterior_color          TEXT,
          exterior_color_code     TEXT,
          interior_color          TEXT,
          transmission            transmission_type NOT NULL,
          drive_type              TEXT CHECK (drive_type IN ('FWD','RWD','AWD','4WD')),
          engine_displacement_l   NUMERIC(4,2),
          cylinder_count          SMALLINT,
          fuel_type               fuel_type   NOT NULL,
          fuel_tank_capacity_gal  NUMERIC(6,2),
          battery_capacity_kwh    NUMERIC(6,2),
          epa_range_miles         INT,
          charge_port_type        TEXT,
          doors                   SMALLINT,
          seats                   SMALLINT,
          luggage_large_bags      SMALLINT,
          luggage_small_bags      SMALLINT,

          sipp_code               CHAR(4),
          vehicle_class_id        UUID NOT NULL REFERENCES public.vehicle_classes (class_id),
          pool_id                 UUID,

          home_location_id        UUID NOT NULL REFERENCES public.locations (location_id),
          current_location_id     UUID REFERENCES public.locations (location_id),
          status                  vehicle_status NOT NULL DEFAULT 'STAGING',
          odometer_current        INT         NOT NULL DEFAULT 0,
          odometer_unit           TEXT        NOT NULL DEFAULT 'MILES' CHECK (odometer_unit IN ('MILES','KM')),
          fuel_level_pct          SMALLINT    CHECK (fuel_level_pct BETWEEN 0 AND 100),
          soc_pct                 SMALLINT    CHECK (soc_pct BETWEEN 0 AND 100),
          in_service_date         DATE,

          acquisition_cost        NUMERIC(12,2),
          residual_value          NUMERIC(12,2),
          book_value              NUMERIC(12,2),
          depreciation_method     depreciation_method NOT NULL DEFAULT 'STRAIGHT_LINE',
          useful_life_months      INT,
          estimated_life_miles    INT,
          fleet_type              fleet_type  NOT NULL DEFAULT 'OWNED',
          lease_reference         TEXT,
          target_disposal_miles   INT,
          target_disposal_months  INT,

          options_packages        JSONB       NOT NULL DEFAULT '[]',
          photos                  JSONB       NOT NULL DEFAULT '[]',
          telematics_device_id    TEXT,
          telematics_provider     TEXT,

          created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at              TIMESTAMPTZ,

          CONSTRAINT uq_vehicle_vin_tenant UNIQUE (tenant_id, vin)
        )
    """)

    op.execute("""
        CREATE INDEX idx_vehicles_tenant_status ON public.vehicles (tenant_id, status) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_vehicles_home_location ON public.vehicles (home_location_id) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_vehicles_current_location ON public.vehicles (current_location_id) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_vehicles_class ON public.vehicles (vehicle_class_id) WHERE deleted_at IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_vehicles_sipp ON public.vehicles (sipp_code) WHERE deleted_at IS NULL
    """)

    # RLS
    op.execute("ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON public.vehicles
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    """)



def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.vehicles CASCADE")
