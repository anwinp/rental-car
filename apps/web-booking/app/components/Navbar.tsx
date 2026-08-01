'use client'

import { tenantId } from '../lib/tenant'

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
  const [user, setUser] = useState<{ first_name: string; last_name: string } | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    fetch('/api/v1/auth/me', {
      credentials: 'include',
      headers: { 'X-Tenant-ID': tenantId() },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setUser(d))
      .catch(() => setUser(null))
  }, [])

  async function handleSignOut() {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Tenant-ID': tenantId() },
    }).catch(() => {})
    setUser(null)
    window.location.href = '/'
  }

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: 64, zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 48px',
      background: scrolled ? '#181818' : 'rgba(18,18,18,0.55)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: scrolled ? '1px solid #303030' : '1px solid rgba(255,255,255,0.06)',
      transition: 'background 0.3s ease, border-color 0.3s ease',
    }}>
      {/* Logo */}
      <Link href="/" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#ffffff', textDecoration: 'none' }}>
        RCM
      </Link>

      {/* Desktop nav */}
      <nav className="hidden md:flex" style={{ gap: 32, alignItems: 'center' }} aria-label="Main navigation">
        {NAV_LINKS.map(link => (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <Link key={link.label} href={link.href as any}
            style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: '#ffffff', textDecoration: 'none', transition: 'opacity 0.15s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.6'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
          >
            {link.label}
          </Link>
        ))}

        {/* Auth controls */}
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.12)', paddingLeft: 24 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Link href={'/account' as any} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: '#303030',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600, color: '#fff',
                letterSpacing: '0.02em', userSelect: 'none',
                flexShrink: 0,
              }}>
                {user.first_name.charAt(0).toUpperCase()}{user.last_name.charAt(0).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#ffffff', lineHeight: 1 }}>
                  {user.first_name} {user.last_name}
                </span>
                <button
                  onClick={e => { e.preventDefault(); void handleSignOut() }}
                  style={{ fontSize: 11, fontWeight: 400, letterSpacing: '0.4px', color: 'rgba(255,255,255,0.40)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit', transition: 'color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.75)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.40)'}
                >
                  Sign out
                </button>
              </div>
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.12)', paddingLeft: 24 }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Link href={'/login' as any}
              style={{ fontSize: 13, fontWeight: 500, letterSpacing: '0.5px', color: 'rgba(255,255,255,0.75)', textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#fff'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.75)'}
            >
              Sign In
            </Link>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Link href={'/signup' as any}
              style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '1.4px',
                textTransform: 'uppercase',
                color: '#fff', textDecoration: 'none',
                background: '#da291c',
                padding: '0 20px', height: 36, display: 'inline-flex', alignItems: 'center',
                borderRadius: 0,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.85'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
            >
              Create Account
            </Link>
          </div>
        )}
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <Link key={link.label} href={link.href as any} onClick={() => setMobileOpen(false)}
                style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: '#ffffff', textDecoration: 'none' }}
              >{link.label}</Link>
            ))}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {user ? (
                <>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Link href={'/account' as any} onClick={() => setMobileOpen(false)}
                    style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#303030', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
                      {user.first_name.charAt(0).toUpperCase()}{user.last_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', letterSpacing: '0.4px' }}>{user.first_name} {user.last_name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>My Account</div>
                    </div>
                  </Link>
                  <button onClick={() => { setMobileOpen(false); void handleSignOut() }}
                    style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >Sign Out</button>
                </>
              ) : (
                <>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Link href={'/login' as any} onClick={() => setMobileOpen(false)}
                    style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: '#ffffff', textDecoration: 'none' }}
                  >Sign In</Link>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Link href={'/signup' as any} onClick={() => setMobileOpen(false)}
                    style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: 'var(--p-brand)', textDecoration: 'none' }}
                  >Create Account</Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
