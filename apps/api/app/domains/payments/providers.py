"""What each payment provider needs, and what it can do.

One declarative entry per provider. The settings UI renders its form from
`fields` rather than hardcoding one screen per gateway, so adding a provider is
an entry here plus an adapter — no new UI.

`capabilities` is the half that is easy to treat as documentation and expensive
to. It has to drive the interface. If a tenant's processor cannot raise an
existing hold, the deposit screen must not offer "increase the hold when a
rental is extended", and the counter must not show an Extend button that will
fail — the point is to hide what a tenant's own processor cannot do, rather than
discovering it at the counter with a customer waiting.

`kind` exists because providers are not all reachable the same way
(PAYMENTS_STRATEGY.md §5):

  server_rest     our API calls the processor            Stripe, Adyen online
  terminal_local  the counter's browser drives a reader  Tyro iClient
  terminal_cloud  our API dispatches to a networked one  Stripe Terminal

Tyro is the reason this distinction is in the model rather than implied. Its
iClient is a browser library talking to a terminal on the counter's LAN; our
server cannot initiate a Tyro transaction at all.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Kind = Literal["server_rest", "terminal_local", "terminal_cloud"]
Onboarding = Literal["managed", "credentials"]


@dataclass(frozen=True)
class Field:
    """One input on the settings form."""
    key: str
    label: str
    # Secret fields are write-only: stored as ciphertext, and only ever read
    # back as the last four characters.
    secret: bool = False
    required: bool = True
    help: str | None = None
    placeholder: str | None = None


@dataclass(frozen=True)
class Capabilities:
    # Can an existing hold be raised when a rental is extended?
    incremental_auth: bool = False
    # Stripe caps this at 10; None means the provider does not say.
    max_increments: int | None = None
    # How long an authorisation survives. Vehicle rental gets an extended
    # window on most networks — the 7-day default is wrong for this industry.
    max_auth_days: int = 7
    # Capture less than was authorised, which is the normal case on return.
    partial_capture: bool = False
    # Can the deposit be a second authorisation rather than riding on the
    # rental's? Gates that choice in the deposit policy UI.
    separate_deposit_auth: bool = False
    # Card-present at the counter, and by what mechanism.
    card_present: str | None = None
    # Empty means "no restriction we model" — used to filter the provider list
    # for a tenant by where they operate.
    countries: tuple[str, ...] = ()
    currencies: tuple[str, ...] = ()


@dataclass(frozen=True)
class Provider:
    key: str
    label: str
    blurb: str
    kind: Kind
    onboarding: Onboarding
    capabilities: Capabilities
    fields: tuple[Field, ...] = ()
    # False while an adapter is stubbed. Listed so the choice is visible and
    # explained, but not selectable — offering a provider that raises on first
    # use is worse than not offering it.
    available: bool = True
    unavailable_reason: str | None = None


REGISTRY: dict[str, Provider] = {
    "stripe": Provider(
        key="stripe",
        label="Stripe (one-click setup)",
        blurb="Stripe creates and verifies your account for you, and pays out "
              "to your bank.",
        kind="server_rest",
        onboarding="managed",
        # Nothing to type: the tenant is redirected to Stripe and comes back.
        fields=(),
        capabilities=Capabilities(
            incremental_auth=True,
            max_increments=10,
            max_auth_days=30,
            partial_capture=True,
            separate_deposit_auth=True,
            card_present="stripe_terminal",
        ),
        # Managed onboarding creates the connected account through *our* Stripe
        # account, which means it only works once Connect is signed up for on
        # the platform side. Until then the button would 409, and a control that
        # cannot work is worse than one that explains itself. Nothing else in
        # the design depends on this: a tenant supplying their own keys never
        # touches our account at all.
        available=False,
        unavailable_reason=(
            "One-click setup is not switched on yet. Use the option below to "
            "connect the Stripe account you already have."
        ),
    ),
    "stripe_keys": Provider(
        key="stripe_keys",
        label="Stripe",
        blurb="Connect your own Stripe account. Payments go straight to you — "
              "we never hold your money.",
        kind="server_rest",
        onboarding="credentials",
        fields=(
            Field("secret_key", "Secret key", secret=True,
                  placeholder="sk_live_…",
                  help="From Stripe → Developers → API keys. Starts sk_test_ "
                       "for testing or sk_live_ for real payments."),
            Field("publishable_key", "Publishable key", secret=False,
                  required=False, placeholder="pk_live_…",
                  help="Safe to expose — it is sent to your customers' browsers."),
            Field("webhook_secret", "Webhook signing secret", secret=True,
                  required=False, placeholder="whsec_…",
                  help="Lets us trust the payment updates Stripe sends back."),
        ),
        capabilities=Capabilities(
            incremental_auth=True,
            max_increments=10,
            max_auth_days=30,
            partial_capture=True,
            separate_deposit_auth=True,
            card_present="stripe_terminal",
        ),
    ),
    "adyen": Provider(
        key="adyen",
        label="Adyen",
        blurb="For companies with an existing Adyen contract.",
        kind="server_rest",
        onboarding="credentials",
        fields=(
            Field("api_key", "API key", secret=True),
            Field("merchant_account", "Merchant account", secret=False,
                  help="The account name Adyen assigned you, not your company name."),
            Field("hmac_key", "Webhook HMAC key", secret=True, required=False),
            Field("live_url_prefix", "Live URL prefix", secret=False,
                  required=False,
                  help="Required for live traffic. Adyen gives you this when "
                       "your account goes live."),
        ),
        capabilities=Capabilities(
            incremental_auth=True,
            # Adyen expires authorisations after 28 days and extends by
            # re-issuing an adjustment at the current amount.
            max_auth_days=28,
            partial_capture=True,
            separate_deposit_auth=True,
            card_present="adyen_pos",
        ),
        available=False,
        unavailable_reason="The Adyen adapter is not built yet.",
    ),
    "tyro": Provider(
        key="tyro",
        label="Tyro",
        blurb="Australian EFTPOS terminals, for counter payments.",
        kind="terminal_local",
        onboarding="credentials",
        fields=(
            Field("merchant_id", "Merchant ID", secret=False),
            Field("terminal_id", "Terminal ID", secret=False),
        ),
        capabilities=Capabilities(
            incremental_auth=False,
            max_auth_days=7,
            partial_capture=False,
            separate_deposit_auth=False,
            card_present="tyro_iclient",
            countries=("AU",),
            currencies=("AUD",),
        ),
        available=False,
        unavailable_reason=(
            "Tyro runs from the counter's browser against a terminal on your "
            "local network, and needs Tyro's certification before it can be "
            "used for real payments."
        ),
    ),
}


def get(key: str) -> Provider | None:
    return REGISTRY.get(key)


def for_country(country: str | None) -> list[Provider]:
    """Providers a tenant in this country could actually use.

    A provider with no declared countries is unrestricted as far as we model
    it; one that declares them is filtered out elsewhere. Tyro appearing as an
    option to a German rental company would be a bug in the settings page.
    """
    code = (country or "").upper()
    out = []
    for p in REGISTRY.values():
        if p.capabilities.countries and code and code not in p.capabilities.countries:
            continue
        out.append(p)
    return out


def describe(p: Provider) -> dict[str, Any]:
    """The registry entry as the settings page consumes it."""
    caps = p.capabilities
    return {
        "key": p.key,
        "label": p.label,
        "blurb": p.blurb,
        "kind": p.kind,
        "onboarding": p.onboarding,
        "available": p.available,
        "unavailable_reason": p.unavailable_reason,
        "fields": [
            {
                "key": f.key, "label": f.label, "secret": f.secret,
                "required": f.required, "help": f.help,
                "placeholder": f.placeholder,
            }
            for f in p.fields
        ],
        "capabilities": {
            "incremental_auth": caps.incremental_auth,
            "max_increments": caps.max_increments,
            "max_auth_days": caps.max_auth_days,
            "partial_capture": caps.partial_capture,
            "separate_deposit_auth": caps.separate_deposit_auth,
            "card_present": caps.card_present,
            "countries": list(caps.countries),
            "currencies": list(caps.currencies),
        },
    }
