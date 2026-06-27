from __future__ import annotations
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel

class TaskCreate(BaseModel):
    task_type: str
    title: str
    notes: Optional[str] = None
    due_datetime: Optional[datetime] = None
    priority: str = "MEDIUM"
    assignee_id: Optional[UUID] = None
    vehicle_id: Optional[UUID] = None
    reservation_id: Optional[UUID] = None
    location_id: Optional[UUID] = None

class TaskUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    notes: Optional[str] = None
    due_datetime: Optional[datetime] = None
    assignee_id: Optional[UUID] = None
    blocked_reason: Optional[str] = None

class TaskResponse(BaseModel):
    model_config = {"from_attributes": True}
    task_id: str
    tenant_id: str
    task_type: str
    title: str
    notes: Optional[str] = None
    status: str
    priority: str
    due_datetime: Optional[datetime] = None
    assignee_id: Optional[str] = None
    reservation_id: Optional[str] = None
    vehicle_id: Optional[str] = None
    location_id: Optional[str] = None
    created_by: str
    blocked_reason: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class DailyTaskSection(BaseModel):
    label: str
    tasks: list[TaskResponse]

class StaffDailyTasksResponse(BaseModel):
    date: str
    sections: list[DailyTaskSection]
    total_count: int
    done_count: int
