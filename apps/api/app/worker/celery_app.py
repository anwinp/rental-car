from __future__ import annotations

from celery import Celery
from celery.schedules import crontab
from kombu import Exchange, Queue

from app.core.config import settings

# ── App instance ─────────────────────────────────────────────────────────────

_broker_url = settings.redis_broker_url.get_secret_value()
# Use DB 1 on the broker cluster for the result backend
_broker_base = _broker_url.rstrip("/0").rstrip("/")
_result_backend = f"{_broker_base}/1"

celery_app = Celery(
    "rcm",
    broker=_broker_url,
    backend=_result_backend,
    include=[
        "app.worker.tasks.notifications",
        "app.worker.tasks.rate_filing",
        "app.worker.tasks.reports",
        "app.worker.tasks.batch",
        "app.worker.tasks.toll_processing",
        "app.worker.tasks.payment_tasks",
        # Wave F additions
        "app.worker.tasks.fleet_tasks",
        "app.worker.tasks.reservation_tasks",
        "app.worker.tasks.reporting_tasks",
        # Wave G additions
        "app.worker.tasks.channel_tasks",
        # Agent tasks (Foundation stubs — real implementations in Wave 3)
        "app.worker.tasks.agent_tasks",
    ],
)

# ── Core configuration ────────────────────────────────────────────────────────

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,

    # Result backend
    result_expires=3600,  # 1h

    # Worker behavior
    worker_prefetch_multiplier=1,  # process one task at a time; prevents starvation
    task_acks_late=True,           # ack after task completes, not on receipt
    task_reject_on_worker_lost=True,

    # Broker connection
    broker_pool_limit=10,
    broker_connection_timeout=4.0,
    broker_connection_retry_on_startup=True,

    # RedBeat scheduler
    beat_scheduler="redbeat.RedBeatScheduler",
    beat_max_loop_interval=5,
    redbeat_redis_url=_broker_url,
    redbeat_key_prefix="redbeat:",
    redbeat_lock_timeout=900,  # 15 min

    # ── Six queues (agents isolated to prevent Claude API latency from starving others) ──
    task_queues=[
        Queue("notifications",   Exchange("rcm"), routing_key="notifications"),
        Queue("rate_filing",     Exchange("rcm"), routing_key="rate_filing"),
        Queue("reports",         Exchange("rcm"), routing_key="reports"),
        Queue("batch",           Exchange("rcm"), routing_key="batch"),
        Queue("toll_processing", Exchange("rcm"), routing_key="toll_processing"),
        Queue("agents",          Exchange("rcm"), routing_key="agents"),
    ],
    task_default_queue="batch",
    task_default_exchange="rcm",
    task_default_routing_key="batch",

    # ── Task routing table ────────────────────────────────────────────────────
    task_routes={
        # Notifications queue
        "app.worker.tasks.notifications.*":                      {"queue": "notifications"},
        "app.worker.tasks.notifications.dispatch_notification":  {"queue": "notifications"},
        "app.worker.tasks.notifications.no_show_transition":     {"queue": "notifications"},
        "app.worker.tasks.notifications.document_expiry_alerts": {"queue": "notifications"},

        # Rate filing queue
        "app.worker.tasks.rate_filing.*":                        {"queue": "rate_filing"},
        "app.worker.tasks.rate_filing.renew_expiring_preauths":  {"queue": "rate_filing"},
        "app.worker.tasks.rate_filing.file_rates_to_gds":        {"queue": "rate_filing"},

        # Toll processing queue
        "app.worker.tasks.toll_processing.*":                    {"queue": "toll_processing"},
        "app.worker.tasks.toll_processing.toll_charge_batch":    {"queue": "toll_processing"},

        # Reports queue
        "app.worker.tasks.reports.*":                            {"queue": "reports"},
        "app.worker.tasks.reports.pre_auth_expiry_report":       {"queue": "reports"},
        "app.worker.tasks.reports.generate_scheduled_report":    {"queue": "reports"},

        # Batch queue
        "app.worker.tasks.batch.*":                              {"queue": "batch"},
        "app.worker.tasks.batch.availability_cache_rebuild":     {"queue": "batch"},
        "app.worker.tasks.batch.nhtsa_recall_poll":              {"queue": "batch"},
        "app.worker.tasks.batch.depreciation_journal_entries":   {"queue": "batch"},
        "app.worker.tasks.batch.sync_telematics_events":         {"queue": "batch"},
        "app.worker.tasks.batch.archive_old_records":            {"queue": "batch"},

        # Payment tasks
        "app.worker.tasks.payment_tasks.*":                              {"queue": "batch"},
        "app.worker.tasks.payment_tasks.renew_expiring_preauths":        {"queue": "batch"},
        "app.worker.tasks.payment_tasks.process_notification_stream":    {"queue": "notifications"},

        # Wave F: Fleet tasks (canonical names live in batch queue)
        "app.worker.tasks.fleet_tasks.*":                                {"queue": "batch"},
        "app.worker.tasks.fleet_tasks.rebuild_availability_cache":       {"queue": "batch"},
        "app.worker.tasks.fleet_tasks.poll_nhtsa_recalls":               {"queue": "batch"},

        # Wave F: Reservation tasks (notifications queue)
        "app.worker.tasks.reservation_tasks.*":                          {"queue": "notifications"},
        "app.worker.tasks.reservation_tasks.process_no_shows":           {"queue": "notifications"},
        "app.worker.tasks.reservation_tasks.send_pre_rental_reminders":  {"queue": "notifications"},

        # Wave F: Reporting tasks (reports queue)
        "app.worker.tasks.reporting_tasks.*":                            {"queue": "reports"},
        "app.worker.tasks.reporting_tasks.generate_daily_revenue_report":    {"queue": "reports"},
        "app.worker.tasks.reporting_tasks.calculate_fleet_utilization":      {"queue": "reports"},

        # Wave G: Channel tasks (batch queue)
        "app.worker.tasks.channel_tasks.*":                                      {"queue": "batch"},
        "app.worker.tasks.channel_tasks.poll_ota_channels":                      {"queue": "batch"},
        "app.worker.tasks.channel_tasks.push_availability_to_all_channels":      {"queue": "batch"},

        # Wave G: Payment bond release (batch queue)
        "app.worker.tasks.payment_tasks.process_bond_release":                   {"queue": "batch"},

        # Agent tasks (isolated queue — Claude API latency 200-400ms must not starve notifications)
        "app.worker.tasks.agent_tasks.*":                                         {"queue": "agents"},
        "app.worker.tasks.agent_tasks.scan_ev_alerts":                           {"queue": "agents"},
        "app.worker.tasks.agent_tasks.scan_overdue_rentals":                     {"queue": "agents"},
    },

    # ── RedBeat beat schedule (8 tasks) ──────────────────────────────────────
    beat_schedule={
        # Pre-auth renewal — every 6 hours
        "renew-expiring-preauths": {
            "task": "app.worker.tasks.rate_filing.renew_expiring_preauths",
            "schedule": crontab(minute=0, hour="*/6"),
            "options": {"queue": "rate_filing", "expires": 21600},
        },
        # No-show transition — every 15 minutes
        "no-show-transition": {
            "task": "app.worker.tasks.notifications.no_show_transition",
            "schedule": crontab(minute="*/15"),
            "options": {"queue": "notifications", "expires": 900},
        },
        # NHTSA recall poll — daily at 02:00 UTC
        "nhtsa-recall-poll": {
            "task": "app.worker.tasks.batch.nhtsa_recall_poll",
            "schedule": crontab(minute=0, hour=2),
            "options": {"queue": "batch", "expires": 86400},
        },
        # Document expiry alerts — daily at 08:00 UTC
        "document-expiry-alerts": {
            "task": "app.worker.tasks.notifications.document_expiry_alerts",
            "schedule": crontab(minute=0, hour=8),
            "options": {"queue": "notifications", "expires": 86400},
        },
        # Toll charge batch — every 4 hours (at :30)
        "toll-charge-batch": {
            "task": "app.worker.tasks.toll_processing.toll_charge_batch",
            "schedule": crontab(minute=30, hour="*/4"),
            "options": {"queue": "toll_processing", "expires": 14400},
        },
        # Availability cache rebuild — every 5 minutes
        "availability-cache-rebuild": {
            "task": "app.worker.tasks.batch.availability_cache_rebuild",
            "schedule": crontab(minute="*/5"),
            "options": {"queue": "batch", "expires": 300},
        },
        # Depreciation journal entries — monthly, 1st at 01:00 UTC
        "depreciation-journal-entries": {
            "task": "app.worker.tasks.batch.depreciation_journal_entries",
            "schedule": crontab(minute=0, hour=1, day_of_month=1),
            "options": {"queue": "batch", "expires": 86400},
        },
        # Pre-auth expiry report — daily at 06:00 UTC
        "preauth-expiry-report": {
            "task": "app.worker.tasks.reports.pre_auth_expiry_report",
            "schedule": crontab(minute=0, hour=6),
            "options": {"queue": "reports", "expires": 86400},
        },
        # Task due reminders — every 15 minutes
        "task-due-reminders": {
            "task": "app.worker.tasks.notifications.task_due_reminder_scan",
            "schedule": crontab(minute="*/15"),
            "options": {"queue": "notifications", "expires": 900},
        },
        # OTA channel poll — every 5 minutes
        "ota-channel-poll": {
            "task": "app.worker.tasks.channel_tasks.poll_ota_channels",
            "schedule": crontab(minute="*/5"),
            "options": {"queue": "batch", "expires": 300},
        },
        # EV low-SOC alert scan — every 5 minutes (stub; real implementation in Wave 3)
        "ev-alert-poll": {
            "task": "app.worker.tasks.agent_tasks.scan_ev_alerts",
            "schedule": crontab(minute="*/5"),
            "options": {"queue": "agents", "expires": 300},
        },
        # Overdue rental scan — every 30 minutes (stub; real implementation in Wave 3)
        "overdue-tracker-scan": {
            "task": "app.worker.tasks.agent_tasks.scan_overdue_rentals",
            "schedule": crontab(minute="*/30"),
            "options": {"queue": "agents", "expires": 1800},
        },
    },
)
