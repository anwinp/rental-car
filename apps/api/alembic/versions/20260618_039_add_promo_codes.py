"""Add promotion_codes table

Revision ID: 039_add_promo_codes
Revises: 038_staff_phone_prefs
Create Date: 2026-06-18

Phase: expand
Lock risk: low (new table)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '039_add_promo_codes'
down_revision: str | None = '038_staff_phone_prefs'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS public.promotion_codes (
          promo_id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id           UUID          NOT NULL,
          code                TEXT          NOT NULL,
          discount_type       TEXT          NOT NULL,
          discount_value      NUMERIC(10,4) NOT NULL,
          valid_from          TIMESTAMPTZ   NOT NULL,
          valid_to            TIMESTAMPTZ   NOT NULL,
          usage_limit         INTEGER,
          used_count          INTEGER       NOT NULL DEFAULT 0,
          applicable_class_ids UUID[]       NOT NULL DEFAULT '{}',
          min_days            INTEGER       NOT NULL DEFAULT 1,
          is_active           BOOLEAN       NOT NULL DEFAULT true,
          created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
          updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
          CONSTRAINT uq_promo_tenant_code UNIQUE (tenant_id, code),
          CONSTRAINT promo_discount_type_check CHECK (discount_type IN ('PERCENT', 'FIXED'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_promo_codes_tenant ON public.promotion_codes(tenant_id, code) WHERE is_active = true")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.promotion_codes")
