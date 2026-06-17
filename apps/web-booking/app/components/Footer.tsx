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
      <h4 style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#969696', marginBottom: 16 }}>
        {heading}
      </h4>
      {links.map(link => (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Link key={link.label} href={link.href as any}
          style={{ fontSize: 13, color: '#969696', textDecoration: 'none', display: 'block', marginBottom: 8, transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#ffffff'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#969696'}
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}

export function Footer() {
  return (
    <footer style={{ background: '#181818', borderTop: '1px solid #303030', padding: '64px 48px', marginTop: 128 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 48 }} className="footer-inner">
        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }} className="footer-row">
          <div style={{ maxWidth: 320 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#ffffff', marginBottom: 16 }}>
              RCM Rentals
            </h3>
            <p style={{ fontSize: 14, color: '#969696', lineHeight: 1.5 }}>
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
        <div style={{ borderTop: '1px solid #303030', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <p style={{ fontSize: 13, color: '#969696' }}>
            &copy; {new Date().getFullYear()} RCM Rentals. All rights reserved.
          </p>
          <p style={{ fontSize: 13, color: '#969696' }}>
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
