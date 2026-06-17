import Link from 'next/link'

const TERMS = [
  {
    heading: 'Minimum Age Requirement',
    body: 'The primary driver must be at least 21 years of age and hold a valid driver\'s license that has been held for a minimum of 12 months. Drivers aged 21–24 are subject to a young driver surcharge. Some vehicle classes (performance and exotic) are restricted to drivers aged 25 and over.',
  },
  {
    heading: 'Credit Card Requirement',
    body: 'A valid major credit card (Visa, Mastercard, American Express, or Discover) in the primary driver\'s name is required at pickup for the security hold. Debit cards and prepaid cards are not accepted. The hold amount varies by vehicle class and is released within 7–10 business days of vehicle return.',
  },
  {
    heading: 'Mileage Policy',
    body: 'Most standard rentals include unlimited mileage within the contiguous United States. For specialty and exotic vehicle classes, a daily mileage cap applies — excess mileage is charged at a per-mile rate stated in your rental agreement. Cross-border travel to Canada or Mexico must be pre-approved and requires additional documentation.',
  },
  {
    heading: 'Fuel Policy',
    body: 'All vehicles are provided with a full tank of fuel and must be returned full. If returned with less fuel, a refuelling service charge plus a per-litre rate applies. The Fuel Prepay Option allows you to pre-purchase a full tank at a competitive rate and return the vehicle on empty.',
  },
  {
    heading: 'Additional Drivers',
    body: 'Additional drivers must be registered at the counter at the time of pickup. Each additional driver must present a valid driver\'s license and meet the same eligibility requirements as the primary renter. A daily additional driver fee applies per extra driver. Unregistered drivers are not covered under any protection plans.',
  },
  {
    heading: 'Vehicle Condition & Responsibility',
    body: 'You are responsible for the vehicle from the time of pickup until return. You must report any damage, theft, or incident to us and to local authorities immediately. Smoking, transporting pets, and off-road use are prohibited. Violations may result in cleaning fees and forfeiture of any protection coverage.',
  },
  {
    heading: 'Insurance & Liability',
    body: 'Without a Collision Damage Waiver (CDW) or Full Protection plan, you are fully liable for any loss or damage to the vehicle up to its full value. We strongly recommend selecting one of our protection tiers at the time of booking. Your personal auto insurance or credit card may provide some coverage — verify with your provider before declining our plans.',
  },
  {
    heading: 'Late Returns',
    body: 'A grace period of 29 minutes is applied to all returns. Beyond this, an additional day charge is levied for each hour or part thereof. If you anticipate a late return, contact us as early as possible to extend your reservation, subject to availability. Extensions cannot be guaranteed.',
  },
  {
    heading: 'Cancellation & Modifications',
    body: 'Standard rate bookings may be cancelled free of charge up to 24 hours before pickup. Within 24 hours, a one-night charge applies. No-shows are charged the full rental amount. Prepaid rates are non-refundable. Modifications to dates or vehicle class are subject to availability and potential rate adjustments.',
  },
  {
    heading: 'Governing Law',
    body: 'These terms are governed by the laws of the jurisdiction in which the rental begins. Any disputes shall be resolved in the courts of that jurisdiction. RCM Rentals reserves the right to update these terms at any time — the version in effect at the time of rental applies.',
  },
]

export default function RentalTermsPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#181818', padding: '80px 24px 60px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <p style={{ fontSize: 11, fontWeight: 500, color: '#da291c', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 12 }}>
            Policies
          </p>
          <h1 style={{ fontSize: 42, fontWeight: 500, color: '#ffffff', letterSpacing: '-0.04em', margin: 0 }}>
            Rental Terms
          </h1>
        </div>

        {/* Intro */}
        <p style={{ fontSize: 15, fontWeight: 400, color: '#969696', lineHeight: 1.7, marginBottom: 48, maxWidth: 640 }}>
          Please read the following terms before completing your reservation. By confirming a booking
          with RCM Rentals, you agree to these conditions in full.
        </p>

        {/* Terms list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TERMS.map((term, i) => (
            <div
              key={term.heading}
              style={{
                background: '#303030',
                border: '1px solid #303030',
                borderRadius: 0,
                padding: '24px 28px',
              }}
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <span style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                  background: 'rgba(218,41,28,0.10)',
                  border: '1px solid rgba(218,41,28,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, color: '#da291c',
                  marginTop: 2,
                }}>
                  {i + 1}
                </span>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 500, color: '#ffffff', marginBottom: 10, letterSpacing: '-0.01em' }}>
                    {term.heading}
                  </h2>
                  <p style={{ fontSize: 14, fontWeight: 400, color: '#969696', lineHeight: 1.65, margin: 0 }}>
                    {term.body}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer links */}
        <div style={{ marginTop: 48, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href="/policies/cancellation"
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
            Cancellation Policy
          </Link>
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
        </div>

      </div>
    </div>
  )
}
