"""Email verification for self-service sign-ups.

A public endpoint that creates workspaces and sends mail is a spam target, and
an unverified address means an unreachable owner. Tenants therefore start
PENDING_VERIFICATION — which the login path already refuses — and become ACTIVE
only when the address is proven.

Design notes:

- Only a SHA-256 hash of the token is persisted. The token lives in the email.
- Tokens are single-use and expire; resending supersedes outstanding ones so a
  forwarded older link cannot be replayed.
- Verification and resend never disclose whether an address is registered.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = structlog.get_logger()

TOKEN_TTL = timedelta(hours=24)
RESEND_LIMIT = 5  # per address, across the token's lifetime


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verification_link(token: str, base_url: str) -> str:
    return f"{base_url.rstrip('/')}/verify?token={token}"


async def issue_token(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    email: str,
) -> str:
    """Create a verification token, superseding any outstanding ones."""
    # Invalidating older tokens means a forwarded earlier email stops working
    # the moment a new one is requested.
    await session.execute(
        text(
            "UPDATE email_verifications SET consumed_at = now() "
            "WHERE lower(email) = lower(:e) AND consumed_at IS NULL"
        ),
        {"e": email},
    )

    token = secrets.token_urlsafe(32)
    await session.execute(
        text(
            """
            INSERT INTO email_verifications (
                verification_id, tenant_id, user_id, email, token_hash, expires_at
            ) VALUES (:vid, :tid, :uid, :email, :hash, :expires)
            """
        ),
        {
            "vid": str(uuid.uuid4()),
            "tid": str(tenant_id),
            "uid": str(user_id),
            "email": email,
            "hash": _hash(token),
            "expires": datetime.now(timezone.utc) + TOKEN_TTL,
        },
    )
    return token


class VerificationResult:
    """Outcome of consuming a token, with a message safe to show a visitor."""

    def __init__(self, ok: bool, message: str, slug: str | None = None) -> None:
        self.ok = ok
        self.message = message
        self.slug = slug


async def consume_token(session: AsyncSession, token: str) -> VerificationResult:
    """Verify a token and activate the workspace.

    Idempotent for the common double-click case: a token already consumed for a
    workspace that is now ACTIVE reports success rather than an error, because
    from the visitor's point of view the thing they wanted has happened.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT v.verification_id, v.tenant_id, v.user_id, v.expires_at,
                       v.consumed_at, t.slug, t.status
                FROM email_verifications v
                JOIN tenants t ON t.tenant_id = v.tenant_id
                WHERE v.token_hash = :hash
                """
            ),
            {"hash": _hash(token)},
        )
    ).mappings().first()

    if row is None:
        return VerificationResult(False, "This confirmation link is not valid.")

    if row["consumed_at"] is not None:
        if (row["status"] or "").upper() == "ACTIVE":
            return VerificationResult(
                True, "This workspace is already confirmed.", row["slug"]
            )
        return VerificationResult(False, "This confirmation link has already been used.")

    expires = row["expires_at"]
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return VerificationResult(
            False, "This confirmation link has expired. Request a new one."
        )

    await session.execute(
        text("UPDATE email_verifications SET consumed_at = now() WHERE verification_id = :v"),
        {"v": str(row["verification_id"])},
    )
    await session.execute(
        text(
            "UPDATE tenants SET status = 'ACTIVE', updated_at = now() "
            "WHERE tenant_id = :t AND status = 'PENDING_VERIFICATION'"
        ),
        {"t": str(row["tenant_id"])},
    )
    # staff_users is RLS-protected; adopt the tenant for this statement.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(row["tenant_id"])},
    )
    await session.execute(
        text("UPDATE staff_users SET email_verified_at = now() WHERE user_id = :u"),
        {"u": str(row["user_id"])},
    )

    log.info("tenant_verified", tenant_id=str(row["tenant_id"]), slug=row["slug"])
    return VerificationResult(True, "Your workspace is confirmed.", row["slug"])


async def resend_for_email(
    session: AsyncSession, email: str
) -> tuple[str, uuid.UUID, uuid.UUID] | None:
    """Find the pending workspace for an address and mint a fresh token.

    Returns None when there is nothing to resend — the caller must still answer
    identically either way, so the endpoint does not become an address oracle.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT v.tenant_id, v.user_id, v.email, v.sent_count
                FROM email_verifications v
                JOIN tenants t ON t.tenant_id = v.tenant_id
                WHERE lower(v.email) = lower(:e)
                  AND t.status = 'PENDING_VERIFICATION'
                ORDER BY v.created_at DESC
                LIMIT 1
                """
            ),
            {"e": email},
        )
    ).mappings().first()

    if row is None or (row["sent_count"] or 0) >= RESEND_LIMIT:
        return None

    token = await issue_token(session, row["tenant_id"], row["user_id"], row["email"])
    await session.execute(
        text(
            "UPDATE email_verifications SET sent_count = :n "
            "WHERE token_hash = :hash"
        ),
        {"n": (row["sent_count"] or 1) + 1, "hash": _hash(token)},
    )
    return token, row["tenant_id"], row["user_id"]


# ── Delivery ─────────────────────────────────────────────────────────────────

def _looks_like_placeholder(value: str) -> bool:
    return (not value) or "placeholder" in value.lower() or value.endswith(".placeholder")


async def send_verification_email(to_email: str, company: str, link: str) -> str:
    """Send the confirmation mail. Returns the transport actually used.

    Falls back through SMTP -> SendGrid -> log. The log transport exists so a
    developer without mail credentials still gets a working, inspectable flow
    rather than a silent failure — the link is written to the application log.
    """
    subject = f"Confirm your {company} workspace"
    html = f"""
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#111">Confirm your workspace</h2>
        <p style="color:#444;line-height:1.6">
          You created the <strong>{company}</strong> workspace on RCM. Confirm this
          address to activate it and sign in.
        </p>
        <p style="margin:28px 0">
          <a href="{link}"
             style="background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;
                    text-decoration:none;font-weight:600;display:inline-block">
            Confirm workspace
          </a>
        </p>
        <p style="color:#777;font-size:13px;line-height:1.6">
          This link expires in 24 hours. If you did not create this workspace you can
          ignore this email — nothing will be activated.
        </p>
        <p style="color:#aaa;font-size:12px;word-break:break-all">{link}</p>
      </div>
    """

    if settings.smtp_host:
        try:
            from app.integrations.smtp_client import send_email_smtp

            await send_email_smtp(
                to_email=to_email,
                subject=subject,
                html_body=html,
                from_email=settings.smtp_from_email or "noreply@rcm.local",
            )
            return "smtp"
        except Exception as exc:  # noqa: BLE001
            log.warning("verification_smtp_failed", error=str(exc)[:200])

    if not _looks_like_placeholder(settings.sendgrid_api_key.get_secret_value()):
        try:
            from app.integrations import SendGridClient

            await SendGridClient().send_email(
                to_email=to_email, subject=subject, html_content=html
            )
            return "sendgrid"
        except Exception as exc:  # noqa: BLE001
            log.warning("verification_sendgrid_failed", error=str(exc)[:200])

    log.warning(
        "verification_email_not_sent_no_transport",
        to=to_email,
        link=link,
        hint="configure SMTP_HOST or a real SENDGRID_API_KEY",
    )
    return "log"
