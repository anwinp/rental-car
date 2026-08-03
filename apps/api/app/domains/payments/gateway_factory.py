"""Resolve the payment gateway a tenant takes renter money through.

Credentials come from `tenant_payment_config` and are decrypted here, per call.
They are never cached on a module: `stripe.api_key` used to be process-global,
which with per-tenant keys is a cross-tenant money bug — one variable, two
concurrent requests, and a charge that succeeds against the wrong company's
account. `tests/payment_credential_lint.py` keeps that from coming back.

A tenant's configuration is used only when it is **live**, which requires having
been verified. A config that is merely saved does not take money; see
PAYMENTS_STRATEGY.md §6.

Tenants with nothing configured fall back to the platform's own Stripe account.
That is a migration affordance, not the destination — it is what every existing
workspace does today, and removing it before they have configured anything would
stop them taking payments at all. `PLATFORM_FALLBACK_ALLOWED` turns it off once
the estate has moved across.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import structlog

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.payments.gateway import PaymentGateway

log = structlog.get_logger()


@dataclass(frozen=True)
class GatewayCredentials:
    """What a gateway needs in order to act for a tenant.

    `stripe_account` is the connected account a charge should land on. None
    means "the account owning the key" — true for a tenant who supplied their
    own keys, and for the platform fallback.
    """
    provider: str
    api_key: str
    stripe_account: str | None = None
    # Whether this configuration is switched on for real money. Verification
    # resolves credentials that are not yet live; charging must not.
    is_live: bool = False
    settings: dict = field(default_factory=dict)


class PaymentsNotConfigured(RuntimeError):
    """The tenant has no usable way to take money."""


# Whether a tenant that has configured nothing may transact on the platform's
# account. True until every workspace has its own configuration; flipping it to
# False makes an unconfigured tenant fail loudly instead of quietly billing
# through us.
PLATFORM_FALLBACK_ALLOWED = True


async def resolve_credentials(tenant_id: str, session: AsyncSession) -> GatewayCredentials:
    """Credentials for this tenant, decrypted at the point of use.

    Used by the gateway factory and by verification — which is why it resolves
    a config that is *not* live: an operator has to be able to check
    credentials before switching them on. Only `get_gateway_for_tenant`
    requires live, because only it is about moving a renter's money.
    """
    from app.core.secrets_box import decrypt

    # tenant_payment_config is under RLS, so an unbound session sees nothing —
    # and "no row" would then be indistinguishable from "not allowed to see the
    # row". Getting that wrong points the fallback at the platform's account,
    # which means a tenant who configured their own processor would silently
    # have renter money land with us. Confirm the session is bound to the
    # tenant being asked about before trusting an empty result.
    bound = (
        await session.execute(
            text("SELECT NULLIF(current_setting('app.current_tenant_id', true), '')")
        )
    ).scalar()
    if str(bound or "") != str(tenant_id):
        raise PaymentsNotConfigured(
            "Payment credentials were requested on a session that is not bound "
            "to this workspace. Refusing rather than guessing whose account to "
            "charge."
        )

    row = (
        await session.execute(
            text(
                "SELECT provider, onboarding, connected_account_id, secrets_enc, "
                "       settings, is_live "
                "  FROM tenant_payment_config WHERE tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid": tenant_id},
        )
    ).mappings().first()

    if not row:
        return await _platform_credentials(session)

    provider = row["provider"]
    secrets = row["secrets_enc"] or {}

    if row["onboarding"] == "managed":
        # Our key, their account. The connected account is what makes the
        # charge land on them rather than on us.
        return GatewayCredentials(
            provider=provider,
            api_key=await platform_api_key(session),
            stripe_account=row["connected_account_id"],
            is_live=row["is_live"],
        )

    key_field = "secret_key" if provider.startswith("stripe") else "api_key"
    blob = secrets.get(key_field)
    if not blob:
        raise PaymentsNotConfigured(
            "This workspace has no payment credentials stored."
        )
    try:
        key = decrypt(blob, name=f"tenant_payment.{key_field}")
    except Exception as exc:  # noqa: BLE001 — never leak ciphertext or key state
        raise PaymentsNotConfigured(
            "The stored payment credentials could not be read."
        ) from exc

    return GatewayCredentials(
        provider=provider,
        api_key=key,
        stripe_account=None,
        is_live=row["is_live"],
        settings=dict(row["settings"] or {}),
    )


async def platform_api_key(session: AsyncSession) -> str:
    """The platform's own Stripe key, decrypted at the point of use.

    Reads `platform_billing_config` — the key an operator entered in the console
    — before the environment variable. Those had drifted: the env value in
    production is the literal placeholder from `.env.example`, while the working
    key is the console one. Anything that reached for settings.stripe_secret_key
    was reaching for a string that authenticates against nothing.

    The environment remains a fallback so a deployment can be configured without
    the console, but it is second.
    """
    from app.core.config import settings

    try:
        row = (
            await session.execute(
                text("SELECT secret_key_enc FROM platform_billing_config WHERE id = 1")
            )
        ).mappings().first()
        if row and row["secret_key_enc"]:
            from app.core.secrets_box import decrypt

            return decrypt(row["secret_key_enc"], name="stripe_secret_key")
    except Exception as exc:  # noqa: BLE001 — fall through to the environment
        log.warning("platform_stripe_key_unreadable", error=str(exc)[:200])

    key = settings.stripe_secret_key.get_secret_value()
    if not key or key.endswith("placeholder"):
        raise PaymentsNotConfigured(
            "The platform has no usable Stripe credentials configured."
        )
    return key


async def _platform_credentials(session: AsyncSession) -> GatewayCredentials:
    if not PLATFORM_FALLBACK_ALLOWED:
        raise PaymentsNotConfigured(
            "This workspace has not set up payments yet."
        )
    return GatewayCredentials(
        provider="stripe", api_key=await platform_api_key(session), is_live=True,
    )


async def get_gateway_for_tenant(tenant_id: str, session: AsyncSession) -> PaymentGateway:
    creds = await resolve_credentials(tenant_id, session)

    if not creds.is_live:
        # Saved but never switched on. Refusing here rather than transacting is
        # the point of the gate: a configuration that has not been verified and
        # deliberately enabled must not move a renter's money.
        raise PaymentsNotConfigured(
            "Payments are not switched on for this workspace yet."
        )

    if creds.provider == "tyro":
        # Still resolvable, so a tenant configured for Tyro does not silently
        # fall back to Stripe and get charged on the wrong rails. It raises on
        # use, which is the honest failure: Tyro is a terminal-local provider
        # and does not fit this server-side interface — PAYMENTS_STRATEGY.md §5.
        from app.integrations.gateways.tyro_gateway import TyroGateway
        return TyroGateway()

    from app.integrations.gateways.stripe_gateway import StripeGateway
    return StripeGateway(api_key=creds.api_key, stripe_account=creds.stripe_account)
