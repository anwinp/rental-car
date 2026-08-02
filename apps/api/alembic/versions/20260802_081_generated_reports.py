"""a record of every report generated, so one can be found again

Revision ID: 081_generated_reports
Revises: 080_audit_nullif
Create Date: 2026-08-02

The reporting endpoints computed a report, wrote a CSV to object storage, and
returned a Celery task id. Nothing recorded that any of it happened.

So the file existed at a key nobody had written down, no endpoint could list or
fetch it, and the admin page was hidden behind a build flag. A tenant could
start a report and had no way, ever, to read one. The docstring promised "a
report_id for status polling"; there was nothing to poll.

This is the missing middle. The computation and the upload were already there
and are unchanged.

Kept as its own table rather than columns on anything else because a report is
an event, not a property: the same tenant runs the same report for a hundred
different dates and wants to find the one from last March.

Phase: expand
Lock risk: none — new table
Reversible: yes. The CSVs in object storage survive; only the index is dropped.
"""
from __future__ import annotations

from alembic import op

revision: str = '081_generated_reports'
down_revision: str | None = '080_audit_nullif'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS generated_reports (
            report_id     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id     uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,

            kind          text NOT NULL,
            -- What was asked for, verbatim. A report is only meaningful
            -- alongside its parameters, and "revenue for which day?" is the
            -- first question anyone asks looking at a list of them.
            params        jsonb NOT NULL DEFAULT '{}'::jsonb,

            status        text NOT NULL DEFAULT 'PENDING',
            -- The object key, not a URL. URLs to private storage expire; the
            -- key is what survives, and a fresh signed URL is minted per
            -- download request.
            object_key    text,
            byte_size     bigint,
            row_count     integer,
            -- Headline figures, so a list can be useful without fetching every
            -- file behind it.
            summary       jsonb,
            error         text,

            requested_by  uuid,
            created_at    timestamptz NOT NULL DEFAULT now(),
            completed_at  timestamptz,

            CONSTRAINT generated_reports_status_check
                CHECK (status IN ('PENDING','RUNNING','READY','FAILED'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_generated_reports_tenant "
        "ON generated_reports (tenant_id, created_at DESC)"
    )

    op.execute("ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE generated_reports FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON generated_reports "
        "USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid) "
        "WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON generated_reports TO app_user")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS generated_reports")
