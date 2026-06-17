import Link from 'next/link'

export default function CancellationPolicyPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#181818', padding: '80px 24px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: '#da291c', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 12 }}>
            Policies
          </p>
          <h1 style={{ fontSize: 42, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', margin: 0 }}>
            Cancellation Policy
          </h1>
        </div>

        {/* Summary intro */}
        <p style={{ fontSize: 15, fontWeight: 400, color: '#969696', lineHeight: 1.7, marginBottom: 48, maxWidth: 640 }}>
          We understand plans change. The following policy applies to standard-rate reservations.
          Prepaid promotional rates are subject to separate terms detailed below.
        </p>

        {/* Cancellation table */}
        <section style={{ marginBottom: 48 }}>
          <div style={{
            background: '#303030',
            border: '1px solid #303030',
            borderRadius: 0,
            overflow: 'hidden',
          }}>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              padding: '14px 24px',
              background: 'rgba(255,255,255,0.04)',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Timing
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Cancellation Fee
              </span>
            </div>

            {/* Row 1 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              padding: '20px 24px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span style={{ fontSize: 14, fontWeight: 400, color: '#ffffff', lineHeight: 1.5 }}>
                More than 24 hours before pickup
              </span>
              <span style={{ fontSize: 14, fontWeight: 400, color: '#03904a', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Free
              </span>
            </div>

            {/* Row 2 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              padding: '20px 24px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
            }}>
              <span style={{ fontSize: 14, fontWeight: 400, color: '#ffffff', lineHeight: 1.5 }}>
                2–24 hours before pickup
              </span>
              <span style={{ fontSize: 14, fontWeight: 400, color: '#ffffff' }}>
                1 night charge
              </span>
            </div>

            {/* Row 3 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              padding: '20px 24px',
            }}>
              <span style={{ fontSize: 14, fontWeight: 400, color: '#ffffff', lineHeight: 1.5 }}>
                Less than 2 hours before pickup / No-show
              </span>
              <span style={{ fontSize: 14, fontWeight: 400, color: '#969696' }}>
                Full rental charge
              </span>
            </div>
          </div>
        </section>

        {/* Prepaid note */}
        <section style={{ marginBottom: 48 }}>
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid #303030',
            borderRadius: 0,
            padding: '20px 24px',
          }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#969696', marginBottom: 8 }}>
              Prepaid Rate Terms
            </p>
            <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.65, margin: 0 }}>
              Prepaid promotional rates are non-refundable in most cases. If you booked at a prepaid
              rate, please review the specific terms shown at the time of booking. In exceptional
              circumstances, a credit may be issued at management discretion — contact our support
              team at least 48 hours before your pickup time.
            </p>
          </div>
        </section>

        {/* CTA links */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href="/support"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 24px', height: 48, borderRadius: 0,
              background: 'transparent', color: '#ffffff',
              border: '1px solid #ffffff',
              fontWeight: 700, textDecoration: 'none', fontSize: 14,
              letterSpacing: '1.4px', textTransform: 'uppercase',
            }}
          >
            Contact Support
          </Link>
          <Link
            href="/policies/rental-terms"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 24px', height: 48, borderRadius: 0,
              background: '#da291c',
              border: 'none',
              color: '#ffffff',
              fontWeight: 700, textDecoration: 'none', fontSize: 14,
              letterSpacing: '1.4px', textTransform: 'uppercase',
            }}
          >
            View Rental Terms
          </Link>
        </div>

      </div>
    </div>
  )
}
