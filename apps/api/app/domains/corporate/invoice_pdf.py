"""Rendering an invoice as a branded PDF.

HTML and CSS through WeasyPrint rather than drawing boxes with ReportLab. An
invoice is a document with a logo, a table and a total, which is what HTML is
for — and a tenant wanting their brand on it should not require somebody to
recompute coordinates.

Two things this file is careful about.

**Everything is escaped.** A company name, a vehicle description and an invoice
note all reach this page, all originate from user input, and WeasyPrint renders
HTML — so an unescaped apostrophe is a broken invoice and an unescaped tag is
worse. There is no template engine here doing it silently; every interpolation
goes through esc().

**No network access.** WeasyPrint will happily fetch a remote stylesheet or
image while rendering. A logo URL is user-supplied, so fetching it server-side
turns invoice generation into a request-forgery primitive pointed at whatever
the tenant likes, including internal addresses. The URL is only emitted when it
is https and not an internal host, and the renderer is given a url_fetcher that
refuses everything else.
"""
from __future__ import annotations

import html
from datetime import date
from decimal import Decimal
from ipaddress import ip_address
from typing import Any
from urllib.parse import urlparse

import structlog

log = structlog.get_logger()

# Hosts a rendered document may never reach. A logo URL is tenant-supplied, and
# without this the renderer would happily GET a link-local metadata endpoint on
# the tenant's behalf and embed the result in a PDF they receive.
_BLOCKED_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "metadata.google.internal"}


def esc(value: Any) -> str:
    """HTML-escape anything on its way into the document."""
    return html.escape("" if value is None else str(value), quote=True)


def _safe_logo(url: str | None) -> str | None:
    """A logo URL, or None if fetching it would be a bad idea.

    https only, no internal hosts, no IP literals in private ranges. Anything
    that does not obviously belong on the public internet is dropped and the
    invoice renders with the company name instead — a missing logo is a
    cosmetic problem, a server-side fetch of an arbitrary URL is not.
    """
    if not url:
        return None
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.hostname:
        return None
    host = parsed.hostname.lower()
    if host in _BLOCKED_HOSTS:
        return None
    try:
        addr = ip_address(host)
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            return None
    except ValueError:
        pass  # a name, not an address — fine
    return url


def _money(cents: int, currency: str) -> str:
    return f"{currency} {Decimal(cents) / 100:,.2f}"


def render_invoice_pdf(
    *,
    invoice: dict,
    lines: list[dict],
    tenant: dict,
    account: dict,
) -> bytes:
    """Return the invoice as PDF bytes.

    Raises RuntimeError with a readable message when WeasyPrint's native
    libraries are unavailable, rather than the cffi dlopen traceback — that
    failure means the image is missing system packages, and saying so is more
    useful than the stack.
    """
    try:
        from weasyprint import HTML
    except OSError as exc:  # noqa: BLE001 — dlopen failure, not a Python error
        raise RuntimeError(
            "PDF rendering is unavailable: the Pango/Cairo libraries WeasyPrint "
            "needs are not installed in this image."
        ) from exc

    currency = invoice.get("currency") or "USD"
    logo = _safe_logo(tenant.get("logo_url"))
    billing = tenant.get("billing_address") or {}
    bill_to = invoice.get("bill_to") or {}

    rows = "".join(
        f"""<tr>
              <td class="desc">{esc(l['description'])}
                {f'<span class="ref">{esc(l["reference"])}</span>' if l.get('reference') else ''}
              </td>
              <td class="date">{esc(l['line_date'] or '')}</td>
              <td class="num">{esc(f"{Decimal(str(l['quantity'])):g}")}</td>
              <td class="num">{esc(_money(l['unit_cents'], currency))}</td>
              <td class="num">{esc(_money(l['amount_cents'], currency))}</td>
            </tr>"""
        for l in lines
    ) or (
        '<tr><td colspan="5" class="empty">No charges in this period.</td></tr>'
    )

    doc = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page {{ size: A4; margin: 18mm 16mm 22mm;
           @bottom-center {{ content: "Page " counter(page) " of " counter(pages);
                             font-size: 8pt; color: #8a8a8a; }} }}
  body {{ font-family: "DejaVu Sans", sans-serif; font-size: 9.5pt; color: #1c1c1c; }}
  .head {{ display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #1c1c1c; padding-bottom: 10mm; margin-bottom: 8mm; }}
  .logo {{ max-height: 18mm; max-width: 60mm; }}
  .issuer h1 {{ font-size: 15pt; margin: 0 0 2mm; font-weight: 600; }}
  .issuer p {{ margin: 0; font-size: 8.5pt; color: #555; line-height: 1.45; }}
  .doc {{ text-align: right; }}
  .doc .title {{ font-size: 20pt; font-weight: 600; letter-spacing: 1px;
                 text-transform: uppercase; margin: 0 0 3mm; }}
  .doc table td {{ font-size: 8.5pt; padding: 0.4mm 0 0.4mm 5mm; }}
  .doc table td.k {{ color: #777; text-align: left; padding-left: 0; }}
  .parties {{ display: flex; gap: 12mm; margin-bottom: 8mm; }}
  .parties h2 {{ font-size: 7.5pt; text-transform: uppercase; letter-spacing: 1px;
                 color: #888; margin: 0 0 2mm; font-weight: 600; }}
  .parties p {{ margin: 0; line-height: 1.5; }}
  table.lines {{ width: 100%; border-collapse: collapse; margin-bottom: 6mm; }}
  table.lines th {{ text-align: left; font-size: 7.5pt; text-transform: uppercase;
                    letter-spacing: 0.6px; color: #888; border-bottom: 1px solid #cfcfcf;
                    padding: 0 2mm 2mm 0; font-weight: 600; }}
  table.lines td {{ padding: 2.2mm 2mm 2.2mm 0; border-bottom: 1px solid #eee;
                    vertical-align: top; }}
  table.lines .num {{ text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }}
  table.lines .date {{ white-space: nowrap; color: #666; }}
  table.lines .ref {{ display: block; color: #888; font-size: 8pt; }}
  table.lines .empty {{ text-align: center; color: #888; padding: 8mm 0; }}
  .totals {{ width: 62mm; margin-left: auto; }}
  .totals td {{ padding: 1.4mm 0; }}
  .totals .num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .totals .grand td {{ border-top: 2px solid #1c1c1c; font-weight: 600;
                       font-size: 11.5pt; padding-top: 2.5mm; }}
  .pay {{ margin-top: 10mm; border-top: 1px solid #e2e2e2; padding-top: 4mm;
          font-size: 8.5pt; color: #555; line-height: 1.55; }}
  .void {{ position: fixed; top: 45%; left: 12%; font-size: 62pt; font-weight: 700;
           color: rgba(200,30,20,0.16); transform: rotate(-24deg); letter-spacing: 6px; }}
</style></head><body>

{'<div class="void">VOID</div>' if invoice.get('status') == 'VOID' else ''}

<div class="head">
  <div class="issuer">
    {f'<img class="logo" src="{esc(logo)}" alt="">' if logo
      else f'<h1>{esc(tenant.get("legal_name") or tenant.get("slug"))}</h1>'}
    <p>
      {esc(billing.get('line1') or '')}{'<br>' if billing.get('line1') else ''}
      {esc(billing.get('city') or '')} {esc(billing.get('postal_code') or '')}<br>
      {f"Tax ID {esc(tenant.get('vat_tax_id'))}" if tenant.get('vat_tax_id') else ''}
    </p>
  </div>
  <div class="doc">
    <p class="title">Invoice</p>
    <table>
      <tr><td class="k">Number</td><td>{esc(invoice['invoice_number'])}</td></tr>
      <tr><td class="k">Issued</td><td>{esc(invoice.get('issued_on') or date.today())}</td></tr>
      <tr><td class="k">Due</td><td>{esc(invoice.get('due_on') or '—')}</td></tr>
      <tr><td class="k">Period</td>
          <td>{esc(invoice['period_start'])} – {esc(invoice['period_end'])}</td></tr>
    </table>
  </div>
</div>

<div class="parties">
  <div style="flex:1">
    <h2>Billed to</h2>
    <p>
      <strong>{esc(bill_to.get('name') or account.get('name'))}</strong><br>
      {esc(bill_to.get('contact_name') or '')}{'<br>' if bill_to.get('contact_name') else ''}
      {esc(bill_to.get('email') or '')}
    </p>
  </div>
  <div style="flex:1">
    <h2>Account</h2>
    <p>
      {esc(account.get('cdp_code') or '—')}<br>
      Payment terms: {esc(invoice.get('terms_days', 30))} days
    </p>
  </div>
</div>

<table class="lines">
  <thead><tr>
    <th style="width:44%">Description</th><th>Date</th>
    <th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th>
  </tr></thead>
  <tbody>{rows}</tbody>
</table>

<table class="totals">
  <tr><td>Subtotal</td>
      <td class="num">{esc(_money(invoice['subtotal_cents'], currency))}</td></tr>
  <tr><td>Tax</td>
      <td class="num">{esc(_money(invoice['tax_cents'], currency))}</td></tr>
  <tr class="grand"><td>Total due</td>
      <td class="num">{esc(_money(invoice['total_cents'], currency))}</td></tr>
</table>

<div class="pay">
  {f"<p>{esc(invoice.get('notes'))}</p>" if invoice.get('notes') else ''}
  <p>Please quote invoice number <strong>{esc(invoice['invoice_number'])}</strong>
     with your payment.</p>
</div>

</body></html>"""

    def _no_fetch(url: str, *_a: Any, **_kw: Any) -> dict:
        """Refuse every external fetch except an approved logo.

        WeasyPrint resolves images and stylesheets while rendering. Everything
        here is inline except the logo, so anything else asking to be fetched
        is either a mistake or an attempt to make the server issue a request.
        """
        if logo and url == logo:
            from weasyprint.urls import default_url_fetcher

            return default_url_fetcher(url)
        log.warning("invoice_pdf_fetch_blocked", url=url[:120])
        raise ValueError("External resources are not fetched while rendering.")

    return HTML(string=doc, url_fetcher=_no_fetch).write_pdf()
