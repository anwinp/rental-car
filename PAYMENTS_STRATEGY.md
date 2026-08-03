# Tenant payment processing — strategy

How a rental company configures the way it takes money from its renters.

Status: proposal, nothing built. Research and decisions first, per request.

---

## 1. Where we actually are

The gateway abstraction is already the right shape. `PaymentGateway` in
`app/domains/payments/gateway.py` declares `create_preauth`, `incremental_auth`,
`capture`, `void`, `refund`, `get_status` — which is precisely the car-rental
money flow and not the e-commerce one. That is worth keeping.

Underneath it, three things are missing or wrong:

**Every tenant's rental income goes to our Stripe account.**
`StripeClient.__init__` does `stripe.api_key = settings.stripe_secret_key`. The
factory (`gateway_factory.py`) reads `tenants.payment_gateway` — a *name* — and
constructs the gateway with no credentials. So there is no mechanism by which a
renter's card payment could reach the rental company. Today the platform is the
merchant of record for every rental in the system.

**`tenants.payment_gateway` is decorative.** Nothing writes it, no UI sets it,
and there is no per-tenant configuration table. `stripe_account_id` and
`stripe_test_charge_succeeded` exist on `tenants` but are read only by the
onboarding checklist — they gate a green tick and nothing else.

**Tyro raises on every method.** `_tyro_init_transaction` is
`NotImplementedError("fill when creds arrive")`. Selecting it would fail at the
counter.

Two money flows are being conflated and must not be. **Platform billing** — the
rental company paying us a subscription — is built and works (`platform_billing_config`,
Stripe Checkout, webhooks). **Merchant processing** — a renter paying the rental
company — does not exist. This document is only about the second.

---

## 2. Why the usual answer doesn't work here

The reflex for "add payments to a SaaS" is a drop-in: Stripe Checkout, a PayPal
button, a hosted payment page. For vehicle rental that is the wrong tool, and it
is worth being concrete about why, because it constrains every later choice.

A rental transaction is not a sale. It is a **hold that resolves into a charge
of an amount nobody knows yet**:

| Moment | Operation | Amount |
|---|---|---|
| Booking | optional deposit, often nothing | small or zero |
| Pickup | **pre-authorisation** — estimated rental + security deposit | more than the rental |
| Extension | **incremental authorisation** | increases the hold |
| Return | **capture**, usually *less* than authorised | actual |
| Damage/fuel/toll found later | additional capture or separate charge | unknown at pickup |
| No-show | **void** | zero |

Drop-in checkout products do immediate capture of a known amount. They cannot
express any row in that table except the first. So the integration has to be at
the PaymentIntent/authorisation level, which is what the existing ABC already
assumes.

Two facts from the research that directly change what we must build:

**Authorisation validity.** The default hold on an online card payment is **7
days**. Vehicle rental is a card-network-recognised exception: with *extended
authorisations*, Visa allows 29 days 18 hours, Mastercard 30 days, Amex 30 days
for vehicle rental, Discover 30 days ([Stripe extended
authorizations](https://docs.stripe.com/payments/extended-authorization)). Adyen
expires authorisations after 28 days and extends by re-issuing an adjustment for
the current amount ([Adyen authorisation
adjustment](https://docs.adyen.com/online-payments/adjust-authorisation)).

Our `StripeGateway.create_preauth` returns a hardcoded `auth_expiry_days=7`.
Any rental longer than a week would have its hold silently expire before return,
and the capture at the counter would fail with the customer standing there. This
is a live bug in the abstraction, not just a gap.

**Incremental authorisation limits.** Stripe supports up to **10 increments per
PaymentIntent**. A rental extended repeatedly can exhaust that, so the domain
logic needs a fallback (new auth + void old) rather than assuming increments are
unlimited.

---

## 3. The central decision: whose merchant account?

There are two models, they are not exclusive, and the choice determines
liability, compliance burden and whether we can ever take a cut.

### Model A — Managed onboarding ("Connect Stripe")

The tenant clicks a button, completes Stripe-hosted onboarding, and we store
their `stripe_account_id` (the column already exists). We charge **on their
account** by passing the connected account id per request.

- Stripe performs KYC/AML on the rental company, not us.
- **We never hold their credentials.** Nothing to encrypt, rotate, or leak.
- The tenant is the settlement merchant: money lands in their bank, and *they*
  own chargebacks.
- We can take an application fee if we ever want revenue share.
- Cost: Stripe-only, and the tenant must be in a supported country.

### Model B — Bring your own credentials

The tenant pastes API keys for a gateway they already have.

- Works with anything — Adyen, Braintree, Tyro, a local acquirer.
- Necessary for tenants with an existing processor contract, which mid-size
  rental companies usually have.
- Cost: **we hold their secrets.** That is real liability, a rotation burden, and
  a much larger breach blast radius. No application fee is possible.

### Recommendation

**Build A first, B as the escape hatch.** Default every new tenant to
one-click Connect; offer BYO credentials to tenants who ask. This is what
Shopify and Lightspeed do, for the same reasons.

**Use direct charges, not destination charges.** With destination charges the
platform is the settlement merchant and, per Stripe's own guidance, *"your
platform is responsible for negative balances"*
([Stripe Connect charges](https://docs.stripe.com/connect/charges)). Vehicle
rental is a high-dispute category — damage claims, fuel charges, toll
recharges are exactly what customers charge back. Being on the hook for a
negative balance we cannot control, for damage we did not assess, on a rental we
did not conduct, is the wrong side of that risk. Direct charges put the dispute
with the rental company, which is also where the evidence is.

---

## 4. The configurable UI

The request is a UI that handles "all the standard payment methods" without a
bespoke form per gateway. The way to get that is to stop hardcoding forms and
**describe each provider declaratively**, then render from the description.

### Provider descriptor

One registry entry per gateway, holding both its configuration shape and its
capabilities:

```
PROVIDERS = {
  "stripe_connect": {
    label, logo, onboarding: "oauth",
    fields: [],                          # nothing to type — it's a redirect
    capabilities: {
      incremental_auth: true, max_increments: 10,
      extended_auth_days: 30, partial_capture: true,
      card_present: "stripe_terminal",
      currencies: [...], countries: [...],
    },
  },
  "adyen": {
    onboarding: "credentials",
    fields: [
      {key: "api_key",        label: "API key",         secret: true},
      {key: "merchant_account", label: "Merchant account", secret: false},
      {key: "hmac_key",       label: "Webhook HMAC key", secret: true},
      {key: "live_url_prefix", ...},
    ],
    capabilities: {incremental_auth: true, extended_auth_days: 28, ...},
  },
  "tyro": {...},
}
```

The settings page renders whatever `fields` says, marks `secret: true` ones
write-only, and shows a last-4 hint on read. Adding a gateway becomes a registry
entry plus an adapter class — no new UI.

### Capabilities must drive the UX, not just document it

This is the part that is easy to skip and expensive to skip. If a tenant's
gateway cannot do incremental authorisation, the deposit-policy screen must not
offer "increase the hold when a rental is extended", and the counter must not
show an "extend" button that will fail. The registry is what lets the UI hide
what the tenant's own processor cannot do, rather than surfacing an error at the
counter with a customer waiting.

### What a tenant configures, in order

1. **Processor** — connect, or enter credentials. Test mode first.
2. **Verify** — a real authorisation-and-void against their own account, before
   the config can go live. `tenants.stripe_test_charge_succeeded` already exists
   for exactly this and currently means nothing; make it the gate.
3. **Deposit / hold policy** — this is rental-specific and belongs to the tenant,
   not the gateway: hold amount per vehicle class (flat or multiplier), whether
   to hold at booking or at pickup, release timing after return.
4. **Accepted methods** — cards, wallets, local methods; the list is filtered by
   what their processor and country actually support.
5. **Counter hardware** — terminal pairing for card-present, if any.

### Card-present vs card-not-present

Worth treating as first-class, because a rental company does both. Web booking
is card-not-present via hosted fields. The counter should be card-present via a
terminal: better rates, liability shift on fraud, and materially higher
authorisation success on the large deposit holds that get declined most often.
The existing ABC takes a `payment_method_token`, which covers both.

---

## 5. Security

**The concurrency landmine.** `stripe.api_key = ...` is a **process-global
assignment**. The moment credentials become per-tenant, two concurrent requests
race: tenant B's key can overwrite the global while tenant A's charge is in
flight, and the money lands in the wrong company's account. Under async workers
this is not theoretical. The installed SDK (10.12.0) exposes
`stripe.StripeClient(api_key=...)` for per-instance keys, verified present.
**Nothing per-tenant may ship until the global assignment is gone.** Our own
class is also named `StripeClient`, shadowing the SDK's — rename it while fixing.

**Secrets at rest.** `app/core/secrets_box.py` already does AES-256-GCM with the
field name as associated data and a `v1:` version prefix. Reuse it; do not invent
a second scheme. Secrets are write-only over the API — a `hint()` of the last 4
characters is the only thing that ever comes back.

**PCI scope.** Never accept a raw card number anywhere in our stack — hosted
fields, Payment Element, or terminal only. That keeps us at SAQ A. As a
multi-tenant service provider we also fall under PCI DSS Appendix A1, which is
specifically about tenant isolation; the existing RLS model extends to the
payment config tables naturally.

**Webhooks.** Each tenant's processor sends events to us. Per-tenant signing
secrets, verified against the raw body before parsing, and the tenant resolved
*from the verified payload* — never from a query parameter an attacker controls.

---

## 6. Suggested phasing

| Phase | What | Why first |
|---|---|---|
| 0 | Kill the global `stripe.api_key`; per-request client | Everything else is unsafe until this is done |
| 1 | `tenant_payment_config` table + provider registry + settings UI, Stripe Connect only | The one-click path covers most tenants |
| 2 | Verify-before-live gate; make `stripe_test_charge_succeeded` mean something | Stops a tenant going live with a broken config |
| 3 | Deposit/hold policy per vehicle class; fix `auth_expiry_days` to use extended auth | The 7-day bug bites on any week-plus rental |
| 4 | BYO credentials (Adyen first), per-tenant webhook secrets | Unlocks tenants with existing processors |
| 5 | Card-present terminals at the counter | Better rates and auth success on deposits |

---

## 7. Decisions I need from you

1. **Revenue model** — do we ever want a cut of rental payments (application
   fee), or is the subscription the only revenue? This decides whether Connect is
   strategic or merely convenient.
2. **Which markets first?** Tyro is Australian and already stubbed. If AU is a
   target, BYO-credentials matters sooner than phase 4 suggests.
3. **Deposit holds** — is the security deposit a hold on the same authorisation
   as the rental, or a separate one? Separate is cleaner to reason about and to
   release; same-auth is cheaper and more likely to be approved.
4. **Do we support tenants with no processor at all?** If yes, Connect onboarding
   is the product's front door and needs real design attention, not a settings tab.

---

## Sources

- [Stripe — extended authorizations](https://docs.stripe.com/payments/extended-authorization)
- [Stripe — Connect charge types](https://docs.stripe.com/connect/charges)
- [Stripe — recommended Connect integrations](https://docs.stripe.com/connect/integration-recommendations)
- [Adyen — authorisation adjustment](https://docs.adyen.com/online-payments/adjust-authorisation)
- [Adyen — pre-authorisation (point of sale)](https://docs.adyen.com/point-of-sale/pre-authorisation)
