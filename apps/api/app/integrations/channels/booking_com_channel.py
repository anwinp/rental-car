"""Booking.com Connectivity API channel — skeleton."""
from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from app.domains.channels.channel import ConfirmResult, OTAChannel, OTALead, RejectResult


class BookingComChannel(OTAChannel):
    channel_name = "BOOKING_COM"

    def __init__(self, api_key: str, api_secret: str, property_id: str) -> None:
        self._api_key = api_key
        self._api_secret = api_secret
        self._property_id = property_id

    async def poll_new_leads(self, since: Optional[datetime] = None) -> list[OTALead]:
        raise NotImplementedError("BookingComChannel.poll_new_leads: needs BOOKING_COM_CLIENT_ID + credentials.")

    async def confirm_booking(self, ota_booking_ref, internal_reservation_id) -> ConfirmResult:
        raise NotImplementedError("BookingComChannel.confirm_booking: POST /demand/reservations/{id}/confirm")

    async def reject_booking(self, ota_booking_ref, reason) -> RejectResult:
        raise NotImplementedError("BookingComChannel.reject_booking: POST /demand/reservations/{id}/deny")

    async def push_availability(self, date_from, date_to, vehicle_class_id, available_count) -> bool:
        raise NotImplementedError("BookingComChannel.push_availability: PUT /supply/rooms/availability")

    async def push_rate(self, date_from, date_to, vehicle_class_id, daily_rate) -> bool:
        raise NotImplementedError("BookingComChannel.push_rate: PUT /supply/rooms/rates")
