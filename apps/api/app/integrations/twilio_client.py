"""
Twilio SMS integration client.
Uses the official Twilio Python SDK.
"""
from __future__ import annotations

import re
import structlog
from typing import Optional

from twilio.rest import Client as TwilioSDKClient
from twilio.base.exceptions import TwilioRestException

from app.core.exceptions import IntegrationCircuitOpenError, IntegrationError, ValidationError
from app.integrations.base import CircuitBreaker

log = structlog.get_logger()

# E.164 format: +[country_code][number], 7-15 digits
_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


class TwilioClient:
    """
    Wraps the Twilio Python SDK with circuit-breaker protection.
    All phone numbers must be in E.164 format before sending.
    """

    def __init__(self) -> None:
        from app.core.config import settings
        self._account_sid = settings.twilio_account_sid
        self._auth_token = settings.twilio_auth_token.get_secret_value()
        self._from_number = settings.twilio_from_number
        self.circuit = CircuitBreaker(
            integration_name="twilio",
            failure_threshold=5,
            recovery_timeout=60,
        )

    async def _guard(self) -> None:
        if not await self.circuit.allow_request():
            raise IntegrationCircuitOpenError("twilio")

    def _validate_e164(self, phone: str) -> str:
        """
        Validate and return the phone number in E.164 format.
        Raises ValidationError if the format is invalid.
        """
        if not _E164_RE.match(phone):
            raise ValidationError(
                f"Phone number '{phone}' is not in E.164 format (+[country][number])."
            )
        return phone

    async def send_sms(self, to_phone_e164: str, body: str) -> str:
        """
        Send an SMS message via Twilio.

        Args:
            to_phone_e164: Recipient phone in E.164 format (e.g. +15551234567)
            body:          Message text (max 1600 chars for multi-part SMS)

        Returns:
            Twilio message SID (e.g. SMxxx).
        Raises:
            ValidationError if phone is not E.164 format.
            IntegrationError on Twilio API error.
        """
        self._validate_e164(to_phone_e164)
        await self._guard()

        try:
            client = TwilioSDKClient(self._account_sid, self._auth_token)
            message = client.messages.create(
                to=to_phone_e164,
                from_=self._from_number,
                body=body[:1600],
            )
            await self.circuit.record_success()
            log.info(
                "twilio_sms_sent",
                to=to_phone_e164[:6] + "XXXX",  # Partial for privacy in logs
                sid=message.sid,
                status=message.status,
            )
            return message.sid

        except IntegrationCircuitOpenError:
            raise
        except ValidationError:
            raise
        except TwilioRestException as exc:
            await self.circuit.record_failure()
            raise IntegrationError(
                "twilio",
                f"Twilio API error {exc.code}: {exc.msg}",
            ) from exc
        except Exception as exc:
            await self.circuit.record_failure()
            raise IntegrationError(
                "twilio",
                f"Failed to send SMS via Twilio: {exc}",
            ) from exc
