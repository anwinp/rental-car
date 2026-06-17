"""Async SMTP email client — development/fallback when SendGrid is not configured."""
from __future__ import annotations

import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.core.config import settings

log = logging.getLogger(__name__)


async def send_email_smtp(
    to_email: str,
    subject: str,
    html_body: str,
    from_email: str | None = None,
    from_name: str | None = None,
) -> None:
    """
    Send an HTML email via SMTP (STARTTLS on port 587).
    Raises on failure — callers should catch and log.
    """
    sender_email = from_email or settings.smtp_from_email or settings.smtp_user
    sender_name = from_name or settings.smtp_from_name

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html_body, "html"))

    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user,
        password=settings.smtp_password.get_secret_value(),
        start_tls=True,
    )
    log.info("smtp_email_sent to=%s subject=%s", to_email, subject)
