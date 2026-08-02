"""Render a signed rental agreement as a PDF.

Signature capture worked; the document did not exist. weasyprint has been in
requirements the whole time and imported nowhere, so a signed agreement lived as
scattered columns — a signature URL, a hash, a timestamp — and never as
something an operator could hand to a customer or produce in a dispute.

Two decisions shape this module:

**Rendered once, then stored.** The agreement records what was agreed at
handover: the rate, the mileage plan, the fuel policy, the deposit. Re-rendering
on each view from live data would let a later price change silently rewrite a
document the customer already signed. The key is written to
rental_agreements.agreement_pdf_key on first generation and reused thereafter.

**Everything comes from the snapshot, not from today's tables.** rate_snapshot
and extras_snapshot are captured at checkout precisely so the agreement survives
later edits to the rate card. This reads those, not the current rates.

The layout is deliberately plain. It is a legal record that gets printed, faxed
to insurers and attached to claims — not a brand surface.
"""
from __future__ import annotations

import html
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = structlog.get_logger()


class AgreementRenderError(RuntimeError):
    """Rendering failed. Never silently substituted with a placeholder."""


def _esc(value: Any) -> str:
    """Escape for HTML. Customer-supplied text reaches this document."""
    if value is None:
        return "—"
    return html.escape(str(value))


def _money(value: Any, currency: str = "USD") -> str:
    if value in (None, ""):
        return "—"
    try:
        return f"{Decimal(str(value)):,.2f} {currency}"
    except Exception:  # noqa: BLE001
        return _esc(value)


def _address(value: Any) -> str:
    """Render an address for a human.

    billing_address is JSONB, so interpolating it directly printed a Python
    dict onto the legal document: {'zip': '90001', 'city': 'Los Angeles', ...}.
    """
    if not value:
        return "—"
    if isinstance(value, str):
        return _esc(value)
    if isinstance(value, dict):
        parts = [
            value.get("street") or value.get("address_line1"),
            value.get("city"),
            value.get("state"),
            value.get("zip") or value.get("postal_code"),
            value.get("country"),
        ]
        return _esc(", ".join(str(p) for p in parts if p)) or "—"
    return _esc(value)


def _date(value: Any) -> str:
    if not value:
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y, %H:%M")
    return _esc(value)


async def _load(session: AsyncSession, ra_id: uuid.UUID) -> dict[str, Any]:
    """Everything the document needs, in one read.

    Scoped by tenant explicitly as well as by RLS: this produces a legal record,
    and a query that is only correct because of ambient session state is not a
    guarantee worth resting that on.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT ra.ra_id, ra.ra_number, ra.tenant_id,
                       ra.vin_at_checkout, ra.plate_at_checkout,
                       ra.odometer_out, ra.odometer_in,
                       ra.fuel_level_out_pct, ra.fuel_level_in_pct,
                       ra.mileage_plan, ra.fuel_policy, ra.additional_drivers,
                       ra.rate_snapshot, ra.extras_snapshot,
                       ra.preauth_amount, ra.status,
                       ra.customer_signed_at, ra.esignature_hash,
                       ra.customer_signature_url, ra.created_at,
                       ra.agreement_pdf_key,
                       ra.actual_return_datetime,
                       c.first_name, c.last_name, c.email,
                       c.mobile_phone AS phone,
                       c.license_number AS dl_number, c.license_state AS dl_state,
                       v.make, v.model, v.model_year AS year, v.exterior_color AS color,
                       vc.name              AS class_name,
                       r.confirmation_number, r.pickup_datetime, r.return_datetime,
                       r.currency,
                       t.legal_name, t.trading_name, t.primary_email,
                       t.primary_phone, t.billing_address,
                       l.name AS location_name, l.address_line1, l.city
                  FROM rental_agreements ra
                  LEFT JOIN customers       c  ON c.customer_id = ra.customer_id
                  LEFT JOIN vehicles        v  ON v.vehicle_id  = ra.vehicle_id
                  LEFT JOIN vehicle_classes vc ON vc.class_id   = v.vehicle_class_id
                  LEFT JOIN reservations    r  ON r.reservation_id = ra.reservation_id
                  LEFT JOIN tenants         t  ON t.tenant_id   = ra.tenant_id
                  LEFT JOIN locations       l  ON l.location_id = r.pickup_location_id
                 WHERE ra.ra_id = :ra AND ra.tenant_id = :t
                """
            ),
            {"ra": str(ra_id), "t": str(_current_tenant(session))},
        )
    ).mappings().first()

    if row is None:
        raise AgreementRenderError("No such rental agreement.")

    data = dict(row)

    # extras_snapshot stores {extra_id, quantity, daily_rate} — no name. Listing
    # a charge the customer cannot identify is not much better than omitting it,
    # so the names are resolved here from the tenant's own catalogue.
    extras = data.get("extras_snapshot") or []
    ids = [
        x.get("extra_id")
        for x in extras
        if isinstance(x, dict) and x.get("extra_id")
    ]
    if ids:
        named = (
            await session.execute(
                # resolve_extra_names (migration 069) reads the caller's own
                # rows and the seed templates. Agreements written before
                # migration 065 reference the global extra_id, which a
                # tenant-scoped read can no longer see — leaving a money line
                # with a blank description on a signed document.
                text(
                    "SELECT extra_id::text, name "
                    "  FROM resolve_extra_names(CAST(:ids AS uuid[]))"
                ),
                {"ids": [str(i) for i in ids]},
            )
        ).all()
        lookup = {eid: name for eid, name in named}
        for x in extras:
            if isinstance(x, dict) and x.get("extra_id"):
                x["name"] = lookup.get(str(x["extra_id"]))
        data["extras_snapshot"] = extras

    return data


def _current_tenant(session: AsyncSession) -> str:
    """The tenant bound to this session, for the explicit predicate above."""
    from app.core.tenancy import current_tenant_id

    tid = current_tenant_id.get()
    if not tid:
        raise AgreementRenderError("No tenant bound to this request.")
    return tid


def _terms_rows(data: dict[str, Any]) -> str:
    """Rate and extras, read from the snapshot taken at checkout."""
    currency = data.get("currency") or "USD"
    rows: list[str] = []

    snap = data.get("rate_snapshot") or {}
    if isinstance(snap, dict):
        # Key names as actually written at checkout — daily_rate, not
        # price_per_day. Both spellings are accepted so an older snapshot
        # still renders rather than silently showing no charges.
        for label, keys in (
            ("Rate code", ("rate_code", "code")),
            ("Daily rate", ("daily_rate", "price_per_day")),
            ("Weekly rate", ("weekly_rate", "price_per_week")),
        ):
            key = next((k for k in keys if snap.get(k) not in (None, "")), None)
            if key is None:
                continue
            value = snap[key]
            shown = (
                _money(value, currency)
                if "rate" in key or "price" in key
                else _esc(value)
            )
            rows.append(f"<tr><th>{label}</th><td>{shown}</td></tr>")

    extras = data.get("extras_snapshot") or []
    if isinstance(extras, list):
        for x in extras:
            if not isinstance(x, dict):
                continue
            name = x.get("name") or x.get("code") or x.get("extra_code")
            # daily_rate is what checkout actually writes.
            price = next(
                (
                    x[k]
                    for k in ("price", "amount", "unit_price", "daily_rate")
                    if x.get(k) is not None
                ),
                None,
            )
            qty = x.get("quantity")
            if qty and int(qty) > 1:
                name = f"{name} x{int(qty)}"
            if name and price is not None:
                name = f"{name} (per day)" if "daily_rate" in x else name
            # An entry with neither a name nor a price renders as "— —", which
            # on a signed agreement reads as an unexplained charge line.
            if not name and price is None:
                continue
            rows.append(
                f"<tr><th>{_esc(name)}</th>"
                f"<td>{_money(price, currency)}</td></tr>"
            )

    if not rows:
        # Say so rather than render an empty table that looks like "no charges".
        rows.append(
            "<tr><th>Charges</th><td>Not recorded on this agreement</td></tr>"
        )
    return "".join(rows)


def _mileage_rows(data: dict[str, Any]) -> str:
    """Mileage terms, from the JSONB plan captured at checkout.

    This was interpolated straight into the document, printing a raw dict —
    {'rental_days': 10, 'free_miles_per_day': 250, ...} — onto a page a customer
    signs and an insurer may read.
    """
    plan = data.get("mileage_plan")
    currency = data.get("currency") or "USD"
    if isinstance(plan, str):
        return f"<tr><th>Mileage plan</th><td>{_esc(plan)}</td></tr>"
    if not isinstance(plan, dict) or not plan:
        return "<tr><th>Mileage plan</th><td>—</td></tr>"

    rows = []
    if plan.get("free_miles_per_day") is not None:
        rows.append(
            "<tr><th>Included mileage</th>"
            f"<td>{_esc(plan['free_miles_per_day'])} miles per day</td></tr>"
        )
    if plan.get("overage_rate_per_mile") is not None:
        rows.append(
            "<tr><th>Charge per additional mile</th>"
            f"<td>{_money(plan['overage_rate_per_mile'], currency)}</td></tr>"
        )
    if plan.get("unlimited"):
        rows.append("<tr><th>Included mileage</th><td>Unlimited</td></tr>")
    return "".join(rows) or "<tr><th>Mileage plan</th><td>—</td></tr>"


def build_html(data: dict[str, Any]) -> str:
    """The agreement as HTML. Kept plain — this is a legal record, not a brand page."""
    currency = data.get("currency") or "USD"
    operator = data.get("trading_name") or data.get("legal_name") or "Rental operator"
    vehicle = " ".join(
        str(p) for p in (data.get("year"), data.get("make"), data.get("model")) if p
    ) or "—"

    signed = data.get("customer_signed_at")
    signature_block = (
        f"""<p class="sig">Signed electronically by
              {_esc(f"{data.get('first_name') or ''} {data.get('last_name') or ''}".strip())}
              on {_date(signed)}.</p>
            <p class="hash">Signature reference: {_esc(data.get('esignature_hash'))}</p>"""
        if signed
        else '<p class="unsigned">This agreement has not been signed.</p>'
    )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Rental Agreement {_esc(data.get('ra_number'))}</title>
<style>
  @page {{ size: A4; margin: 18mm 16mm; }}
  body {{ font-family: "Helvetica", "Arial", sans-serif; font-size: 10pt; color: #111; line-height: 1.45; }}
  h1 {{ font-size: 15pt; margin: 0 0 2mm; }}
  h2 {{ font-size: 10pt; text-transform: uppercase; letter-spacing: .08em;
        border-bottom: 1px solid #999; padding-bottom: 1mm; margin: 7mm 0 2mm; }}
  .head {{ display: flex; justify-content: space-between; align-items: flex-start; }}
  .ra {{ font-family: monospace; font-size: 12pt; font-weight: bold; }}
  .muted {{ color: #555; font-size: 9pt; }}
  table {{ width: 100%; border-collapse: collapse; }}
  th, td {{ text-align: left; vertical-align: top; padding: 1.4mm 0; font-size: 9.5pt; }}
  th {{ width: 46%; font-weight: normal; color: #555; }}
  .cols {{ display: flex; gap: 10mm; }}
  .cols > div {{ flex: 1; }}
  .sig {{ margin-top: 3mm; }}
  .hash {{ font-family: monospace; font-size: 7.5pt; color: #666; word-break: break-all; }}
  .unsigned {{ color: #a11; font-weight: bold; }}
  footer {{ position: fixed; bottom: 0; left: 0; right: 0;
            font-size: 7.5pt; color: #666; border-top: 1px solid #ccc; padding-top: 1.5mm; }}
</style></head><body>

<div class="head">
  <div>
    <h1>{_esc(operator)}</h1>
    <p class="muted">{_address(data.get('billing_address'))}<br>
      {_esc(data.get('primary_email'))} · {_esc(data.get('primary_phone'))}</p>
  </div>
  <div style="text-align:right">
    <p class="muted">Rental agreement</p>
    <p class="ra">{_esc(data.get('ra_number'))}</p>
    <p class="muted">Booking {_esc(data.get('confirmation_number'))}</p>
  </div>
</div>

<div class="cols">
  <div>
    <h2>Renter</h2>
    <table>
      <tr><th>Name</th><td>{_esc(f"{data.get('first_name') or ''} {data.get('last_name') or ''}".strip())}</td></tr>
      <tr><th>Email</th><td>{_esc(data.get('email'))}</td></tr>
      <tr><th>Phone</th><td>{_esc(data.get('phone'))}</td></tr>
      <tr><th>Licence</th><td>{_esc(data.get('dl_number'))} {_esc(data.get('dl_state'))}</td></tr>
    </table>
  </div>
  <div>
    <h2>Vehicle</h2>
    <table>
      <tr><th>Vehicle</th><td>{_esc(vehicle)}</td></tr>
      <tr><th>Class</th><td>{_esc(data.get('class_name'))}</td></tr>
      <tr><th>Registration</th><td>{_esc(data.get('plate_at_checkout'))}</td></tr>
      <tr><th>VIN</th><td>{_esc(data.get('vin_at_checkout'))}</td></tr>
    </table>
  </div>
</div>

<h2>Rental period</h2>
<div class="cols">
  <div><table>
    <tr><th>Collected</th><td>{_date(data.get('pickup_datetime'))}</td></tr>
    <tr><th>From</th><td>{_esc(data.get('location_name'))}</td></tr>
    <tr><th>Odometer out</th><td>{_esc(data.get('odometer_out'))}</td></tr>
    <tr><th>Fuel out</th><td>{_esc(data.get('fuel_level_out_pct'))}%</td></tr>
  </table></div>
  <div><table>
    <tr><th>Due back</th><td>{_date(data.get('return_datetime'))}</td></tr>
    <tr><th>Returned</th><td>{_date(data.get('actual_return_datetime'))}</td></tr>
    <tr><th>Odometer in</th><td>{_esc(data.get('odometer_in'))}</td></tr>
    <tr><th>Fuel in</th><td>{_esc(data.get('fuel_level_in_pct'))}%</td></tr>
  </table></div>
</div>

<h2>Charges and terms</h2>
<table>
  {_terms_rows(data)}
  {_mileage_rows(data)}
  <tr><th>Fuel policy</th><td>{_esc(str(data.get('fuel_policy') or '').replace('_', ' ').title() or '—')}</td></tr>
  <tr><th>Security deposit held</th><td>{_money(data.get('preauth_amount'), currency)}</td></tr>
</table>

<h2>Signature</h2>
{signature_block}

<footer>
  {_esc(data.get('ra_number'))} · issued by {_esc(operator)} ·
  generated {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}
</footer>
</body></html>"""


async def get_or_create_pdf(
    session: AsyncSession, ra_id: uuid.UUID
) -> tuple[bytes, str]:
    """Return (pdf_bytes, object_key), rendering and storing on first request.

    Raises AgreementRenderError rather than returning a placeholder. A rental
    agreement that silently isn't the real document is worse than an error: it
    would be produced in a dispute and found wanting.
    """
    data = await _load(session, ra_id)

    existing_key: Optional[str] = data.get("agreement_pdf_key")
    if existing_key:
        try:
            from app.core.s3 import get_s3_client

            obj = get_s3_client().get_object(
                Bucket=settings.s3_documents_bucket, Key=existing_key
            )
            return obj["Body"].read(), existing_key
        except Exception:  # noqa: BLE001 — object lost; fall through and re-render
            log.warning("agreement_pdf_missing_rerendering", ra_id=str(ra_id),
                        key=existing_key)

    try:
        from weasyprint import HTML

        pdf = HTML(string=build_html(data)).write_pdf()
    except Exception as exc:  # noqa: BLE001
        raise AgreementRenderError(f"Could not render the agreement: {exc}") from exc

    key = f"agreements/{data['tenant_id']}/{data['ra_number'] or ra_id}.pdf"
    try:
        from app.core.s3 import get_s3_client, supports_sse

        extra = {"ContentType": "application/pdf"}
        if supports_sse():
            extra["ServerSideEncryption"] = "AES256"
        get_s3_client().put_object(
            Bucket=settings.s3_documents_bucket, Key=key, Body=pdf, **extra
        )
        await session.execute(
            text(
                "UPDATE rental_agreements "
                "   SET agreement_pdf_key = :k, agreement_pdf_generated_at = now() "
                " WHERE ra_id = :ra AND tenant_id = :t"
            ),
            {"k": key, "ra": str(ra_id), "t": data["tenant_id"]},
        )
        await session.commit()
    except Exception:  # noqa: BLE001
        # Storage is unavailable. The document is still correct, so serve it —
        # the operator has a customer waiting — but do not claim it was kept.
        log.warning("agreement_pdf_not_stored", ra_id=str(ra_id), exc_info=True)

    return pdf, key
