"""Nightly: warn workspaces whose term is running out, lock out the ones whose
term has run out.

Runs beside tenants.sweep_unverified and follows its shape deliberately — one
task, one transaction per workspace, a summary returned for the log.

The policy is a hard lockout. When a term lapses, staff cannot sign in and the
storefront stops selling. That is a decision with a sharp edge: a customer who
cannot sign in cannot reach a billing page either, so the expiry email carries a
single-use reactivation link and that link is the only route back. Sending it is
therefore not a courtesy, it is part of the mechanism, and a failure to send is
logged loudly rather than swallowed.

Warnings go out at 7 days, 3 days, and on the day. The stage is recorded on the
workspace so a nightly task does not send the same notice every night for a
week.
"""
from __future__ import annotations

import asyncio
import secrets

import structlog
from sqlalchemy import text

from app.worker.celery_app import celery_app

log = structlog.get_logger()

# Days remaining at which each notice fires. Descending, and the stage stored on
# the tenant is an index into this list, so a workspace that crosses two
# thresholds between runs still only gets the more urgent one.
_WARN_DAYS = (7, 3, 0)


@celery_app.task(name="tenants.sweep_expired")
def sweep_expired_tenants() -> dict:
    """Warn, then lock out. Returns counts for the log."""
    return asyncio.run(_sweep())


def _term_sql(alias: str = "t") -> str:
    """The end of a workspace's paid or trial term.

    A workspace can carry both dates. The subscription is the commercial
    relationship and the trial is the runway before it, so a subscription end
    date wins where both exist; otherwise a paid customer whose trial record
    was never cleared would be locked out mid-term.
    """
    return f"COALESCE({alias}.subscription_ends_at, {alias}.trial_ends_at)"


async def _sweep() -> dict:
    from app.core.database import AsyncSessionLocal

    warned: list[str] = []
    expired: list[str] = []

    async with AsyncSessionLocal() as session:
        # `tenants` carries no RLS — it is the registry the resolver reads
        # before any tenant context exists — so these are plain queries.
        rows = (
            await session.execute(
                text(
                    f"""
                    SELECT tenant_id::text, slug, primary_email,
                           COALESCE(trading_name, legal_name, slug) AS name,
                           status, expiry_warn_stage,
                           {_term_sql()} AS term_end,
                           EXTRACT(day FROM ({_term_sql()} - now()))::int AS days_left
                      FROM tenants t
                     WHERE deleted_at IS NULL
                       AND status IN ('ACTIVE', 'TRIAL')
                       AND {_term_sql()} IS NOT NULL
                    """
                )
            )
        ).mappings().all()

        for r in rows:
            if r["term_end"] is None:
                continue
            days = r["days_left"]

            if days is not None and days < 0:
                await _expire(session, r)
                expired.append(r["slug"])
                continue

            # The most urgent unsent threshold this workspace has crossed.
            stage = int(r["expiry_warn_stage"] or 0)
            due = None
            for i, threshold in enumerate(_WARN_DAYS, start=1):
                if days is not None and days <= threshold and i > stage:
                    due = (i, threshold)
            if due:
                await _warn(session, r, stage=due[0], days_left=days)
                warned.append(r["slug"])

        await session.commit()

    log.info("sweep_expired_complete", warned=len(warned), expired=len(expired),
             warned_slugs=warned, expired_slugs=expired)
    return {"warned": warned, "expired": expired}


async def _warn(session, row, *, stage: int, days_left: int) -> None:
    from app.core.config import settings
    from app.core.mailer import send_email, wrap_html
    from app.core.tenancy import tenant_host

    host = tenant_host(row["slug"], settings.public_admin_host)
    url = f"{settings.public_url_scheme}://{host}/billing"
    when = "today" if days_left <= 0 else f"in {days_left} day{'s' if days_left != 1 else ''}"

    html = wrap_html(
        f"Your {row['name']} subscription ends {when}",
        f"<p>Access to <strong>{row['name']}</strong> ends {when}.</p>"
        "<p>When it does, your team will not be able to sign in and your "
        "booking site will stop taking reservations. Nothing is deleted — "
        "your data stays exactly as it is and returns the moment you renew.</p>",
        cta_text="Renew now", cta_url=url,
    )
    try:
        await send_email(
            to_email=row["primary_email"], subject=f"Your {row['name']} access ends {when}",
            html=html, kind="subscription_expiry_warning",
        )
    except Exception:  # noqa: BLE001 — one bad address must not stop the sweep
        log.warning("expiry_warning_failed", slug=row["slug"], exc_info=True)
        return

    await session.execute(
        text(
            "UPDATE tenants SET expiry_warn_stage = :s, expiry_warned_at = now(), "
            "       updated_at = now() WHERE tenant_id = :t"
        ),
        {"s": stage, "t": row["tenant_id"]},
    )
    log.info("expiry_warned", slug=row["slug"], days_left=days_left, stage=stage)


async def _expire(session, row) -> None:
    """Lock the workspace out and send the one link that can undo it."""
    from app.core.config import settings
    from app.core.mailer import send_email, wrap_html

    token = secrets.token_urlsafe(32)
    await session.execute(
        text(
            "UPDATE tenants "
            "   SET status = 'EXPIRED', "
            "       status_before_expiry = status, "
            "       expired_at = now(), "
            "       reactivation_token = :tok, "
            "       updated_at = now() "
            " WHERE tenant_id = :t AND status IN ('ACTIVE','TRIAL')"
        ),
        {"tok": token, "t": row["tenant_id"]},
    )

    # Every session dies now rather than running out its own clock. A staff
    # member holding an 8-hour counter token would otherwise keep checking
    # vehicles out of a workspace that has stopped paying.
    await _revoke_all(session, row["tenant_id"])

    url = (
        f"{settings.public_url_scheme}://{settings.public_admin_host}"
        f"/reactivate?token={token}"
    )
    html = wrap_html(
        f"{row['name']} access has ended",
        f"<p>The subscription for <strong>{row['name']}</strong> has ended, so "
        "sign-in and your booking site are switched off.</p>"
        "<p><strong>Nothing has been deleted.</strong> Your vehicles, "
        "reservations, customers and documents are all exactly where you left "
        "them, and everything returns the moment you renew.</p>"
        "<p>This link is the way back — you will not be able to sign in to find "
        "it later, so keep this email.</p>",
        cta_text="Renew and restore access", cta_url=url,
    )
    try:
        await send_email(
            to_email=row["primary_email"],
            subject=f"{row['name']} access has ended — renew to restore it",
            html=html, kind="subscription_expired",
        )
    except Exception:  # noqa: BLE001
        # Loud, because this email is not a courtesy: with a hard lockout it is
        # the customer's only route back to a payment page.
        log.error("expiry_email_failed", slug=row["slug"],
                  detail="workspace is locked out and holds no delivered link",
                  exc_info=True)

    log.warning("tenant_expired", slug=row["slug"], tenant_id=row["tenant_id"])


async def _revoke_all(session, tenant_id: str) -> None:
    from app.core.redis import REVOKED_TOKENS_SET, get_session_redis
    from app.core.security import bump_epoch
    from app.domains.auth.service import USER_SESSIONS_KEY

    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"), {"t": tenant_id}
    )
    users = [
        str(r[0])
        for r in (
            await session.execute(
                text(
                    "SELECT user_id FROM staff_users "
                    " WHERE tenant_id = :t AND deleted_at IS NULL"
                ),
                {"t": tenant_id},
            )
        ).all()
    ]
    for uid in users:
        await bump_epoch(session, uid)
    try:
        redis = get_session_redis()
        for uid in users:
            jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=uid))
            if jtis:
                await redis.sadd(REVOKED_TOKENS_SET, *jtis)
            await redis.delete(USER_SESSIONS_KEY.format(user_id=uid))
    except Exception:  # noqa: BLE001 — the epoch is the durable half
        log.warning("expiry_session_sweep_failed", tenant_id=tenant_id, exc_info=True)
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
