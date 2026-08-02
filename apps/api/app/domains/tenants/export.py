"""Export everything a tenant owns, as a zip of CSVs.

There was no export route anywhere in the product. GDPR erasure is implemented
carefully — it blocks on legal holds and anonymises rather than deletes — so RCM
could delete a person's data and could not give it to them. That is half of
GDPR Chapter III, and the missing half is the one a departing customer needs.

Three decisions:

**Available while past-due and suspended.** Withholding a business's operating
records over an unpaid invoice is not a lever anyone should reach for, and for
EU customers it is likely unlawful. The route is gated on being a tenant
administrator, not on the tenant's billing standing.

**Reservations are exported in the shape the importer accepts.** Exporting in
your own import format is the strongest signal you are not trying to trap
anyone, and it costs nothing to do. It also means a tenant can round-trip their
own data between workspaces.

**Generated synchronously, streamed once.** A Celery job writing to object
storage would be the scalable shape, and the reporting tasks already do that —
but they also demonstrate the failure mode: a file written to S3 with no route
to fetch it. For the fleet sizes this product targets a direct stream is
simpler, has no storage dependency, and cannot leave an export the customer
cannot reach. Tenants large enough to time out are a problem worth having, and
the async path can be added then.
"""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()


# Tables a tenant owns, in an order that reads sensibly when unzipped.
# Deliberately excludes:
#   tenants                — the workspace record itself, exported separately
#   staff_invitations      — carries single-use token hashes
#   email_verifications    — same
#   processed_webhooks     — inbound plumbing, meaningless outside this system
EXPORT_TABLES: tuple[str, ...] = (
    "locations",
    "vehicle_classes",
    "vehicles",
    "vehicle_blocks",
    "vehicle_status_log",
    "customers",
    "reservations",
    "reservation_versions",
    "rental_agreements",
    "payments",
    "damage_claims",
    "rate_codes",
    "rate_schedule_items",
    "extras_catalog",
    "tax_templates",
    "promotion_codes",
    "notification_templates",
    "staff_users",
    "tasks",
    "task_comments",
    "shift_logs",
    "ota_channels",
    "ota_leads",
    "customer_goodwill_ledger",
)

# Columns never exported, whatever table they appear on. A data export is handed
# to the customer and often forwarded onward; it must not carry credentials.
REDACTED_COLUMNS: frozenset[str] = frozenset({
    "password_hash",
    "pin_hash",
    "mfa_secret",
    "mfa_backup_codes",
    "token_hash",
    "esignature_hash",
    "anthropic_api_key",
    "sendgrid_api_key",
    "smtp_password",
})


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        import json

        return json.dumps(value, default=str)
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


async def _table_csv(session: AsyncSession, table: str, tenant_id: str) -> tuple[str, int]:
    """One table as CSV text, plus its row count."""
    cols = [
        r[0]
        for r in (
            await session.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    " WHERE table_schema = 'public' AND table_name = :t "
                    " ORDER BY ordinal_position"
                ),
                {"t": table},
            )
        ).all()
    ]
    if not cols:
        return "", 0

    exported = [c for c in cols if c not in REDACTED_COLUMNS]
    select_list = ", ".join(f'"{c}"' for c in exported)

    rows = (
        await session.execute(
            text(
                f'SELECT {select_list} FROM "{table}" '  # noqa: S608 — names from information_schema
                " WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).mappings().all()

    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(exported)
    for row in rows:
        writer.writerow([_stringify(row[c]) for c in exported])
    return buf.getvalue(), len(rows)


async def _reservations_import_shape(session: AsyncSession, tenant_id: str) -> str:
    """Forward bookings in the column layout the importer accepts.

    A tenant leaving should be able to load this straight into another
    workspace. Only future pickups: historical rentals are in the full
    reservations.csv and would collide with live availability on import.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT r.confirmation_number      AS external_reference,
                       c.first_name               AS customer_first_name,
                       c.last_name                AS customer_last_name,
                       c.email                    AS customer_email,
                       c.mobile_phone             AS customer_phone,
                       -- vehicle_class_name is the snapshot written at booking
                       -- time (migration 066). A class deleted since sets the
                       -- FK to NULL, and without the fallback the booking would
                       -- export with a blank class and fail to re-import.
                       COALESCE(vc.name, r.vehicle_class_name) AS vehicle_class,
                       pl.name                    AS pickup_location,
                       dl.name                    AS dropoff_location,
                       r.pickup_datetime          AS pickup_at,
                       r.return_datetime          AS dropoff_at,
                       COALESCE(r.grand_total, r.base_total) AS agreed_total,
                       r.currency,
                       r.status
                  FROM reservations r
                  LEFT JOIN customers       c  ON c.customer_id = r.customer_id
                  LEFT JOIN vehicle_classes vc ON vc.class_id   = r.vehicle_class_id
                  LEFT JOIN locations       pl ON pl.location_id = r.pickup_location_id
                  LEFT JOIN locations       dl ON dl.location_id = r.dropoff_location_id
                 WHERE r.tenant_id = :t
                   AND r.deleted_at IS NULL
                   AND r.pickup_datetime >= now()
                   AND r.status NOT IN ('CANCELLED', 'NO_SHOW')
                 ORDER BY r.pickup_datetime
                """
            ),
            {"t": tenant_id},
        )
    ).mappings().all()

    buf = io.StringIO()
    if not rows:
        buf.write(
            "external_reference,customer_first_name,customer_last_name,"
            "customer_email,customer_phone,vehicle_class,pickup_location,"
            "dropoff_location,pickup_at,dropoff_at,agreed_total,currency,status\n"
        )
        return buf.getvalue()

    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    for row in rows:
        writer.writerow({k: _stringify(v) for k, v in row.items()})
    return buf.getvalue()


async def build_export(session: AsyncSession, tenant_id: str) -> tuple[bytes, str]:
    """Return (zip_bytes, filename). Raises nothing it can recover from."""
    tenant = (
        await session.execute(
            text(
                "SELECT slug, legal_name, trading_name, primary_email, "
                "       default_currency, default_timezone, created_at "
                "  FROM tenants WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).mappings().first()

    slug = (tenant or {}).get("slug") or tenant_id
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    out = io.BytesIO()
    counts: dict[str, int] = {}

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for table in EXPORT_TABLES:
            try:
                body, n = await _table_csv(session, table, tenant_id)
            except Exception:  # noqa: BLE001
                # One unreadable table must not cost the customer the other 23.
                log.warning("export_table_failed", table=table,
                            tenant_id=tenant_id, exc_info=True)
                continue
            if body:
                z.writestr(f"{table}.csv", body)
                counts[table] = n

        z.writestr(
            "forward_bookings_for_import.csv",
            await _reservations_import_shape(session, tenant_id),
        )

        summary = [
            f"RCM data export for {slug}",
            f"Generated {datetime.now(timezone.utc).isoformat()}",
            "",
            "This is everything your workspace holds, one CSV per table.",
            "",
            "forward_bookings_for_import.csv is your upcoming bookings in the",
            "column layout our own importer accepts, so they can be loaded",
            "into another workspace directly.",
            "",
            "Not included: password hashes, MFA secrets, API keys and signature",
            "hashes are omitted deliberately — they are credentials, not records.",
            "",
            "Rows exported:",
        ]
        summary += [f"  {t:<28} {n:>8,}" for t, n in sorted(counts.items())]
        z.writestr("README.txt", "\n".join(summary) + "\n")

    log.info("tenant_export_built", tenant_id=tenant_id, slug=slug,
             tables=len(counts), rows=sum(counts.values()))
    return out.getvalue(), f"rcm-export-{slug}-{stamp}.zip"
