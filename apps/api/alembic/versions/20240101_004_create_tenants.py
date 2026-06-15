"""create tenants table

Revision ID: 004_tenants
Revises: 003_enum_types
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '004_tenants'
down_revision: str | None = '003_enum_types'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.tenants (
          tenant_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          slug                 TEXT NOT NULL UNIQUE,
          legal_name           TEXT NOT NULL,
          trading_name         TEXT,
          company_reg_no       TEXT,
          vat_tax_id           TEXT,
          primary_email        TEXT NOT NULL,
          primary_phone        TEXT,
          billing_address      JSONB NOT NULL DEFAULT '{}',
          logo_url             TEXT,
          default_currency     CHAR(3)     NOT NULL DEFAULT 'USD',
          default_timezone     TEXT        NOT NULL DEFAULT 'America/New_York',
          subscription_tier    TEXT        NOT NULL DEFAULT 'STARTER'
                                 CHECK (subscription_tier IN ('STARTER','PROFESSIONAL','ENTERPRISE')),
          trial_ends_at        TIMESTAMPTZ,
          subscription_ends_at TIMESTAMPTZ,
          tos_accepted_at      TIMESTAMPTZ,
          tos_version          TEXT,
          dpa_accepted_at      TIMESTAMPTZ,
          status               TEXT        NOT NULL DEFAULT 'ACTIVE'
                                 CHECK (status IN ('ACTIVE','SUSPENDED','CANCELLED','TRIAL')),
          created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at           TIMESTAMPTZ
        )
    """)

    op.execute("""
        CREATE INDEX idx_tenants_slug ON public.tenants (slug) WHERE deleted_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.tenants CASCADE")
