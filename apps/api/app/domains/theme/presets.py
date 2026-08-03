"""The six preset templates, and how a supplied brand colour reshapes one.

THEMING_STRATEGY.md §5 proposed six templates in light and dark. Building this,
one thing did not survive contact with the actual storefront: every component in
`apps/web-booking` was written against `apps/web-booking/app/globals.css`'s
single hardcoded dark palette (`color-scheme: dark`, fixed near-black surfaces,
white text) — there is no light-mode variant of a button, a card, or the hero
anywhere in that app, verified by reading it rather than assumed. Shipping a
"light" preset against components that assume a dark background is exactly the
failure this design exists to prevent: a themed storefront that looks broken.

So all six ship as dark palettes, distinguished by hue, shape and type rather
than by light/dark. A true light mode is future work gated on a pass over the
storefront's components, not a token change, and is not silently dropped —
it is out of this pass because it was not verified to render correctly, not
because it was forgotten.

The other four decisions from the strategy hold as designed:
  * preset-first — a tenant chooses a complete look, not forty controls.
  * a brand colour re-derives the template's accent (this file), not one
    isolated button.
  * fonts come only from `theme.fonts.FONTS`.
  * every value that reaches CSS passes through a parser here first — a hex
    regex, an enum, a clamped int. Nothing tenant-supplied is ever concatenated
    into a stylesheet. See `render_css` at the bottom.
"""
from __future__ import annotations

import colorsys
import re
from dataclasses import dataclass, replace

from app.domains.theme.fonts import FONTS

_HEX_RE = re.compile(r"^#([0-9a-fA-F]{6})$")


# ── colour math ──────────────────────────────────────────────────────────────

def _hex_to_rgb(hex_colour: str) -> tuple[int, int, int]:
    h = hex_colour.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


def _shift_lightness(hex_colour: str, delta: float) -> str:
    """Same hue and saturation, lightness moved by `delta` (-1..1)."""
    r, g, b = _hex_to_rgb(hex_colour)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    l = max(0.0, min(1.0, l + delta))
    r2, g2, b2 = colorsys.hls_to_rgb(h, l, s)
    return _rgb_to_hex(round(r2 * 255), round(g2 * 255), round(b2 * 255))


def _relative_luminance(hex_colour: str) -> float:
    """WCAG relative luminance, 0 (black) to 1 (white)."""
    def lin(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = _hex_to_rgb(hex_colour)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def _readable_foreground(hex_colour: str) -> str:
    """Black or white text on `hex_colour`, whichever has more contrast.

    A real WCAG contrast check, not a guess — a pale brand yellow needs black
    text, a deep brand navy needs white, and getting this wrong is a button a
    renter cannot read the label on.
    """
    l = _relative_luminance(hex_colour)
    contrast_white = (1.0 + 0.05) / (l + 0.05)
    contrast_black = (l + 0.05) / (0.0 + 0.05)
    return "#ffffff" if contrast_white >= contrast_black else "#0a0a0a"


def is_hex_colour(value: str) -> bool:
    return bool(_HEX_RE.match(value or ""))


# The widest a background/surface/navbar/footer colour may go and still hold
# WCAG AA (4.5:1) against the white body text this codebase has hardcoded
# across roughly thirty components that do not yet read from the token system
# — verified, not assumed: relative luminance L solves (1.05)/(L+0.05) >= 4.5,
# i.e. L <= 0.183. This is what makes it safe to let a tenant pick their own
# canvas colour without first rewriting every page that assumes a dark one:
# the clamp keeps every one of those un-converted pages legible regardless of
# what colour comes out of this function.
_MAX_CANVAS_LUMINANCE = 0.18


def clamp_to_dark(hex_colour: str) -> tuple[str, bool]:
    """A colour, darkened if needed to stay under the legibility ceiling.

    Returns (colour, was_adjusted). Real colourful darks pass through
    untouched — a deep navy, forest green or maroon all measure well under the
    ceiling. Only something that would actually break white text on it gets
    pulled down, and the caller is told so rather than the adjustment
    happening silently.
    """
    if _relative_luminance(hex_colour) <= _MAX_CANVAS_LUMINANCE:
        return hex_colour, False
    lo, hi = -0.95, 0.0
    darkened = hex_colour
    for _ in range(24):  # binary search on the lightness delta; converges fast
        mid = (lo + hi) / 2
        candidate = _shift_lightness(hex_colour, mid)
        if _relative_luminance(candidate) <= _MAX_CANVAS_LUMINANCE:
            darkened = candidate
            lo = mid
        else:
            hi = mid
    return darkened, True


def derive_surface_scale(bg_hex: str) -> tuple[str, str, str]:
    """(surface, surface_2, surface_3) — a graduated elevation scale from a
    single background colour, the same relationship every hand-authored
    template already uses (each step a little lighter than the last)."""
    return (
        _shift_lightness(bg_hex, 0.03),
        _shift_lightness(bg_hex, 0.06),
        _shift_lightness(bg_hex, 0.09),
    )


def derive_brand_shades(brand_hex: str) -> "BrandShades":
    """The three shades every template's accent needs, from one hex.

    This is the "make it theirs" lever: a tenant supplies one colour and the
    template stays coherent around it, rather than one button matching and
    six other surfaces disagreeing with it.
    """
    return BrandShades(
        brand=brand_hex,
        brand_dark=_shift_lightness(brand_hex, -0.14),
        brand_mid=_shift_lightness(brand_hex, +0.10),
        cta_fg=_readable_foreground(brand_hex),
    )


@dataclass(frozen=True)
class BrandShades:
    brand: str
    brand_dark: str
    brand_mid: str
    cta_fg: str


# ── templates ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Tokens:
    bg: str
    surface: str
    surface_2: str
    surface_3: str
    text_1: str
    border_rgb: str  # "r,g,b" — alpha is applied at CSS-emit time
    shades: BrandShades
    radius_px: int
    button_style: str  # "solid" | "pill" | "square"
    heading_font: str  # theme.fonts key
    body_font: str
    # None means "use bg" — every template ships with the header and footer
    # blending into the page, which is what every tenant sees until they
    # deliberately give one its own colour.
    navbar_hex: str | None = None
    footer_hex: str | None = None


@dataclass(frozen=True)
class Template:
    key: str
    label: str
    blurb: str
    for_: str
    tokens: Tokens


TEMPLATES: dict[str, Template] = {
    "meridian": Template(
        "meridian", "Meridian", "A clean, confident default.", "Any workspace",
        Tokens(
            bg="#141414", surface="#1c1c1c", surface_2="#232323", surface_3="#2a2a2a",
            text_1="#ffffff", border_rgb="255,255,255",
            shades=derive_brand_shades("#3b82f6"),
            radius_px=8, button_style="solid",
            heading_font="figtree", body_font="source_sans_3",
        ),
    ),
    "terminal": Template(
        "terminal", "Terminal", "Dense and trustworthy — airport and national chains.",
        "Airport & national chains",
        Tokens(
            bg="#0b1b2e", surface="#122238", surface_2="#182b42", surface_3="#1e344c",
            text_1="#f4f8fc", border_rgb="180,200,220",
            shades=derive_brand_shades("#f5a524"),
            radius_px=4, button_style="square",
            heading_font="ibm_plex_sans", body_font="ibm_plex_sans",
        ),
    ),
    "coastal": Template(
        "coastal", "Coastal", "Warm and human — independent operators.",
        "Local independents",
        Tokens(
            bg="#211c17", surface="#2a231c", surface_2="#332b22", surface_3="#3c3328",
            text_1="#fbf5ec", border_rgb="230,210,180",
            shades=derive_brand_shades("#4fa3c7"),
            radius_px=14, button_style="pill",
            heading_font="manrope", body_font="manrope",
        ),
    ),
    "marque": Template(
        "marque", "Marque", "Quiet and precise — luxury and exotic hire.",
        "Luxury & exotic hire",
        Tokens(
            bg="#0c0c0d", surface="#141415", surface_2="#1a1a1c", surface_3="#212123",
            text_1="#f5f2ea", border_rgb="201,169,97",
            shades=derive_brand_shades("#c9a961"),
            radius_px=2, button_style="square",
            heading_font="fraunces", body_font="source_sans_3",
        ),
    ),
    "voltage": Template(
        "voltage", "Voltage", "Sharp and current — EV and eco fleets.",
        "EV & eco fleets",
        Tokens(
            bg="#111517", surface="#171c1f", surface_2="#1d2327", surface_3="#232a2f",
            text_1="#f2f7f4", border_rgb="198,241,53",
            shades=derive_brand_shades("#c6f135"),
            radius_px=999, button_style="pill",
            heading_font="plus_jakarta_sans", body_font="plus_jakarta_sans",
        ),
    ),
    "rally": Template(
        "rally", "Rally", "Loud on purpose — budget and high-volume.",
        "Budget & high-volume",
        Tokens(
            bg="#121212", surface="#1a1a1a", surface_2="#202020", surface_3="#272727",
            text_1="#ffffff", border_rgb="255,255,255",
            shades=derive_brand_shades("#ff5a1f"),
            radius_px=0, button_style="square",
            heading_font="archivo", body_font="source_sans_3",
        ),
    ),
}

_BUTTON_STYLES = {"solid", "pill", "square"}


def get(key: str) -> Template | None:
    return TEMPLATES.get(key)


def describe() -> list[dict]:
    """The gallery listing — enough to render cards, no CSS in it."""
    out = []
    for t in TEMPLATES.values():
        tok = t.tokens
        out.append({
            "key": t.key, "label": t.label, "blurb": t.blurb, "for": t.for_,
            "preview": {
                "bg": tok.bg, "surface": tok.surface, "text": tok.text_1,
                "brand": tok.shades.brand, "radius_px": tok.radius_px,
            },
            "heading_font": tok.heading_font, "body_font": tok.body_font,
        })
    return out


# ── rendering: the only place a value reaches CSS ───────────────────────────

@dataclass(frozen=True)
class RenderResult:
    css: str
    # Which override(s) got darkened to stay legible, if any — so the UI can
    # tell the tenant "we darkened that a touch to keep your text readable"
    # instead of the colour silently coming out different from what they typed.
    adjusted: tuple[str, ...] = ()


def render_theme(
    preset_key: str,
    *,
    brand_hex: str | None = None,
    background_hex: str | None = None,
    surface_hex: str | None = None,
    navbar_hex: str | None = None,
    footer_hex: str | None = None,
    heading_font: str | None = None,
    body_font: str | None = None,
    radius_px: int | None = None,
    button_style: str | None = None,
) -> RenderResult:
    """The `<style>` body for this tenant's published theme, and what changed.

    Every override is validated before use and silently ignored if it fails —
    an invalid value falls back to the template's own, never to something
    unparsed reaching the page. That is what makes this safe against a
    corrupted settings row as well as a malicious one: there is no code path
    from a stored string to a CSS token that does not go through one of the
    checks below.

    Background-family colours (background, surface, navbar, footer) additionally
    pass through `clamp_to_dark` — real freedom to pick a colour, but not one
    that would make the white text on ~30 pages that do not yet read from this
    token system unreadable. See the constant's docstring for the exact bound.
    """
    tmpl = TEMPLATES.get(preset_key) or TEMPLATES["meridian"]
    tok = tmpl.tokens
    adjusted: list[str] = []

    def _dark_override(value: str | None, label: str) -> str | None:
        if not value or not is_hex_colour(value):
            return None
        clamped, was_adjusted = clamp_to_dark(value)
        if was_adjusted:
            adjusted.append(label)
        return clamped

    shades = tok.shades
    if brand_hex and is_hex_colour(brand_hex):
        shades = derive_brand_shades(brand_hex)

    bg = _dark_override(background_hex, "background") or tok.bg
    # Surface follows background unless independently overridden — so setting
    # only the page background still produces a coherent, graduated set of
    # card/panel tones rather than leaving them at the old template's values.
    if surface_hex:
        surface_base = _dark_override(surface_hex, "surface") or tok.surface
        surface, surface_2, surface_3 = derive_surface_scale(surface_base)
    elif background_hex:
        surface, surface_2, surface_3 = derive_surface_scale(bg)
    else:
        surface, surface_2, surface_3 = tok.surface, tok.surface_2, tok.surface_3

    navbar_bg = _dark_override(navbar_hex, "navbar") or tok.navbar_hex or bg
    footer_bg = _dark_override(footer_hex, "footer") or tok.footer_hex or bg
    # Foreground text is computed from whatever background came out above —
    # never assumed white. A navbar colour clamped down from something pale can
    # still land closer to mid-tone than the page's own dark surfaces, and
    # _readable_foreground is the same WCAG check used for the CTA button text,
    # just pointed at the navbar/footer background instead of the brand colour.
    navbar_fg = _readable_foreground(navbar_bg)
    footer_fg = _readable_foreground(footer_bg)
    nav_r, nav_g, nav_b = _hex_to_rgb(navbar_fg)
    foot_r, foot_g, foot_b = _hex_to_rgb(footer_fg)

    heading = FONTS.get(heading_font or "")
    heading_var = heading.css_var if heading and heading.role in ("heading", "either") \
        else FONTS[tok.heading_font].css_var

    body = FONTS.get(body_font or "")
    body_var = body.css_var if body and body.role in ("body", "either") \
        else FONTS[tok.body_font].css_var

    radius = tok.radius_px
    if radius_px is not None:
        try:
            radius = max(0, min(999, int(radius_px)))
        except (TypeError, ValueError):
            pass

    button = button_style if button_style in _BUTTON_STYLES else tok.button_style
    radius_css = "999px" if button == "pill" else f"{radius}px"

    # Body text stays the template's own colour rather than being recomputed
    # per background: every current template's text_1 is white or near-white,
    # which the luminance clamp above exists specifically to keep legible
    # against whatever background comes out of it.
    b_r, b_g, b_bl = tok.border_rgb.split(",")

    lines = [
        "/* generated from tenant_theme — see app/domains/theme/presets.py */",
        ":root {",
        f"  --p-bg: {bg};",
        f"  --p-surface: {surface};",
        f"  --p-surface-2: {surface_2};",
        f"  --p-surface-3: {surface_3};",
        f"  --p-surface-dark: {bg};",
        f"  --p-navbar-bg: {navbar_bg};",
        f"  --p-navbar-fg: {navbar_fg};",
        f"  --p-navbar-fg-dim: rgba({nav_r},{nav_g},{nav_b},0.62);",
        f"  --p-navbar-border: rgba({nav_r},{nav_g},{nav_b},0.12);",
        f"  --p-footer-bg: {footer_bg};",
        f"  --p-footer-fg: {footer_fg};",
        f"  --p-footer-fg-dim: rgba({foot_r},{foot_g},{foot_b},0.55);",
        f"  --p-footer-border: rgba({foot_r},{foot_g},{foot_b},0.10);",
        f"  --p-text-1: {tok.text_1};",
        f"  --p-text-2: rgba({b_r},{b_g},{b_bl},0.72);",
        f"  --p-text-3: rgba({b_r},{b_g},{b_bl},0.52);",
        f"  --p-text-4: rgba({b_r},{b_g},{b_bl},0.32);",
        f"  --p-border: rgba({b_r},{b_g},{b_bl},0.14);",
        f"  --p-border-mid: rgba({b_r},{b_g},{b_bl},0.22);",
        f"  --p-border-light: rgba({b_r},{b_g},{b_bl},0.07);",
        f"  --p-brand: {shades.brand};",
        f"  --p-brand-dark: {shades.brand_dark};",
        f"  --p-brand-mid: {shades.brand_mid};",
        f"  --p-brand-50: {_alpha(shades.brand, 0.10)};",
        f"  --p-brand-100: {_alpha(shades.brand, 0.20)};",
        f"  --p-cta: {shades.brand};",
        f"  --p-cta-dark: {shades.brand_dark};",
        f"  --p-cta-fg: {shades.cta_fg};",
        f"  --p-cta-glow: 0 0 28px {_alpha(shades.brand, 0.45)};",
        f"  --p-shadow-brand: 0 0 36px {_alpha(shades.brand, 0.35)};",
        f"  --p-grad: linear-gradient(135deg, {shades.brand} 0%, {shades.brand_dark} 100%);",
        f"  --p-grad-text: linear-gradient(135deg, {shades.brand} 0%, {shades.brand_mid} 100%);",
        "",
        f"  --background: {_hex_to_hsl_triple(bg)};",
        f"  --foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --card: {_hex_to_hsl_triple(surface)};",
        f"  --card-foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --popover: {_hex_to_hsl_triple(surface)};",
        f"  --popover-foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --primary: {_hex_to_hsl_triple(shades.brand)};",
        f"  --primary-foreground: {_hex_to_hsl_triple(shades.cta_fg)};",
        f"  --secondary: {_hex_to_hsl_triple(surface_2)};",
        f"  --secondary-foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --muted: {_hex_to_hsl_triple(surface_2)};",
        f"  --accent: {_hex_to_hsl_triple(surface_3)};",
        f"  --border: {_hex_to_hsl_triple(surface_3)};",
        f"  --input: {_hex_to_hsl_triple(surface_2)};",
        f"  --ring: {_hex_to_hsl_triple(shades.brand)};",
        f"  --radius: {radius_css if button != 'pill' else '999px'};",
        "",
        f"  --tenant-font-heading: var({heading_var});",
        f"  --tenant-font-body: var({body_var});",
        f"  --tenant-radius: {radius_css};",
        f"  --tenant-button-style: {button};",
        "}",
    ]
    return RenderResult(css="\n".join(lines), adjusted=tuple(adjusted))


def render_css(preset_key: str, **kwargs: object) -> str:
    """Back-compat shim — CSS text only, no adjustment reporting.

    Kept because tests and one call site (public_router, which has nowhere to
    surface an "adjusted" notice to an anonymous visitor) only need the text.
    """
    return render_theme(preset_key, **kwargs).css  # type: ignore[arg-type]


def _alpha(hex_colour: str, a: float) -> str:
    r, g, b = _hex_to_rgb(hex_colour)
    return f"rgba({r},{g},{b},{a})"


def _hex_to_hsl_triple(hex_colour: str) -> str:
    """`H S% L%` — the bare triple `hsl(var(--x))` in the Tailwind preset expects."""
    r, g, b = _hex_to_rgb(hex_colour)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return f"{round(h * 360)} {round(s * 100)}% {round(l * 100)}%"
