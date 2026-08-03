"""Resolve the payment gateway a tenant takes renter money through.

This is the seam. Phase 0 changes only *how* credentials reach the gateway —
explicitly, as arguments — not yet *whose* they are. Every tenant still
transacts on the platform's Stripe account, because per-tenant merchant
configuration does not exist yet; that is Phase 1, and it lands here in
`_credentials_for`.

What Phase 0 removes is the module-global `stripe.api_key`. Adding per-tenant
credentials on top of that global would have been a cross-tenant money bug: one
process-wide variable, two concurrent requests, and a charge that succeeds
against the wrong company's account. See PAYMENTS_STRATEGY.md §7.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.payments.gateway import PaymentGateway


@dataclass(frozen=True)
class GatewayCredentials:
    """What a gateway needs in order to act for a tenant.

    `stripe_account` is the connected account a charge should land on. None
    means "the account owning the key" — which today is ours, and after Phase 1
    should be true only for tenants who supplied their own keys directly.
    """
    provider: str
    api_key: str
    stripe_account: str | None = None


class PaymentsNotConfigured(RuntimeError):
    """The tenant has no usable way to take money."""


async def _credentials_for(tenant_id: str, session: AsyncSession) -> GatewayCredentials:
    """Credentials for this tenant.

    Phase 1 replaces the body of this function with a read of
    `tenant_payment_config`, decrypted per call through `secrets_box` and never
    cached on a module. The signature is already the one that needs, so the
    change will not reach any caller.
    """
    from app.core.config import settings

    row = (
        await session.execute(
            text(
                "SELECT payment_gateway, stripe_account_id "
                "  FROM tenants WHERE tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid": tenant_id},
        )
    ).mappings().first()

    provider = ((row["payment_gateway"] if row else None) or "STRIPE").upper()

    key = settings.stripe_secret_key.get_secret_value()
    if not key:
        raise PaymentsNotConfigured("No Stripe credentials are configured.")

    # Deliberately NOT passing tenants.stripe_account_id yet. Nothing populates
    # that column, and charging on an unverified connected account would move
    # real money to an account no one has confirmed belongs to the tenant.
    # Phase 1 turns it on, behind the verify-before-live gate.
    return GatewayCredentials(provider=provider, api_key=key, stripe_account=None)


async def get_gateway_for_tenant(tenant_id: str, session: AsyncSession) -> PaymentGateway:
    creds = await _credentials_for(tenant_id, session)

    if creds.provider == "TYRO":
        # Still resolvable, so a tenant configured for Tyro does not silently
        # fall back to Stripe and get charged on the wrong rails. It raises on
        # use, which is the honest failure: Tyro is a terminal-local provider
        # and does not fit this server-side interface — PAYMENTS_STRATEGY.md §5.
        from app.integrations.gateways.tyro_gateway import TyroGateway
        return TyroGateway()

    from app.integrations.gateways.stripe_gateway import StripeGateway
    return StripeGateway(api_key=creds.api_key, stripe_account=creds.stripe_account)
