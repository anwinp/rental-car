/**
 * Design tokens for the platform marketing surface.
 *
 * Cinematic-editorial system: near-black canvas, a single scarce accent, one
 * sans family, sharp corners, and an explicit 8px spacing ladder. Held here as
 * named tokens rather than inline hex so the scarcity rules are enforceable by
 * reading one file — the accent in particular is meant to appear on primary
 * CTAs, the mark, and nothing else.
 */

export const color = {
  // Brand — used scarcely. Primary CTAs and the crest only.
  primary: '#da291c',
  primaryActive: '#b01e0a',

  // Surface. The canvas is deliberately not pure black; it carries slight warmth.
  canvas: '#181818',
  canvasElevated: '#303030',
  canvasLight: '#ffffff',
  surfaceSoftLight: '#f7f7f7',
  surfaceStrongLight: '#ebebeb',

  // Hairlines carry the elevation. There are no drop-shadow tiers.
  hairline: '#303030',
  hairlineOnLight: '#d2d2d2',

  // Text
  ink: '#ffffff',
  body: '#969696',
  bodyOnLight: '#181818',
  muted: '#666666',
  onPrimary: '#ffffff',
} as const

/** 4px base. Use these names, never ad-hoc pixel values. */
export const space = {
  xxxs: 4,
  xxs: 8,
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
  xxl: 96,
  super: 128,
} as const

/**
 * Display weight stays at 500 — never bold. The photography does the visual
 * work; the type does not compete with it. Negative tracking on display sizes
 * only; body stays at 0.
 */
export const type = {
  displayMega: {
    fontSize: 80,
    fontWeight: 500,
    lineHeight: 1.05,
    letterSpacing: '-1.6px',
  },
  displayXl: {
    fontSize: 56,
    fontWeight: 500,
    lineHeight: 1.1,
    letterSpacing: '-1.12px',
  },
  displayLg: {
    fontSize: 36,
    fontWeight: 500,
    lineHeight: 1.2,
    letterSpacing: '-0.36px',
  },
  displayMd: {
    fontSize: 26,
    fontWeight: 500,
    lineHeight: 1.5,
    letterSpacing: '0.195px',
  },
  titleSm: { fontSize: 16, fontWeight: 500, lineHeight: 1.4, letterSpacing: '0.08px' },
  bodyMd: { fontSize: 14, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0 },
  bodySm: { fontSize: 13, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0 },
  caption: { fontSize: 12, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
  captionUpper: {
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: '1.1px',
    textTransform: 'uppercase' as const,
  },
  button: {
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '1.4px',
    textTransform: 'uppercase' as const,
  },
  navLink: {
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.4,
    letterSpacing: '0.65px',
    textTransform: 'uppercase' as const,
  },
  numberDisplay: {
    fontSize: 80,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '-1.6px',
  },
} as const

/** Sharp by default. Pill geometry is reserved for badge labels. */
export const rounded = { none: 0, sm: 4, full: 9999 } as const

/** Editorial body caps here; hero photography continues full-bleed past it. */
export const MAX_WIDTH = 1280
