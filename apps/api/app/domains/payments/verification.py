"""Prove a tenant's payment configuration actually works.

The gate on going live. It matters that this makes a real call: a well-formed
key for the wrong account, a revoked key, and a correct key are
indistinguishable by inspection, and the moment anyone finds out otherwise is a
customer at the counter.

What it does *not* do is charge anybody. Stripe's account endpoint answers
"these credentials are valid, and here is whose account they open" without
touching a card — which is the whole question at configuration time. A test
authorisation needs a card number, and asking a tenant for one to prove their
API key works would put a PAN in a place we have gone to some trouble to keep
them out of.
"""
from __future__ import annotations

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger()


async def verify_tenant_payments(
    session: AsyncSession, tenant_id: str,
) -> tuple[bool, str | None]:
    """(ok, error). Never raises — the error is the product."""
    from app.domains.payments import providers
    from app.domains.payments.gateway_factory import (
        PaymentsNotConfigured, resolve_credentials,
    )

    try:
        creds = await resolve_credentials(tenant_id, session)
    except PaymentsNotConfigured as exc:
        return False, str(exc)
    except Exception as exc:  # noqa: BLE001
        log.warning("payment_verify_resolve_failed", tenant_id=tenant_id,
                    error=str(exc)[:200])
        return False, "The stored credentials could not be read."

    provider = providers.get(creds.provider)
    if provider is None:
        return False, f"Unknown payment provider '{creds.provider}'."
    if provider.kind != "server_rest":
        # A terminal-local provider cannot be checked from here at all; the
        # counter's browser is the only thing that can reach the reader.
        return False, (
            f"{provider.label} runs from the counter, so it cannot be checked "
            "from this screen."
        )

    if not creds.provider.startswith("stripe"):
        return False, f"No verification is implemented for {provider.label} yet."

    return await _verify_stripe(creds)


async def _verify_stripe(creds) -> tuple[bool, str | None]:
    """Retrieve the account the credentials belong to."""
    import stripe

    client = stripe.StripeClient(api_key=creds.api_key)
    options = {"stripe_account": creds.stripe_account} if creds.stripe_account else {}

    try:
        # `retrieve_current` is GET /v1/account — "whose account does this key
        # open". With stripe_account in options it resolves the connected
        # account instead, which is the same question for managed onboarding.
        account = await client.accounts.retrieve_current_async(options=options)
    except stripe.AuthenticationError:
        return False, "Stripe rejected those credentials."
    except stripe.PermissionError:
        return False, (
            "Those credentials do not have access to that account."
        )
    except stripe.APIConnectionError:
        return False, "Could not reach Stripe. Try again in a moment."
    except stripe.StripeError as exc:
        return False, f"Stripe said: {getattr(exc, 'user_message', None) or str(exc)}"
    except Exception as exc:  # noqa: BLE001
        # Not a Stripe error at all, so not the tenant's problem. This branch
        # once reported a wrong call signature on our side as "could not reach
        # Stripe", which sent the operator to check their network while the bug
        # was here. Log it as an error and say who is at fault.
        log.error("payment_verify_internal_error",
                  error=f"{type(exc).__name__}: {exc}"[:300])
        return False, "The check could not be completed — this is a fault on our side."

    data = dict(account)

    # Valid credentials are not the same as an account that can take money.
    # Saying "connected" while Stripe is still waiting on identity documents
    # would set the tenant up to discover it at the counter.
    if data.get("charges_enabled") is False:
        return False, (
            "Stripe accepted the credentials but this account cannot take "
            "payments yet — finish the outstanding steps in your Stripe "
            "dashboard."
        )

    log.info("payment_verify_ok", stripe_account=data.get("id"))
    return True, None
