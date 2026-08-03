# Tenant theming — strategy

How a rental company makes the booking site look like theirs.

Status: design agreed, nothing built.

**Decisions taken** (2026-08-03): tenants choose from preset templates rather
than assembling a look from controls; custom domains are connect-only, we do not
sell them; a curated font library, with genuinely modern options; the payment
step inherits colours, logo and fonts and nothing else.

---

## 1. Where we actually are

`tenants.logo_url` exists. The API selects it, `public_router` returns it in the
tenant config, and both `web-admin/src/tenant.ts` and
`web-booking/app/lib/tenant.ts` declare it in their `TenantConfig` interface.

It is **rendered nowhere and uploadable nowhere.** The only code that reads it
is the corporate invoice PDF. A tenant has no way to put a logo in, and if they
did, no page would show it. Same shape as the other findings in this codebase: a
column written by nothing and read by nothing.

Two things are further along than they look:

**The storefront already has a token system.** `web-booking/app/globals.css`
defines the whole palette as HSL custom properties — `--background`,
`--primary`, `--border`, `--radius` and the rest. Today every workspace gets the
same values. That is exactly the right substrate: theming becomes overriding
tokens, not rewriting components.

**Custom domains are most of the way there.** Tenants resolve by hostname
already, and `platform/tls_router.py` serves the `/tls-allowed` gate that Caddy's
on-demand TLS asks before issuing a certificate. The hard infrastructure exists;
what is missing is domain ownership verification and a table to record it.

---

## 2. What Shopify actually does

Worth being precise, because the instinct is to copy the visible part (themes
you can edit) rather than the part that carries the weight.

**Themes are data at the merchant's level, not code.** `settings_schema.json` is
an array of setting groups, each declaring typed inputs; the theme editor renders
its form from that schema. JSON templates are data files listing which sections
appear on a page and their settings, and merchants add, remove and reorder them
in the editor — up to 25 sections per template, 50 blocks per section. A merchant
customising a store is filling in a generated form, not writing Liquid.

**The setting types are the interesting part.** Beyond primitives, Shopify ships
`color`, `color_background`, `color_scheme`, `color_scheme_group`, `font_picker`,
`image_picker`, `richtext`, `inline_richtext`, `url`, `link_list`, `video`,
`html`, and `liquid`. Two are worth stealing outright:

  * **`color_scheme_group`** — merchants pick from named schemes rather than
    forty loose colour pickers. It is what stops a customised store looking
    broken.
  * **`font_picker`** — populated from *Shopify's own font library*, system fonts
    plus a curated selection of Google Fonts. Not an arbitrary URL. That is a
    deliberate constraint, and a good one.

**Sections need presets** to be addable in the editor, which is how Shopify keeps
"what a merchant can place" a decision the theme author made rather than a free
-for-all.

### What Shopify does *not* let you theme

This is the load-bearing half, and the reason to research them rather than guess.

**Checkout is locked.** Customisation happens only through predefined extension
points, deliberately, to keep checkout PCI compliant. Arbitrary code in the
checkout path is not a taste judgement; it is a compliance boundary.

The reason is concrete. In 2023 Reflectiz found a Magecart attack on Shopify
stores using a compromised favicon and a fake CDN-hosted script to skim card data
at checkout. A skimmer does not need to look like an attack — it needs one script
on the page that types alongside the customer.

And since January 2025, PCI DSS 4.0 changed SAQ A eligibility: you must confirm
the payment page **is not susceptible to script attacks** and that **all elements
delivered to the browser originate from a PCI DSS compliant processor**.
Requirements 6.4.3 and 11.6.1 add script inventory, authorisation and
change-detection on payment pages.

---

## 3. The constraint that shapes everything

We have just built payments. The booking funnel is where a renter's card details
are entered.

> If we let tenants inject CSS, HTML or JavaScript into a page that collects card
> details, we lose SAQ A eligibility — **for every tenant on the platform**.

A per-tenant convenience with a platform-wide consequence. So the storefront
splits in two, exactly as Shopify's does:

| Zone | Pages | What a tenant controls |
|---|---|---|
| **Branded** | landing, search, results, vehicle detail, extras, confirmation, account | colours, logo, fonts, copy, section order, imagery |
| **Locked** | anything rendering payment fields | the same colours, logo and font — nothing else |

The locked zone still looks like the tenant's site: it reads the same tokens, so
it is not a jarring hand-off. What it does not accept is tenant-authored markup,
injected scripts, or custom CSS. Card fields come from the processor's hosted
fields (Stripe Payment Element) in an iframe, so the PAN never touches a page we
render.

**We should not ship a "custom CSS" box.** Shopify has one, and can afford it:
they have the checkout on a separate locked origin, a script-integrity
programme, and a compliance team. Ours would sit on the same origin as the
funnel. The honest version of that feature is "custom CSS, but never on the
payment step", and that is what this design gives without the box.

---

## 4. The model: preset templates over tokens, not a template language

**Reject full Liquid-style theming.** Not because it is bad — because the leverage
is somewhere else:

  * A rental booking site is a funnel, not a content site. Search → results →
    vehicle → extras → details → pay → confirm. Six or seven page types, whose
    *structure* is the product. A merchant reordering the checkout funnel is not
    a feature, it is a bug.
  * A templating language means building, sandboxing, versioning and supporting
    a language, for a demand that is overwhelmingly "our colours, our logo, our
    fonts, our words".
  * Shopify's actual leverage is the **settings schema**, not Liquid. We can take
    that half.

**Adopt, from Shopify:**

  * A typed **theme settings schema** — the same pattern as the payment provider
    registry we just built, where the UI renders from a descriptor rather than a
    hardcoded form. That approach is already proven in this codebase.
  * **Named colour schemes** rather than loose pickers.
  * **Curated, self-hosted fonts.** Not arbitrary URLs — that would be a CSP hole,
    a third-party request on a payment page, and (for Google Fonts served from
    Google) a GDPR problem for European tenants.
  * **Draft and publish.** Shopify's editor works on an unpublished copy. Editing
    the live storefront in place, in front of customers, is not acceptable.

**Do not adopt (yet):** merchant-authored templates, a theme marketplace,
arbitrary script injection, or per-page layout editing outside the landing page.

### Preset-first, per the decision

The tenant picks a template. They do not assemble one.

This is a bigger simplification than it sounds. The usual failure of a themeable
product is a settings page with forty controls, a tenant who is not a designer,
and a storefront that ends up worse than the default — Shopify's
`color_scheme_group` exists precisely because loose colour pickers produce broken
stores. Starting from a complete, designed look and allowing a narrow set of
overrides inverts that: the floor is "good", not "default".

So the model is:

  1. **Choose a template** from a gallery of complete first-party looks. Every
     token is set. A tenant who stops here has a coherent site.
  2. **Make it theirs** with a deliberately small set of overrides: logo,
     favicon, one brand colour, and the copy.
  3. **Adjust the details** — fonts, radius, header style — for those who want
     to, tucked behind an "advanced" disclosure rather than presented up front.

The brand colour is the important one. It does not replace a token; the preset
declares *how* its scheme derives from a brand hue, and re-derives the scheme
around whatever the tenant supplies. A company can use its actual brand red
without having to reason about what that does to seven other tokens or to text
contrast.

---

## 5. The templates

Six, covering the kinds of company that actually rent cars. They are not six
recolourings of one layout — the shape language differs too, because a budget
operator and an exotic-hire company do not want the same corners.

| Template | For | Ground / accent | Headings / body | Shape |
|---|---|---|---|---|
| **Meridian** | The safe default. Anything, anyone. | Near-white `#FAFAF9`, ink `#1A1A19`, single confident blue | Figtree / Source Sans 3 | 8px, solid buttons |
| **Terminal** | Airport and national chains. Dense, trustworthy. | Deep navy `#0B1B33`, cool white, signal amber | IBM Plex Sans / IBM Plex Sans | 4px, square, tight |
| **Coastal** | Local independents. Warm, human. | Warm off-white `#FBF7F0`, sea blue, sand | Manrope / Manrope | 14px, generous, soft shadow |
| **Marque** | Luxury and exotic hire. | Near-black `#0C0C0D`, champagne `#C9A961` | Fraunces / Inter | 2px, hairline rules, wide letter-spacing on labels |
| **Voltage** | EV and eco fleets. | White, electric lime, graphite | Plus Jakarta Sans / Plus Jakarta Sans | 12px, pill buttons |
| **Rally** | Budget and high-volume. Loud on purpose. | White, safety orange `#FF5A1F`, black | Archivo Expanded / Archivo | 0px, heavy weights, high contrast |

Each template declares the full token set *and* a rule for re-deriving its scheme
from a supplied brand hue, so "Coastal in our green" is a coherent result rather
than one mismatched button.

Every template ships in light and dark. The storefront's tokens are already
HSL-based, which makes deriving a dark variant a lightness transform rather than
a second hand-authored palette.

### The font library

All SIL OFL or Apache 2.0, all variable, all self-hosted and subsetted. The
brief was modern options rather than safe ones, so the list is deliberately not
six grotesques:

| Face | Character | Use |
|---|---|---|
| Figtree | Geometric, friendly, low-key | Body or headings |
| Source Sans 3 | Humanist, invisible in the right way | Long-form body |
| IBM Plex Sans | Structured, technical, excellent language coverage | Information-dense UI |
| Manrope | Geometric-humanist, warm | Body or headings |
| Plus Jakarta Sans | Modern geometric with a little character | Body or headings |
| Space Grotesk | Distinctive, brand-forward | Headings only |
| Archivo / Archivo Expanded | Strong, sporty, wide axis | Headings, loud brands |
| Fraunces | Expressive variable serif, soft-to-sharp axis | Display headings |
| Source Serif 4 | Screen-tuned serif with optical sizes | Editorial body |
| Literata | Long-read serif, weight and optical axes | Editorial body |

Two notes for a global product. **Inter** stays in the library as a body
workhorse for its script coverage, but is not the display face of any template —
it is the most-used interface font on the web and a storefront set in it looks
like every other storefront. And a **Noto fallback chain** is needed for CJK,
Arabic and Indic scripts, which none of the above cover; that is a fallback
concern, not a choice we put in front of a tenant.

## 6. Concrete design

### Settings schema

Groups, each with typed settings, served to the admin UI the way
`/payments/config/providers` already serves the provider registry:

| Group | Settings | Shown |
|---|---|---|
| Template | preset (gallery), light/dark/auto | first |
| Brand | logo, logo dark variant, favicon, brand colour | first |
| Content | hero heading, hero subheading, hero image, promo strip | first |
| Legal | terms URL, privacy URL, support phone and email | first |
| Typography | heading font, body font (curated select), base size | advanced |
| Layout | corner radius, header style, button style | advanced |

The `Shown` column is part of the schema, not a UI decision made later. Preset
-first only works if the advanced controls are genuinely out of the way.

`richtext` is a **sanitised subset** — a whitelist of tags and no attributes
beyond `href` — not a passthrough.

### Storage

`tenant_theme`: `tenant_id`, `preset`, `settings jsonb`, `draft_settings jsonb`,
`published_at`, `updated_by`. Draft and published are separate columns rather
than separate rows so publishing is one atomic write.

### Rendering — where the safety actually lives

The server emits a `<style>` block of CSS custom properties into the storefront
`<head>`, overriding the whitelisted subset of `globals.css` tokens.

The critical rule: **the server generates the CSS from typed values; it never
echoes tenant strings into a stylesheet.** A colour setting is parsed as a hex
triplet and re-emitted as one. A radius is a number, clamped, with the unit added
by us. Anything unparseable falls back to the default. That closes CSS injection
by construction rather than by escaping, which is the same reason the invoice PDF
renderer escapes every interpolation rather than trusting the input.

### Assets

Logo upload through a presigned PUT to MinIO — the mechanism already exists for
damage photos, signatures and invoices. On upload: sniff the actual content type
rather than trusting the extension, cap dimensions and bytes, re-encode to strip
EXIF and any embedded payload, and serve from our own origin so the CSP stays
tight.

**Never accept a remote URL for a logo.** `invoice_pdf._safe_logo` already exists
because a tenant-supplied URL fetched server-side is a request-forgery primitive.
The same reasoning applies here, and storing the asset ourselves avoids it
entirely.

### Custom domains

`tenant_domains`: `hostname`, `tenant_id`, `verification_token`, `verified_at`,
`is_primary`. Ownership proved by a DNS TXT record before anything else happens.

Then extend the existing `/tls-allowed` gate to answer yes for verified custom
domains. **That gate is the security boundary**: if it approves any hostname that
resolves to us, anyone can point a DNS record at the platform and have a
certificate issued for their domain against our infrastructure. It must answer
from `tenant_domains` where `verified_at IS NOT NULL`, and nothing else.

Connect-only to start. Shopify also *sells* domains; that is a registrar
relationship and a different business.

---

## 7. Phasing

| Phase | What | Why there |
|---|---|---|
| 0 | Upload a logo, and render the one we already store | It is stored, typed in both clients, and displayed nowhere. The smallest real win available |
| 1 | Token plumbing: server-generated CSS variables from a published theme, overriding `globals.css` | Nothing else can land until the storefront reads a theme at all |
| 2 | The six templates, the font library, the gallery, draft/publish | The decision: a tenant picks a look and is done |
| 3 | Brand-colour derivation and the advanced controls | Makes a template theirs without letting them break it |
| 4 | Live preview against draft settings | Choosing a look blind is why themed products end up worse than the default |
| 5 | Sections on the landing page only | The one page whose content genuinely varies per tenant |
| 6 | Custom domains with DNS verification, connect-only | Highest perceived value, but worthless before the site looks like theirs |
| 7 | Carry the theme into emails and PDFs | The invoice PDF already reads `logo_url`; unify rather than duplicate |

---

## 8. Still open

Not blocking, but worth settling before Phase 5.

- **Contrast enforcement.** A tenant supplying a pale brand colour can make a
  template unreadable. Recommendation: clamp derived tokens to a minimum
  contrast ratio and tell them we adjusted it, rather than either rejecting the
  colour or shipping unreadable text.
- **Template updates.** If we improve *Coastal*, do live storefronts move? Shopify
  versions themes and asks. Simplest honest answer is that a tenant's published
  theme is a snapshot, and an improved template is offered rather than applied.
- **Landing-page sections** (Phase 5) are the one place this could still grow
  into a template language. Worth re-deciding when we get there rather than
  designing for it now.

---

## Sources

- [Shopify — Online Store 2.0](https://shopify.dev/docs/storefronts/themes/os20/index)
- [Shopify — JSON templates](https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates)
- [Shopify — settings_schema.json](https://shopify.dev/docs/storefronts/themes/architecture/config/settings-schema-json)
- [Shopify — input settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings)
- [Shopify — checkout compliance](https://www.shopify.com/enterprise/blog/shopify-checkout-compliance)
- [Reflectiz — Shopify PCI compliance and the favicon Magecart attack](https://www.reflectiz.com/blog/shopify-pci-compliance/)
- [cside — PCI DSS 6.4.3 and 11.6.1 on Shopify](https://cside.com/blog/does-shopify-make-you-pci-compliant-6-4-3-11-6-1)
