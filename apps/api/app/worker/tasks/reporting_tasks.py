"""
Reporting Celery tasks.

  generate_daily_revenue_report   — on-demand or scheduled, reports queue
  calculate_fleet_utilization     — on-demand or scheduled, reports queue

These tasks generate reports for a given tenant and period, store them in S3,
and record the report metadata in the database for download via
GET /api/v1/reporting/reports/{id}/download.

Both tasks are "chain-friendly" — they return a result dict that can be
piped into downstream tasks (e.g., email notification with download link).
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import json as _json
import structlog

from app.worker.celery_app import celery_app

log = structlog.get_logger()


# ---------------------------------------------------------------------------
# Daily Revenue Report
# ---------------------------------------------------------------------------



# ── Recording what was produced ──────────────────────────────────────────────
#
# Both tasks already computed a report and uploaded a CSV. Neither wrote down
# that it had happened, so the file sat at a key nobody had recorded and no
# endpoint could find it. This is what closes that loop.
#
# report_id is optional throughout: these tasks are also on the beat schedule
# and run with nobody waiting, and a scheduled run with no row to update is not
# an error.

async def _mark(report_id: str | None, tenant_id: str, **fields: Any) -> None:
    """Update the generated_reports row, if there is one."""
    if not report_id:
        return
    from sqlalchemy import text as _t

    from app.core.database import AsyncSessionLocal

    sets, params = [], {"r": report_id, "t": tenant_id}
    for key, value in fields.items():
        if key == "summary":
            sets.append("summary = CAST(:summary AS jsonb)")
            params["summary"] = _json.dumps(value, default=str)
        else:
            sets.append(f"{key} = :{key}")
            params[key] = value
    if not sets:
        return

    try:
        async with AsyncSessionLocal() as session:
            # generated_reports is under RLS and a worker carries no request
            # context, so the tenant is bound explicitly.
            await session.execute(
                _t("SELECT set_config('app.current_tenant_id', :t, true)"),
                {"t": tenant_id},
            )
            await session.execute(
                _t(
                    f"UPDATE generated_reports SET {', '.join(sets)} "
                    " WHERE report_id = CAST(:r AS uuid) AND tenant_id = CAST(:t AS uuid)"
                ),
                params,
            )
            await session.commit()
    except Exception:  # noqa: BLE001
        # A bookkeeping failure must not lose a report that was computed and
        # uploaded successfully. Loud, because the row is how anyone finds it.
        log.error("report_status_write_failed", report_id=report_id, exc_info=True)


@celery_app.task(
    name="app.worker.tasks.reports.generate_daily_revenue_report",
    queue="reports",
    bind=True,
    max_retries=2,
    soft_time_limit=300,
    time_limit=600,
    default_retry_delay=60,
)
def generate_daily_revenue_report(
    self: Any,  # type: ignore[type-arg]
    tenant_id: str,
    date: str,  # YYYY-MM-DD
    report_id: str | None = None,
) -> dict:
    """
    Generate a daily revenue report for a specific tenant and date.

    Aggregates:
      - Total rental revenue (base rate × days)
      - Extras revenue (CDW, GPS, child seats, etc.)
      - Tax collected (by tax code)
      - Refunds issued
      - Net revenue
      - Payment method breakdown

    Output: CSV uploaded to S3 at:
      s3://{S3_REPORTS_BUCKET}/tenants/{tenant_id}/revenue/{date}/daily_revenue.csv

    Returns a dict with S3 URI and summary statistics for caller consumption.

    Args:
        tenant_id: UUID string of the tenant.
        date:      Report date as YYYY-MM-DD string (UTC).
    """
    try:
        asyncio.run(_mark(report_id, tenant_id, status="RUNNING"))
        result = asyncio.run(_generate_daily_revenue_report_async(tenant_id, date))
        asyncio.run(_mark(
            report_id, tenant_id,
            status="READY",
            object_key=f"tenants/{tenant_id}/revenue/{date}/daily_revenue.csv",
            row_count=result.get("transaction_count"),
            summary={
                "net_revenue": result.get("net_revenue"),
                "total_revenue": result.get("total_revenue"),
                "total_refunded": result.get("total_refunded"),
                "transactions": result.get("transaction_count"),
            },
            completed_at=datetime.now(timezone.utc),
        ))
        log.info(
            "daily_revenue_report_generated",
            tenant_id=tenant_id,
            date=date,
            s3_uri=result.get("s3_uri"),
            total_revenue=result.get("total_revenue"),
        )
        return result
    except Exception as exc:
        log.error(
            "daily_revenue_report_error",
            tenant_id=tenant_id,
            date=date,
            error=str(exc),
        )
        # Marked FAILED only once retries are exhausted. Flagging it on the
        # first attempt would show a failure to the customer that the next
        # retry quietly fixes.
        if self.request.retries >= self.max_retries:
            asyncio.run(_mark(
                report_id, tenant_id, status="FAILED",
                error=str(exc)[:400],
                completed_at=datetime.now(timezone.utc),
            ))
        raise self.retry(exc=exc, countdown=60) from exc


async def _generate_daily_revenue_report_async(tenant_id: str, date: str) -> dict:
    """Async implementation — pulls data from DB, generates CSV, uploads to S3."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.core.config import settings

    started_at = datetime.now(timezone.utc)
    engine = create_async_engine(settings.database_url.get_secret_value(), echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Parse target date
    try:
        report_date = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise ValueError(f"Invalid date format: {date!r} — expected YYYY-MM-DD") from exc

    day_start = report_date
    day_end = report_date + timedelta(days=1)

    async with session_factory() as session:
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :tid, true)"),
            {"tid": tenant_id},
        )
        await session.execute(
            text("SELECT set_config('app.current_role', :r, true)"),
            {"r": "SUPER_ADMIN"},
        )

        # Aggregate payment data for the day
        result = await session.execute(
            text("""
                SELECT
                    payment_type,
                    payment_method,
                    status,
                    currency,
                    COUNT(*) AS transaction_count,
                    SUM(amount) AS gross_amount,
                    SUM(refunded_amount) AS total_refunded
                FROM payments
                WHERE tenant_id = :tid
                  AND created_at >= :day_start
                  AND created_at < :day_end
                  AND deleted_at IS NULL
                GROUP BY payment_type, payment_method, status, currency
                ORDER BY payment_type, payment_method
            """),
            {"tid": tenant_id, "day_start": day_start, "day_end": day_end},
        )
        payment_rows = result.fetchall()

        # Aggregate rental agreement completions for the day
        ra_result = await session.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE status = 'RETURNED') AS returned_count,
                    COUNT(*) FILTER (WHERE status = 'CHECKED_OUT') AS active_count,
                    COUNT(*) AS total_opened
                FROM rental_agreements
                WHERE tenant_id = :tid
                  AND created_at >= :day_start
                  AND created_at < :day_end
                  AND deleted_at IS NULL
            """),
            {"tid": tenant_id, "day_start": day_start, "day_end": day_end},
        )
        ra_stats = ra_result.first()

    await engine.dispose()

    # Build CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "payment_type", "payment_method", "status", "currency",
        "transaction_count", "gross_amount", "total_refunded", "net_amount",
    ])

    total_gross = Decimal("0")
    total_refunded = Decimal("0")
    for row in payment_rows:
        gross = Decimal(str(row[4] or 0))
        refunded = Decimal(str(row[5] or 0))
        net = gross - refunded
        total_gross += gross
        total_refunded += refunded
        writer.writerow([
            row[0], row[1], row[2], row[3],
            row[3], str(gross), str(refunded), str(net),
        ])

    net_revenue = total_gross - total_refunded
    csv_content = output.getvalue()

    # Upload to S3 (if boto3 available; skip gracefully in test/dev)
    s3_uri = f"s3://{settings.s3_reports_bucket}/tenants/{tenant_id}/revenue/{date}/daily_revenue.csv"
    try:
        from app.core.s3 import get_s3_client, supports_sse
        s3 = get_s3_client()
        extra = {"ServerSideEncryption": "AES256"} if supports_sse() else {}
        s3.put_object(
            Bucket=settings.s3_reports_bucket,
            Key=f"tenants/{tenant_id}/revenue/{date}/daily_revenue.csv",
            Body=csv_content.encode("utf-8"),
            ContentType="text/csv",
            **extra,
        )
        log.info("daily_revenue_report_uploaded", s3_uri=s3_uri)
    except ImportError:
        log.warning("boto3_not_available", s3_uri=s3_uri)
    except Exception as exc:  # noqa: BLE001
        log.error("s3_upload_error", s3_uri=s3_uri, error=str(exc))

    elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
    return {
        "report_id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "date": date,
        "s3_uri": s3_uri,
        "total_revenue": str(total_gross),
        "total_refunded": str(total_refunded),
        "net_revenue": str(net_revenue),
        "transaction_count": len(payment_rows),
        "rental_agreements_opened": int(ra_stats[2] or 0) if ra_stats else 0,
        "rental_agreements_returned": int(ra_stats[0] or 0) if ra_stats else 0,
        "elapsed_seconds": round(elapsed, 2),
    }


# ---------------------------------------------------------------------------
# Fleet Utilization Report
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.worker.tasks.reports.calculate_fleet_utilization",
    queue="reports",
    bind=True,
    max_retries=2,
    soft_time_limit=300,
    time_limit=600,
    default_retry_delay=60,
)
def calculate_fleet_utilization(
    self: Any,  # type: ignore[type-arg]
    tenant_id: str,
    period_start: str,  # YYYY-MM-DD
    period_end: str,    # YYYY-MM-DD (inclusive)
    report_id: str | None = None,
) -> dict:
    """
    Calculate fleet utilization percentage for a tenant over a given period.

    Utilization = (total vehicle-days in CHECKED_OUT status) /
                  (total vehicle-days in fleet) × 100

    Also computes per-class and per-location breakdowns.

    Args:
        tenant_id:    UUID string of the tenant.
        period_start: Start date (inclusive) as YYYY-MM-DD.
        period_end:   End date (inclusive) as YYYY-MM-DD.

    Returns:
        Dict with overall_utilization_pct, by_class, by_location, period details.
    """
    try:
        asyncio.run(_mark(report_id, tenant_id, status="RUNNING"))
        result = asyncio.run(
            _calculate_fleet_utilization_async(tenant_id, period_start, period_end)
        )
        asyncio.run(_mark(
            report_id, tenant_id,
            status="READY",
            object_key=f"tenants/{tenant_id}/utilization/{period_start}_{period_end}/fleet_utilization.csv",
            row_count=result.get("vehicle_count"),
            summary={
                "utilization_pct": result.get("utilization_pct"),
                "vehicles": result.get("vehicle_count"),
                "period": f"{period_start} to {period_end}",
            },
            completed_at=datetime.now(timezone.utc),
        ))
        log.info(
            "fleet_utilization_calculated",
            tenant_id=tenant_id,
            period_start=period_start,
            period_end=period_end,
            overall_utilization_pct=result.get("overall_utilization_pct"),
        )
        return result
    except Exception as exc:
        log.error(
            "fleet_utilization_error",
            tenant_id=tenant_id,
            period_start=period_start,
            period_end=period_end,
            error=str(exc),
        )
        if self.request.retries >= self.max_retries:
            asyncio.run(_mark(
                report_id, tenant_id, status="FAILED",
                error=str(exc)[:400],
                completed_at=datetime.now(timezone.utc),
            ))
        raise self.retry(exc=exc, countdown=60) from exc


async def _calculate_fleet_utilization_async(
    tenant_id: str, period_start: str, period_end: str
) -> dict:
    """Async implementation for fleet utilization calculation."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.core.config import settings

    started_at = datetime.now(timezone.utc)
    engine = create_async_engine(settings.database_url.get_secret_value(), echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Validate date formats
    try:
        start_dt = datetime.strptime(period_start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end_dt = datetime.strptime(period_end, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
    except ValueError as exc:
        raise ValueError(f"Invalid date format: {exc}") from exc

    period_days = (end_dt - start_dt).days

    async with session_factory() as session:
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :tid, true)"),
            {"tid": tenant_id},
        )
        await session.execute(
            text("SELECT set_config('app.current_role', :r, true)"),
            {"r": "SUPER_ADMIN"},
        )

        # Count active vehicles (denominator)
        total_result = await session.execute(
            text("""
                SELECT COUNT(*) AS vehicle_count
                FROM vehicles
                WHERE tenant_id = :tid
                  AND is_active = true
                  AND deleted_at IS NULL
            """),
            {"tid": tenant_id},
        )
        total_vehicles = int((total_result.first() or [0])[0])

        # Count vehicle-days spent in CHECKED_OUT status during the period
        utilization_result = await session.execute(
            text("""
                SELECT
                    COUNT(DISTINCT ra.vehicle_id) AS distinct_vehicles_rented,
                    SUM(
                        EXTRACT(EPOCH FROM (
                            LEAST(COALESCE(ra.returned_at, :end_dt), :end_dt)
                            - GREATEST(ra.picked_up_at, :start_dt)
                        )) / 86400.0
                    ) AS total_vehicle_days_rented
                FROM rental_agreements ra
                WHERE ra.tenant_id = :tid
                  AND ra.status IN ('CHECKED_OUT', 'RETURNED')
                  AND ra.picked_up_at < :end_dt
                  AND (ra.returned_at IS NULL OR ra.returned_at > :start_dt)
                  AND ra.deleted_at IS NULL
            """),
            {"tid": tenant_id, "start_dt": start_dt, "end_dt": end_dt},
        )
        util_row = utilization_result.first()
        total_vehicle_days_rented = float(util_row[1] or 0) if util_row else 0.0

        total_fleet_days = total_vehicles * period_days
        overall_pct = (
            (total_vehicle_days_rented / total_fleet_days * 100)
            if total_fleet_days > 0
            else 0.0
        )

        # Per-class breakdown
        class_result = await session.execute(
            text("""
                SELECT
                    vc.name AS class_name,
                    COUNT(DISTINCT v.vehicle_id) AS total_vehicles,
                    COUNT(DISTINCT ra.vehicle_id) AS rented_vehicles,
                    SUM(
                        EXTRACT(EPOCH FROM (
                            LEAST(COALESCE(ra.returned_at, :end_dt), :end_dt)
                            - GREATEST(ra.picked_up_at, :start_dt)
                        )) / 86400.0
                    ) AS vehicle_days_rented
                FROM vehicle_classes vc
                JOIN vehicles v ON v.class_id = vc.class_id
                LEFT JOIN rental_agreements ra
                    ON ra.vehicle_id = v.vehicle_id
                    AND ra.tenant_id = :tid
                    AND ra.status IN ('CHECKED_OUT', 'RETURNED')
                    AND ra.picked_up_at < :end_dt
                    AND (ra.returned_at IS NULL OR ra.returned_at > :start_dt)
                    AND ra.deleted_at IS NULL
                WHERE v.tenant_id = :tid
                  AND v.is_active = true
                  AND v.deleted_at IS NULL
                GROUP BY vc.class_id, vc.name
                ORDER BY vc.name
            """),
            {"tid": tenant_id, "start_dt": start_dt, "end_dt": end_dt},
        )
        by_class = []
        for row in class_result:
            class_fleet_days = int(row[1]) * period_days
            rented_days = float(row[3] or 0)
            util_pct = (rented_days / class_fleet_days * 100) if class_fleet_days > 0 else 0.0
            by_class.append({
                "class_name": row[0],
                "total_vehicles": int(row[1]),
                "rented_vehicles": int(row[2] or 0),
                "vehicle_days_rented": round(rented_days, 2),
                "utilization_pct": round(util_pct, 2),
            })

        # Per-location breakdown
        location_result = await session.execute(
            text("""
                SELECT
                    l.name AS location_name,
                    COUNT(DISTINCT v.vehicle_id) AS total_vehicles,
                    SUM(
                        EXTRACT(EPOCH FROM (
                            LEAST(COALESCE(ra.returned_at, :end_dt), :end_dt)
                            - GREATEST(ra.picked_up_at, :start_dt)
                        )) / 86400.0
                    ) AS vehicle_days_rented
                FROM locations l
                JOIN vehicles v ON v.location_id = l.location_id
                LEFT JOIN rental_agreements ra
                    ON ra.vehicle_id = v.vehicle_id
                    AND ra.tenant_id = :tid
                    AND ra.status IN ('CHECKED_OUT', 'RETURNED')
                    AND ra.picked_up_at < :end_dt
                    AND (ra.returned_at IS NULL OR ra.returned_at > :start_dt)
                    AND ra.deleted_at IS NULL
                WHERE v.tenant_id = :tid
                  AND v.is_active = true
                  AND v.deleted_at IS NULL
                GROUP BY l.location_id, l.name
                ORDER BY l.name
            """),
            {"tid": tenant_id, "start_dt": start_dt, "end_dt": end_dt},
        )
        by_location = []
        for row in location_result:
            loc_fleet_days = int(row[1]) * period_days
            rented_days = float(row[2] or 0)
            util_pct = (rented_days / loc_fleet_days * 100) if loc_fleet_days > 0 else 0.0
            by_location.append({
                "location_name": row[0],
                "total_vehicles": int(row[1]),
                "vehicle_days_rented": round(rented_days, 2),
                "utilization_pct": round(util_pct, 2),
            })

    await engine.dispose()
    elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
    return {
        "report_id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "period_start": period_start,
        "period_end": period_end,
        "period_days": period_days,
        "total_vehicles": total_vehicles,
        "total_fleet_days": total_fleet_days,
        "total_vehicle_days_rented": round(total_vehicle_days_rented, 2),
        "overall_utilization_pct": round(overall_pct, 2),
        "by_class": by_class,
        "by_location": by_location,
        "generated_at": started_at.isoformat(),
        "elapsed_seconds": round(elapsed, 2),
    }
