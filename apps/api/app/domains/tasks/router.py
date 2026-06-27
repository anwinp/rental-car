from __future__ import annotations
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.tasks.schemas import TaskCreate, TaskUpdate, TaskResponse, StaffDailyTasksResponse
from app.domains.tasks.service import TaskService

router = APIRouter()

@router.post("", response_model=dict, status_code=201)
async def create_task(
    body: TaskCreate,
    claims: UserClaims = Depends(require_permission("tasks", "create")),
    session: AsyncSession = Depends(get_session),
):
    svc = TaskService(session, claims.tenant_id)
    return await svc.create_task(body.model_dump(), claims.user_id)

@router.patch("/{task_id}", response_model=dict)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    claims: UserClaims = Depends(require_permission("tasks", "update")),
    session: AsyncSession = Depends(get_session),
):
    svc = TaskService(session, claims.tenant_id)
    return await svc.update_task(task_id, body.model_dump(exclude_none=True))

@router.get("/staff-daily", response_model=dict)
async def staff_daily_tasks(
    date: Optional[str] = Query(default=None),
    assignee_id: Optional[uuid.UUID] = Query(default=None),
    claims: UserClaims = Depends(require_permission("tasks", "read")),
    session: AsyncSession = Depends(get_session),
):
    svc = TaskService(session, claims.tenant_id)
    effective_assignee = assignee_id or claims.user_id
    return await svc.list_staff_daily(effective_assignee, date)

@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    status: Optional[str] = Query(default=None),
    vehicle_id: Optional[uuid.UUID] = Query(default=None),
    priority: Optional[str] = Query(default=None),
    assignee_id: Optional[uuid.UUID] = Query(default=None),
    claims: UserClaims = Depends(require_permission("tasks", "read")),
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import text
    filters = ["tenant_id = :tid", "deleted_at IS NULL"]
    params: dict = {"tid": str(claims.tenant_id)}
    if status:
        filters.append("status = :status")
        params["status"] = status
    if vehicle_id:
        filters.append("vehicle_id = :vid")
        params["vid"] = str(vehicle_id)
    if priority:
        filters.append("priority = :priority")
        params["priority"] = priority
    if assignee_id:
        filters.append("assignee_id = :assignee_id")
        params["assignee_id"] = str(assignee_id)
    where = " AND ".join(filters)
    result = await session.execute(
        text(f"SELECT * FROM tasks WHERE {where} ORDER BY due_datetime ASC NULLS LAST LIMIT 100"),
        params,
    )
    rows = result.mappings().all()
    return [
        TaskResponse.model_validate({
            **{k: str(v) if hasattr(v, 'hex') else v for k, v in row.items()}
        })
        for row in rows
    ]
