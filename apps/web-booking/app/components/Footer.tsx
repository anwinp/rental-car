'use client'

import Link from 'next/link'

const FLEET_LINKS = [
  { label: 'Stradale V8',  href: '/search' },
  { label: 'GT Berlinetta', href: '/search' },
  { label: 'Pista',        href: '/search' },
  { label: 'Spider',       href: '/search' },
]

const COMPANY_LINKS = [
  { label: 'Concierge', href: '/' },
  { label: 'Careers',   href: '/' },
  { label: 'Contact',   href: '/support' },
]

const LEGAL_LINKS = [
  { label: 'Rental Policy',  href: '/policies/rental-terms' },
  { label: 'Privacy Policy', href: '/support' },
  { label: 'Terms of Use',   href: '/policies/rental-terms' },
]

function FooterColumn({ heading, links }: { heading: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', textTransform: 'uppercase', color: 'var(--p-footer-fg-dim)', marginBottom: 16 }}>
        {heading}
      </h4>
      {links.map(link => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Link key={link.label} href={link.href as any}
          style={{ fontSize: 13, color: 'var(--p-footer-fg-dim)', textDecoration: 'none', display: 'block', marginBottom: 8, transition: 'opacity 0.15s' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.7'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}

// Independent footer tokens, not tied to the page background — a tenant can
// give the footer its own colour (a dark banded strip is a common pattern)
// without that also repainting the hero above it. See presets.py::render_theme
// for how --p-footer-bg/-fg/-fg-dim/-border are computed, including the
// contrast check that picks -fg regardless of what background is chosen.
export function Footer() {
  return (
    <footer style={{ background: 'var(--p-footer-bg)', borderTop: '1px solid var(--p-footer-border)', padding: '64px 48px', marginTop: 128 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 48 }} className="footer-inner">
        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }} className="footer-row">
          <div style={{ maxWidth: 320 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--p-footer-fg)', marginBottom: 16 }}>
              RCM Rentals
            </h3>
            <p style={{ fontSize: 14, color: 'var(--p-footer-fg-dim)', lineHeight: 1.5 }}>
              The world&apos;s most desirable performance vehicles, available on your terms.
            </p>
          </div>

          {/* Link columns */}
          <div style={{ display: 'flex', gap: 64 }} className="footer-cols">
            <FooterColumn heading="Fleet"   links={FLEET_LINKS} />
            <FooterColumn heading="Company" links={COMPANY_LINKS} />
            <FooterColumn heading="Legal"   links={LEGAL_LINKS} />
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ borderTop: '1px solid var(--p-footer-border)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--p-footer-fg-dim)' }}>
            &copy; {new Date().getFullYear()} RCM Rentals. All rights reserved.
          </p>
          <p style={{ fontSize: 13, color: 'var(--p-footer-fg-dim)' }}>
            Luxury. Performance. Delivered.
          </p>
        </div>
      </div>

      <style>{`
        @media (min-width: 1024px) {
          .footer-row {
            flex-direction: row !important;
            justify-content: space-between;
            align-items: flex-start;
          }
        }
      `}</style>
    </footer>
  )
}
