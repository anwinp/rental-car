"""add is_promo, promo_image_url, promo_label to vehicles

Revision ID: 036_vehicle_promo_fields
Revises: 035_staff_users_mfa
Create Date: 2024-01-01

Phase: expand
Lock risk: low (adding nullable/default columns)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '036_vehicle_promo_fields'
down_revision: str | None = '035_staff_users_mfa'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.add_column('vehicles', sa.Column('is_promo', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('vehicles', sa.Column('promo_image_url', sa.Text(), nullable=True))
    op.add_column('vehicles', sa.Column('promo_label', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('vehicles', 'promo_label')
    op.drop_column('vehicles', 'promo_image_url')
    op.drop_column('vehicles', 'is_promo')
