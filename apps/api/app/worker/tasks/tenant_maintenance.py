"""Scheduled tenant housekeeping.

Abandoned signups previously accumulated forever, each holding a workspace
address hostage — someone who typed the wrong name and walked away kept that
name permanently.
"""
from __future__ import annotations

import asyncio
from datetime import timedelta

import structlog
from sqlalchemy import text

from app.worker.celery_app import celery_app

log = structlog.get_logger()

# Long enough that a real customer who signed up on a Friday and confirmed on
# Monday is never swept, short enough that addresses recycle.
UNVERIFIED_GRACE = timedelta(days=14)


@celery_app.task(name="tenants.sweep_unverified")
def sweep_unverified_tenants() -> dict:
    """Remove tenants that never confirmed their email address.

    Only ever touches PENDING_VERIFICATION workspaces that have no staff beyond
    the unconfirmed founder and no operational data — so a tenant that somehow
    started trading while unverified is left alone for a human to look at.
    """
    return asyncio.run(_sweep())


async def _sweep() -> dict:
    from app.core.database import AsyncSessionLocal

    removed, skipped = [], []
    async with AsyncSessionLocal() as session:
        candidates = (
            await session.execute(
                # make_interval takes an integer; asyncpg cannot bind a string
                # like '14 days' to an interval parameter.
                text(
                    "SELECT tenant_id, slug FROM tenants "
                    "WHERE status = 'PENDING_VERIFICATION' "
                    "  AND created_at < now() - make_interval(days => :grace)"
                ),
                {"grace": UNVERIFIED_GRACE.days},
            )
        ).mappings().all()

        for row in candidates:
            tid = str(row["tenant_id"])
            await session.execute(
                text("SELECT set_config('app.current_tenant_id', :t, true)"), {"t": tid}
            )
            counts = (
                await session.execute(
                    text(
                        "SELECT (SELECT count(*) FROM reservations) AS res,"
                        "       (SELECT count(*) FROM vehicles)     AS veh,"
                        "       (SELECT count(*) FROM customers)    AS cust"
                    )
                )
            ).mappings().first() or {}

            if any(counts.get(k, 0) for k in ("res", "veh", "cust")):
                skipped.append(row["slug"])
                log.warning("sweep_skipped_tenant_has_data", slug=row["slug"], **counts)
                continue

            # Scoped explicitly: RLS is a backstop, not the delete predicate.
            for table in ("email_verifications", "staff_invitations", "rate_codes",
                          "locations", "staff_users"):
                try:
                    async with session.begin_nested():
                        await session.execute(
                            text(f"DELETE FROM {table} WHERE tenant_id = :t"),  # noqa: S608
                            {"t": tid},
                        )
                except Exception as exc:  # noqa: BLE001
                    log.warning("sweep_table_skipped", table=table, error=str(exc)[:120])

            await session.execute(
                text("SELECT set_config('app.current_tenant_id', '', true)")
            )
            await session.execute(
                text("DELETE FROM tenants WHERE tenant_id = :t"), {"t": tid}
            )
            removed.append(row["slug"])

        await session.commit()

    log.info("sweep_unverified_complete", removed=len(removed), skipped=len(skipped))
    return {"removed": removed, "skipped": skipped}
