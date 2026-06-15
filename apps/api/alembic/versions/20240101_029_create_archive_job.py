"""create archive.run_archive_job procedure and pg_cron schedule

Revision ID: 029_archive_job
Revises: 028_archive_tables
Create Date: 2024-01-01

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '029_archive_job'
down_revision: str | None = '028_archive_tables'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE PROCEDURE archive.run_archive_job()
        LANGUAGE plpgsql AS $$
        DECLARE
          _legal_hold_ids TEXT[] := ARRAY(
            SELECT DISTINCT resource_id FROM audit.audit_events
             WHERE resource_type = 'rental_agreements'
               AND action = 'CONFIG_CHANGE' AND new_data->>'flag' = 'LEGAL_HOLD'
          );
          _rows_archived INT := 0;
        BEGIN
          -- Step 1: copy CLOSED RAs >1yr into archive (skip legal holds and already-archived)
          INSERT INTO archive.rental_agreements
          SELECT ra.*, now()
            FROM public.rental_agreements ra
           WHERE ra.status = 'CLOSED'
             AND ra.actual_return_datetime < now() - INTERVAL '1 year'
             AND ra.ra_id NOT IN (SELECT ra_id FROM archive.rental_agreements)
             AND ra.ra_id::TEXT != ALL(_legal_hold_ids);
          GET DIAGNOSTICS _rows_archived = ROW_COUNT;

          -- Step 2: soft-delete archived RAs from public
          UPDATE public.rental_agreements SET deleted_at = now()
           WHERE status = 'CLOSED' AND actual_return_datetime < now() - INTERVAL '1 year'
             AND deleted_at IS NULL;

          -- Step 3: archive terminal reservations with no open RA
          INSERT INTO archive.reservations
          SELECT r.*, now()
            FROM public.reservations r
           WHERE r.status IN ('CANCELLED','CLOSED','NO_SHOW')
             AND r.updated_at < now() - INTERVAL '1 year'
             AND r.reservation_id NOT IN (SELECT reservation_id FROM archive.reservations)
             AND NOT EXISTS (
               SELECT 1 FROM public.rental_agreements ra
                WHERE ra.reservation_id = r.reservation_id AND ra.status IN ('ACTIVE','EXTENDED','DISPUTED')
             );
          UPDATE public.reservations SET deleted_at = now()
           WHERE status IN ('CANCELLED','CLOSED','NO_SHOW') AND updated_at < now() - INTERVAL '1 year'
             AND deleted_at IS NULL;

          -- Step 4: hard-delete archive rows past 7-year retention (no legal hold)
          DELETE FROM archive.rental_agreements
           WHERE archived_at < now() - INTERVAL '7 years'
             AND ra_id::TEXT != ALL(_legal_hold_ids);

          -- Step 5: log run
          INSERT INTO audit.audit_events (action, resource_type, resource_id, new_data)
          VALUES ('CONFIG_CHANGE','archive_job','nightly',
                  jsonb_build_object('ran_at',now(),'rows_archived',_rows_archived));
          COMMIT;
        END;
        $$
    """)

    # pg_cron: nightly archive job at 02:00 UTC
    op.execute("""
        SELECT cron.schedule('archive-nightly','0 2 * * *',$$CALL archive.run_archive_job()$$)
    """)

    # pg_cron: nightly partition maintenance at 02:30 UTC
    op.execute("""
        SELECT cron.schedule(
          'partman-maintenance',
          '30 2 * * *',
          $$SELECT partman.run_maintenance_proc()$$
        )
    """)


def downgrade() -> None:
    op.execute("SELECT cron.unschedule('archive-nightly')")
    op.execute("SELECT cron.unschedule('partman-maintenance')")
    op.execute("DROP PROCEDURE IF EXISTS archive.run_archive_job()")
