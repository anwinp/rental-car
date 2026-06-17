'use client'

import { useState } from 'react'

const RED = '#da291c'
const RED_ACTIVE = '#b01e0a'

const VEHICLES = [
  { name: 'RCM Stradale V8',    price: 1200, zero60: '2.9s', hp: 710,  img: '/assets/hero_cinema.png',     waitlist: false },
  { name: 'RCM GT Berlinetta',  price: 950,  zero60: '3.2s', hp: 620,  img: '/assets/action_cinema.png',   waitlist: false },
  { name: 'RCM Pista Track-Ed', price: 1800, zero60: '2.7s', hp: 800,  img: '/assets/interior_cinema.png', waitlist: false },
  { name: 'RCM Spider',         price: 1400, zero60: '3.0s', hp: 680,  img: null,                          waitlist: true  },
]

const INPUT_DARK: React.CSSProperties = {
  background: '#181818',
  color: '#ffffff',
  border: '1px solid #303030',
  borderRadius: 4,
  padding: '14px 16px',
  height: 48,
  fontFamily: 'inherit',
  fontSize: 14,
  width: '100%',
  outline: 'none',
  colorScheme: 'dark',
}

const LABEL_UPPER: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '1.1px',
  textTransform: 'uppercase',
  color: '#969696',
  marginBottom: 8,
  display: 'block',
}

function VehicleCard({ name, price, zero60, hp, img, waitlist }: typeof VEHICLES[0]) {
  const [hov, setHov] = useState(false)
  return (
    <div style={{ background: '#ffffff', border: '1px solid #d2d2d2', borderRadius: 0, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        {img
          ? <img src={img} alt={name} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block', marginBottom: 16 }} />
          : (
            <div style={{ width: '100%', aspectRatio: '4/3', background: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#666' }}>Waitlist</span>
            </div>
          )
        }
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#181818', lineHeight: 1.2, marginBottom: 8 }}>{name}</h3>
        <p style={{ fontSize: 18, fontWeight: 700, color: RED, margin: 0 }}>
          ${price.toLocaleString()}
          <span style={{ fontSize: 14, fontWeight: 400, color: '#666666' }}> / DAY</span>
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16, borderTop: '1px solid #d2d2d2', paddingTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#181818', letterSpacing: '-0.5px', lineHeight: 1 }}>{zero60}</span>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#666666', marginTop: 2 }}>0-60 MPH</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#181818', letterSpacing: '-0.5px', lineHeight: 1 }}>{hp}</span>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '1.1px', textTransform: 'uppercase', color: '#666666', marginTop: 2 }}>HORSEPOWER</span>
          </div>
        </div>
      </div>
      <a
        href={waitlist ? '#' : '/search'}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginTop: 24, height: 48,
          border: waitlist ? '1px solid #cccccc' : '1px solid #181818',
          background: waitlist ? 'transparent' : (hov ? '#181818' : 'transparent'),
          color: waitlist ? '#999999' : (hov ? '#ffffff' : '#181818'),
          fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
          textDecoration: 'none', cursor: waitlist ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s, color 0.2s', borderRadius: 0,
        }}
      >
        {waitlist ? 'Unavailable' : 'Reserve'}
      </a>
    </div>
  )
}

export default function HomePage() {
  const [pickup,   setPickup]   = useState('')
  const [dropoff,  setDropoff]  = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')
  const [btnHov,   setBtnHov]   = useState(false)
  const [livHov,   setLivHov]   = useState(false)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const p = new URLSearchParams()
    if (pickup)   p.set('pickup',  pickup)
    if (dropoff)  p.set('dropoff', dropoff)
    if (fromDate) p.set('from',    fromDate)
    if (toDate)   p.set('to',      toDate)
    window.location.href = `/search?${p.toString()}`
  }

  return (
    <>
      {/* ── 1. CINEMA HERO ──────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', width: '100%', height: '100vh', minHeight: 900, background: '#181818', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
        {/* Full-bleed photo */}
        <img
          src="/assets/hero_cinema.png"
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
        />
        {/* Bottom gradient */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '60%', background: 'linear-gradient(180deg, transparent, rgba(24,24,24,0.97))', zIndex: 1 }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 1280, margin: '0 auto', width: '100%', padding: '0 48px 96px' }}>
          <h1 style={{ fontSize: 'clamp(32px, 5.5vw, 80px)', fontWeight: 500, letterSpacing: '-1.6px', lineHeight: 1.05, color: '#ffffff', margin: '0 0 16px' }}>
            Drive The Dream.
          </h1>
          <p style={{ fontSize: 16, fontWeight: 400, color: '#e0e0e0', maxWidth: 600, lineHeight: 1.5, margin: 0 }}>
            Reserve an exclusive vehicle from our elite fleet. Delivered directly to your estate or private hangar.
          </p>

          {/* Booking widget */}
          <form onSubmit={handleSearch} className="booking-grid" style={{ background: '#303030', border: '1px solid #303030', padding: 32, marginTop: 48, display: 'grid', gap: 24, borderRadius: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={LABEL_UPPER}>Pick-up Location</label>
              <input
                type="text"
                value={pickup}
                onChange={e => setPickup(e.target.value)}
                placeholder="City, Airport, or Address"
                style={INPUT_DARK}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={LABEL_UPPER}>Drop-off Location</label>
              <input
                type="text"
                value={dropoff}
                onChange={e => setDropoff(e.target.value)}
                placeholder="Same as pick-up"
                style={INPUT_DARK}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={LABEL_UPPER}>Pick-up Date</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={INPUT_DARK} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={LABEL_UPPER}>Drop-off Date</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={INPUT_DARK} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                onMouseEnter={() => setBtnHov(true)}
                onMouseLeave={() => setBtnHov(false)}
                style={{
                  background: btnHov ? RED_ACTIVE : RED,
                  color: '#ffffff',
                  fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
                  height: 48, border: 'none', cursor: 'pointer', borderRadius: 0, width: '100%',
                  transition: 'background 0.2s', fontFamily: 'inherit',
                }}
              >
                Check Availability
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ── 2. FLEET (white) ────────────────────────────────────────────────── */}
      <section id="fleet" style={{ background: '#ffffff', color: '#181818', padding: '96px 48px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <h2 style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.36px', color: '#181818', marginBottom: 32 }}>
            Reserve Your Vehicle
          </h2>
          <div className="fleet-grid" style={{ display: 'grid', gap: 24 }}>
            {VEHICLES.map(v => <VehicleCard key={v.name} {...v} />)}
          </div>
        </div>
      </section>

      {/* ── 3. EDITORIAL (dark) ─────────────────────────────────────────────── */}
      <section id="models" style={{ padding: '96px 48px', maxWidth: 1280, margin: '0 auto' }}>
        <h2 style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.36px', color: '#ffffff', marginBottom: 16 }}>
          White Glove Experience
        </h2>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', maxWidth: 600, lineHeight: 1.5, marginBottom: 48 }}>
          We go beyond standard rentals. Enjoy 24/7 dedicated concierge service, bespoke driving itineraries, and seamless vehicle delivery directly to your location.
        </p>
        <div className="editorial-grid" style={{ display: 'grid', gap: 32 }}>
          <div>
            <img src="/assets/interior_cinema.png" alt="Luxury Interior Detail" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
            <div style={{ paddingTop: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>Immaculate Preparation</h3>
              <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.5 }}>
                Every vehicle undergoes a rigorous 100-point inspection and professional detailing before hand-off.
              </p>
            </div>
          </div>
          <div>
            <img src="/assets/action_cinema.png" alt="Car in Action" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
            <div style={{ paddingTop: 24 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 8 }}>Unlimited Thrills</h3>
              <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.5 }}>
                Engineered on the track, our fleet is ready to deliver visceral acceleration and razor-sharp handling.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. LIVERY BAND (red) ────────────────────────────────────────────── */}
      <section style={{ background: RED, padding: '96px 48px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.36px', color: '#ffffff', marginBottom: 16 }}>
          Join The Club
        </h2>
        <p style={{ fontSize: 14, fontWeight: 400, color: '#ffffff', lineHeight: 1.5, maxWidth: 500, margin: '0 auto 32px' }}>
          Members receive priority booking, exclusive rates, and invitations to track days.
        </p>
        <a
          href="/search"
          onMouseEnter={() => setLivHov(true)}
          onMouseLeave={() => setLivHov(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: livHov ? '#ffffff' : 'transparent',
            color: livHov ? RED : '#ffffff',
            fontSize: 14, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase',
            padding: '14px 32px', height: 48,
            border: '1px solid #ffffff',
            textDecoration: 'none', borderRadius: 0,
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          Apply Now
        </a>
      </section>

      {/* Responsive styles */}
      <style>{`
        .booking-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 1024px) {
          .booking-grid {
            grid-template-columns: 1.5fr 1.5fr 1fr 1fr auto;
            align-items: flex-end;
          }
        }
        .fleet-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px) {
          .fleet-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (min-width: 1024px) {
          .fleet-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }
        .editorial-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 1024px) {
          .editorial-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </>
  )
}
