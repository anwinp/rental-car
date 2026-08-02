"""Subscriptions: starting one, and keeping the mirror in step.

Two surfaces with opposite trust models, kept in one file because they are two
halves of the same mechanism and separating them is how they drift.

  * `/tenants/my/checkout` is authenticated, and treats everything the browser
    sends as a request rather than an instruction — the plan code is looked up
    here, the price comes from this system's catalogue, and the return URLs are
    built from configured hosts. A client that could choose its own price could
    buy Enterprise for a penny; a client that could choose the return URL would
    have a phishing page inside the checkout flow.

  * `/platform/billing/webhook` is unauthenticated by necessity — Stripe cannot
    sign in — and treats the signature as the entire proof. Everything else
    about the request is hostile input.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session, get_session_untenanted
from app.core.security import UserClaims, get_current_user
from app.core.tenancy import tenant_host
from app.domains.platform.stripe_client import (
    StripeNotConfigured,
    create_checkout_session,
    fetch_subscription,
    verify_signature,
    webhook_secret,
)

log = structlog.get_logger()

router = APIRouter()

# Namespaced away from tenants' own gateway events. Event ids are unique within
# a Stripe account, not across accounts, and the platform account is a different
# account from any tenant's — without this, two ids could collide and one event
# would be silently dropped as "already processed".
_GATEWAY = "STRIPE_PLATFORM"

# Stripe statuses in which a workspace is considered to be paying.
_LIVE_STATUSES = ("trialing", "active", "past_due")


class CheckoutRequest(BaseModel):
    plan_code: str


class CheckoutResponse(BaseModel):
    url: str


# ── Starting a subscription ──────────────────────────────────────────────────

@router.post("/tenants/my/checkout", response_model=CheckoutResponse)
async def start_checkout(
    payload: CheckoutRequest,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> CheckoutResponse:
    """Hand back a Stripe Checkout URL for the chosen plan.

    Restricted to administrators: committing the workspace to a recurring
    charge is not a counter agent's decision, even though reading the plan page
    is.
    """
    if claims.primary_role not in ("SYSTEM_ADMIN", "SUPER_ADMIN"):
        raise HTTPException(
            status_code=403,
            detail="Only an administrator can change the workspace's plan.",
        )

    code = payload.plan_code.strip().upper()
    plan = (
        await session.execute(
            text(
                "SELECT code, display_name, price_cents, currency, billing_period, "
                "       is_active FROM plans WHERE code = :c"
            ),
            {"c": code},
        )
    ).mappings().first()

    if not plan or not plan["is_active"]:
        raise HTTPException(status_code=404, detail="No such plan.")
    if plan["price_cents"] is None:
        # Enterprise, and anything else sold by agreement. Sending somebody to
        # a checkout with no amount would fail at Stripe with something unhelpful.
        raise HTTPException(
            status_code=400,
            detail=f"{plan['display_name']} is priced by agreement — please contact us.",
        )
    if plan["price_cents"] == 0:
        raise HTTPException(
            status_code=400,
            detail=f"{plan['display_name']} is free; there is nothing to pay.",
        )
    if plan["billing_period"] not in ("MONTHLY", "YEARLY"):
        raise HTTPException(
            status_code=400,
            detail="That plan is not sold through self-service checkout.",
        )

    tenant = (
        await session.execute(
            text(
                "SELECT slug, primary_email, "
                "       COALESCE(trading_name, legal_name, slug) AS name "
                "  FROM tenants WHERE tenant_id = :t"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).mappings().first()
    if not tenant:
        raise HTTPException(status_code=404, detail="No such workspace.")

    # Built here, from configured hosts. Accepting a return URL from the caller
    # is the same hole the password-reset flow once had with the Origin header:
    # a genuine payment page that hands off to somewhere the attacker chose.
    host = tenant_host(tenant["slug"], settings.public_admin_host)
    base = f"{settings.public_url_scheme}://{host}"

    try:
        stripe_session = await create_checkout_session(
            session,
            tenant_id=str(claims.tenant_id),
            tenant_email=tenant["primary_email"],
            plan_code=plan["code"],
            plan_name=f"{tenant['name']} — {plan['display_name']}",
            amount_cents=int(plan["price_cents"]),
            currency=plan["currency"] or "USD",
            interval="year" if plan["billing_period"] == "YEARLY" else "month",
            success_url=f"{base}/plan?checkout=done",
            cancel_url=f"{base}/plan?checkout=cancelled",
        )
    except StripeNotConfigured as exc:
        raise HTTPException(
            status_code=503,
            detail="Online payment is not available yet. Please contact us.",
        ) from exc

    log.info("checkout_started", tenant_id=str(claims.tenant_id),
             plan=plan["code"], session_id=stripe_session.get("id"))
    return CheckoutResponse(url=stripe_session["url"])


# ── Keeping the mirror in step ───────────────────────────────────────────────

@router.post("/platform/billing/webhook", include_in_schema=False)
async def stripe_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
) -> Response:
    """Receive Stripe events.

    Returns 200 for anything successfully verified, including events this does
    not act on. A non-2xx tells Stripe to retry, so a handler that errors on
    unknown event types teaches Stripe to hammer the endpoint for days.

    Returns 400 for a bad signature and nothing else — no detail about which
    check failed, since the caller at that point is not Stripe.
    """
    raw = await request.body()
    signature = request.headers.get("Stripe-Signature", "")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing signature.")

    try:
        secret = await webhook_secret(session)
    except Exception:  # noqa: BLE001
        # 503, not 400: the request may be perfectly valid and this end is not
        # ready. Stripe will retry, which is what should happen.
        log.error("webhook_no_secret_configured")
        raise HTTPException(status_code=503, detail="Not configured.") from None

    try:
        verify_signature(raw, signature, secret)
    except ValueError as exc:
        log.warning("webhook_signature_rejected", reason=str(exc),
                    ip=request.client.host if request.client else None)
        raise HTTPException(status_code=400, detail="Invalid signature.") from None
    finally:
        del secret

    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload.") from None

    event_id = str(event.get("id") or "")
    event_type = str(event.get("type") or "")
    obj = (event.get("data") or {}).get("object") or {}

    tenant_id = await _tenant_for_event(session, obj)
    if not tenant_id:
        # Acknowledged rather than retried. An event about something this
        # system does not own — a subscription created directly in the Stripe
        # dashboard, say — is not a failure and will never become processable.
        log.info("webhook_no_tenant", type=event_type, event_id=event_id)
        return Response(status_code=200)

    # Adopt the workspace the event is about, before touching anything under
    # RLS. processed_webhooks is tenant-scoped, and with no tenant bound the
    # policy fails in BOTH directions: the insert is rejected outright, and —
    # more quietly — the dedup SELECT below matches nothing, so every Stripe
    # retry would be treated as a first delivery and applied again.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": tenant_id},
    )

    # Idempotency. Stripe delivers at least once and retries on any non-2xx, so
    # a handler that is not idempotent will eventually double-apply something.
    already = (
        await session.execute(
            text(
                "SELECT 1 FROM processed_webhooks "
                " WHERE gateway = :g AND event_id = :e AND tenant_id = :t"
            ),
            {"g": _GATEWAY, "e": event_id, "t": tenant_id},
        )
    ).first()
    if already:
        return Response(status_code=200)

    try:
        await _apply(session, event_type, obj, tenant_id)
    except Exception:  # noqa: BLE001
        # Not recorded as processed, so Stripe's retry gets another attempt.
        # 500 rather than a swallowed 200: silently losing a cancellation is
        # how a workspace keeps running for free.
        log.error("webhook_apply_failed", type=event_type, event_id=event_id,
                  tenant_id=tenant_id, exc_info=True)
        await session.rollback()
        raise HTTPException(status_code=500, detail="Could not process.") from None

    await session.execute(
        text(
            "INSERT INTO processed_webhooks (event_id, gateway, tenant_id) "
            "VALUES (:e, :g, :t) ON CONFLICT DO NOTHING"
        ),
        {"e": event_id, "g": _GATEWAY, "t": tenant_id},
    )
    await session.commit()

    log.info("webhook_processed", type=event_type, event_id=event_id,
             tenant_id=tenant_id)
    return Response(status_code=200)


async def _tenant_for_event(session: AsyncSession, obj: dict) -> str | None:
    """Which workspace an event is about.

    Metadata first, because it is what this system set when the checkout
    started. Falling back to the subscription id covers invoice events, which
    carry no metadata of their own.
    """
    meta = obj.get("metadata") or {}
    candidate = meta.get("tenant_id") or obj.get("client_reference_id")
    if candidate:
        try:
            uuid.UUID(str(candidate))
        except ValueError:
            # Metadata is attacker-influenced in principle — it is echoed back
            # from whatever created the object. A malformed value is dropped
            # rather than interpolated anywhere.
            return None
        exists = (
            await session.execute(
                text("SELECT 1 FROM tenants WHERE tenant_id = CAST(:t AS uuid)"),
                {"t": str(candidate)},
            )
        ).first()
        return str(candidate) if exists else None

    sub_id = obj.get("subscription") or (
        obj.get("id") if str(obj.get("object") or "") == "subscription" else None
    )
    if sub_id:
        row = (
            await session.execute(
                text(
                    "SELECT tenant_id::text FROM tenant_subscriptions "
                    " WHERE stripe_subscription_id = :s"
                ),
                {"s": str(sub_id)},
            )
        ).first()
        if row:
            return row[0]
    return None


async def _apply(session: AsyncSession, event_type: str, obj: dict, tenant_id: str) -> None:
    """Act on one event. Anything unrecognised is deliberately a no-op."""
    if event_type == "checkout.session.completed":
        await _on_checkout_complete(session, obj, tenant_id)
    elif event_type in ("customer.subscription.created",
                        "customer.subscription.updated",
                        "customer.subscription.deleted"):
        await _on_subscription(session, obj, tenant_id)
    elif event_type == "invoice.paid":
        await _on_invoice_paid(session, obj, tenant_id)
    elif event_type == "invoice.payment_failed":
        log.warning("subscription_payment_failed", tenant_id=tenant_id,
                    invoice=obj.get("id"))


async def _on_checkout_complete(session: AsyncSession, obj: dict, tenant_id: str) -> None:
    sub_id = obj.get("subscription")
    if not sub_id:
        return
    # The session says a payment succeeded but carries none of the period
    # detail. Ask Stripe rather than guess: the period end is what the expiry
    # sweep enforces, and inventing it would lock somebody out early or late.
    sub = await fetch_subscription(session, str(sub_id))
    await _upsert(session, sub, tenant_id,
                  checkout_id=str(obj.get("id") or "") or None)


async def _on_subscription(session: AsyncSession, obj: dict, tenant_id: str) -> None:
    await _upsert(session, obj, tenant_id)


async def _on_invoice_paid(session: AsyncSession, obj: dict, tenant_id: str) -> None:
    sub_id = obj.get("subscription")
    if not sub_id:
        return
    sub = await fetch_subscription(session, str(sub_id))
    await _upsert(session, sub, tenant_id)


async def _upsert(
    session: AsyncSession, sub: dict, tenant_id: str, *, checkout_id: str | None = None
) -> None:
    """Write the mirror, and push the term onto the workspace itself."""
    status_ = str(sub.get("status") or "incomplete")
    plan_code = str((sub.get("metadata") or {}).get("plan_code") or "")
    period_end = sub.get("current_period_end")
    ends_at = (
        datetime.fromtimestamp(int(period_end), tz=timezone.utc)
        if period_end else None
    )

    item = ((sub.get("items") or {}).get("data") or [{}])[0]
    price = item.get("price") or {}
    recurring = price.get("recurring") or {}

    await session.execute(
        text(
            """
            INSERT INTO tenant_subscriptions (
                tenant_id, stripe_subscription_id, stripe_customer_id,
                stripe_checkout_id, plan_code, status, amount_cents, currency,
                interval, current_period_end, cancel_at_period_end, canceled_at
            ) VALUES (
                CAST(:t AS uuid), :sid, :cus, :chk, :plan, :st, :amt, :cur,
                :intv, :ends, :cape, :canc
            )
            ON CONFLICT (stripe_subscription_id) DO UPDATE SET
                status               = EXCLUDED.status,
                plan_code            = COALESCE(NULLIF(EXCLUDED.plan_code, ''),
                                                tenant_subscriptions.plan_code),
                amount_cents         = EXCLUDED.amount_cents,
                currency             = EXCLUDED.currency,
                interval             = EXCLUDED.interval,
                current_period_end   = EXCLUDED.current_period_end,
                cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                canceled_at          = EXCLUDED.canceled_at,
                updated_at           = now()
            """
        ),
        {
            "t": tenant_id,
            "sid": str(sub.get("id") or ""),
            "cus": str(sub.get("customer") or "") or None,
            "chk": checkout_id,
            "plan": plan_code,
            "st": status_,
            "amt": price.get("unit_amount"),
            "cur": (price.get("currency") or "").upper() or None,
            "intv": recurring.get("interval"),
            "ends": ends_at,
            "cape": bool(sub.get("cancel_at_period_end")),
            "canc": (
                datetime.fromtimestamp(int(sub["canceled_at"]), tz=timezone.utc)
                if sub.get("canceled_at") else None
            ),
        },
    )

    if status_ in _LIVE_STATUSES:
        # The plan and the paid-through date, onto the workspace. Migration 075
        # already enforces subscription_ends_at; this is what finally writes it.
        #
        # The status is lifted out of any terminal state too: a workspace that
        # was locked out and has now paid should be usable again immediately,
        # not at 03:35 tomorrow.
        sets = [
            "subscription_ends_at = :ends",
            "status = CASE WHEN status IN ('EXPIRED','SUSPENDED') THEN 'ACTIVE' ELSE status END",
            "expired_at = NULL",
            "reactivation_token = NULL",
            "expiry_warn_stage = 0",
            "expiry_warned_at = NULL",
            # The trial is over once money has changed hands. Left in place, it
            # would sit in the past and re-expire the workspace overnight.
            "trial_ends_at = NULL",
            "updated_at = now()",
        ]
        params: dict = {"ends": ends_at, "t": tenant_id}
        if plan_code:
            exists = (
                await session.execute(
                    text("SELECT 1 FROM plans WHERE code = :c"), {"c": plan_code}
                )
            ).first()
            if exists:
                sets.insert(0, "subscription_tier = :plan")
                params["plan"] = plan_code
        await session.execute(
            text(
                f"UPDATE tenants SET {', '.join(sets)} "
                " WHERE tenant_id = CAST(:t AS uuid)"
            ),
            params,
        )
    elif status_ in ("canceled", "incomplete_expired", "unpaid"):
        # Not locked out here. The term already paid for is honoured, and the
        # nightly sweep does the lockout when it actually runs out — cutting
        # somebody off mid-month because they cancelled a renewal would be
        # taking back something they had already bought.
        log.info("subscription_ended", tenant_id=tenant_id, status=status_)
