"""let the runtime role delete archive and audit rows, so a purge can finish

Revision ID: 071_purge_grants
Revises: 070_reset_targets
Create Date: 2026-08-02

Deleting a workspace could never remove its archive.* or audit.audit_events
rows: app_user, the role the application actually runs as, has no privileges on
the archive schema and none on audit_events. Every attempt failed with
"permission denied".

That was invisible because the delete loop caught each exception, logged a
warning, and still returned ok=True with the table simply missing from the
counts — indistinguishable from "it had no rows". So a customer discharging a
GDPR erasure request was told their workspace and N rows were deleted while
retired copies of their renters' names, licence numbers, payment records and
signed agreements stayed in archive.*, orphaned to a tenant id that no longer
resolved to anything.

The purge now reports per-table failures instead of swallowing them, which is
what surfaced this. Without these grants it would simply refuse to complete.

DELETE only. app_user gets no INSERT or UPDATE on archive or audit: those are
written by triggers and the archive job running as the owner, and the
application has no business editing an audit trail it is also the subject of.

Phase: expand
Lock risk: none — privileges only
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '071_purge_grants'
down_revision: str | None = '070_reset_targets'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # USAGE alone does not permit reading or deleting; it makes the schema's
    # objects addressable at all. Without it the DELETE fails before it reaches
    # any table-level check.
    op.execute("GRANT USAGE ON SCHEMA archive TO app_user")
    op.execute("GRANT USAGE ON SCHEMA audit TO app_user")

    op.execute("GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA archive TO app_user")
    op.execute("GRANT SELECT, DELETE ON audit.audit_events TO app_user")

    # audit_events is partitioned by pg_partman, and a grant on the parent does
    # not reach partitions created later. Without this the purge starts failing
    # again the first month a new partition appears.
    op.execute("GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA audit TO app_user")
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA audit "
        "GRANT SELECT, DELETE ON TABLES TO app_user"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA archive "
        "GRANT SELECT, DELETE ON TABLES TO app_user"
    )


def downgrade() -> None:
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA audit "
        "REVOKE SELECT, DELETE ON TABLES FROM app_user"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA archive "
        "REVOKE SELECT, DELETE ON TABLES FROM app_user"
    )
    op.execute("REVOKE SELECT, DELETE ON ALL TABLES IN SCHEMA audit FROM app_user")
    op.execute("REVOKE SELECT, DELETE ON ALL TABLES IN SCHEMA archive FROM app_user")
    op.execute("REVOKE USAGE ON SCHEMA archive FROM app_user")
    op.execute("REVOKE USAGE ON SCHEMA audit FROM app_user")
