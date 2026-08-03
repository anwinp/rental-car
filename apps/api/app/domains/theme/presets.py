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

def render_css(
    preset_key: str,
    *,
    brand_hex: str | None = None,
    heading_font: str | None = None,
    body_font: str | None = None,
    radius_px: int | None = None,
    button_style: str | None = None,
) -> str:
    """The `<style>` body for this tenant's published theme.

    Every override is validated before use and silently ignored if it fails —
    an invalid value falls back to the template's own, never to something
    unparsed reaching the page. That is what makes this safe against a
    corrupted settings row as well as a malicious one: there is no code path
    from a stored string to a CSS token that does not go through one of the
    checks below.
    """
    tmpl = TEMPLATES.get(preset_key) or TEMPLATES["meridian"]
    tok = tmpl.tokens

    shades = tok.shades
    if brand_hex and is_hex_colour(brand_hex):
        shades = derive_brand_shades(brand_hex)

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

    b_r, b_g, b_bl = tok.border_rgb.split(",")

    lines = [
        "/* generated from tenant_theme — see app/domains/theme/presets.py */",
        ":root {",
        f"  --p-bg: {tok.bg};",
        f"  --p-surface: {tok.surface};",
        f"  --p-surface-2: {tok.surface_2};",
        f"  --p-surface-3: {tok.surface_3};",
        f"  --p-surface-dark: {tok.bg};",
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
        f"  --background: {_hex_to_hsl_triple(tok.bg)};",
        f"  --foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --card: {_hex_to_hsl_triple(tok.surface)};",
        f"  --card-foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --popover: {_hex_to_hsl_triple(tok.surface)};",
        f"  --popover-foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --primary: {_hex_to_hsl_triple(shades.brand)};",
        f"  --primary-foreground: {_hex_to_hsl_triple(shades.cta_fg)};",
        f"  --secondary: {_hex_to_hsl_triple(tok.surface_2)};",
        f"  --secondary-foreground: {_hex_to_hsl_triple(tok.text_1)};",
        f"  --muted: {_hex_to_hsl_triple(tok.surface_2)};",
        f"  --accent: {_hex_to_hsl_triple(tok.surface_3)};",
        f"  --border: {_hex_to_hsl_triple(tok.surface_3)};",
        f"  --input: {_hex_to_hsl_triple(tok.surface_2)};",
        f"  --ring: {_hex_to_hsl_triple(shades.brand)};",
        f"  --radius: {radius_css if button != 'pill' else '999px'};",
        "",
        f"  --tenant-font-heading: var({heading_var});",
        f"  --tenant-font-body: var({body_var});",
        f"  --tenant-radius: {radius_css};",
        f"  --tenant-button-style: {button};",
        "}",
    ]
    return "\n".join(lines)


def _alpha(hex_colour: str, a: float) -> str:
    r, g, b = _hex_to_rgb(hex_colour)
    return f"rgba({r},{g},{b},{a})"


def _hex_to_hsl_triple(hex_colour: str) -> str:
    """`H S% L%` — the bare triple `hsl(var(--x))` in the Tailwind preset expects."""
    r, g, b = _hex_to_rgb(hex_colour)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return f"{round(h * 360)} {round(s * 100)}% {round(l * 100)}%"
