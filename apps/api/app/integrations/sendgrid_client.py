"""
SendGrid email integration client.
Uses the official SendGrid Python SDK v3.
"""
from __future__ import annotations

from typing import Any, Optional

import structlog
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, To

from app.core.exceptions import IntegrationCircuitOpenError, IntegrationError
from app.integrations.base import CircuitBreaker

log = structlog.get_logger()


class SendGridClient:
    """
    Wraps the SendGrid Python SDK (not raw HTTP) with circuit-breaker protection.
    Supports both template-based and direct HTML sends.
    """

    def __init__(self) -> None:
        from app.core.config import settings
        self._api_key = settings.sendgrid_api_key.get_secret_value()
        self._default_from_email = settings.sendgrid_from_email
        self._default_from_name = settings.sendgrid_from_name
        self.circuit = CircuitBreaker(
            integration_name="sendgrid",
            failure_threshold=5,
            recovery_timeout=60,
        )

    async def _guard(self) -> None:
        if not await self.circuit.allow_request():
            raise IntegrationCircuitOpenError("sendgrid")

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
        template_id: Optional[str] = None,
        dynamic_data: Optional[dict[str, Any]] = None,
    ) -> bool:
        """
        Send a transactional email via SendGrid.

        Args:
            to_email:      Recipient email address
            subject:       Email subject (ignored when template_id is set — template defines it)
            html_body:     Rendered HTML body (ignored when template_id is set)
            from_email:    Sender address (defaults to SENDGRID_FROM_EMAIL setting)
            from_name:     Sender display name (defaults to SENDGRID_FROM_NAME setting)
            template_id:   SendGrid Dynamic Template ID (d-xxx)
            dynamic_data:  Template variable substitutions for dynamic templates

        Returns:
            True on success (2xx response from SendGrid).
        Raises:
            IntegrationError on SendGrid API error.
        """
        await self._guard()

        sender = f"{from_name or self._default_from_name} <{from_email or self._default_from_email}>"
        try:
            if template_id:
                message = Mail(
                    from_email=sender,
                    to_emails=to_email,
                )
                message.template_id = template_id
                if dynamic_data:
                    message.dynamic_template_data = dynamic_data
            else:
                message = Mail(
                    from_email=sender,
                    to_emails=to_email,
                    subject=subject,
                    html_content=html_body,
                )

            sg = SendGridAPIClient(self._api_key)
            response = sg.send(message)

            if response.status_code >= 400:
                await self.circuit.record_failure()
                raise IntegrationError(
                    "sendgrid",
                    f"SendGrid returned HTTP {response.status_code}: {response.body}",
                )

            await self.circuit.record_success()
            log.info(
                "sendgrid_email_sent",
                to=to_email,
                subject=subject[:80] if not template_id else f"template:{template_id}",
                status=response.status_code,
            )
            return True

        except IntegrationError:
            raise
        except IntegrationCircuitOpenError:
            raise
        except Exception as exc:
            await self.circuit.record_failure()
            raise IntegrationError(
                "sendgrid",
                f"Failed to send email via SendGrid: {exc}",
            ) from exc
