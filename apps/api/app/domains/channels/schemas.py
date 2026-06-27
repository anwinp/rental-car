from __future__ import annotations
from datetime import datetime, date
from typing import Optional
from uuid import UUID
from pydantic import BaseModel


class OTALeadResponse(BaseModel):
    model_config = {"from_attributes": True}
    lead_id: str
    tenant_id: str
    channel_name: str
    ota_booking_ref: str
    customer_name: str
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    pickup_date: Optional[date] = None
    return_date: Optional[date] = None
    vehicle_class_requested: str
    status: str
    internal_reservation_id: Optional[str] = None
    received_at: Optional[datetime] = None


class ConfirmLeadRequest(BaseModel):
    notify_customer: bool = True


class RejectLeadRequest(BaseModel):
    reason: str
