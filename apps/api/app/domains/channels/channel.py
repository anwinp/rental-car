"""OTA Channel abstraction — abstract base class for all OTA channel implementations."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional


@dataclass
class OTALead:
    ota_booking_ref: str
    channel_name: str
    customer_name: str
    customer_email: Optional[str]
    customer_phone: Optional[str]
    pickup_date: date
    return_date: date
    vehicle_class_requested: str
    special_requests: Optional[str]
    received_at: datetime
    raw_payload: dict


@dataclass
class ConfirmResult:
    success: bool
    ota_confirmation_ref: Optional[str]
    error_message: Optional[str] = None


@dataclass
class RejectResult:
    success: bool
    error_message: Optional[str] = None


class OTAChannel(ABC):
    channel_name: str

    @abstractmethod
    async def poll_new_leads(self, since: Optional[datetime] = None) -> list[OTALead]: ...

    @abstractmethod
    async def confirm_booking(self, ota_booking_ref: str, internal_reservation_id: str) -> ConfirmResult: ...

    @abstractmethod
    async def reject_booking(self, ota_booking_ref: str, reason: str) -> RejectResult: ...

    @abstractmethod
    async def push_availability(self, date_from: date, date_to: date, vehicle_class_id: str, available_count: int) -> bool: ...

    @abstractmethod
    async def push_rate(self, date_from: date, date_to: date, vehicle_class_id: str, daily_rate: Decimal) -> bool: ...

    def handle_webhook(self, payload: dict, headers: dict) -> Optional[OTALead]:
        raise NotImplementedError(f"{self.__class__.__name__}.handle_webhook: implement when OTA format confirmed.")
