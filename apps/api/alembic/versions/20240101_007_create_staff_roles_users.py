"""create staff_roles and staff_users tables

Revision ID: 007_staff_roles_users
Revises: 005_locations
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new tables)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '007_staff_roles_users'
down_revision: str | None = '006_vehicle_classes'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.staff_roles (
          role_key         TEXT PRIMARY KEY,
          display_name     TEXT NOT NULL,
          permissions_json JSONB NOT NULL DEFAULT '{}',
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE public.staff_users (
          user_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id        UUID NOT NULL REFERENCES public.tenants (tenant_id),
          email            TEXT NOT NULL,
          password_hash    TEXT NOT NULL,
          first_name       TEXT NOT NULL,
          last_name        TEXT NOT NULL,
          role             user_role NOT NULL,
          home_location_id UUID REFERENCES public.locations (location_id),
          pin_hash         TEXT,
          is_active        BOOLEAN     NOT NULL DEFAULT true,
          last_login_at    TIMESTAMPTZ,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at       TIMESTAMPTZ,

          CONSTRAINT uq_staff_email_tenant UNIQUE (tenant_id, email)
        )
    """)

    op.execute("""
        CREATE INDEX idx_staff_tenant ON public.staff_users (tenant_id) WHERE deleted_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.staff_users CASCADE")
    op.execute("DROP TABLE IF EXISTS public.staff_roles CASCADE")
