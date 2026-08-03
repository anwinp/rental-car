/**
 * The curated font library — server counterpart in
 * app/domains/theme/fonts.py (FONTS dict; the keys there are these same
 * families, and `css_var` there must match the variable name given to each
 * font below exactly, since the server emits `var(--font-x)` into the
 * generated theme CSS and this is what makes that variable exist).
 *
 * All ten load via `next/font/google`, which fetches the files once at BUILD
 * TIME and serves them from this app's own origin — no runtime request to
 * Google on any page, including the one collecting a card number. Confirmed
 * by running a real `next build`: a family name `next/font` cannot resolve
 * fails the whole build, not just one tenant's page, so this list is not a
 * guess — it is the list that built successfully.
 *
 * Every family is imported regardless of which tenants use it. That is cheap:
 * this only ships @font-face declarations, and a browser fetches the actual
 * font file for a family only once something on the page is set to use it.
 * Ten declarations, one or two font files downloaded per visit.
 */
import {
  Figtree, Source_Sans_3, IBM_Plex_Sans, Manrope, Plus_Jakarta_Sans,
  Space_Grotesk, Archivo, Fraunces, Source_Serif_4, Literata,
} from 'next/font/google'

export const figtree = Figtree({
  subsets: ['latin'], variable: '--font-figtree', display: 'swap',
})
export const sourceSans3 = Source_Sans_3({
  subsets: ['latin'], variable: '--font-source-sans-3', display: 'swap',
})
export const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'], weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans', display: 'swap',
})
export const manrope = Manrope({
  subsets: ['latin'], variable: '--font-manrope', display: 'swap',
})
export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'], variable: '--font-plus-jakarta-sans', display: 'swap',
})
export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap',
})
export const archivo = Archivo({
  subsets: ['latin'], variable: '--font-archivo', display: 'swap',
})
export const fraunces = Fraunces({
  subsets: ['latin'], variable: '--font-fraunces', display: 'swap',
})
export const sourceSerif4 = Source_Serif_4({
  subsets: ['latin'], variable: '--font-source-serif-4', display: 'swap',
})
export const literata = Literata({
  subsets: ['latin'], variable: '--font-literata', display: 'swap',
})

/** Applied once on <html> in layout.tsx — declares every variable, fetches none. */
export const allFontVariables = [
  figtree.variable, sourceSans3.variable, ibmPlexSans.variable,
  manrope.variable, plusJakartaSans.variable, spaceGrotesk.variable,
  archivo.variable, fraunces.variable, sourceSerif4.variable, literata.variable,
].join(' ')
