"""A thin Stripe client, and the signature check for its webhooks.

Talks to the REST API directly rather than pulling in the SDK. The surface used
here is four calls wide, the SDK is a large dependency to audit for something
holding live payment credentials, and its global `stripe.api_key` module state
sits badly beside a key that is decrypted per request and dropped afterwards.

The credential is read from the database and decrypted at the point of use. It
is never held on a module, never cached, and never passed anywhere that logs.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()

_API = "https://api.stripe.com/v1"

# Stripe signs `{timestamp}.{raw body}`. Events older than this are refused: a
# valid signature is valid forever, so without a bound, one captured request
# could be replayed indefinitely. Five minutes is Stripe's own recommendation
# and comfortably survives a slow retry.
_SIGNATURE_TOLERANCE_SECONDS = 300


class StripeNotConfigured(RuntimeError):
    """No usable credentials are stored."""


async def _credentials(session: AsyncSession) -> tuple[str, str | None]:
    """(secret key, webhook secret). Decrypted here and nowhere else."""
    from app.core.secrets_box import decrypt

    row = (
        await session.execute(
            text(
                "SELECT secret_key_enc, webhook_secret_enc, is_enabled "
                "  FROM platform_billing_config WHERE id = 1"
            )
        )
    ).mappings().first()
    if not row or not row["secret_key_enc"]:
        raise StripeNotConfigured("Stripe is not configured.")
    if not row["is_enabled"]:
        raise StripeNotConfigured("Billing is switched off.")

    secret = decrypt(row["secret_key_enc"], name="stripe_secret_key")
    webhook = (
        decrypt(row["webhook_secret_enc"], name="stripe_webhook_secret")
        if row["webhook_secret_enc"] else None
    )
    return secret, webhook


async def webhook_secret(session: AsyncSession) -> str:
    """The signing secret alone, for the receiver.

    Deliberately does not require is_enabled: events keep arriving after
    billing is switched off — a cancellation, a final invoice — and refusing to
    verify them would leave this system's idea of a subscription frozen at the
    moment somebody flipped a toggle.
    """
    from app.core.secrets_box import decrypt

    row = (
        await session.execute(
            text("SELECT webhook_secret_enc FROM platform_billing_config WHERE id = 1")
        )
    ).mappings().first()
    if not row or not row["webhook_secret_enc"]:
        raise StripeNotConfigured("No webhook signing secret is stored.")
    return decrypt(row["webhook_secret_enc"], name="stripe_webhook_secret")


def verify_signature(payload: bytes, header: str, secret: str) -> None:
    """Raise ValueError unless `payload` really came from Stripe.

    This is the whole of the endpoint's authentication. A webhook receiver
    cannot ask the caller to sign in, so an unverified handler is an
    unauthenticated write path into billing state — anyone who learns the URL
    could mark every workspace paid up, or cancel them all.

    Three things are checked, and all three matter:

      * the signature, over the raw body. Re-serialising parsed JSON changes
        bytes — key order, whitespace, number formatting — and the signature no
        longer matches, which is why the handler must read the request body
        rather than a Pydantic model.

      * the timestamp, against a tolerance. Without it a single captured
        request replays forever.

      * the comparison itself, in constant time. A byte-by-byte compare that
        returns early leaks the correct prefix to anyone who can measure it.
    """
    parts = dict(
        p.split("=", 1) for p in header.split(",") if "=" in p
    )
    timestamp = parts.get("t")
    signature = parts.get("v1")
    if not timestamp or not signature:
        raise ValueError("Malformed signature header.")

    try:
        age = abs(time.time() - int(timestamp))
    except ValueError as exc:
        raise ValueError("Malformed timestamp.") from exc
    if age > _SIGNATURE_TOLERANCE_SECONDS:
        raise ValueError("Timestamp outside the tolerance window.")

    expected = hmac.new(
        secret.encode(),
        b"%s.%s" % (timestamp.encode(), payload),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("Signature does not match.")


async def create_checkout_session(
    session: AsyncSession,
    *,
    tenant_id: str,
    tenant_email: str,
    plan_code: str,
    plan_name: str,
    amount_cents: int,
    currency: str,
    interval: str,
    success_url: str,
    cancel_url: str,
) -> dict[str, Any]:
    """A hosted Checkout session for one plan.

    The amount comes from this system's own plan catalogue, never from the
    browser. A price supplied by the client would let anyone subscribe to
    Enterprise for a penny.

    Prices are created inline rather than referencing pre-made Stripe Price
    objects, so the catalogue here stays the single place a price is edited. It
    costs a slightly larger request and removes an entire class of drift where
    the plans page and Stripe disagree about what something costs.
    """
    secret, _ = await _credentials(session)

    form = {
        "mode": "subscription",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "customer_email": tenant_email,
        # Both, because they are read at different moments: client_reference_id
        # rides the session, metadata rides the subscription that outlives it.
        "client_reference_id": tenant_id,
        "metadata[tenant_id]": tenant_id,
        "metadata[plan_code]": plan_code,
        "subscription_data[metadata][tenant_id]": tenant_id,
        "subscription_data[metadata][plan_code]": plan_code,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": currency.lower(),
        "line_items[0][price_data][unit_amount]": str(amount_cents),
        "line_items[0][price_data][product_data][name]": plan_name,
        "line_items[0][price_data][recurring][interval]": interval,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(f"{_API}/checkout/sessions", data=form,
                                    auth=(secret, ""))
    finally:
        del secret

    if res.status_code >= 400:
        # Bounded, and never echoing the request: the form above carries no
        # credential, but an unbounded upstream body in a log is how one
        # eventually appears there.
        log.error("stripe_checkout_failed", status=res.status_code,
                  detail=res.text[:200])
        raise RuntimeError("Stripe could not start the checkout.")
    return res.json()


async def fetch_subscription(session: AsyncSession, subscription_id: str) -> dict[str, Any]:
    """Read a subscription back from Stripe.

    Used when an event arrives without the fields needed to update the mirror.
    Asking Stripe is always correct; inferring from a partial payload is not.
    """
    secret, _ = await _credentials(session)
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.get(f"{_API}/subscriptions/{subscription_id}",
                                   auth=(secret, ""))
    finally:
        del secret
    if res.status_code >= 400:
        raise RuntimeError(f"Stripe returned {res.status_code}")
    return res.json()
