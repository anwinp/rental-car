"""Corporate accounts — negotiated rates, bookers, and billing to the account.

This router held a health endpoint and nothing else while "corporate accounts"
sat on the price list. What made that odd is how much already existed:
rate_codes and reservations both carry corporate_account_id, the quote engine
already selects a rate by CDP code and falls back to the public rate when it
does not match, and CORPORATE_BOOKER has been in the role enum all along. The
account itself was the missing row.

So there is deliberately no rate logic in this file. An account holds a CDP
code, rate codes carry the same code, and the existing pricing path does the
rest — including the fallback, which is the part a bolt-on implementation would
have got wrong by quoting corporate customers the public price without saying
so.
"""
from __future__ import annotations

import uuid
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims

log = structlog.get_logger()

router = APIRouter()

_STATUSES = ("ACTIVE", "SUSPENDED", "CLOSED")


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    cdp_code: str | None = Field(default=None, max_length=50)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=40)
    payment_terms_days: int = Field(default=30, ge=0, le=180)
    credit_limit_cents: int | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    bill_to_account: bool = False
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("cdp_code")
    @classmethod
    def _cdp(cls, v: str | None) -> str | None:
        v = (v or "").strip().upper() or None
        if v and not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError("A CDP code is letters, numbers, hyphens and underscores.")
        return v


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    cdp_code: str | None = Field(default=None, max_length=50)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_email: EmailStr | None = None
    contact_phone: str | None = Field(default=None, max_length=40)
    payment_terms_days: int | None = Field(default=None, ge=0, le=180)
    credit_limit_cents: int | None = Field(default=None, ge=0)
    bill_to_account: bool | None = None
    status: str | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().upper()
        if v not in _STATUSES:
            raise ValueError(f"Status must be one of: {', '.join(_STATUSES)}")
        return v


class Account(BaseModel):
    corporate_account_id: uuid.UUID
    name: str
    cdp_code: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    payment_terms_days: int
    credit_limit_cents: int | None = None
    currency: str
    bill_to_account: bool
    status: str
    notes: str | None = None
    created_at: datetime
    booker_count: int = 0
    reservation_count: int = 0
    # Whether any rate code actually carries this account's CDP code. An
    # account with a code nobody priced against silently gets public rates,
    # which looks like a broken discount to the customer; saying so on the
    # account is cheaper than the support call.
    has_negotiated_rates: bool = False


class BookerIn(BaseModel):
    email: EmailStr
    full_name: str | None = Field(default=None, max_length=120)
    may_bill_to_account: bool = False


class Booker(BaseModel):
    booker_id: uuid.UUID
    email: str
    full_name: str | None = None
    may_bill_to_account: bool
    created_at: datetime


class SimpleResult(BaseModel):
    ok: bool = True
    message: str


_ACCOUNT_SELECT = (
    "SELECT a.corporate_account_id, a.name, a.cdp_code, a.contact_name, "
    "       a.contact_email, a.contact_phone, a.payment_terms_days, "
    "       a.credit_limit_cents, a.currency, a.bill_to_account, "
    "       a.status, a.notes, a.created_at, "
    "       (SELECT count(*) FROM corporate_bookers b "
    "         WHERE b.corporate_account_id = a.corporate_account_id "
    "           AND b.tenant_id = a.tenant_id AND b.revoked_at IS NULL) AS booker_count, "
    "       (SELECT count(*) FROM reservations r "
    "         WHERE r.corporate_account_id = a.corporate_account_id "
    "           AND r.tenant_id = a.tenant_id) AS reservation_count, "
    "       EXISTS (SELECT 1 FROM rate_codes rc "
    "                WHERE rc.tenant_id = a.tenant_id "
    "                  AND a.cdp_code IS NOT NULL "
    "                  AND upper(rc.cdp_code) = upper(a.cdp_code)) "
    "         AS has_negotiated_rates "
    "  FROM corporate_accounts a "
    " WHERE a.tenant_id = :t "
)


@router.get("/health", include_in_schema=False)
async def corporate_health() -> dict:
    return {"status": "ok", "domain": "corporate"}


@router.get("/accounts", response_model=list[Account])
async def list_accounts(
    include_closed: bool = False,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "read")),
) -> list[Account]:
    rows = (
        await session.execute(
            text(
                _ACCOUNT_SELECT
                + "   AND a.deleted_at IS NULL "
                  "   AND (CAST(:inc AS boolean) OR a.status <> 'CLOSED') "
                  " ORDER BY a.name"
            ),
            {"t": str(claims.tenant_id), "inc": include_closed},
        )
    ).mappings().all()
    return [Account(**r) for r in rows]


@router.get("/accounts/{account_id}", response_model=Account)
async def get_account(
    account_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "read")),
) -> Account:
    return await _one(session, str(claims.tenant_id), str(account_id))


@router.post("/accounts", response_model=Account, status_code=status.HTTP_201_CREATED)
async def create_account(
    body: AccountIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> Account:
    account_id = str(uuid.uuid4())
    try:
        await session.execute(
            text(
                "INSERT INTO corporate_accounts "
                "  (corporate_account_id, tenant_id, name, cdp_code, contact_name, "
                "   contact_email, contact_phone, payment_terms_days, "
                "   credit_limit_cents, currency, bill_to_account, notes) "
                "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), :name, :cdp, :cn, "
                "        :ce, :cp, :terms, :climit, :cur, :bill, :notes)"
            ),
            {
                "id": account_id, "t": str(claims.tenant_id), "name": body.name.strip(),
                "cdp": body.cdp_code, "cn": body.contact_name,
                "ce": str(body.contact_email) if body.contact_email else None,
                "cp": body.contact_phone, "terms": body.payment_terms_days,
                "climit": body.credit_limit_cents, "cur": body.currency.upper(),
                "bill": body.bill_to_account, "notes": body.notes,
            },
        )
        await session.commit()
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        # The one collision worth naming: two accounts sharing a CDP code makes
        # "which negotiated rate applies" ambiguous at the counter.
        if "ux_corporate_accounts_cdp" in str(exc):
            raise HTTPException(
                status_code=409,
                detail=f"Another account already uses the code {body.cdp_code}.",
            ) from exc
        raise

    log.info("corporate_account_created", tenant_id=str(claims.tenant_id),
             account_id=account_id, name=body.name)
    return await _one(session, str(claims.tenant_id), account_id)


@router.patch("/accounts/{account_id}", response_model=Account)
async def update_account(
    account_id: uuid.UUID,
    body: AccountPatch,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> Account:
    fields = {
        "name": body.name, "cdp_code": body.cdp_code,
        "contact_name": body.contact_name,
        "contact_email": str(body.contact_email) if body.contact_email else None,
        "contact_phone": body.contact_phone,
        "payment_terms_days": body.payment_terms_days,
        "credit_limit_cents": body.credit_limit_cents,
        "bill_to_account": body.bill_to_account,
        "status": body.status, "notes": body.notes,
    }
    sets, params = [], {"id": str(account_id), "t": str(claims.tenant_id)}
    for key, value in fields.items():
        if value is not None:
            sets.append(f"{key} = :{key}")
            params[key] = value
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to change.")

    sets.append("updated_at = now()")
    res = await session.execute(
        text(
            f"UPDATE corporate_accounts SET {', '.join(sets)} "
            " WHERE corporate_account_id = CAST(:id AS uuid) AND tenant_id = :t "
            "   AND deleted_at IS NULL RETURNING name"
        ),
        params,
    )
    if not res.first():
        raise HTTPException(status_code=404, detail="No such account.")
    await session.commit()
    return await _one(session, str(claims.tenant_id), str(account_id))


@router.delete("/accounts/{account_id}", response_model=SimpleResult)
async def close_account(
    account_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> SimpleResult:
    """Close an account. Soft, because its bookings reference it.

    A closed account keeps its history and stops being offered at the counter.
    Deleting the row would either break every reservation that named it or
    rewrite what those rentals were billed under.
    """
    res = await session.execute(
        text(
            "UPDATE corporate_accounts SET status = 'CLOSED', deleted_at = now(), "
            "       updated_at = now() "
            " WHERE corporate_account_id = CAST(:id AS uuid) AND tenant_id = :t "
            "   AND deleted_at IS NULL RETURNING name"
        ),
        {"id": str(account_id), "t": str(claims.tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="No such account.")
    await session.commit()
    log.info("corporate_account_closed", tenant_id=str(claims.tenant_id),
             account_id=str(account_id))
    return SimpleResult(message=f"{row[0]} is closed. Its bookings are unchanged.")


# ── Bookers ──────────────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/bookers", response_model=list[Booker])
async def list_bookers(
    account_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "read")),
) -> list[Booker]:
    rows = (
        await session.execute(
            text(
                "SELECT booker_id, email, full_name, may_bill_to_account, created_at "
                "  FROM corporate_bookers "
                " WHERE corporate_account_id = CAST(:id AS uuid) AND tenant_id = :t "
                "   AND revoked_at IS NULL ORDER BY email"
            ),
            {"id": str(account_id), "t": str(claims.tenant_id)},
        )
    ).mappings().all()
    return [Booker(**r) for r in rows]


@router.post("/accounts/{account_id}/bookers", response_model=Booker,
             status_code=status.HTTP_201_CREATED)
async def add_booker(
    account_id: uuid.UUID,
    body: BookerIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> Booker:
    """Authorise somebody at the customer to book on the account.

    A booker is a person at the customer company, not a staff user, and may
    have no account here at all — which is why this is an email address rather
    than a reference into staff_users.
    """
    owner = (
        await session.execute(
            text(
                "SELECT bill_to_account FROM corporate_accounts "
                " WHERE corporate_account_id = CAST(:id AS uuid) AND tenant_id = :t "
                "   AND deleted_at IS NULL"
            ),
            {"id": str(account_id), "t": str(claims.tenant_id)},
        )
    ).mappings().first()
    if not owner:
        raise HTTPException(status_code=404, detail="No such account.")
    if body.may_bill_to_account and not owner["bill_to_account"]:
        # Otherwise a booker holds a permission the account itself does not.
        raise HTTPException(
            status_code=409,
            detail="This account is not set up to be billed. Enable that first.",
        )

    booker_id = str(uuid.uuid4())
    try:
        await session.execute(
            text(
                "INSERT INTO corporate_bookers "
                "  (booker_id, tenant_id, corporate_account_id, email, full_name, "
                "   may_bill_to_account) "
                "VALUES (CAST(:b AS uuid), CAST(:t AS uuid), CAST(:a AS uuid), "
                "        :e, :n, :bill)"
            ),
            {"b": booker_id, "t": str(claims.tenant_id), "a": str(account_id),
             "e": str(body.email).lower(), "n": body.full_name,
             "bill": body.may_bill_to_account},
        )
        await session.commit()
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        if "ux_corporate_bookers_email" in str(exc):
            raise HTTPException(
                status_code=409, detail="That address is already a booker here."
            ) from exc
        raise

    row = (
        await session.execute(
            text(
                "SELECT booker_id, email, full_name, may_bill_to_account, created_at "
                "  FROM corporate_bookers WHERE booker_id = CAST(:b AS uuid) "
                "   AND tenant_id = :t"
            ),
            {"b": booker_id, "t": str(claims.tenant_id)},
        )
    ).mappings().first()
    return Booker(**row)


@router.delete("/accounts/{account_id}/bookers/{booker_id}", response_model=SimpleResult)
async def revoke_booker(
    account_id: uuid.UUID,
    booker_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> SimpleResult:
    res = await session.execute(
        text(
            "UPDATE corporate_bookers SET revoked_at = now() "
            " WHERE booker_id = CAST(:b AS uuid) "
            "   AND corporate_account_id = CAST(:a AS uuid) AND tenant_id = :t "
            "   AND revoked_at IS NULL RETURNING email"
        ),
        {"b": str(booker_id), "a": str(account_id), "t": str(claims.tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="No such booker.")
    await session.commit()
    return SimpleResult(message=f"{row[0]} can no longer book on this account.")


async def _one(session: AsyncSession, tenant_id: str, account_id: str) -> Account:
    row = (
        await session.execute(
            text(_ACCOUNT_SELECT + "   AND a.corporate_account_id = CAST(:id AS uuid)"),
            {"t": tenant_id, "id": account_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="No such account.")
    return Account(**row)
