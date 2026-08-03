"""Stripe Connect onboarding — the one-click path for a tenant with no processor.

A **Standard** connected account, charged **directly**, with **no application
fee**. Each of those is a decision, and together they are what keeps us out of
the funds flow (PAYMENTS_STRATEGY.md §3):

  * *Standard* rather than Express or Custom: the rental company gets its own
    full Stripe dashboard, Stripe provides their support, and they own the
    relationship. We are an integration, not their payments provider.
  * *Direct* charges rather than destination: the connected account is the
    settlement merchant, so money never passes through us and chargebacks land
    with the company that assessed the damage.
  * *No application fee*: we take a subscription, not a cut, which is what
    keeps us out of money-transmission licensing in every market we enter.

The tenant never supplies an account id. We create the account, we store the
id, and the only thing that comes back from Stripe is the tenant returning to a
URL of ours. Accepting an account id from the client would let one workspace
point its configuration at another's account.
"""
from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()


class ConnectError(RuntimeError):
    """Onboarding could not be started, with a reason worth showing."""


async def _tenant_facts(session: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """What Stripe wants prefilled, taken from what we already know."""
    row = (
        await session.execute(
            text(
                # `name` and `booking_url` are not columns on tenants; the
                # business name is trading_name (falling back to legal_name),
                # and the storefront URL is derived from the slug, not stored.
                "SELECT trading_name, legal_name, primary_email, slug "
                "  FROM tenants WHERE tenant_id = CAST(:t AS uuid)"
            ),
            {"t": tenant_id},
        )
    ).mappings().first()

    # The country of the account has to match where the business actually is,
    # and `tenants` does not record one — locations do.
    country = (
        await session.execute(
            text(
                "SELECT country_code FROM locations "
                " WHERE tenant_id = CAST(:t AS uuid) AND deleted_at IS NULL "
                "   AND country_code IS NOT NULL "
                " GROUP BY country_code ORDER BY count(*) DESC LIMIT 1"
            ),
            {"t": tenant_id},
        )
    ).scalar_one_or_none()

    slug = (row or {}).get("slug")
    return {
        "name": (row or {}).get("trading_name") or (row or {}).get("legal_name"),
        "email": (row or {}).get("primary_email"),
        "slug": slug,
        "url": f"https://{slug}-rcm.ceez.ai" if slug else None,
        "country": (country or "").upper() or None,
    }


async def start_onboarding(
    session: AsyncSession, tenant_id: str, return_base: str,
) -> str:
    """Create or reuse the connected account and return a link to finish setup.

    The link is single-use and short-lived, which is why it is generated on
    demand rather than stored.
    """
    import stripe

    from app.domains.payments.gateway_factory import (
        PaymentsNotConfigured, platform_api_key,
    )

    try:
        api_key = await platform_api_key(session)
    except PaymentsNotConfigured as exc:
        raise ConnectError(
            "Connecting is unavailable: the platform's own Stripe credentials "
            "are not configured."
        ) from exc

    client = stripe.StripeClient(api_key=api_key)
    facts = await _tenant_facts(session, tenant_id)

    existing = (
        await session.execute(
            text(
                "SELECT connected_account_id FROM tenant_payment_config "
                " WHERE tenant_id = CAST(:t AS uuid)"
            ),
            {"t": tenant_id},
        )
    ).scalar_one_or_none()

    account_id = existing
    if not account_id:
        if not facts["country"]:
            # Stripe needs a country and it must be the real one. Guessing would
            # produce an account the tenant cannot complete onboarding for.
            raise ConnectError(
                "Add a location first — Stripe needs to know which country the "
                "business operates in before an account can be created."
            )
        params: dict[str, Any] = {
            "type": "standard",
            "country": facts["country"],
            "business_profile": {
                # 7512 is the card networks' code for automobile rental, and it
                # is what makes this account eligible for the extended
                # authorisation windows a rental needs.
                "mcc": "7512",
                "name": facts["name"] or facts["slug"],
            },
            "metadata": {"tenant_id": tenant_id, "slug": facts["slug"] or ""},
        }
        if facts["email"]:
            params["email"] = facts["email"]
        if facts["url"]:
            params["business_profile"]["url"] = facts["url"]

        try:
            account = await client.accounts.create_async(params)
        except stripe.StripeError as exc:
            detail = getattr(exc, "user_message", None) or str(exc)
            # Connect not being signed up for is a one-time platform setup, not
            # something the rental company can act on. Say so, or they will
            # spend an afternoon checking their own details.
            if "signed up for Connect" in detail or isinstance(exc, stripe.PermissionError):
                raise ConnectError(
                    "Connecting is not available yet — Stripe Connect has not "
                    "been enabled on the platform's own Stripe account. This is "
                    "our setup to do, not yours; please contact support."
                ) from exc
            raise ConnectError(f"Stripe would not create the account: {detail}") from exc

        account_id = str(dict(account).get("id"))
        await _store_account(session, tenant_id, account_id)
        log.info("connect_account_created", tenant_id=tenant_id,
                 account=account_id, country=facts["country"])

    # refresh_url is where Stripe sends them if the link has expired; it must
    # start the flow again rather than 404, or a slow onboarding dead-ends.
    try:
        link = await client.account_links.create_async({
            "account": account_id,
            "type": "account_onboarding",
            "refresh_url": f"{return_base}/settings?connect=refresh",
            "return_url": f"{return_base}/settings?connect=return",
        })
    except stripe.StripeError as exc:
        raise ConnectError(
            f"Stripe would not start onboarding: "
            f"{getattr(exc, 'user_message', None) or str(exc)}"
        ) from exc

    return str(dict(link).get("url") or "")


async def _store_account(session: AsyncSession, tenant_id: str, account_id: str) -> None:
    """Record the account, not live and not verified.

    Creating an account is the beginning of onboarding, not the end of it —
    Stripe will not let it take payments until identity and bank details are
    done. So this writes the id and nothing that would let a charge through.
    """
    await session.execute(
        text(
            """
            INSERT INTO tenant_payment_config
                (tenant_id, provider, onboarding, connected_account_id,
                 mode, is_live, verified_at, verify_error, updated_at)
            VALUES
                (CAST(:t AS uuid), 'stripe', 'managed', :acct,
                 'LIVE', false, NULL, NULL, now())
            ON CONFLICT (tenant_id) DO UPDATE SET
                provider    = 'stripe',
                onboarding  = 'managed',
                connected_account_id = EXCLUDED.connected_account_id,
                -- Switching to the managed path abandons any keys that were
                -- stored for the credentials path. Leaving them would mean two
                -- possible answers to "whose account does this charge land on".
                secrets_enc = '{}'::jsonb,
                secret_hints= '{}'::jsonb,
                is_live     = false,
                verified_at = NULL,
                verify_error = NULL,
                updated_at  = now()
            """
        ),
        {"t": tenant_id, "acct": account_id},
    )
    await session.commit()
