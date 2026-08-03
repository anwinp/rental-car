# Tenant payment processing — strategy

How a rental company configures the way it takes money from its renters.

Status: design agreed, nothing built.

**Decisions taken** (2026-08-03): no revenue share on rental payments; Australia
first but built as a global app; security deposits are a tenant policy and must
be configurable; tenants with no payment processor at all are supported.

---

## 1. Where we actually are

The gateway abstraction is already the right shape. `PaymentGateway` in
`app/domains/payments/gateway.py` declares `create_preauth`, `incremental_auth`,
`capture`, `void`, `refund`, `get_status` — precisely the car-rental money flow
and not the e-commerce one. That is worth keeping.

Underneath it, three things are missing or wrong.

**Every tenant's rental income goes to our Stripe account.**
`StripeClient.__init__` does `stripe.api_key = settings.stripe_secret_key`. The
factory (`gateway_factory.py`) reads `tenants.payment_gateway` — a *name* — and
constructs the gateway with no credentials. There is no mechanism by which a
renter's card payment could reach the rental company. Today the platform is the
merchant of record for every rental in the system.

**`tenants.payment_gateway` is decorative.** Nothing writes it, no UI sets it,
and there is no per-tenant payment configuration table.
`stripe_account_id` and `stripe_test_charge_succeeded` exist on `tenants` but are
read only by the onboarding checklist — they gate a green tick and nothing else.

**Tyro raises on every method,** and is also the wrong shape — see §5.

Two money flows are being conflated and must not be. **Platform billing** — the
rental company paying us a subscription — is built and works
(`platform_billing_config`, Stripe Checkout, webhooks). **Merchant processing** —
a renter paying the rental company — does not exist. This document is only about
the second.

---

## 2. Why the usual answer doesn't work here

The reflex for "add payments to a SaaS" is a drop-in: Stripe Checkout, a PayPal
button, a hosted payment page. For vehicle rental that is the wrong tool, and it
constrains every later choice.

A rental is not a sale. It is **a hold that resolves into an amount nobody knows
yet**:

| Moment | Operation | Amount |
|---|---|---|
| Booking | optional deposit, often nothing | small or zero |
| Pickup | **pre-authorisation** — estimated rental, plus deposit if the tenant takes one | more than the rental |
| Extension | **incremental authorisation** | increases the hold |
| Return | **capture**, usually *less* than authorised | actual |
| Damage, fuel, tolls found later | additional capture or separate charge | unknown at pickup |
| No-show | **void** | zero |

Drop-in checkout does immediate capture of a known amount. It cannot express any
row except the first. The integration has to be at the authorisation level,
which is what the existing ABC already assumes.

Two research findings change what must be built:

**Authorisation validity.** The default hold on an online card payment is **7
days**. Vehicle rental is a card-network-recognised exception: with extended
authorisations Visa allows 29 days 18 hours, Mastercard 30 days, Amex 30 days for
vehicle rental, Discover 30 days ([Stripe](https://docs.stripe.com/payments/extended-authorization)).
Adyen expires authorisations after 28 days and extends by re-issuing an
adjustment for the current amount ([Adyen](https://docs.adyen.com/online-payments/adjust-authorisation)).

`StripeGateway.create_preauth` returns a hardcoded `auth_expiry_days=7`. Any
rental longer than a week has its hold expire silently before return, and the
capture fails at the counter with the customer standing there. That is a live
bug in the abstraction, not merely a gap.

**Incremental authorisations are capped.** Stripe allows up to 10 per
PaymentIntent. A repeatedly extended rental exhausts that, so the domain needs a
fallback — new authorisation, then void the old — rather than assuming increments
are unlimited.

---

## 3. The governing principle: stay out of the funds flow

You've ruled out taking a cut of rental payments. That single decision resolves
the architecture, and it resolves it in the direction that is also safest for a
global product.

If we never take an application fee and charges are made **directly on the
tenant's own merchant account**, money never passes through us. We are not a
payment facilitator and not a money transmitter — the distinction turns on
control of funds: a processor that sends payment instructions between banks and
*"does not receive the funds itself… should not be considered a money
transmitter"* ([Venable](https://www.venable.com/insights/publications/2018/06/money-transmission-in-the-payment-facilitator-mode)).

For a product intended to run in many countries this is the difference between a
software rollout and a licensing project in every jurisdiction. Make it an
architectural rule, not an implementation detail:

> **The platform is never in the funds flow.** Renter money moves from the
> renter to the rental company's own merchant account. We hold configuration and
> issue instructions; we never hold, route, or net funds.

This settles the earlier open question definitively: **direct charges, never
destination charges.** Destination charges make the platform the settlement
merchant and, per Stripe, *"your platform is responsible for negative
balances"* ([Stripe](https://docs.stripe.com/connect/charges)). Vehicle rental is
a high-dispute category — damage, fuel, tolls are exactly what gets charged back.
Being liable for a negative balance on damage we did not assess, and putting
ourselves in the funds flow to do it, would be wrong twice over.

Losing the application fee costs us nothing we wanted, and buys global
deployability.

---

## 4. Two ways in, both needed from the start

Decision 4 (support tenants with no processor) and decision 2 (Australia first,
global) pull in different directions. Both paths are therefore Phase 1, not
sequenced.

### Managed onboarding — the front door

Tenant clicks *Connect*, completes provider-hosted onboarding, we store their
account id (`tenants.stripe_account_id` already exists) and charge on their
account. The provider does KYC/AML on the rental company. **We never hold their
credentials** — nothing to encrypt, rotate, or leak.

This is the default for a tenant who has no processor, which after decision 4 is
a first-class customer rather than an edge case. It needs real product design —
it is the first thing a new rental company does — not a settings tab.

Note that with no application fee, Connect gives us onboarding and
credential-avoidance, not economics. That is still worth having, but it means we
should not contort the design to keep tenants inside it.

### Bring your own credentials — required earlier than I first thought

Originally proposed for Phase 4. Australia-first moves it up. Mid-size Australian
rental operators typically already hold an acquirer relationship, and a global
product will meet the same in every market. Telling them to abandon their
existing rates to use us is a losing argument, especially when we take no cut and
therefore have no economic reason to care which processor they use.

Cost: we hold their secrets. `app/core/secrets_box.py` already does AES-256-GCM
with the field name as associated data; reuse it, do not invent a second scheme.

---

## 5. Three kinds of provider, not one

This is the finding that changes the abstraction.

`PaymentGateway` is a server-side async Python interface: our API calls the
processor's REST API. **Tyro does not work that way.** Tyro's iClient is a
*browser-based JavaScript library* that drives a physical EFTPOS terminal on the
counter's local network, and production use requires passing Tyro's
[mandatory certification](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide).
Our server cannot initiate a Tyro transaction at all — the counter app does, and
tells us the result.

The existing `TyroGateway` is not an unfinished implementation of the right
interface; it is the wrong interface. The leak is already visible: `PreAuthResult`
carries an `iclient_transaction_id` field that only Tyro could ever populate,
sitting in the dataclass every gateway returns.

So the registry needs a provider **kind**, and the domain has to handle each:

| Kind | Who talks to the processor | Examples |
|---|---|---|
| `server_rest` | Our API, server-side | Stripe, Adyen (online) |
| `terminal_local` | The counter app, browser → terminal on the LAN | Tyro iClient, Adyen POS |
| `terminal_cloud` | Our API, dispatching to a networked reader | Stripe Terminal |

For `terminal_local` the payment record is *reported to us* after the fact, which
means the flow needs an idempotent "record this terminal result" endpoint and the
counter UI owns the retry, not the server.

**Australia does not depend on Tyro.** Stripe Terminal is available in Australia,
supports eftpos alongside the international schemes, and offers Tap to Pay on
phone hardware ([Stripe](https://stripe.com/au/terminal)) — so an Australian
tenant with no processor gets card-present at the counter through the managed
path. Tyro is for tenants who already have Tyro. That de-risks Phase 1
considerably: it can ship without the certification project.

One constraint to design around: Terminal requires the receiving account and the
reader's location to be in the same country, settling in local currency.

---

## 6. The configurable UI

The ask is a UI that covers the standard payment methods without a bespoke form
per gateway. The way to get it is to describe each provider declaratively and
render from the description.

### Provider descriptor

```
PROVIDERS = {
  "stripe": {
    kind: "server_rest", onboarding: "managed",   # OAuth redirect
    fields: [],                                   # nothing to type
    capabilities: {
      incremental_auth: true, max_increments: 10,
      extended_auth_days: 30, partial_capture: true,
      separate_deposit_auth: true,
      card_present: "stripe_terminal",
      countries: [...], currencies: [...],
    },
  },
  "adyen": {
    kind: "server_rest", onboarding: "credentials",
    fields: [
      {key: "api_key",          label: "API key",           secret: true},
      {key: "merchant_account", label: "Merchant account",  secret: false},
      {key: "hmac_key",         label: "Webhook HMAC key",  secret: true},
      {key: "live_url_prefix",  label: "Live URL prefix",   secret: false},
    ],
    capabilities: {incremental_auth: true, extended_auth_days: 28, ...},
  },
  "tyro": {
    kind: "terminal_local", onboarding: "credentials",
    fields: [{key: "merchant_id", ...}, {key: "terminal_id", ...}],
    capabilities: {card_present: "tyro_iclient", countries: ["AU"],
                   currencies: ["AUD"], ...},
  },
}
```

The settings page renders whatever `fields` says, treats `secret: true` as
write-only, and shows a last-4 hint on read. Adding a provider is a registry
entry plus an adapter — no new UI.

### Capabilities must drive the UX, not merely document it

Easy to skip, expensive to skip. If a tenant's processor cannot do incremental
authorisation, the deposit-policy screen must not offer *"increase the hold when
a rental is extended"*, and the counter must not show an Extend button that will
fail. The registry is what lets the UI hide what a tenant's own processor cannot
do — rather than surfacing the error at the counter with a customer waiting.

Country and currency in the descriptor also do real work for a global product:
they filter which providers a tenant is even offered.

### Deposit policy — configurable, per your decision

The deposit is the tenant's commercial policy, so it is configured separately
from the processor and must not be hardcoded anywhere:

- **Taken at all?** Some operators take none.
- **Amount** — flat, or a multiplier of the rental total, **set per vehicle
  class**. A deposit on an exotic is not a deposit on an economy.
- **When** — at booking, or at pickup.
- **Combined or separate authorisation.** One hold covering rental plus deposit
  is cheaper and likelier to be approved; two holds are far easier to reason
  about and to release independently, and let the deposit be released at return
  while the rental capture settles. Both are legitimate — make it a per-tenant
  setting, gated by the `separate_deposit_auth` capability so it is only offered
  where the processor supports it.
- **Release timing** after return — immediately, or held pending inspection.

### What a tenant configures, in order

1. **Processor** — connect, or enter credentials. Test mode first.
2. **Verify** — a real authorisation and void against their own account before the
   config can go live. `tenants.stripe_test_charge_succeeded` exists for exactly
   this and currently means nothing; make it the gate.
3. **Deposit policy** — as above.
4. **Accepted methods** — filtered by processor, country and currency.
5. **Counter hardware** — terminal pairing, where the provider kind needs it.

---

## 7. Security

**The concurrency landmine — fixed in Phase 0.** `stripe.api_key = ...` was a
process-global assignment. With per-tenant credentials, two concurrent requests
race: tenant B's key overwrites the global while tenant A's charge is in flight,
and the money lands in the wrong company's account.

That was demonstrated rather than assumed. `tests/test_stripe_credential_isolation.py`
interleaves two requests the way an event loop does and prints which key each
would charge with:

```
old client   A charges with sk_test_TENANT_B   (should be sk_test_TENANT_A)
current      A charges with sk_test_TENANT_A   (should be sk_test_TENANT_A)
```

The test refuses to pass if the legacy shape *fails* to leak, so it cannot
quietly stop testing anything. `StripeMerchantApi` now builds its own
`stripe.StripeClient` per instance and carries `api_key` and `stripe_account` in
per-request options; `tests/payment_credential_lint.py` fails the build on any
module-level payment credential assignment.

**Secrets at rest.** Reuse `secrets_box.py`. Secrets are write-only over the API —
a `hint()` of the last four characters is all that ever comes back.

**PCI scope.** Never accept a raw card number anywhere in our stack — hosted
fields, Payment Element, or terminal only. That keeps us at SAQ A. As a
multi-tenant service provider we also fall under PCI DSS Appendix A1, which is
specifically about tenant isolation; the existing RLS model extends to the
payment configuration tables naturally.

**Webhooks.** Each tenant's processor sends events to us. Per-tenant signing
secrets, verified against the raw body before parsing, and the tenant resolved
**from the verified payload** — never from a query parameter an attacker
controls.

---

## 8. Phasing

| Phase | What | Why there |
|---|---|---|
| 0 ✅ | Remove the global `stripe.api_key`; per-request client | Everything else is unsafe until this is done |
| 1 ◐ | `tenant_payment_config` + provider registry + settings UI; BYO credentials done, managed onboarding still to build | Decision 4 needs the front door; decision 2 needs BYO immediately |
| 2 ✅ | Verify-before-live gate | Stops a tenant going live with a config that has never worked |
| 3 | Deposit policy per vehicle class; fix `auth_expiry_days` to use extended authorisation | The 7-day bug bites on any rental over a week |
| 4 | Stripe Terminal for card-present at the counter (AU: eftpos, Tap to Pay) | Better rates and far better auth success on deposit holds |
| 5 | Adyen adapter | Global coverage, and enterprise tenants with existing contracts |
| 6 | Tyro `terminal_local`, incl. certification | Only for tenants who already have Tyro; needs a certification project |

---

## 9. Still open

- **Multi-currency display.** A global product will have renters browsing in a
  currency the tenant does not settle in. Decide whether we display in the
  tenant's settlement currency only (simple, honest) or convert for display
  (nicer, and a source of disputes when the card statement differs).
- **Tyro certification** is a scheduled project with an external dependency, not
  a sprint task. Worth confirming demand before starting it.

---

## Sources

- [Stripe — extended authorizations](https://docs.stripe.com/payments/extended-authorization)
- [Stripe — Connect charge types](https://docs.stripe.com/connect/charges)
- [Stripe — Terminal (Australia)](https://stripe.com/au/terminal)
- [Adyen — authorisation adjustment](https://docs.adyen.com/online-payments/adjust-authorisation)
- [Tyro — iClient implementation guide](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide)
- [Venable — money transmission in the payment facilitator model](https://www.venable.com/insights/publications/2018/06/money-transmission-in-the-payment-facilitator-mode)
