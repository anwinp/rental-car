from __future__ import annotations
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID
from pydantic import BaseModel

# These mirror the CHECK constraints on public.tasks. They are spelled out here
# so a wrong value is a 422 naming the accepted set, rather than the 500 that
# an unvalidated string produced when Postgres rejected the INSERT.
TaskType = Literal[
    "PICKUP_PREP", "RETURN_INSPECTION", "CUSTOMER_DROPOFF", "DOC_COLLECTION",
    "HANDOVER", "MAINTENANCE", "TURNAROUND", "RECALL_HOLD", "INSPECTION",
    "HOLD", "STAGING", "CHARGING", "GENERAL",
]
TaskPriority = Literal["HIGH", "MEDIUM", "LOW"]
TaskStatus = Literal["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]


class TaskCreate(BaseModel):
    task_type: TaskType
    title: str
    notes: Optional[str] = None
    due_datetime: Optional[datetime] = None
    priority: TaskPriority = "MEDIUM"
    assignee_id: Optional[UUID] = None
    vehicle_id: Optional[UUID] = None
    reservation_id: Optional[UUID] = None
    location_id: Optional[UUID] = None

class TaskUpdate(BaseModel):
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
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
