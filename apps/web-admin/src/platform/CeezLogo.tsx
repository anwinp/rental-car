import icon from '../assets/ceeicon.png'

/**
 * The CEEZ AI lockup, as it appears on ceez.ai.
 *
 * The console is the operator's view of the whole business, so it wears the
 * company's mark rather than the product crest used on the tenant-facing
 * landing page — that one belongs to the rental product a customer buys.
 *
 * The source mark is a flat light-grey silhouette on transparency. It is set
 * on its own dark tile here for the same reason ceez.ai does: the shape has no
 * contrast of its own and would disappear onto any surface lighter than the
 * canvas. The tile keeps the mark legible wherever the lockup is placed.
 *
 * The `product` chip mirrors the "Workforce" badge on ceez.ai — same position,
 * same treatment — naming which control plane this is. Without it the console
 * and the marketing site are indistinguishable at a glance, which matters when
 * one of them can delete a customer.
 */

export function CeezLogo({
  size = 26,
  product = 'Rentals',
  showProduct = true,
}: {
  size?: number
  product?: string
  showProduct?: boolean
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: 6,
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <img
          src={icon}
          alt=""
          aria-hidden="true"
          width={Math.round(size * 0.66)}
          height={Math.round(size * 0.66)}
          style={{ display: 'block', objectFit: 'contain' }}
        />
      </span>

      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--text-1)',
          whiteSpace: 'nowrap',
        }}
      >
        CEEZ AI
      </span>

      {showProduct && (
        <span
          style={{
            fontSize: 10,
            lineHeight: 1.6,
            letterSpacing: '0.14em',
            padding: '1px 6px',
            borderRadius: 3,
            color: 'var(--accent)',
            background: 'var(--accent-sub)',
            border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            whiteSpace: 'nowrap',
          }}
        >
          {product}
        </span>
      )}
    </span>
  )
}
