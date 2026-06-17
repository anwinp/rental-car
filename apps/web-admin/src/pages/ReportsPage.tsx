import { useState, useMemo } from 'react'

const ALL_MONTHS      = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const ALL_REVENUE     = [42800, 38500, 51200, 49700, 61300, 57900]
const ALL_UTILIZATION = [62, 58, 71, 68, 79, 75]

const YTD_TOTAL = ALL_REVENUE.reduce((a, b) => a + b, 0)

const PERIOD_N = { '1m': 1, '3m': 3, '6m': 6 } as const

const LOCATIONS = [
  { name: 'Airport',  revenue: 29800, pct: 51, rentals: 142 },
  { name: 'Downtown', revenue: 19600, pct: 34, rentals: 98  },
  { name: 'Midtown',  revenue: 8500,  pct: 15, rentals: 44  },
]

const CLASSES = [
  { name: 'SUV',      revenue: 22100, pct: 38, rentals: 96,  color: '#6366f1' },
  { name: 'Standard', revenue: 17300, pct: 30, rentals: 118, color: '#8b5cf6' },
  { name: 'Economy',  revenue: 9800,  pct: 17, rentals: 124, color: '#0ea5e9' },
  { name: 'Premium',  revenue: 6200,  pct: 11, rentals: 28,  color: '#10b981' },
  { name: 'Luxury',   revenue: 2500,  pct: 4,  rentals: 8,   color: '#f59e0b' },
]

export function ReportsPage() {
  const [period, setPeriod] = useState<'6m' | '3m' | '1m'>('6m')

  const { months, revenue, utilization, maxRev } = useMemo(() => {
    const n = PERIOD_N[period]
    const months      = ALL_MONTHS.slice(-n)
    const revenue     = ALL_REVENUE.slice(-n)
    const utilization = ALL_UTILIZATION.slice(-n)
    const maxRev      = Math.max(...revenue)
    return { months, revenue, utilization, maxRev }
  }, [period])

  const currentMonth = months[months.length - 1]
  const currentRev   = revenue[revenue.length - 1]
  const prevRev      = revenue[revenue.length - 2]
  const revDelta     = prevRev != null
    ? ((currentRev - prevRev) / prevRev * 100).toFixed(1)
    : null

  const currentUtil = utilization[utilization.length - 1]

  const KPIS = [
    {
      label: `Revenue (${currentMonth})`,
      value: `$${currentRev.toLocaleString()}`,
      delta: revDelta != null ? `${parseFloat(revDelta) >= 0 ? '+' : ''}${revDelta}%` : '—',
      dir:   revDelta != null ? (parseFloat(revDelta) >= 0 ? 1 : -1) : 0,
      sub:   prevRev != null ? `vs ${months[months.length - 2]} 2026` : 'Jun 2026',
    },
    { label: 'Fleet Utilization',   value: '75%',      delta: '+4 pts', dir: 1, sub: 'Jun 2026' },
    { label: 'Avg Rental Duration', value: '4.2 days', delta: '+0.3d',  dir: 1, sub: 'Jun 2026' },
    { label: 'Avg Daily Rate',      value: '$89.40',   delta: '+$3.10', dir: 1, sub: 'Jun 2026' },
  ]

  return (
    <div className="space-y-5 max-w-[1200px]">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Reports</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>Performance overview · June 2026</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg p-0.5" style={{ border: '1px solid var(--border)', background: 'var(--elevated)' }}>
            {(['1m', '3m', '6m'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: period === p ? 'var(--card-bg)' : 'transparent',
                  color: period === p ? 'var(--text-1)' : 'var(--text-3)',
                }}>
                {p === '1m' ? '1 Mo' : p === '3m' ? '3 Mo' : '6 Mo'}
              </button>
            ))}
          </div>
          <button className="btn-secondary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {KPIS.map(k => (
          <div key={k.label} className="panel px-5 py-4">
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{k.label}</p>
            <p className="mt-2 text-[2rem] font-bold tracking-tight num" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>{k.value}</p>
            <div className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold">
              {k.dir !== 0 && (
                <span style={{ color: k.dir > 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {k.dir > 0 ? '↑' : '↓'} {k.delta}
                </span>
              )}
              <span className="font-normal ml-1" style={{ color: 'var(--text-3)' }}>{k.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="panel p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>Monthly Revenue</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>Gross rental revenue (USD)</p>
          </div>
          <div className="text-right">
            <p className="text-[22px] font-bold num" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
              ${YTD_TOTAL.toLocaleString()}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>YTD total</p>
          </div>
        </div>

        {/* Bar chart — items-stretch so column height is definite, enabling % bar heights */}
        <div className="flex items-stretch gap-1.5" style={{ height: 160 }}>
          {months.map((month, i) => {
            const pct    = (revenue[i] / maxRev) * 100
            const isLast = i === months.length - 1
            return (
              <div key={month} className="flex h-full flex-1 flex-col items-center gap-1.5 min-w-0">
                <p className="shrink-0 text-[10px] num" style={{ color: 'var(--text-3)' }}>
                  ${(revenue[i] / 1000).toFixed(0)}k
                </p>
                <div className="flex min-h-0 w-full flex-1 items-end justify-center">
                  <div
                    className="w-full rounded-t-md transition-all duration-300"
                    style={{
                      height: `${pct}%`,
                      background: isLast ? 'var(--accent-sub)' : 'var(--accent)',
                      border:     isLast ? '1.5px dashed var(--accent)' : 'none',
                      minHeight:  2,
                    }}
                    title={`${month}: $${revenue[i].toLocaleString()}`}
                  />
                </div>
                <p className="shrink-0 text-[12px] font-medium"
                   style={{ color: isLast ? 'var(--accent)' : 'var(--text-3)' }}>{month}</p>
              </div>
            )
          })}
        </div>

        <div style={{ borderTop: '1px solid var(--border-sub)', marginTop: 12 }} />
        <div className="mt-4 flex items-center gap-5">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm" style={{ background: 'var(--accent)' }} />
            <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>Revenue</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm" style={{ background: 'var(--accent-sub)', border: '1.5px dashed var(--accent)' }} />
            <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>Current period ({currentMonth})</span>
          </div>
        </div>
      </div>

      {/* Utilization */}
      <div className="panel p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>Fleet Utilization</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>Average % of fleet on rent (daily)</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold num" style={{ color: 'var(--text-1)' }}>{currentUtil}%</span>
            <span className="badge-green text-[11px]">+4 pts</span>
          </div>
        </div>
        <div className="space-y-4">
          {months.map((month, i) => (
            <div key={month} className="flex items-center gap-4">
              <p className="w-7 text-[12px] font-medium shrink-0" style={{ color: 'var(--text-3)' }}>{month}</p>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                <div className="h-full rounded-full" style={{ width: `${utilization[i]}%`, background: 'var(--accent)' }} />
              </div>
              <p className="w-9 text-right text-[12px] font-bold num shrink-0" style={{ color: 'var(--text-2)' }}>{utilization[i]}%</p>
            </div>
          ))}
        </div>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel p-6">
          <h2 className="text-[14px] font-semibold mb-5" style={{ color: 'var(--text-1)' }}>Revenue by Location</h2>
          <div className="space-y-5">
            {LOCATIONS.map(loc => (
              <div key={loc.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>{loc.name}</p>
                  <div className="flex items-center gap-4">
                    <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{loc.rentals} rentals</p>
                    <p className="text-[13px] font-bold num" style={{ color: 'var(--text-1)' }}>${(loc.revenue / 1000).toFixed(1)}k</p>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                  <div className="h-full rounded-full" style={{ width: `${loc.pct}%`, background: 'var(--accent)' }} />
                </div>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>{loc.pct}% of total revenue</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="text-[14px] font-semibold mb-5" style={{ color: 'var(--text-1)' }}>Revenue by Vehicle Class</h2>
          <div className="space-y-5">
            {CLASSES.map(cls => (
              <div key={cls.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ background: cls.color }} />
                    <p className="text-[13px] font-medium" style={{ color: 'var(--text-2)' }}>{cls.name}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>{cls.rentals} rentals</p>
                    <p className="text-[13px] font-bold num" style={{ color: 'var(--text-1)' }}>${(cls.revenue / 1000).toFixed(1)}k</p>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--elevated)' }}>
                  <div className="h-full rounded-full" style={{ width: `${cls.pct}%`, background: cls.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
