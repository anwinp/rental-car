"""create 10 critical indexes via CREATE INDEX CONCURRENTLY

Revision ID: 030_critical_indexes
Revises: 029_archive_job
Create Date: 2024-01-01

Phase: expand
Lock risk: low (CONCURRENTLY avoids ACCESS EXCLUSIVE lock)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '030_critical_indexes'
down_revision: str | None = '029_archive_job'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # CONCURRENTLY cannot run inside a transaction; use AUTOCOMMIT
    bind = op.get_bind()
    conn = bind.execution_options(isolation_level='AUTOCOMMIT')

    # 1. Availability overlap query — the hottest query (GiST on vehicle_blocks)
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vb_vehicle_time_critical
          ON public.vehicle_blocks
          USING gist (vehicle_id, tstzrange(start_time, end_time, '[)'))
          WHERE deleted_at IS NULL
    """))

    # 2. Counter lookup by confirmation number
    conn.execute(sa.text("""
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_res_confirmation
          ON public.reservations (confirmation_number)
    """))

    # 3. Counter checkout + DNR check
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_license_critical
          ON public.customers (license_number, license_country)
          WHERE deleted_at IS NULL
    """))

    # 4. Customer rental history
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_res_customer_pickup
          ON public.reservations (customer_id, pickup_datetime DESC)
          WHERE deleted_at IS NULL
    """))

    # 5. Availability matrix rebuild
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_class_location_status
          ON public.vehicles (vehicle_class_id, current_location_id, status)
          WHERE deleted_at IS NULL AND status = 'AVAILABLE'
    """))

    # 6. Nightly re-auth Celery job
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_expiring_auths
          ON public.payments (tenant_id, auth_expiry_at)
          WHERE status = 'AUTHORIZED' AND payment_type = 'PREAUTH'
    """))

    # 7. Claims coordinator dashboard
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_tenant_status_assigned
          ON public.damage_claims (tenant_id, status, assigned_to)
          WHERE status NOT IN ('PAID','WRITTEN_OFF')
    """))

    # 8. DSAR export + compliance lookup
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_resource
          ON audit.audit_events (tenant_id, resource_type, resource_id, event_time DESC)
    """))

    # 9. Customer service search bar (full-text GIN)
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_fulltext
          ON public.customers
          USING gin (to_tsvector('english', first_name || ' ' || last_name || ' ' || email))
          WHERE deleted_at IS NULL AND anonymized_at IS NULL
    """))

    # 10. Dashboard active reservation queries
    conn.execute(sa.text("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_res_active
          ON public.reservations (tenant_id, pickup_datetime, status)
          WHERE deleted_at IS NULL
    """))


def downgrade() -> None:
    bind = op.get_bind()
    conn = bind.execution_options(isolation_level='AUTOCOMMIT')

    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_res_active"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_fulltext"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS audit.idx_audit_resource"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_claims_tenant_status_assigned"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_payments_expiring_auths"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_class_location_status"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_res_customer_pickup"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_customers_license_critical"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_res_confirmation"))
    conn.execute(sa.text("DROP INDEX CONCURRENTLY IF EXISTS public.idx_vb_vehicle_time_critical"))
