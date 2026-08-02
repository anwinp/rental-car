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

import json as _json
import uuid
from datetime import date, datetime, timezone

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


# ── Invoicing ────────────────────────────────────────────────────────────────
#
# An issued invoice is immutable. A customer's finance department files the PDF,
# quotes its number on a payment and reconciles against it months later, so the
# line items are copies rather than a live view over reservations — a rental
# corrected after billing must not rewrite paper already sent. Corrections are
# a credit note against the original, which is what an accountant expects.

class InvoiceLine(BaseModel):
    line_id: uuid.UUID
    description: str
    reference: str | None = None
    line_date: date | None = None
    quantity: float
    unit_cents: int
    amount_cents: int


class Invoice(BaseModel):
    invoice_id: uuid.UUID
    corporate_account_id: uuid.UUID
    account_name: str | None = None
    invoice_number: str
    status: str
    period_start: date
    period_end: date
    issued_at: datetime | None = None
    due_at: datetime | None = None
    paid_at: datetime | None = None
    voided_at: datetime | None = None
    void_reason: str | None = None
    subtotal_cents: int
    tax_cents: int
    total_cents: int
    currency: str
    line_count: int = 0
    has_pdf: bool = False
    notes: str | None = None
    created_at: datetime


class InvoiceDetail(Invoice):
    lines: list[InvoiceLine] = []


class GenerateIn(BaseModel):
    corporate_account_id: uuid.UUID
    period_start: date
    period_end: date
    notes: str | None = Field(default=None, max_length=1000)


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


_INVOICE_SELECT = (
    "SELECT i.invoice_id, i.corporate_account_id, a.name AS account_name, "
    "       i.invoice_number, i.status, i.period_start, i.period_end, "
    "       i.issued_at, i.due_at, i.paid_at, i.voided_at, i.void_reason, "
    "       i.subtotal_cents, "
    "       i.tax_cents, i.total_cents, i.currency, i.notes, i.created_at, "
    "       (SELECT count(*) FROM corporate_invoice_lines l "
    "         WHERE l.invoice_id = i.invoice_id) AS line_count, "
    "       i.pdf_object_key IS NOT NULL AS has_pdf "
    "  FROM corporate_invoices i "
    "  JOIN corporate_accounts a ON a.corporate_account_id = i.corporate_account_id "
    " WHERE i.tenant_id = :t "
)


@router.get("/invoices", response_model=list[Invoice])
async def list_invoices(
    account_id: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "read")),
) -> list[Invoice]:
    rows = (
        await session.execute(
            text(
                _INVOICE_SELECT
                + "   AND (CAST(:a AS uuid) IS NULL "
                  "        OR i.corporate_account_id = CAST(:a AS uuid)) "
                  " ORDER BY i.created_at DESC LIMIT 200"
            ),
            {"t": str(claims.tenant_id), "a": str(account_id) if account_id else None},
        )
    ).mappings().all()
    return [Invoice(**r) for r in rows]


@router.post("/invoices", response_model=InvoiceDetail,
             status_code=status.HTTP_201_CREATED)
async def generate_invoice(
    body: GenerateIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> InvoiceDetail:
    """Draft an invoice from the account's unbilled rentals in a period.

    Only rentals that were actually placed on the account are collected, and
    only ones not already on another live invoice — a unique index enforces
    that second rule rather than trusting this query, because double-billing a
    corporate customer is the kind of mistake that ends the relationship.
    """
    account = (
        await session.execute(
            text(
                "SELECT corporate_account_id, name, cdp_code, contact_name, "
                "       contact_email, payment_terms_days, currency, status "
                "  FROM corporate_accounts "
                " WHERE corporate_account_id = CAST(:a AS uuid) AND tenant_id = :t "
                "   AND deleted_at IS NULL"
            ),
            {"a": str(body.corporate_account_id), "t": str(claims.tenant_id)},
        )
    ).mappings().first()
    if not account:
        raise HTTPException(status_code=404, detail="No such account.")
    if account["status"] == "CLOSED":
        raise HTTPException(status_code=409, detail="That account is closed.")

    # Completed rentals on this account, in the window, not already billed.
    candidates = (
        await session.execute(
            text(
                "SELECT r.reservation_id, r.confirmation_number, "
                "       r.pickup_datetime, r.return_datetime, "
                "       r.vehicle_class_name, r.grand_total, r.taxes_total, r.currency "
                "  FROM reservations r "
                " WHERE r.tenant_id = :t "
                "   AND r.corporate_account_id = CAST(:a AS uuid) "
                "   AND r.deleted_at IS NULL "
                "   AND r.status NOT IN ('CANCELLED', 'NO_SHOW') "
                "   AND r.pickup_datetime >= CAST(:ps AS date) "
                "   AND r.pickup_datetime < (CAST(:pe AS date) + INTERVAL '1 day') "
                "   AND NOT EXISTS (SELECT 1 FROM corporate_invoice_lines l "
                "                    WHERE l.reservation_id = r.reservation_id) "
                " ORDER BY r.pickup_datetime"
            ),
            {"t": str(claims.tenant_id), "a": str(body.corporate_account_id),
             "ps": body.period_start, "pe": body.period_end},
        )
    ).mappings().all()

    subtotal = tax = 0
    lines: list[dict] = []
    for i, r in enumerate(candidates):
        gross = int(round(float(r["grand_total"] or 0) * 100))
        line_tax = int(round(float(r["taxes_total"] or 0) * 100))
        net = gross - line_tax
        subtotal += net
        tax += line_tax
        lines.append({
            "description": f"Vehicle rental — {r['vehicle_class_name'] or 'vehicle'}",
            "reference": r["confirmation_number"],
            "line_date": r["pickup_datetime"].date() if r["pickup_datetime"] else None,
            "quantity": 1,
            "unit_cents": net,
            "amount_cents": net,
            "reservation_id": str(r["reservation_id"]),
            "sort_order": i,
        })

    invoice_id = str(uuid.uuid4())
    # Sequential per workspace and per year, so the number reads like a number a
    # finance department expects rather than a UUID they have to transcribe.
    seq = (
        await session.execute(
            text(
                "SELECT count(*) + 1 FROM corporate_invoices "
                " WHERE tenant_id = :t AND date_part('year', created_at) "
                "       = date_part('year', now())"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).scalar() or 1
    number = f"INV-{datetime.now(timezone.utc).year}-{int(seq):05d}"

    await session.execute(
        text(
            "INSERT INTO corporate_invoices "
            "  (invoice_id, tenant_id, corporate_account_id, invoice_number, "
            "   period_start, period_end, subtotal_cents, tax_cents, total_cents, "
            "   currency, bill_to, notes, created_by) "
            "VALUES (CAST(:i AS uuid), CAST(:t AS uuid), CAST(:a AS uuid), :num, "
            "        :ps, :pe, :sub, :tax, :tot, :cur, CAST(:bt AS jsonb), :notes, "
            "        CAST(:u AS uuid))"
        ),
        {
            "i": invoice_id, "t": str(claims.tenant_id),
            "a": str(body.corporate_account_id), "num": number,
            "ps": body.period_start, "pe": body.period_end,
            "sub": subtotal, "tax": tax, "tot": subtotal + tax,
            "cur": account["currency"] or "USD",
            # Captured now. A customer that later changes its billing details
            # must not retroactively alter an invoice already sent.
            "bt": _json.dumps({
                "name": account["name"],
                "contact_name": account["contact_name"],
                "email": account["contact_email"],
                "cdp_code": account["cdp_code"],
                "terms_days": account["payment_terms_days"],
            }),
            "notes": body.notes, "u": str(claims.user_id),
        },
    )
    for ln in lines:
        await session.execute(
            text(
                "INSERT INTO corporate_invoice_lines "
                "  (tenant_id, invoice_id, reservation_id, description, reference, "
                "   line_date, quantity, unit_cents, amount_cents, sort_order) "
                "VALUES (CAST(:t AS uuid), CAST(:i AS uuid), CAST(:r AS uuid), :d, "
                "        :ref, :ld, :q, :u, :amt, :so)"
            ),
            {"t": str(claims.tenant_id), "i": invoice_id, "r": ln["reservation_id"],
             "d": ln["description"], "ref": ln["reference"], "ld": ln["line_date"],
             "q": ln["quantity"], "u": ln["unit_cents"], "amt": ln["amount_cents"],
             "so": ln["sort_order"]},
        )
    await session.commit()

    log.info("corporate_invoice_drafted", tenant_id=str(claims.tenant_id),
             invoice=number, lines=len(lines), total_cents=subtotal + tax)
    return await _invoice(session, str(claims.tenant_id), invoice_id)


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetail)
async def get_invoice(
    invoice_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "read")),
) -> InvoiceDetail:
    return await _invoice(session, str(claims.tenant_id), str(invoice_id))


@router.post("/invoices/{invoice_id}/issue", response_model=InvoiceDetail)
async def issue_invoice(
    invoice_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> InvoiceDetail:
    """Issue the invoice and render its PDF.

    Issuing is the point of no return: after this the document exists outside
    this system, so nothing may edit it. A draft with no lines is refused —
    sending a customer an invoice for nothing is worse than sending nothing.
    """
    inv = await _invoice(session, str(claims.tenant_id), str(invoice_id))
    if inv.status != "DRAFT":
        raise HTTPException(
            status_code=409,
            detail=f"This invoice is already {inv.status.lower()}.",
        )
    if not inv.lines:
        raise HTTPException(status_code=409, detail="This invoice has no lines.")

    terms = (
        await session.execute(
            text(
                "SELECT payment_terms_days FROM corporate_accounts "
                " WHERE corporate_account_id = CAST(:a AS uuid) AND tenant_id = :t"
            ),
            {"a": str(inv.corporate_account_id), "t": str(claims.tenant_id)},
        )
    ).scalar() or 30

    await session.execute(
        text(
            "UPDATE corporate_invoices "
            "   SET status = 'ISSUED', issued_at = now(), "
            "       due_at = now() + make_interval(days => :d), updated_at = now() "
            " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t "
            "   AND status = 'DRAFT'"
        ),
        {"i": str(invoice_id), "t": str(claims.tenant_id), "d": int(terms)},
    )
    await session.commit()

    await _render_and_store(session, str(claims.tenant_id), str(invoice_id))
    log.warning("corporate_invoice_issued", tenant_id=str(claims.tenant_id),
                invoice=inv.invoice_number, total_cents=inv.total_cents,
                by=str(claims.user_id))
    return await _invoice(session, str(claims.tenant_id), str(invoice_id))


@router.post("/invoices/{invoice_id}/paid", response_model=InvoiceDetail)
async def mark_paid(
    invoice_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> InvoiceDetail:
    res = await session.execute(
        text(
            "UPDATE corporate_invoices SET status = 'PAID', paid_at = now(), "
            "       updated_at = now() "
            " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t "
            "   AND status = 'ISSUED' RETURNING invoice_number"
        ),
        {"i": str(invoice_id), "t": str(claims.tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(
            status_code=409, detail="Only an issued invoice can be marked paid."
        )
    await session.commit()
    log.info("corporate_invoice_paid", tenant_id=str(claims.tenant_id), invoice=row[0])
    return await _invoice(session, str(claims.tenant_id), str(invoice_id))


@router.post("/invoices/{invoice_id}/void", response_model=InvoiceDetail)
async def void_invoice(
    invoice_id: uuid.UUID,
    body: VoidIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "write")),
) -> InvoiceDetail:
    """Void an invoice, with a reason.

    Voiding rather than deleting, and the reason is required. An invoice that
    vanishes leaves a gap in a numbered sequence, which is the first thing an
    auditor asks about; a voided one answers the question itself. Its rentals
    become billable again, because the unique index on reservation_id ignores
    lines belonging to voided invoices.
    """
    res = await session.execute(
        text(
            "UPDATE corporate_invoices SET status = 'VOID', voided_at = now(), "
            "       void_reason = :r, updated_at = now() "
            " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t "
            "   AND status <> 'VOID' RETURNING invoice_number"
        ),
        {"i": str(invoice_id), "t": str(claims.tenant_id), "r": body.reason},
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=409, detail="That invoice is already void.")
    # The lines go with it, so those rentals can be billed correctly next time.
    await session.execute(
        text(
            "DELETE FROM corporate_invoice_lines "
            " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t"
        ),
        {"i": str(invoice_id), "t": str(claims.tenant_id)},
    )
    await session.commit()
    log.warning("corporate_invoice_voided", tenant_id=str(claims.tenant_id),
                invoice=row[0], reason=body.reason, by=str(claims.user_id))
    return await _invoice(session, str(claims.tenant_id), str(invoice_id))


@router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("corporate", "read")),
) -> dict:
    """A short-lived signed URL for the rendered invoice."""
    row = (
        await session.execute(
            text(
                "SELECT pdf_object_key, status FROM corporate_invoices "
                " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t"
            ),
            {"i": str(invoice_id), "t": str(claims.tenant_id)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="No such invoice.")
    if not row["pdf_object_key"]:
        raise HTTPException(
            status_code=409,
            detail="No PDF yet — issue the invoice to generate one.",
        )

    from app.core.config import settings
    from app.core.s3 import get_presign_client

    try:
        url = get_presign_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_documents_bucket,
                    "Key": row["pdf_object_key"]},
            ExpiresIn=300,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="Storage is unavailable.") from exc
    return {"url": url, "expires_in": 300}


async def _render_and_store(session: AsyncSession, tenant_id: str, invoice_id: str) -> None:
    """Render the PDF and record its key. Never loses an issued invoice."""
    from app.core.config import settings
    from app.domains.corporate.invoice_pdf import render_invoice_pdf

    inv = (
        await session.execute(
            text(
                "SELECT i.*, a.name AS account_name, a.cdp_code, "
                "       a.payment_terms_days "
                "  FROM corporate_invoices i "
                "  JOIN corporate_accounts a "
                "    ON a.corporate_account_id = i.corporate_account_id "
                " WHERE i.invoice_id = CAST(:i AS uuid) AND i.tenant_id = :t"
            ),
            {"i": invoice_id, "t": tenant_id},
        )
    ).mappings().first()
    lines = [
        dict(r) for r in (
            await session.execute(
                text(
                    "SELECT description, reference, line_date, quantity, "
                    "       unit_cents, amount_cents FROM corporate_invoice_lines "
                    " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t "
                    " ORDER BY sort_order"
                ),
                {"i": invoice_id, "t": tenant_id},
            )
        ).mappings().all()
    ]
    tenant = (
        await session.execute(
            text(
                "SELECT slug, legal_name, trading_name, billing_address, "
                "       vat_tax_id, logo_url FROM tenants WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).mappings().first() or {}

    payload = dict(inv)
    payload["issued_on"] = inv["issued_at"].date() if inv["issued_at"] else None
    payload["due_on"] = inv["due_at"].date() if inv["due_at"] else None
    payload["terms_days"] = inv["payment_terms_days"]

    try:
        pdf = render_invoice_pdf(
            invoice=payload, lines=lines, tenant=dict(tenant),
            account={"name": inv["account_name"], "cdp_code": inv["cdp_code"]},
        )
    except Exception:  # noqa: BLE001
        # The invoice is issued and that stands. A failed render is a missing
        # attachment, not a reason to un-issue a document the customer may
        # already have been told about.
        log.error("invoice_pdf_render_failed", invoice_id=invoice_id, exc_info=True)
        return

    key = f"tenants/{tenant_id}/invoices/{inv['invoice_number']}.pdf"
    try:
        from app.core.s3 import get_s3_client, supports_sse

        extra = {"ServerSideEncryption": "AES256"} if supports_sse() else {}
        get_s3_client().put_object(
            Bucket=settings.s3_documents_bucket, Key=key, Body=pdf,
            ContentType="application/pdf", **extra,
        )
    except Exception:  # noqa: BLE001
        log.error("invoice_pdf_upload_failed", invoice_id=invoice_id, exc_info=True)
        return

    await session.execute(
        text(
            "UPDATE corporate_invoices SET pdf_object_key = :k, updated_at = now() "
            " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t"
        ),
        {"k": key, "i": invoice_id, "t": tenant_id},
    )
    await session.commit()
    log.info("invoice_pdf_stored", invoice_id=invoice_id, bytes=len(pdf))


async def _invoice(session: AsyncSession, tenant_id: str, invoice_id: str) -> InvoiceDetail:
    row = (
        await session.execute(
            text(_INVOICE_SELECT + "   AND i.invoice_id = CAST(:i AS uuid)"),
            {"t": tenant_id, "i": invoice_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="No such invoice.")
    lines = (
        await session.execute(
            text(
                "SELECT line_id, description, reference, line_date, quantity, "
                "       unit_cents, amount_cents FROM corporate_invoice_lines "
                " WHERE invoice_id = CAST(:i AS uuid) AND tenant_id = :t "
                " ORDER BY sort_order"
            ),
            {"i": invoice_id, "t": tenant_id},
        )
    ).mappings().all()
    return InvoiceDetail(**row, lines=[InvoiceLine(**l) for l in lines])
