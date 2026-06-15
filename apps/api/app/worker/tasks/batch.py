"""
Batch maintenance tasks.

The canonical task names used in celery_app.beat_schedule live in fleet_tasks.py.
This module re-exports them so the task routing table in celery_app.py
(which uses "app.worker.tasks.batch.*" patterns) resolves correctly.

Also provides stubs for:
  - depreciation_journal_entries  (Wave G)
  - sync_telematics_events         (Wave G)
  - archive_old_records            (Wave G)
"""
from __future__ import annotations

from typing import Any

import structlog

from app.worker.celery_app import celery_app

# Re-export fleet batch tasks so routing table "app.worker.tasks.batch.*" works
from app.worker.tasks.fleet_tasks import (  # noqa: F401
    poll_nhtsa_recalls as nhtsa_recall_poll,
    rebuild_availability_cache as availability_cache_rebuild,
)

log = structlog.get_logger()


# ---------------------------------------------------------------------------
# Depreciation journal entries (stub — Wave G)
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.worker.tasks.batch.depreciation_journal_entries",
    queue="batch",
    bind=True,
    max_retries=2,
    default_retry_delay=600,
)
def depreciation_journal_entries(self: Any) -> dict:  # type: ignore[type-arg]
    """
    Monthly (1st of month at 01:00 UTC): generate depreciation journal entries
    for all active vehicles across all tenants.

    Implementation deferred to Wave G (accounting integration).
    """
    log.info("depreciation_journal_entries_stub_called")
    return {"status": "stub", "message": "Depreciation journal entries not yet implemented."}


# ---------------------------------------------------------------------------
# Telematics sync (stub — Wave G)
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.worker.tasks.batch.sync_telematics_events",
    queue="batch",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def sync_telematics_events(self: Any) -> dict:  # type: ignore[type-arg]
    """
    Periodic: pull telematics events from Geotab/Samsara and persist
    to telematics_events table.

    Implementation deferred to Wave G (telematics integration — Phase 3).
    """
    log.info("sync_telematics_events_stub_called")
    return {"status": "stub", "message": "Telematics sync not yet implemented."}


# ---------------------------------------------------------------------------
# Archive old records (stub — Wave G)
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.worker.tasks.batch.archive_old_records",
    queue="batch",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def archive_old_records(self: Any) -> dict:  # type: ignore[type-arg]
    """
    Periodic: archive records older than retention threshold to archive tables.
    Invokes the pg_partman / archive_job stored procedure.

    Implementation deferred to Wave G.
    """
    log.info("archive_old_records_stub_called")
    return {"status": "stub", "message": "Archive job not yet implemented."}
