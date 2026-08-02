"""Reports: ask for one, see what you have, fetch it.

The computation and the upload to object storage already existed. What did not
was any record that a report had been produced: the endpoints returned a Celery
task id, the CSV landed at a key nobody had written down, and no route could
list or fetch anything. A tenant could start a report and never read one — and
the docstring promised "a report_id for status polling" with nothing to poll.

The three missing pieces:

  * a row per report, so it can be found again
  * a list, so "the revenue report from last March" is something you can click
  * a download that mints a short-lived signed URL per request, rather than
    storing one that expires
"""
from __future__ import annotations

import json
import uuid
from datetime import date as _date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims

router = APIRouter()

# kind -> (label, celery task path, required parameters)
#
# In code, for the same reason the feature registry is: the UI offers exactly
# these, so it cannot ask for a report the worker does not implement.
KINDS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "daily_revenue": (
        "Daily revenue",
        "app.worker.tasks.reports.generate_daily_revenue_report",
        ("date",),
    ),
    "fleet_utilization": (
        "Fleet utilisation",
        "app.worker.tasks.reports.calculate_fleet_utilization",
        ("period_start", "period_end"),
    ),
}

# Long enough to click, short enough that a forwarded link is useless. These
# files carry revenue and customer detail.
_DOWNLOAD_TTL_SECONDS = 300


class ReportRequest(BaseModel):
    kind: str
    date: str | None = None
    period_start: str | None = None
    period_end: str | None = None

    @field_validator("kind")
    @classmethod
    def _known(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in KINDS:
            raise ValueError(f"Unknown report. Choose one of: {', '.join(KINDS)}")
        return v

    @field_validator("date", "period_start", "period_end")
    @classmethod
    def _iso(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        try:
            _date.fromisoformat(v.strip())
        except ValueError as exc:
            raise ValueError("Dates must be YYYY-MM-DD.") from exc
        return v.strip()


class ReportRow(BaseModel):
    report_id: uuid.UUID
    kind: str
    label: str
    params: dict
    status: str
    row_count: int | None = None
    byte_size: int | None = None
    summary: dict | None = None
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


class ReportKind(BaseModel):
    kind: str
    label: str
    requires: list[str]


@router.get("/health", include_in_schema=False)
async def reporting_health() -> dict:
    return {"status": "ok", "domain": "reporting"}


@router.get("/kinds", response_model=list[ReportKind])
async def list_kinds(
    claims: UserClaims = Depends(require_permission("reporting", "read")),
) -> list[ReportKind]:
    """What can be asked for, and what each one needs."""
    return [
        ReportKind(kind=k, label=label, requires=list(req))
        for k, (label, _task, req) in KINDS.items()
    ]


@router.post("/reports", response_model=ReportRow, status_code=status.HTTP_202_ACCEPTED)
async def request_report(
    payload: ReportRequest,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("reporting", "read")),
) -> ReportRow:
    """Queue a report and hand back the row that will hold it."""
    label, task_path, required = KINDS[payload.kind]

    params = {
        k: v for k, v in
        (("date", payload.date), ("period_start", payload.period_start),
         ("period_end", payload.period_end))
        if v is not None
    }
    missing = [r for r in required if r not in params]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"{label} needs {' and '.join(missing)}."
        )
    if payload.period_start and payload.period_end and payload.period_start > payload.period_end:
        raise HTTPException(status_code=400, detail="The period ends before it starts.")

    report_id = str(uuid.uuid4())
    await session.execute(
        text(
            "INSERT INTO generated_reports "
            "  (report_id, tenant_id, kind, params, status, requested_by) "
            "VALUES (CAST(:r AS uuid), CAST(:t AS uuid), :k, CAST(:p AS jsonb), "
            "        'PENDING', CAST(:u AS uuid))"
        ),
        {"r": report_id, "t": str(claims.tenant_id), "k": payload.kind,
         "p": json.dumps(params), "u": str(claims.user_id)},
    )
    await session.commit()

    # Dispatched only after the row is committed. A worker that started first
    # would look for a row that does not exist yet and report a failure for a
    # report that is perfectly fine.
    from app.worker.celery_app import celery_app

    celery_app.send_task(
        task_path,
        kwargs={"tenant_id": str(claims.tenant_id), "report_id": report_id, **params},
        queue="reports",
    )
    return await _one(session, claims, report_id)


@router.get("/reports", response_model=list[ReportRow])
async def list_reports(
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("reporting", "read")),
) -> list[ReportRow]:
    rows = (
        await session.execute(
            text(
                "SELECT report_id, kind, params, status, row_count, byte_size, "
                "       summary, error, created_at, completed_at "
                "  FROM generated_reports WHERE tenant_id = :t "
                " ORDER BY created_at DESC LIMIT :n"
            ),
            {"t": str(claims.tenant_id), "n": max(1, min(limit, 200))},
        )
    ).mappings().all()
    return [
        ReportRow(**{**dict(r), "label": KINDS.get(r["kind"], (r["kind"],))[0]})
        for r in rows
    ]


@router.get("/reports/{report_id}/download")
async def download_report(
    report_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("reporting", "read")),
) -> dict:
    """A short-lived signed URL for one report.

    Signed per request rather than stored. A URL kept in a row outlives the
    click it was made for, and a link that still works next month is a
    credential that leaks by being forwarded.
    """
    row = (
        await session.execute(
            text(
                "SELECT status, object_key FROM generated_reports "
                " WHERE report_id = :r AND tenant_id = :t"
            ),
            {"r": str(report_id), "t": str(claims.tenant_id)},
        )
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="No such report.")
    if row["status"] != "READY" or not row["object_key"]:
        raise HTTPException(
            status_code=409,
            detail=f"That report is {row['status'].lower()}, not ready to download.",
        )

    from app.core.config import settings
    from app.core.s3 import get_presign_client

    try:
        url = get_presign_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_reports_bucket, "Key": row["object_key"]},
            ExpiresIn=_DOWNLOAD_TTL_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503, detail="Report storage is unavailable."
        ) from exc

    return {"url": url, "expires_in": _DOWNLOAD_TTL_SECONDS}


async def _one(session: AsyncSession, claims: UserClaims, report_id: str) -> ReportRow:
    row = (
        await session.execute(
            text(
                "SELECT report_id, kind, params, status, row_count, byte_size, "
                "       summary, error, created_at, completed_at "
                "  FROM generated_reports WHERE report_id = CAST(:r AS uuid) "
                "   AND tenant_id = :t"
            ),
            {"r": report_id, "t": str(claims.tenant_id)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="No such report.")
    return ReportRow(**{**dict(row), "label": KINDS.get(row["kind"], (row["kind"],))[0]})
