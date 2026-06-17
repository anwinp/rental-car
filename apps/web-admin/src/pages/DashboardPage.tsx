import { useAuth } from '@rcm/ui/auth'

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

const KPI = [
  { label: 'Active Rentals',    value: '24', trend: '↑ +3 from yesterday', positive: true  },
  { label: 'Available Now',     value: '47', trend: '57.3% utilization',   positive: null  },
  { label: "Today's Pickups",   value: '8',  trend: 'Next at 10:30 AM',    positive: null  },
  { label: 'Returns Today',     value: '6',  trend: '2 overdue',           positive: false },
]

const FLEET = [
  { label: 'Available', count: 47, pct: 57, color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  { label: 'On Rent',   count: 24, pct: 29, color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
  { label: 'Maint.',    count:  8, pct: 10, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  { label: 'Other',     count:  3, pct:  4, color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
]

const ACTIVITY = [
  { id: '1', color: '#10b981', msg: 'Toyota Camry GHI-3456 returned by Carol Davis',         when: '2m ago' },
  { id: '2', color: '#6366f1', msg: 'Tesla Model 3 VWX-3456 checked out to Alex Johnson',    when: '14m ago' },
  { id: '3', color: '#3b82f6', msg: 'Reservation CNF-20260616-8821 confirmed via Web',       when: '31m ago' },
  { id: '4', color: '#ef4444', msg: 'Damage report filed on Ford Explorer JKL-7890',         when: '1h ago' },
  { id: '5', color: '#94a3b8', msg: 'BMW 3 Series EFG-5678 added to Downtown fleet',         when: '2h ago' },
  { id: '6', color: '#6366f1', msg: 'Honda Civic ABC-1234 checked out to Maria Lopez',       when: '3h ago' },
]

const PICKUPS = [
  { conf: 'CNF-0091', customer: 'Sarah K.',  cls: 'Economy',  time: '10:30 AM', confirmed: true  },
  { conf: 'CNF-0092', customer: 'James T.',  cls: 'SUV',      time: '11:00 AM', confirmed: true  },
  { conf: 'CNF-0093', customer: 'Priya M.', cls: 'Standard', time: '12:15 PM', confirmed: false },
  { conf: 'CNF-0094', customer: 'Daniel R.', cls: 'Premium',  time: '2:00 PM',  confirmed: true  },
  { conf: 'CNF-0095', customer: 'Sophie W.', cls: 'Economy',  time: '3:30 PM',  confirmed: true  },
]

const QUICK = [
  { label: 'New Reservation', href: '/reservations' },
  { label: 'Check Out',       href: '/reservations' },
  { label: 'Check In',        href: '/reservations' },
  { label: 'Add Vehicle',     href: '/fleet' },
  { label: 'Find Customer',   href: '/customers' },
  { label: 'Run Report',      href: '/reports' },
]

export function DashboardPage() {
  const { user } = useAuth()
  const hr = new Date().getHours()
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
            {greeting}{user?.first_name ? `, ${user.first_name}` : ''}
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--text-3)' }}>{TODAY}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button className="btn-secondary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export
          </button>
          <a href="/reservations" className="btn-primary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Reservation
          </a>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {KPI.map(card => (
          <div key={card.label} className="panel px-5 py-4">
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{card.label}</p>
            <p className="mt-2 text-[2.25rem] font-bold tracking-tight leading-none num" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>{card.value}</p>
            <p className="mt-2 text-[12px] font-medium" style={{
              color: card.positive === true  ? 'var(--success)' :
                     card.positive === false ? 'var(--danger)'  :
                     'var(--text-3)'
            }}>
              {card.trend}
            </p>
          </div>
        ))}
      </div>

      {/* Fleet status + Activity */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Fleet status */}
        <div className="xl:col-span-2 panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>Fleet Status</h2>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>82 vehicles · 3 locations</p>
            </div>
            <a href="/fleet" className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>View all</a>
          </div>

          {/* Segmented bar */}
          <div className="flex h-2 w-full overflow-hidden rounded-full gap-0.5">
            {FLEET.map(s => (
              <div key={s.label} className="rounded-full" style={{ width: `${s.pct}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
            ))}
          </div>

          <div className="mt-4 space-y-3">
            {FLEET.map(s => (
              <div key={s.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-[13px]" style={{ color: 'var(--text-2)' }}>{s.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 w-20 rounded-full" style={{ background: s.bg }}>
                    <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} />
                  </div>
                  <span className="text-[13px] font-semibold num w-7 text-right" style={{ color: 'var(--text-1)' }}>{s.count}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-sub)' }}>
            <p className="text-[10.5px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Quick Actions</p>
            <div className="grid grid-cols-3 gap-1.5">
              {QUICK.map(a => (
                <a
                  key={a.label}
                  href={a.href}
                  className="flex items-center justify-center rounded-md px-2 py-2 text-center text-[11.5px] font-medium transition-colors"
                  style={{ background: 'var(--elevated)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--elevated)' }}
                >
                  {a.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div className="xl:col-span-3 panel">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>Recent Activity</h2>
            <button className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>View all</button>
          </div>
          <ul>
            {ACTIVITY.map(item => (
              <li key={item.id} className="flex items-start gap-3.5 px-5 py-3.5 transition-colors"
                  style={{ borderBottom: '1px solid var(--border-sub)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <div className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug" style={{ color: 'var(--text-2)' }}>{item.msg}</p>
                  <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--text-3)' }}>{item.when}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Upcoming pickups */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-sub)' }}>
          <div>
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--text-1)' }}>Today's Upcoming Pickups</h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>{PICKUPS.length} scheduled for today</p>
          </div>
          <a href="/reservations" className="text-[12px] font-medium" style={{ color: 'var(--accent)' }}>All reservations</a>
        </div>
        <table className="w-full">
          <thead className="tbl-head">
            <tr>
              {['Confirmation', 'Customer', 'Class', 'Time', 'Status'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tbl-body">
            {PICKUPS.map(row => (
              <tr key={row.conf} className="cursor-pointer">
                <td className="font-mono text-[12px] font-medium" style={{ color: 'var(--accent)' }}>{row.conf}</td>
                <td>{row.customer}</td>
                <td style={{ color: 'var(--text-3)' }}>{row.cls}</td>
                <td className="num font-medium" style={{ color: 'var(--text-1)' }}>{row.time}</td>
                <td>
                  {row.confirmed
                    ? <span className="badge-green"><span className="badge-dot bg-emerald-500" />Confirmed</span>
                    : <span className="badge-amber"><span className="badge-dot bg-amber-500" />Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
