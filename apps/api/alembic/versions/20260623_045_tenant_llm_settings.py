"""add llm_provider and anthropic_api_key to tenants

Revision ID: 045_tenant_llm_settings
Revises: 044_agent_notification_templates
Create Date: 2026-06-23

Phase: expand
Lock risk: low (nullable columns, default values)
Reversible: yes
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = '045_tenant_llm_settings'
down_revision: str | None = '044_agent_notification_templates'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'tenants',
        sa.Column('llm_provider', sa.Text(), nullable=True, server_default='anthropic'),
    )
    op.add_column(
        'tenants',
        sa.Column('anthropic_api_key', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('tenants', 'anthropic_api_key')
    op.drop_column('tenants', 'llm_provider')
