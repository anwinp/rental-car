'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const NAV_LINKS = [
  { label: 'Reserve',    href: '/search' },
  { label: 'Experience', href: '/#models' },
  { label: 'Locations',  href: '/#locations' },
  { label: 'Concierge',  href: '/#about' },
]

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: 64, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 48px',
      background: scrolled ? '#181818' : 'transparent',
      borderBottom: scrolled ? '1px solid #303030' : '1px solid transparent',
      transition: 'background 0.3s ease, border-color 0.3s ease',
    }}>
      {/* Logo */}
      <Link href="/" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#ffffff', textDecoration: 'none' }}>
        RCM
      </Link>

      {/* Desktop nav */}
      <nav className="hidden md:flex" style={{ gap: 32 }} aria-label="Main navigation">
        {NAV_LINKS.map(link => (
          <Link key={link.label} href={link.href}
            style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: '#ffffff', textDecoration: 'none', transition: 'opacity 0.15s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.6'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Mobile hamburger */}
      <button type="button" className="md:hidden"
        style={{ padding: 8, border: 'none', cursor: 'pointer', background: 'transparent', color: '#ffffff' }}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(v => !v)}
      >
        {mobileOpen
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        }
      </button>

      {/* Mobile menu */}
      {mobileOpen && (
        <div style={{ position: 'absolute', top: 64, left: 0, width: '100%', background: '#181818', borderBottom: '1px solid #303030', padding: '24px 48px' }}>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {NAV_LINKS.map(link => (
              <Link key={link.label} href={link.href} onClick={() => setMobileOpen(false)}
                style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: '#ffffff', textDecoration: 'none' }}
              >{link.label}</Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}
