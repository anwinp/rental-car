"""Transactional email delivery.

One transport chain for every transactional message, so a working mail setup is
proven once rather than per feature:

    SMTP  ->  SendGrid  ->  log

The log transport is not a silent failure — it is the honest fallback for a
developer with no mail credentials, and callers are told which transport ran so
the UI can adapt (see `email_sent` on registration).

Extracted from the verification flow once password reset needed the same thing.
Before that, reset generated a token and only logged a comment saying production
should send something — which meant the sole administrator of a new workspace
could be permanently locked out.
"""
from __future__ import annotations

import structlog

from app.core.config import settings

log = structlog.get_logger()

# Anything obviously placeholder should fall through rather than fail loudly at
# send time, which is what "SG.placeholder" in a dev .env would otherwise do.
_PLACEHOLDER_HINTS = ("placeholder", "changeme", "xxx", "your-key")


def _is_placeholder(value: str) -> bool:
    low = (value or "").lower()
    return (not low) or any(hint in low for hint in _PLACEHOLDER_HINTS)


def wrap_html(title: str, body_html: str, cta_text: str = "", cta_url: str = "") -> str:
    """Shared shell so every transactional email looks like the same product."""
    cta = ""
    if cta_text and cta_url:
        cta = f"""
        <p style="margin:28px 0">
          <a href="{cta_url}"
             style="background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;
                    text-decoration:none;font-weight:600;display:inline-block">
            {cta_text}
          </a>
        </p>
        <p style="color:#aaa;font-size:12px;word-break:break-all">{cta_url}</p>
        """
    return f"""
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
        <h2 style="color:#111">{title}</h2>
        <div style="color:#444;line-height:1.6">{body_html}</div>
        {cta}
      </div>
    """


async def send_email(to_email: str, subject: str, html: str, *, kind: str = "generic") -> str:
    """Deliver one message. Returns the transport used: smtp | sendgrid | log."""
    if settings.smtp_host:
        try:
            from app.integrations.smtp_client import send_email_smtp

            await send_email_smtp(
                to_email=to_email,
                subject=subject,
                html_body=html,
                from_email=settings.smtp_from_email or "noreply@rcm.local",
            )
            log.info("email_sent", kind=kind, transport="smtp", to=to_email)
            return "smtp"
        except Exception as exc:  # noqa: BLE001
            log.warning("email_smtp_failed", kind=kind, error=str(exc)[:200])

    if not _is_placeholder(settings.sendgrid_api_key.get_secret_value()):
        try:
            from app.integrations import SendGridClient

            await SendGridClient().send_email(
                to_email=to_email, subject=subject, html_content=html
            )
            log.info("email_sent", kind=kind, transport="sendgrid", to=to_email)
            return "sendgrid"
        except Exception as exc:  # noqa: BLE001
            log.warning("email_sendgrid_failed", kind=kind, error=str(exc)[:200])

    log.warning(
        "email_not_sent_no_transport",
        kind=kind,
        to=to_email,
        subject=subject,
        hint="configure SMTP_HOST or a real SENDGRID_API_KEY",
    )
    return "log"
