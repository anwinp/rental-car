"""seed 12 SIPP vehicle classes

Revision ID: 032_seed_vehicle_classes
Revises: 031_rls_remaining
Create Date: 2024-01-01

Phase: backfill
Lock risk: low (INSERT with ON CONFLICT DO NOTHING)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '032_seed_vehicle_classes'
down_revision: str | None = '031_rls_remaining'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # 12 SIPP vehicle classes (tenant_id NULL = system-wide reference)
    op.execute("""
        INSERT INTO public.vehicle_classes (class_id, tenant_id, sipp_prefix, name, sort_order) VALUES
          ('00000000-0000-0000-0001-000000000001', NULL, 'M', 'Mini',            1),
          ('00000000-0000-0000-0001-000000000002', NULL, 'E', 'Economy',          2),
          ('00000000-0000-0000-0001-000000000003', NULL, 'C', 'Compact',          3),
          ('00000000-0000-0000-0001-000000000004', NULL, 'I', 'Intermediate',     4),
          ('00000000-0000-0000-0001-000000000005', NULL, 'S', 'Standard',         5),
          ('00000000-0000-0000-0001-000000000006', NULL, 'F', 'Fullsize',         6),
          ('00000000-0000-0000-0001-000000000007', NULL, 'P', 'Premium',          7),
          ('00000000-0000-0000-0001-000000000008', NULL, 'L', 'Luxury',           8),
          ('00000000-0000-0000-0001-000000000009', NULL, 'U', 'SUV',              9),
          ('00000000-0000-0000-0001-000000000010', NULL, 'V', 'Minivan',         10),
          ('00000000-0000-0000-0001-000000000011', NULL, 'W', 'Wagon/Estate',    11),
          ('00000000-0000-0000-0001-000000000012', NULL, 'X', 'Special/Exotic',  12)
        ON CONFLICT (tenant_id, sipp_prefix) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM public.vehicle_classes
         WHERE class_id IN (
           '00000000-0000-0000-0001-000000000001',
           '00000000-0000-0000-0001-000000000002',
           '00000000-0000-0000-0001-000000000003',
           '00000000-0000-0000-0001-000000000004',
           '00000000-0000-0000-0001-000000000005',
           '00000000-0000-0000-0001-000000000006',
           '00000000-0000-0000-0001-000000000007',
           '00000000-0000-0000-0001-000000000008',
           '00000000-0000-0000-0001-000000000009',
           '00000000-0000-0000-0001-000000000010',
           '00000000-0000-0000-0001-000000000011',
           '00000000-0000-0000-0001-000000000012'
         )
    """)
