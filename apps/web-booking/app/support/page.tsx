'use client'

import { useState } from 'react'

const FAQ_ITEMS = [
  {
    question: 'How do I cancel my reservation?',
    answer:
      'Log in to your account and navigate to My Reservations. Select the booking you wish to cancel and click "Cancel Reservation." Cancellations made more than 24 hours before pickup are free. Within 24 hours, a one-night charge applies. See our full Cancellation Policy for prepaid rate terms.',
  },
  {
    question: 'What documents do I need at pickup?',
    answer:
      'You will need a valid driver\'s license (held for at least one year), a major credit card in the primary driver\'s name, and your confirmation number. International customers must also present a valid passport. An International Driving Permit is required if your license is not in English.',
  },
  {
    question: 'What happens if I return the car late?',
    answer:
      'A grace period of 29 minutes is allowed. After that, an additional day rate is charged for each hour or part thereof beyond the grace period. We recommend contacting us in advance if you anticipate a late return so we can check availability.',
  },
  {
    question: 'Can I add an additional driver?',
    answer:
      'Yes. Additional drivers can be added at the counter at time of pickup. Each additional driver must be present with a valid driver\'s license and must meet the same age and licensing requirements as the primary driver. Additional driver fees vary by location.',
  },
  {
    question: 'Does my personal car insurance cover rentals?',
    answer:
      'Many personal auto insurance policies extend coverage to rental vehicles, but coverage limits vary. We recommend contacting your insurance provider before your rental to confirm your coverage. Some credit cards also provide rental coverage — check with your card issuer. If in doubt, our CDW protection gives you peace of mind.',
  },
  {
    question: 'What is the fuel policy?',
    answer:
      'All vehicles are provided with a full tank of fuel and must be returned full. If the vehicle is returned with less fuel, a refueling charge and a per-litre rate will apply. Alternatively, you can add our Fuel Prepay Option when booking — prepay for a full tank and return on empty with no additional charges.',
  },
  {
    question: 'How do loyalty points work?',
    answer:
      'RCM Rewards members earn 1 point per dollar spent on qualifying rentals. Points can be redeemed for free rental days, upgrades, and accessories. Points are credited to your account within 48 hours of completing a rental. Points expire after 24 months of account inactivity.',
  },
  {
    question: 'Can I modify my dates after booking?',
    answer:
      'Yes, reservations can be modified subject to vehicle availability. Log in to your account, find your reservation, and select "Modify Booking." For prepaid bookings, date changes may be subject to a modification fee and any difference in rate. Same-day modifications must be made by calling our support line.',
  },
  {
    question: 'What if the car I booked isn\'t available?',
    answer:
      'In the rare event your reserved vehicle class is unavailable at pickup, we will provide a complimentary upgrade to the next available class at no additional charge. If no comparable vehicle is available, you will receive a full refund and we will assist in finding an alternative.',
  },
  {
    question: 'How long does a refund take?',
    answer:
      'Refunds are processed within 3–5 business days of the cancellation or adjustment being approved. The time for funds to appear in your account depends on your bank or card issuer and typically takes an additional 2–5 business days. Refunds are returned to the original payment method.',
  },
]

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      background: '#303030',
      border: '1px solid #303030',
      borderRadius: 0,
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '18px 22px',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit', gap: 12,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 400, color: '#ffffff', lineHeight: 1.4 }}>
          {question}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0, color: '#969696',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{
          padding: '0 22px 18px',
          fontSize: 14, fontWeight: 400, color: '#969696',
          lineHeight: 1.65,
          borderTop: '1px solid rgba(255,255,255,0.05)',
          paddingTop: 14,
        }}>
          {answer}
        </div>
      )}
    </div>
  )
}

export default function SupportPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#181818', padding: '80px 24px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: '#da291c', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 12 }}>
            Support
          </p>
          <h1 style={{ fontSize: 42, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', margin: 0 }}>
            Help & Support
          </h1>
        </div>

        {/* FAQ */}
        <section style={{ marginBottom: 64 }}>
          <h2 style={{ fontSize: 11, fontWeight: 500, color: '#969696', letterSpacing: '0.16em', marginBottom: 20, textTransform: 'uppercase' }}>
            Frequently Asked Questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQ_ITEMS.map(item => (
              <FaqItem key={item.question} question={item.question} answer={item.answer} />
            ))}
          </div>
        </section>

        {/* Contact section */}
        <section>
          <h2 style={{ fontSize: 11, fontWeight: 500, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 20 }}>
            Contact Us
          </h2>
          <div style={{
            background: '#303030',
            border: '1px solid #303030',
            borderRadius: 0,
            padding: '32px 36px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 32,
          }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 500, color: '#da291c', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>
                Email
              </p>
              <a
                href="mailto:support@rcmrentals.com"
                style={{ fontSize: 15, fontWeight: 400, color: '#ffffff', textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#da291c'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#ffffff'}
              >
                support@rcmrentals.com
              </a>
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 500, color: '#da291c', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>
                Phone
              </p>
              <p style={{ fontSize: 15, fontWeight: 400, color: '#ffffff', margin: 0 }}>
                1-800-RCM-RENT
              </p>
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 500, color: '#da291c', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>
                Hours
              </p>
              <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', margin: 0, lineHeight: 1.6 }}>
                Mon–Fri 8 AM–8 PM<br />
                Sat–Sun 9 AM–5 PM
              </p>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
