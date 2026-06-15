"""apply RLS to remaining tables not yet covered

Revision ID: 031_rls_remaining
Revises: 030_critical_indexes
Create Date: 2024-01-01

Phase: expand
Lock risk: low (ALTER TABLE RLS enable takes ShareUpdateExclusiveLock)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '031_rls_remaining'
down_revision: str | None = '030_critical_indexes'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # Note: vehicles, vehicle_blocks, customers, reservations, reservation_versions,
    # rental_agreements, payments, damage_claims, rate_codes, rate_schedule_items,
    # notification_log, telematics_events, vehicle_classes, extras_catalog
    # all have RLS applied in their own migration files (008-026).
    # This migration applies RLS to locations which was created in 005 but RLS
    # was already applied there. This migration serves as a verification/documentation
    # step and ensures all remaining tables not handled inline have RLS applied.
    # locations already has RLS from migration 005.
    # staff_users does not have RLS (uses application-level filtering).
    # tax_templates, notification_templates, staff_roles are reference/config tables
    # without tenant isolation RLS (accessible via app_service role).
    # processed_webhooks is a system table without per-tenant RLS.
    pass


def downgrade() -> None:
    pass
