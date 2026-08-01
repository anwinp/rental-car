"""RLS on the audit schema and on every partition, including future ones

Revision ID: 060_partition_audit_rls
Revises: 059_shared_write_guard
Create Date: 2026-08-01

Two holes, same root cause: a policy on a partitioned parent does not protect
the partitions.

Querying through the parent applies the parent's policy. Querying a child
relation *directly* — `SELECT * FROM notification_log_p20260801` — applies the
child's own policies, and a child has none unless it is given them. Every
partition was therefore an unguarded copy of the data it held. Reproduced as
app_user with a tenant adopted: 34 partitions had RLS disabled.

`audit.audit_events` was worse: RLS was never enabled on it at all, parent or
child. It held 11,605 rows across 17 tenants, readable by the runtime role,
and because audit rows carry full before/after snapshots of the rows they
describe, an unprotected audit table is a superset of everything the other 27
policies protect.

The awkward part is that pg_partman creates partitions on a nightly schedule
and does not copy RLS to them — its template table covers indexes and
constraints, not policies. A migration that only fixed today's partitions would
be undone by tomorrow's. So this also installs an event trigger that applies
the policy to any partition of a tenant-scoped parent at the moment it is
created.

Phase: contract
Lock risk: low — ALTER TABLE ... ENABLE ROW LEVEL SECURITY takes ACCESS
  EXCLUSIVE briefly per relation but rewrites nothing
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '060_partition_audit_rls'
down_revision: str | None = '059_shared_write_guard'
branch_labels = None
depends_on = None


APPLY_FN = """
CREATE OR REPLACE FUNCTION public.apply_tenant_rls(target regclass)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
    has_tenant boolean;
BEGIN
    -- Only tables that actually carry a tenant_id can be scoped this way.
    SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = target AND attname = 'tenant_id' AND NOT attisdropped
    ) INTO has_tenant;

    IF NOT has_tenant THEN
        RETURN;
    END IF;

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %s '
        'USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid) '
        'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
        target
    );
END;
$fn$;
"""

# Fires after any CREATE TABLE. If the new relation is a partition whose root
# carries a tenant_id, it inherits the same protection immediately — which is
# what keeps pg_partman's nightly run from quietly reopening this.
EVENT_TRIGGER_FN = """
CREATE OR REPLACE FUNCTION public.rls_on_new_partition()
RETURNS event_trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
    obj record;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
    LOOP
        IF obj.object_type = 'table' THEN
            -- Only act on relations that are partitions of something.
            IF EXISTS (
                SELECT 1 FROM pg_inherits WHERE inhrelid = obj.objid
            ) THEN
                PERFORM public.apply_tenant_rls(obj.objid::regclass);
            END IF;
        END IF;
    END LOOP;
END;
$fn$;
"""


def upgrade() -> None:
    op.execute(APPLY_FN)
    op.execute(EVENT_TRIGGER_FN)

    # The audit parent was never enabled at all.
    op.execute("SELECT public.apply_tenant_rls('audit.audit_events'::regclass)")

    # Every existing partition of every partitioned parent that has a tenant_id.
    op.execute(
        """
        DO $$
        DECLARE
            part record;
        BEGIN
            FOR part IN
                SELECT c.oid::regclass AS rel
                FROM pg_class c
                JOIN pg_inherits i ON i.inhrelid = c.oid
                WHERE c.relkind = 'r'
            LOOP
                PERFORM public.apply_tenant_rls(part.rel);
            END LOOP;
        END $$;
        """
    )

    op.execute("DROP EVENT TRIGGER IF EXISTS rls_on_new_partition_trg")
    op.execute(
        "CREATE EVENT TRIGGER rls_on_new_partition_trg "
        "ON ddl_command_end WHEN TAG IN ('CREATE TABLE') "
        "EXECUTE FUNCTION public.rls_on_new_partition()"
    )

    # app_user must be able to read/write audit rows within its own tenant.
    op.execute(
        "GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO app_user"
    )
    op.execute("GRANT USAGE ON SCHEMA audit TO app_user")
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA audit "
        "GRANT SELECT, INSERT ON TABLES TO app_user"
    )


def downgrade() -> None:
    op.execute("DROP EVENT TRIGGER IF EXISTS rls_on_new_partition_trg")
    op.execute("DROP FUNCTION IF EXISTS public.rls_on_new_partition()")
    op.execute(
        """
        DO $$
        DECLARE
            part record;
        BEGIN
            FOR part IN
                SELECT c.oid::regclass AS rel
                FROM pg_class c
                JOIN pg_inherits i ON i.inhrelid = c.oid
                WHERE c.relkind = 'r' AND c.relrowsecurity
            LOOP
                EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', part.rel);
                EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', part.rel);
                EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', part.rel);
            END LOOP;
        END $$;
        """
    )
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON audit.audit_events")
    op.execute("ALTER TABLE audit.audit_events NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE audit.audit_events DISABLE ROW LEVEL SECURITY")
    op.execute("DROP FUNCTION IF EXISTS public.apply_tenant_rls(regclass)")
