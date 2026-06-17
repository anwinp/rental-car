import { useState, type FormEvent } from 'react'

type Customer = {
  customer_id: string; first_name: string; last_name: string; email: string
  phone: string | null; is_dnr: boolean; dnr_reason: string | null
  loyalty_tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | null
  loyalty_points: number; total_rentals: number; lifetime_value: number; since: string
}

const INIT_CUSTOMERS: Customer[] = [
  { customer_id:'1', first_name:'Alice',  last_name:'Johnson', email:'alice@example.com',  phone:'+1-555-0101', is_dnr:false, dnr_reason:null,                             loyalty_tier:'GOLD',     loyalty_points:4250,  total_rentals:23, lifetime_value:4812.50,  since:'2022-03-14' },
  { customer_id:'2', first_name:'Bob',    last_name:'Smith',   email:'bob@example.com',    phone:null,          is_dnr:true,  dnr_reason:'Vehicle damage, refused payment', loyalty_tier:null,       loyalty_points:0,     total_rentals:5,  lifetime_value:890.00,   since:'2023-08-01' },
  { customer_id:'3', first_name:'Carol',  last_name:'Davis',   email:'carol@example.com',  phone:'+1-555-0303', is_dnr:false, dnr_reason:null,                             loyalty_tier:'PLATINUM', loyalty_points:18500, total_rentals:87, lifetime_value:24350.00, since:'2019-05-22' },
  { customer_id:'4', first_name:'Dan',    last_name:'Wilson',  email:'dan@example.com',    phone:'+1-555-0404', is_dnr:false, dnr_reason:null,                             loyalty_tier:'BRONZE',   loyalty_points:320,   total_rentals:3,  lifetime_value:450.00,   since:'2025-01-08' },
  { customer_id:'5', first_name:'Eve',    last_name:'Martinez',email:'eve@example.com',    phone:'+1-555-0505', is_dnr:false, dnr_reason:null,                             loyalty_tier:'SILVER',   loyalty_points:2100,  total_rentals:12, lifetime_value:3100.00,  since:'2021-09-30' },
  { customer_id:'6', first_name:'Frank',  last_name:'Lee',     email:'frank@example.com',  phone:'+1-555-0606', is_dnr:false, dnr_reason:null,                             loyalty_tier:'GOLD',     loyalty_points:7820,  total_rentals:34, lifetime_value:8900.00,  since:'2020-11-15' },
]

const TIER: Record<string, { label: string; color: string; bg: string }> = {
  BRONZE:   { label:'Bronze',   color:'#f59e0b', bg:'rgba(245,158,11,0.12)'  },
  SILVER:   { label:'Silver',   color:'#94a3b8', bg:'rgba(148,163,184,0.12)' },
  GOLD:     { label:'Gold',     color:'#fbbf24', bg:'rgba(251,191,36,0.12)'  },
  PLATINUM: { label:'Platinum', color:'#a78bfa', bg:'rgba(167,139,250,0.12)' },
}

const AVATAR_COLORS = ['#8b5cf6','#7c3aed','#0ea5e9','#10b981','#f47272','#f59e0b']
const avatarColor = (id: string) => AVATAR_COLORS[parseInt(id, 10) % AVATAR_COLORS.length]
const initials    = (f: string, l: string) => `${f[0] ?? '?'}${l[0] ?? ''}`.toUpperCase()

const RECENT = [
  { conf:'CNF-20260610-0055', dates:'Jun 10 – Jun 15', vehicle:'BMW 3 Series',  amount:'$825.00' },
  { conf:'CNF-20260520-0031', dates:'May 20 – May 24', vehicle:'Toyota Camry',  amount:'$312.00' },
  { conf:'CNF-20260415-0012', dates:'Apr 15 – Apr 20', vehicle:'Honda Civic',   amount:'$195.00' },
]

let nextCid = INIT_CUSTOMERS.length + 1

function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-md p-1.5 transition-colors" style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  )
}

const BLANK = { first_name:'', last_name:'', email:'', phone:'', loyalty_tier:'' }

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>(INIT_CUSTOMERS)
  const [search,   setSearch]     = useState('')
  const [selected, setSelected]   = useState<Customer | null>(null)

  // Add modal
  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState<typeof BLANK>(BLANK)
  const afi = (k: keyof typeof BLANK, v: string) => setAddForm(p => ({ ...p, [k]: v }))

  // Edit modal
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState<typeof BLANK>(BLANK)
  const efi = (k: keyof typeof BLANK, v: string) => setEditForm(p => ({ ...p, [k]: v }))

  // DNR flow
  const [showDnrModal, setShowDnrModal] = useState(false)
  const [dnrReason,    setDnrReason]    = useState('')
  const [confirmUnDnr, setConfirmUnDnr] = useState(false)

  const filtered = customers.filter(c => {
    if (!search) return true
    return `${c.first_name} ${c.last_name} ${c.email} ${c.phone ?? ''}`.toLowerCase().includes(search.toLowerCase())
  })

  // Keeps selected in sync after edits
  const syncSelected = (updated: Customer) => {
    setCustomers(prev => prev.map(c => c.customer_id === updated.customer_id ? updated : c))
    setSelected(updated)
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const id   = String(nextCid++)
    const newC: Customer = {
      customer_id:    id,
      first_name:     addForm.first_name,
      last_name:      addForm.last_name,
      email:          addForm.email,
      phone:          addForm.phone || null,
      is_dnr:         false,
      dnr_reason:     null,
      loyalty_tier:   (addForm.loyalty_tier || null) as Customer['loyalty_tier'],
      loyalty_points: 0,
      total_rentals:  0,
      lifetime_value: 0,
      since:          new Date().toISOString().slice(0, 10),
    }
    setCustomers(prev => [newC, ...prev])
    setSelected(newC)
    setShowAdd(false)
    setAddForm(BLANK)
  }

  function openEdit() {
    if (!selected) return
    setEditForm({
      first_name:    selected.first_name,
      last_name:     selected.last_name,
      email:         selected.email,
      phone:         selected.phone ?? '',
      loyalty_tier:  selected.loyalty_tier ?? '',
    })
    setShowEdit(true)
  }

  function handleEdit(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const updated: Customer = {
      ...selected,
      first_name:   editForm.first_name,
      last_name:    editForm.last_name,
      email:        editForm.email,
      phone:        editForm.phone || null,
      loyalty_tier: (editForm.loyalty_tier || null) as Customer['loyalty_tier'],
    }
    syncSelected(updated)
    setShowEdit(false)
  }

  function handleFlagDnr(e: FormEvent) {
    e.preventDefault()
    if (!selected) return
    const updated = { ...selected, is_dnr: true, dnr_reason: dnrReason }
    syncSelected(updated)
    setShowDnrModal(false)
    setDnrReason('')
  }

  function handleRemoveDnr() {
    if (!selected) return
    const updated = { ...selected, is_dnr: false, dnr_reason: null }
    syncSelected(updated)
    setConfirmUnDnr(false)
  }

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 112px)' }}>

      {/* ── Left panel ── */}
      <div className={`flex flex-col gap-4 transition-all duration-200 ${selected ? 'w-72 shrink-0' : 'w-full'}`}>
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Customers</h1>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {!selected && 'Add Customer'}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="search" placeholder="Search name, email, phone…" value={search}
            onChange={e => setSearch(e.target.value)} className="field-input h-9 pl-8 text-[13px]" />
        </div>

        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
          {filtered.length} customer{filtered.length !== 1 ? 's' : ''}{search ? ` matching "${search}"` : ''}
        </p>

        {/* List */}
        <div className="flex-1 space-y-2 overflow-auto">
          {filtered.length === 0 ? (
            <div className="panel flex flex-col items-center justify-center py-12 text-center" style={{ borderStyle: 'dashed' }}>
              <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>No customers found</p>
              {search && <button onClick={() => setSearch('')} className="mt-2 text-[12px] font-medium" style={{ color: 'var(--accent)' }}>Clear search</button>}
            </div>
          ) : filtered.map(c => (
            <button
              key={c.customer_id}
              onClick={() => { setSelected(c); setConfirmUnDnr(false) }}
              className="w-full rounded-lg p-3.5 text-left transition-colors"
              style={{
                background: selected?.customer_id === c.customer_id ? 'var(--accent-sub)' : 'var(--card-bg)',
                border: `1px solid ${selected?.customer_id === c.customer_id ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                     style={{ background: avatarColor(c.customer_id) }}>
                  {initials(c.first_name, c.last_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>{c.first_name} {c.last_name}</p>
                    {c.is_dnr && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>DNR</span>}
                  </div>
                  <p className="text-[12px] truncate" style={{ color: 'var(--text-3)' }}>{c.email}</p>
                </div>
                {c.loyalty_tier && (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: TIER[c.loyalty_tier].bg, color: TIER[c.loyalty_tier].color }}>
                    {TIER[c.loyalty_tier].label}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Detail panel ── */}
      {selected && (
        <div className="flex-1 panel overflow-auto">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>Customer Profile</p>
            <CloseBtn onClick={() => { setSelected(null); setConfirmUnDnr(false) }} />
          </div>

          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white"
                   style={{ background: avatarColor(selected.customer_id) }}>
                {initials(selected.first_name, selected.last_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[18px] font-bold" style={{ color: 'var(--text-1)' }}>{selected.first_name} {selected.last_name}</h2>
                  {selected.is_dnr && <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>DO NOT RENT</span>}
                  {selected.loyalty_tier && (
                    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                          style={{ background: TIER[selected.loyalty_tier].bg, color: TIER[selected.loyalty_tier].color }}>
                      {TIER[selected.loyalty_tier].label}
                    </span>
                  )}
                </div>
                <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-2)' }}>{selected.email}</p>
                <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>{selected.phone ?? 'No phone on file'}</p>
                <p className="text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
                  Customer since {new Date(selected.since).toLocaleDateString('en-US', { month:'long', year:'numeric' })}
                </p>
              </div>
            </div>

            {/* DNR alert */}
            {selected.is_dnr && selected.dnr_reason && (
              <div className="flex items-start gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                <svg className="mt-0.5 shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--danger)' }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div>
                  <p className="text-[12.5px] font-semibold" style={{ color: 'var(--danger)' }}>Do Not Rent Flag Active</p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>{selected.dnr_reason}</p>
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label:'Total Rentals',  value: selected.total_rentals.toString() },
                { label:'Loyalty Points', value: selected.loyalty_points.toLocaleString() },
                { label:'Lifetime Value', value: `$${selected.lifetime_value.toLocaleString('en-US', { minimumFractionDigits:2 })}` },
              ].map(s => (
                <div key={s.label} className="rounded-lg px-3 py-3 text-center" style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                  <p className="text-[18px] font-bold num" style={{ color: 'var(--text-1)' }}>{s.value}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>{s.label}</p>
                </div>
              ))}
            </div>

            {/* Recent rentals */}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Recent Rentals</p>
              <div className="space-y-2">
                {selected.total_rentals === 0 ? (
                  <p className="text-[13px] py-4 text-center" style={{ color: 'var(--text-3)' }}>No rental history</p>
                ) : RECENT.slice(0, Math.min(selected.total_rentals, 3)).map(r => (
                  <div key={r.conf} className="flex items-center justify-between rounded-lg px-4 py-3"
                       style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}>
                    <div>
                      <p className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--accent)' }}>{r.conf}</p>
                      <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>{r.dates} · {r.vehicle}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold num" style={{ color: 'var(--text-1)' }}>{r.amount}</p>
                      <p className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--success)' }}>Returned</p>
                    </div>
                  </div>
                ))}
                {selected.total_rentals > 3 && (
                  <button className="w-full rounded-lg py-2 text-[12px] font-medium transition-colors"
                          style={{ border: '1px solid var(--border)', color: 'var(--text-3)' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--hover-bg)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                    View all {selected.total_rentals} rentals
                  </button>
                )}
              </div>
            </div>

            {/* Remove DNR confirm */}
            {selected.is_dnr && confirmUnDnr && (
              <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--warn-bg)', border: '1px solid rgba(251,191,36,0.25)' }}>
                <p className="text-[12px] font-medium" style={{ color: 'var(--warn)' }}>Remove Do Not Rent flag?</p>
                <div className="flex gap-2">
                  <button className="flex-1 btn-secondary py-1.5 text-[12px]" onClick={() => setConfirmUnDnr(false)}>Keep Flag</button>
                  <button className="flex-1 btn-secondary py-1.5 text-[12px]"
                          style={{ borderColor: 'rgba(251,191,36,0.4)', color: 'var(--warn)' }}
                          onClick={handleRemoveDnr}>Remove DNR</button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <a href="/reservations" className="btn-primary flex-1 justify-center">New Reservation</a>
              <button className="btn-secondary" onClick={openEdit}>Edit Profile</button>
              {selected.is_dnr ? (
                <button className="btn-secondary" onClick={() => setConfirmUnDnr(true)}>Remove DNR</button>
              ) : (
                <button className="btn-secondary" style={{ borderColor: 'rgba(244,114,114,0.3)', color: 'var(--danger)' }}
                        onClick={() => { setShowDnrModal(true); setDnrReason('') }}>
                  Flag DNR
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add Customer Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) { setShowAdd(false); setAddForm(BLANK) } }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Add Customer</h2>
              <CloseBtn onClick={() => { setShowAdd(false); setAddForm(BLANK) }} />
            </div>
            <form onSubmit={handleAdd} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>First Name</ModalLabel>
                  <input required type="text" placeholder="Jane"
                    value={addForm.first_name} onChange={e => afi('first_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Last Name</ModalLabel>
                  <input required type="text" placeholder="Smith"
                    value={addForm.last_name} onChange={e => afi('last_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>
              <div>
                <ModalLabel>Email Address</ModalLabel>
                <input required type="email" placeholder="jane@example.com"
                  value={addForm.email} onChange={e => afi('email', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Phone <span style={{ fontWeight:400 }}>(optional)</span></ModalLabel>
                <input type="tel" placeholder="+1-555-0100"
                  value={addForm.phone} onChange={e => afi('phone', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Loyalty Tier <span style={{ fontWeight:400 }}>(optional)</span></ModalLabel>
                <select value={addForm.loyalty_tier} onChange={e => afi('loyalty_tier', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="">None</option>
                  <option value="BRONZE">Bronze</option>
                  <option value="SILVER">Silver</option>
                  <option value="GOLD">Gold</option>
                  <option value="PLATINUM">Platinum</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => { setShowAdd(false); setAddForm(BLANK) }} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Add Customer</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Profile Modal ── */}
      {showEdit && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowEdit(false) }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Edit Profile</h2>
              <CloseBtn onClick={() => setShowEdit(false)} />
            </div>
            <form onSubmit={handleEdit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>First Name</ModalLabel>
                  <input required type="text"
                    value={editForm.first_name} onChange={e => efi('first_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Last Name</ModalLabel>
                  <input required type="text"
                    value={editForm.last_name} onChange={e => efi('last_name', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>
              <div>
                <ModalLabel>Email Address</ModalLabel>
                <input required type="email"
                  value={editForm.email} onChange={e => efi('email', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Phone</ModalLabel>
                <input type="tel" placeholder="No phone on file"
                  value={editForm.phone} onChange={e => efi('phone', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Loyalty Tier</ModalLabel>
                <select value={editForm.loyalty_tier} onChange={e => efi('loyalty_tier', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="">None</option>
                  <option value="BRONZE">Bronze</option>
                  <option value="SILVER">Silver</option>
                  <option value="GOLD">Gold</option>
                  <option value="PLATINUM">Platinum</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowEdit(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Flag DNR Modal ── */}
      {showDnrModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowDnrModal(false) }}>
          <div className="panel w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--danger)' }}>Flag Do Not Rent</h2>
              <CloseBtn onClick={() => setShowDnrModal(false)} />
            </div>
            <form onSubmit={handleFlagDnr} className="px-6 py-5 space-y-4">
              <div className="rounded-lg px-4 py-3" style={{ background: 'var(--danger-bg)', border: '1px solid rgba(244,114,114,0.25)' }}>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{selected.first_name} {selected.last_name}</p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-2)' }}>{selected.email}</p>
              </div>
              <div>
                <ModalLabel>Reason for DNR flag</ModalLabel>
                <textarea required rows={3} placeholder="Describe the reason this customer should not be rented to…"
                  value={dnrReason} onChange={e => setDnrReason(e.target.value)}
                  className="field-input px-3 py-2 text-[13px] w-full resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowDnrModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary" style={{ background: 'var(--danger)', boxShadow: 'none' }}>
                  Flag DNR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
