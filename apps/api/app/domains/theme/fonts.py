"""The curated font library.

Ten variable faces, all SIL OFL or Apache 2.0, chosen for range rather than
safety (THEMING_STRATEGY.md §5). Every `css_var` here is loaded at BUILD TIME in
`apps/web-booking/app/fonts.ts` via `next/font/google` — confirmed by an actual
`next build` before this registry was written, because a family name
`next/font` cannot resolve fails the storefront's build, not just this tenant's
page. That build is also why these are genuinely self-hosted rather than a
Google Fonts URL: `next/font/google` fetches the files once at build time and
serves them from our own origin — no runtime request to Google, so no
third-party call on a page a renter is entering payment details near, and no
Google Fonts GDPR question for European tenants.

`inter` is included as a body option, never as a template's default heading
face: it is the most-used interface font on the web, and a storefront set in it
looks like every other storefront. It maps to `--font-sans`, already loaded for
the base UI, so choosing it costs nothing extra.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FontFace:
    key: str
    label: str
    css_var: str
    character: str
    role: str  # "heading" | "body" | "either"


FONTS: dict[str, FontFace] = {
    "inter": FontFace(
        "inter", "Inter", "--font-sans",
        "The default interface face", "body",
    ),
    "figtree": FontFace(
        "figtree", "Figtree", "--font-figtree",
        "Geometric, friendly, low-key", "either",
    ),
    "source_sans_3": FontFace(
        "source_sans_3", "Source Sans 3", "--font-source-sans-3",
        "Humanist, invisible in the right way", "body",
    ),
    "ibm_plex_sans": FontFace(
        "ibm_plex_sans", "IBM Plex Sans", "--font-ibm-plex-sans",
        "Structured, technical, excellent language coverage", "either",
    ),
    "manrope": FontFace(
        "manrope", "Manrope", "--font-manrope",
        "Geometric-humanist, warm", "either",
    ),
    "plus_jakarta_sans": FontFace(
        "plus_jakarta_sans", "Plus Jakarta Sans", "--font-plus-jakarta-sans",
        "Modern geometric with a little character", "either",
    ),
    "space_grotesk": FontFace(
        "space_grotesk", "Space Grotesk", "--font-space-grotesk",
        "Distinctive, brand-forward", "heading",
    ),
    "archivo": FontFace(
        "archivo", "Archivo", "--font-archivo",
        "Strong, sporty, wide axis", "heading",
    ),
    "fraunces": FontFace(
        "fraunces", "Fraunces", "--font-fraunces",
        "Expressive variable serif, soft-to-sharp axis", "heading",
    ),
    "source_serif_4": FontFace(
        "source_serif_4", "Source Serif 4", "--font-source-serif-4",
        "Screen-tuned serif with optical sizes", "body",
    ),
    "literata": FontFace(
        "literata", "Literata", "--font-literata",
        "Long-read serif, weight and optical axes", "body",
    ),
}


def get(key: str) -> FontFace | None:
    return FONTS.get(key)


def for_role(role: str) -> list[FontFace]:
    """Fonts offerable for a given picker — 'heading' also accepts 'either'."""
    return [f for f in FONTS.values() if f.role in (role, "either")]


def describe() -> list[dict]:
    return [
        {"key": f.key, "label": f.label, "character": f.character, "role": f.role}
        for f in FONTS.values()
    ]
