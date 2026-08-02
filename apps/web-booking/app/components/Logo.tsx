'use client'

/**
 * The RCM mark.
 *
 * A racing crest — the shield silhouette automotive badges have used for a
 * century — carrying three receding bars that read as a road running to the
 * horizon. Drawn on a strict grid with sharp corners, matching the rest of the
 * system: no rounded geometry anywhere except badge pills.
 *
 * Deliberately not a figurative animal or any other borrowed heraldry. The
 * design language here is Ferrari's, and the mark must not be.
 *
 * Two colourways only. `onDark` paints the crest in Rosso Corsa with white
 * bars, for the near-black canvas. `mono` paints the whole mark in a single
 * currentColor, for light editorial bands and anywhere the accent would be an
 * eighth use of a colour the system asks to keep scarce.
 */

export function LogoMark({
  size = 28,
  variant = 'onDark',
}: {
  size?: number
  variant?: 'onDark' | 'mono'
}) {
  const crest = variant === 'onDark' ? '#da291c' : 'currentColor'
  const bars = variant === 'onDark' ? '#ffffff' : 'currentColor'
  const barOpacity = variant === 'onDark' ? [1, 0.82, 0.55] : [1, 0.55, 0.3]

  return (
    <svg
      width={size}
      height={(size * 34) / 28}
      viewBox="0 0 28 34"
      fill="none"
      role="img"
      aria-label="Rental Car Manager"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Crest: square shoulders, pointed base. Sharp throughout. */}
      <path d="M0 0h28v21.5L14 34 0 21.5V0Z" fill={crest} />
      {/* Three bars receding to the point — a road, not a letterform, so the
          mark stays legible at 20px in a 64px nav bar. */}
      <rect x="6" y="8" width="16" height="2.6" fill={bars} opacity={barOpacity[0]} />
      <rect x="8" y="13.4" width="12" height="2.6" fill={bars} opacity={barOpacity[1]} />
      <rect x="10" y="18.8" width="8" height="2.6" fill={bars} opacity={barOpacity[2]} />
    </svg>
  )
}

/**
 * Mark plus wordmark. `full` adds the descriptor beneath, for the footer where
 * there is room to say the product's whole name once.
 */
export function Logo({
  size = 28,
  variant = 'onDark',
  lockup = 'compact',
}: {
  size?: number
  variant?: 'onDark' | 'mono'
  lockup?: 'compact' | 'full'
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
      <LogoMark size={size} variant={variant} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: '0.02em',
            lineHeight: 1,
          }}
        >
          RCM
        </span>
        {lockup === 'full' && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '1.1px',
              textTransform: 'uppercase',
              lineHeight: 1.4,
              opacity: 0.62,
            }}
          >
            Rental Car Manager
          </span>
        )}
      </span>
    </span>
  )
}
