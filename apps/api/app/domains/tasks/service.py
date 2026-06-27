from __future__ import annotations
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import structlog, uuid

log = structlog.get_logger()

class TaskService:
    def __init__(self, session: AsyncSession, tenant_id: UUID):
        self._session = session
        self._tenant_id = tenant_id

    async def create_task(self, data: dict, created_by: UUID) -> dict:
        task_id = uuid.uuid4()
        await self._session.execute(
            text("""
                INSERT INTO tasks (task_id, tenant_id, task_type, title, notes,
                  status, priority, due_datetime, assignee_id, vehicle_id,
                  reservation_id, location_id, created_by)
                VALUES (:tid2, :tid, :ttype, :title, :notes,
                  'TODO', :priority, :due_dt, :assignee, :vehicle,
                  :reservation, :location, :created_by)
            """),
            {
                "tid2": str(task_id), "tid": str(self._tenant_id),
                "ttype": data.get("task_type", "GENERAL"),
                "title": data["title"], "notes": data.get("notes"),
                "priority": data.get("priority", "MEDIUM"),
                "due_dt": data.get("due_datetime"),
                "assignee": str(data["assignee_id"]) if data.get("assignee_id") else None,
                "vehicle": str(data["vehicle_id"]) if data.get("vehicle_id") else None,
                "reservation": str(data["reservation_id"]) if data.get("reservation_id") else None,
                "location": str(data["location_id"]) if data.get("location_id") else None,
                "created_by": str(created_by),
            },
        )
        await self._session.commit()
        return {"task_id": str(task_id), "status": "TODO"}

    async def update_task(self, task_id: UUID, data: dict) -> dict:
        updates = []
        params: dict = {"tid": str(self._tenant_id), "task_id": str(task_id)}
        for field in ("status", "priority", "notes", "due_datetime", "assignee_id", "blocked_reason"):
            if field in data and data[field] is not None:
                updates.append(f"{field} = :{field}")
                params[field] = str(data[field]) if field == "assignee_id" and data[field] else data[field]
        if not updates:
            return {}
        updates.append("updated_at = NOW()")
        await self._session.execute(
            text(f"UPDATE tasks SET {', '.join(updates)} WHERE task_id = :task_id AND tenant_id = :tid AND deleted_at IS NULL"),
            params,
        )
        await self._session.commit()
        return {"task_id": str(task_id), "updated": True}

    async def list_staff_daily(self, assignee_id: Optional[UUID], date_str: Optional[str]) -> dict:
        from datetime import date as date_type, timezone as tz
        target = date_type.fromisoformat(date_str) if date_str else date_type.today()
        today_start = datetime.combine(target, datetime.min.time(), tzinfo=tz.utc)
        today_end = datetime.combine(target, datetime.max.time(), tzinfo=tz.utc)
        tomorrow_end = today_end + timedelta(days=1)

        where = "tenant_id = :tid AND deleted_at IS NULL AND status != 'DONE'"
        params: dict = {"tid": str(self._tenant_id)}
        if assignee_id:
            where += " AND (assignee_id = :uid OR assignee_id IS NULL)"
            params["uid"] = str(assignee_id)

        result = await self._session.execute(
            text(f"SELECT * FROM tasks WHERE {where} ORDER BY due_datetime ASC NULLS LAST LIMIT 200"),
            params,
        )
        rows = result.mappings().all()

        done_result = await self._session.execute(
            text(f"SELECT COUNT(*) FROM tasks WHERE tenant_id = :tid AND deleted_at IS NULL AND status = 'DONE' AND created_at >= :today_start"),
            {"tid": str(self._tenant_id), "today_start": today_start},
        )
        done_count = done_result.scalar() or 0

        sections: dict = {"Overdue": [], "Today": [], "Tomorrow": [], "Later": []}
        for row in rows:
            d = dict(row)
            d["task_id"] = str(d["task_id"])
            d["tenant_id"] = str(d["tenant_id"])
            d["created_by"] = str(d["created_by"])
            if d.get("assignee_id"): d["assignee_id"] = str(d["assignee_id"])
            if d.get("reservation_id"): d["reservation_id"] = str(d["reservation_id"])
            if d.get("vehicle_id"): d["vehicle_id"] = str(d["vehicle_id"])
            if d.get("location_id"): d["location_id"] = str(d["location_id"])
            due = d.get("due_datetime")
            if due and due < today_start:
                sections["Overdue"].append(d)
            elif due and due <= today_end:
                sections["Today"].append(d)
            elif due and due <= tomorrow_end:
                sections["Tomorrow"].append(d)
            else:
                sections["Later"].append(d)

        return {
            "date": str(target),
            "sections": [{"label": k, "tasks": v} for k, v in sections.items() if v],
            "total_count": len(rows),
            "done_count": done_count,
        }

    async def auto_create_from_event(
        self, event_type: str, reservation_id: Optional[UUID] = None,
        vehicle_id: Optional[UUID] = None, due_datetime: Optional[datetime] = None,
        created_by: Optional[UUID] = None,
    ) -> None:
        if event_type == "RESERVATION_CONFIRMED" and reservation_id:
            due = due_datetime or (datetime.utcnow() + timedelta(hours=2))
            existing = await self._session.execute(
                text("SELECT 1 FROM tasks WHERE task_type='PICKUP_PREP' AND reservation_id=:rid AND deleted_at IS NULL"),
                {"rid": str(reservation_id)},
            )
            if existing.first():
                return
            await self._session.execute(
                text("""
                    INSERT INTO tasks (task_id, tenant_id, task_type, title,
                      status, priority, due_datetime, reservation_id, vehicle_id, created_by)
                    VALUES (:tid2, :tid, 'PICKUP_PREP',
                      'Prepare vehicle for pickup',
                      'TODO', 'HIGH', :due, :rid, :vid, :cb)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "tid2": str(uuid.uuid4()), "tid": str(self._tenant_id),
                    "due": due, "rid": str(reservation_id),
                    "vid": str(vehicle_id) if vehicle_id else None,
                    "cb": str(created_by) if created_by else str(uuid.UUID(int=0)),
                },
            )
        elif event_type == "RENTAL_RETURNED" and reservation_id:
            due = due_datetime or (datetime.utcnow() + timedelta(minutes=30))
            existing = await self._session.execute(
                text("SELECT 1 FROM tasks WHERE task_type='RETURN_INSPECTION' AND reservation_id=:rid AND deleted_at IS NULL"),
                {"rid": str(reservation_id)},
            )
            if existing.first():
                return
            await self._session.execute(
                text("""
                    INSERT INTO tasks (task_id, tenant_id, task_type, title,
                      status, priority, due_datetime, reservation_id, vehicle_id, created_by)
                    VALUES (:tid2, :tid, 'RETURN_INSPECTION',
                      'Inspect returned vehicle',
                      'TODO', 'HIGH', :due, :rid, :vid, :cb)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "tid2": str(uuid.uuid4()), "tid": str(self._tenant_id),
                    "due": due, "rid": str(reservation_id),
                    "vid": str(vehicle_id) if vehicle_id else None,
                    "cb": str(created_by) if created_by else str(uuid.UUID(int=0)),
                },
            )
