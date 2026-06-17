import { useState, type FormEvent } from 'react'

type RateCode = {
  id: string; code: string; name: string
  status: 'ACTIVE' | 'DRAFT' | 'EXPIRED'
  type: string; valid_from: string; valid_to: string; classes_count: number
}

type Extra = {
  id: string; code: string; name: string; description: string
  daily_rate: number; is_active: boolean; category: string
}

const INIT_RATES: RateCode[] = [
  { id:'1', code:'STD-BASE',  name:'Standard Base Rate',    status:'ACTIVE',  type:'RACK',        valid_from:'2026-01-01', valid_to:'2026-12-31', classes_count:6 },
  { id:'2', code:'SUMMER26',  name:'Summer 2026 Promo',     status:'ACTIVE',  type:'PROMOTIONAL', valid_from:'2026-06-01', valid_to:'2026-08-31', classes_count:4 },
  { id:'3', code:'CORP-ACME', name:'ACME Corp Rate',        status:'ACTIVE',  type:'CORPORATE',   valid_from:'2026-01-01', valid_to:'2026-12-31', classes_count:6 },
  { id:'4', code:'WINTER25',  name:'Winter 2025',           status:'EXPIRED', type:'PROMOTIONAL', valid_from:'2025-12-01', valid_to:'2025-12-31', classes_count:3 },
  { id:'5', code:'AAA-DISC',  name:'AAA Member Discount',   status:'DRAFT',   type:'AFFINITY',    valid_from:'2026-07-01', valid_to:'2026-12-31', classes_count:0 },
]

const INIT_EXTRAS: Extra[] = [
  { id:'1', code:'CDW',     name:'Collision Damage Waiver',    description:'Reduces your financial liability in case of vehicle damage', daily_rate:19.99, is_active:true,  category:'Protection' },
  { id:'2', code:'PAI',     name:'Personal Accident Insurance',description:'Covers medical costs for you and your passengers',          daily_rate:4.99,  is_active:true,  category:'Protection' },
  { id:'3', code:'RSN',     name:'Roadside Network',            description:'24/7 emergency roadside assistance',                        daily_rate:3.99,  is_active:true,  category:'Protection' },
  { id:'4', code:'GPS',     name:'GPS Navigation Unit',         description:'Portable GPS device with lifetime map updates',             daily_rate:7.99,  is_active:true,  category:'Equipment'  },
  { id:'5', code:'CSS',     name:'Child Safety Seat',           description:'Certified child car seat, rear or forward facing',          daily_rate:9.99,  is_active:true,  category:'Equipment'  },
  { id:'6', code:'BOOSTER', name:'Booster Seat',                description:'For children over 40 lbs who outgrown a child seat',        daily_rate:7.99,  is_active:false, category:'Equipment'  },
  { id:'7', code:'SAT',     name:'Satellite Radio',             description:'Sirius XM satellite radio access',                          daily_rate:5.99,  is_active:true,  category:'Equipment'  },
]

const STATUS_CFG: Record<RateCode['status'], { label: string; color: string; bg: string; dot: string }> = {
  ACTIVE:  { label:'Active',  color:'var(--success)', bg:'var(--success-bg)',          dot:'#34d399' },
  DRAFT:   { label:'Draft',   color:'var(--warn)',    bg:'var(--warn-bg)',              dot:'#fbbf24' },
  EXPIRED: { label:'Expired', color:'var(--text-3)',  bg:'rgba(100,116,139,0.15)',      dot:'#64748b' },
}

const TYPE_LABELS: Record<string, string> = {
  RACK:'Rack', PROMOTIONAL:'Promo', CORPORATE:'Corporate', AFFINITY:'Affinity', OPAQUE:'Opaque',
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}

let nextRateId  = INIT_RATES.length  + 1
let nextExtraId = INIT_EXTRAS.length + 1

function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-3)' }}>
      {children}
    </p>
  )
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md p-1.5 transition-colors" style={{ color: 'var(--text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  )
}

const BLANK_RATE  = { code:'', name:'', type:'RACK', status:'DRAFT' as RateCode['status'], valid_from:'', valid_to:'' }
const BLANK_EXTRA = { code:'', name:'', description:'', daily_rate:'', category:'Protection', is_active: true }

export function PricingPage() {
  const [tab,    setTab]    = useState<'rates' | 'extras'>('rates')
  const [rates,  setRates]  = useState<RateCode[]>(INIT_RATES)
  const [extras, setExtras] = useState<Extra[]>(INIT_EXTRAS)

  // Rate modals
  const [showNewRate,  setShowNewRate]  = useState(false)
  const [rateForm,     setRateForm]     = useState<typeof BLANK_RATE>(BLANK_RATE)
  const [editRate,     setEditRate]     = useState<RateCode | null>(null)
  const [editRateForm, setEditRateForm] = useState<typeof BLANK_RATE>(BLANK_RATE)
  const [deleteRate,   setDeleteRate]   = useState<RateCode | null>(null)

  // Extra modals
  const [showNewExtra,  setShowNewExtra]  = useState(false)
  const [extraForm,     setExtraForm]     = useState<typeof BLANK_EXTRA>(BLANK_EXTRA)
  const [editExtra,     setEditExtra]     = useState<Extra | null>(null)
  const [editExtraForm, setEditExtraForm] = useState<typeof BLANK_EXTRA>(BLANK_EXTRA)

  const rfi  = (k: keyof typeof BLANK_RATE,  v: string) => setRateForm(p => ({ ...p, [k]: v }))
  const erfi = (k: keyof typeof BLANK_RATE,  v: string) => setEditRateForm(p => ({ ...p, [k]: v }))
  const xfi  = (k: keyof typeof BLANK_EXTRA, v: string | boolean) => setExtraForm(p => ({ ...p, [k]: v }))
  const exfi = (k: keyof typeof BLANK_EXTRA, v: string | boolean) => setEditExtraForm(p => ({ ...p, [k]: v }))

  const activeRates = rates.filter(r => r.status === 'ACTIVE').length

  function toggleExtra(id: string) {
    setExtras(prev => prev.map(e => e.id === id ? { ...e, is_active: !e.is_active } : e))
  }

  function handleNewRate(e: FormEvent) {
    e.preventDefault()
    const newR: RateCode = {
      id:            String(nextRateId++),
      code:          rateForm.code.toUpperCase(),
      name:          rateForm.name,
      type:          rateForm.type,
      status:        rateForm.status,
      valid_from:    rateForm.valid_from,
      valid_to:      rateForm.valid_to,
      classes_count: 0,
    }
    setRates(prev => [newR, ...prev])
    setShowNewRate(false)
    setRateForm(BLANK_RATE)
  }

  function openEditRate(r: RateCode) {
    setEditRate(r)
    setEditRateForm({ code: r.code, name: r.name, type: r.type, status: r.status, valid_from: r.valid_from, valid_to: r.valid_to })
  }

  function handleEditRate(e: FormEvent) {
    e.preventDefault()
    if (!editRate) return
    setRates(prev => prev.map(r =>
      r.id === editRate.id
        ? { ...r, code: editRateForm.code.toUpperCase(), name: editRateForm.name, type: editRateForm.type, status: editRateForm.status, valid_from: editRateForm.valid_from, valid_to: editRateForm.valid_to }
        : r
    ))
    setEditRate(null)
  }

  function handleDeleteRate() {
    if (!deleteRate) return
    setRates(prev => prev.filter(r => r.id !== deleteRate.id))
    setDeleteRate(null)
  }

  function handleNewExtra(e: FormEvent) {
    e.preventDefault()
    const newE: Extra = {
      id:          String(nextExtraId++),
      code:        extraForm.code.toUpperCase(),
      name:        extraForm.name,
      description: extraForm.description,
      daily_rate:  parseFloat(extraForm.daily_rate) || 0,
      is_active:   extraForm.is_active as boolean,
      category:    extraForm.category,
    }
    setExtras(prev => [...prev, newE])
    setShowNewExtra(false)
    setExtraForm(BLANK_EXTRA)
  }

  function openEditExtra(ex: Extra) {
    setEditExtra(ex)
    setEditExtraForm({ code: ex.code, name: ex.name, description: ex.description, daily_rate: String(ex.daily_rate), category: ex.category, is_active: ex.is_active })
  }

  function handleEditExtra(e: FormEvent) {
    e.preventDefault()
    if (!editExtra) return
    setExtras(prev => prev.map(ex =>
      ex.id === editExtra.id
        ? { ...ex, code: editExtraForm.code.toUpperCase(), name: editExtraForm.name, description: editExtraForm.description, daily_rate: parseFloat(String(editExtraForm.daily_rate)) || 0, category: editExtraForm.category, is_active: editExtraForm.is_active as boolean }
        : ex
    ))
    setEditExtra(null)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>Pricing</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-3)' }}>{activeRates} active rate code{activeRates !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={() => { setShowNewRate(true); setRateForm(BLANK_RATE) }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Rate Code
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
        {(['rates', 'extras'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px"
            style={{
              borderColor: tab === t ? 'var(--accent)' : 'transparent',
              color:       tab === t ? 'var(--accent)' : 'var(--text-3)',
            }}>
            {t === 'rates' ? 'Rate Codes' : 'Extras & Add-ons'}
          </button>
        ))}
      </div>

      {/* ── Rate Codes tab ── */}
      {tab === 'rates' && (
        <div className="panel overflow-hidden">
          <table className="w-full">
            <thead className="tbl-head">
              <tr>
                {['Code', 'Name', 'Type', 'Status', 'Valid Period', 'Classes', ''].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="tbl-body">
              {rates.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>No rate codes — add one above</td></tr>
              ) : rates.map(r => {
                const cfg = STATUS_CFG[r.status]
                return (
                  <tr key={r.id}>
                    <td className="font-mono text-[12px] font-bold" style={{ color: 'var(--text-1)' }}>{r.code}</td>
                    <td className="font-medium" style={{ color: 'var(--text-1)' }}>{r.name}</td>
                    <td>
                      <span className="rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ background: 'var(--elevated)', color: 'var(--text-2)' }}>
                        {TYPE_LABELS[r.type] ?? r.type}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold" style={{ background: cfg.bg, color: cfg.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: cfg.dot }} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                      {fmt(r.valid_from)} – {fmt(r.valid_to)}
                    </td>
                    <td style={{ color: r.classes_count > 0 ? 'var(--text-2)' : 'var(--text-3)' }}>
                      {r.classes_count > 0 ? `${r.classes_count} classes` : '—'}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEditRate(r)} className="btn-secondary px-2.5 py-1 text-[11px]">Edit</button>
                        <button
                          onClick={() => setDeleteRate(r)}
                          className="rounded-md px-2 py-1 text-[11px] transition-colors"
                          style={{ color: 'var(--danger)', border: '1px solid transparent' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(244,114,114,0.3)'; (e.currentTarget as HTMLElement).style.background = 'var(--danger-bg)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Extras tab ── */}
      {tab === 'extras' && (
        <div className="space-y-3">
          {['Protection', 'Equipment'].map(category => {
            const items = extras.filter(e => e.category === category)
            if (items.length === 0) return null
            return (
              <div key={category} className="panel overflow-hidden">
                <div className="px-5 py-3" style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{category}</p>
                </div>
                <div>
                  {items.map((extra, i) => (
                    <div key={extra.id} className="flex items-center gap-4 px-5 py-4"
                         style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border-sub)' : 'none' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--text-3)' }}>{extra.code}</span>
                          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{extra.name}</span>
                        </div>
                        <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>{extra.description}</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <p className="text-[13px] font-bold num" style={{ color: 'var(--text-1)' }}>${extra.daily_rate.toFixed(2)}</p>
                          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>per day</p>
                        </div>
                        <button onClick={() => toggleExtra(extra.id)}
                          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                          style={{ background: extra.is_active ? 'var(--accent)' : 'rgba(100,116,139,0.3)' }}
                          role="switch" aria-checked={extra.is_active} aria-label={`${extra.is_active ? 'Disable' : 'Enable'} ${extra.name}`}>
                          <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
                                style={{ transform: `translateX(${extra.is_active ? '16px' : '2px'})` }} />
                        </button>
                        <button onClick={() => openEditExtra(extra)} className="btn-secondary px-2.5 py-1 text-[11px]">Edit</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          <button
            onClick={() => { setShowNewExtra(true); setExtraForm(BLANK_EXTRA) }}
            className="w-full rounded-lg py-4 text-[13px] font-medium transition-colors"
            style={{ border: '1px dashed var(--border)', color: 'var(--text-3)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-3)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}>
            + Add Extra
          </button>
        </div>
      )}

      {/* ── New Rate Code Modal ── */}
      {showNewRate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowNewRate(false) }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>New Rate Code</h2>
              <CloseBtn onClick={() => setShowNewRate(false)} />
            </div>
            <form onSubmit={handleNewRate} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Code</ModalLabel>
                  <input required type="text" placeholder="SUMMER27"
                    value={rateForm.code} onChange={e => rfi('code', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
                </div>
                <div>
                  <ModalLabel>Type</ModalLabel>
                  <select value={rateForm.type} onChange={e => rfi('type', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="RACK">Rack</option>
                    <option value="PROMOTIONAL">Promotional</option>
                    <option value="CORPORATE">Corporate</option>
                    <option value="AFFINITY">Affinity</option>
                    <option value="OPAQUE">Opaque</option>
                  </select>
                </div>
              </div>
              <div>
                <ModalLabel>Rate Name</ModalLabel>
                <input required type="text" placeholder="Summer 2027 Promotion"
                  value={rateForm.name} onChange={e => rfi('name', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Status</ModalLabel>
                <select value={rateForm.status} onChange={e => rfi('status', e.target.value as RateCode['status'])} className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Valid From</ModalLabel>
                  <input required type="date"
                    value={rateForm.valid_from} onChange={e => rfi('valid_from', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Valid To</ModalLabel>
                  <input required type="date"
                    value={rateForm.valid_to} onChange={e => rfi('valid_to', e.target.value)}
                    min={rateForm.valid_from}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowNewRate(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Create Rate Code</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Rate Code Modal ── */}
      {editRate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setEditRate(null) }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Edit Rate Code</h2>
                <p className="text-[12px] font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{editRate.code}</p>
              </div>
              <CloseBtn onClick={() => setEditRate(null)} />
            </div>
            <form onSubmit={handleEditRate} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Code</ModalLabel>
                  <input required type="text"
                    value={editRateForm.code} onChange={e => erfi('code', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
                </div>
                <div>
                  <ModalLabel>Type</ModalLabel>
                  <select value={editRateForm.type} onChange={e => erfi('type', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="RACK">Rack</option>
                    <option value="PROMOTIONAL">Promotional</option>
                    <option value="CORPORATE">Corporate</option>
                    <option value="AFFINITY">Affinity</option>
                    <option value="OPAQUE">Opaque</option>
                  </select>
                </div>
              </div>
              <div>
                <ModalLabel>Rate Name</ModalLabel>
                <input required type="text"
                  value={editRateForm.name} onChange={e => erfi('name', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Status</ModalLabel>
                <select value={editRateForm.status} onChange={e => erfi('status', e.target.value as RateCode['status'])} className="field-input h-9 px-3 text-[13px] w-full">
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Valid From</ModalLabel>
                  <input required type="date"
                    value={editRateForm.valid_from} onChange={e => erfi('valid_from', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
                <div>
                  <ModalLabel>Valid To</ModalLabel>
                  <input required type="date"
                    value={editRateForm.valid_to} onChange={e => erfi('valid_to', e.target.value)}
                    min={editRateForm.valid_from}
                    className="field-input h-9 px-3 text-[13px] w-full" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setEditRate(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Rate Confirm ── */}
      {deleteRate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setDeleteRate(null) }}>
          <div className="panel w-full max-w-sm overflow-hidden">
            <div className="px-6 py-5 space-y-4">
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Delete Rate Code?</h2>
                <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>
                  This will permanently remove <span className="font-mono font-bold" style={{ color: 'var(--text-1)' }}>{deleteRate.code}</span> — {deleteRate.name}.
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setDeleteRate(null)} className="btn-secondary flex-1 justify-center py-2">Cancel</button>
                <button onClick={handleDeleteRate} className="btn-primary flex-1 justify-center py-2" style={{ background: 'var(--danger)', boxShadow:'none' }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Extra Modal ── */}
      {showNewExtra && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setShowNewExtra(false) }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Add Extra</h2>
              <CloseBtn onClick={() => setShowNewExtra(false)} />
            </div>
            <form onSubmit={handleNewExtra} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Code</ModalLabel>
                  <input required type="text" placeholder="WIFI"
                    value={extraForm.code} onChange={e => xfi('code', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
                </div>
                <div>
                  <ModalLabel>Category</ModalLabel>
                  <select value={extraForm.category} onChange={e => xfi('category', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option>Protection</option>
                    <option>Equipment</option>
                  </select>
                </div>
              </div>
              <div>
                <ModalLabel>Name</ModalLabel>
                <input required type="text" placeholder="Wi-Fi Hotspot"
                  value={extraForm.name} onChange={e => xfi('name', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Description</ModalLabel>
                <textarea required rows={2} placeholder="What does this add-on include?"
                  value={extraForm.description} onChange={e => xfi('description', e.target.value)}
                  className="field-input px-3 py-2 text-[13px] w-full resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Daily Rate ($)</ModalLabel>
                  <input required type="number" min="0" step="0.01" placeholder="9.99"
                    value={extraForm.daily_rate} onChange={e => xfi('daily_rate', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full num" />
                </div>
                <div>
                  <ModalLabel>Status</ModalLabel>
                  <select
                    value={extraForm.is_active ? 'active' : 'inactive'}
                    onChange={e => xfi('is_active', e.target.value === 'active')}
                    className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setShowNewExtra(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Add Extra</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Extra Modal ── */}
      {editExtra && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
             onClick={e => { if (e.target === e.currentTarget) setEditExtra(null) }}>
          <div className="panel w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>Edit Extra</h2>
                <p className="text-[12px] font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{editExtra.code}</p>
              </div>
              <CloseBtn onClick={() => setEditExtra(null)} />
            </div>
            <form onSubmit={handleEditExtra} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Code</ModalLabel>
                  <input required type="text"
                    value={editExtraForm.code} onChange={e => exfi('code', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full font-mono tracking-wider" />
                </div>
                <div>
                  <ModalLabel>Category</ModalLabel>
                  <select value={String(editExtraForm.category)} onChange={e => exfi('category', e.target.value)} className="field-input h-9 px-3 text-[13px] w-full">
                    <option>Protection</option>
                    <option>Equipment</option>
                  </select>
                </div>
              </div>
              <div>
                <ModalLabel>Name</ModalLabel>
                <input required type="text"
                  value={editExtraForm.name} onChange={e => exfi('name', e.target.value)}
                  className="field-input h-9 px-3 text-[13px] w-full" />
              </div>
              <div>
                <ModalLabel>Description</ModalLabel>
                <textarea required rows={2}
                  value={editExtraForm.description} onChange={e => exfi('description', e.target.value)}
                  className="field-input px-3 py-2 text-[13px] w-full resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <ModalLabel>Daily Rate ($)</ModalLabel>
                  <input required type="number" min="0" step="0.01"
                    value={editExtraForm.daily_rate} onChange={e => exfi('daily_rate', e.target.value)}
                    className="field-input h-9 px-3 text-[13px] w-full num" />
                </div>
                <div>
                  <ModalLabel>Status</ModalLabel>
                  <select
                    value={editExtraForm.is_active ? 'active' : 'inactive'}
                    onChange={e => exfi('is_active', e.target.value === 'active')}
                    className="field-input h-9 px-3 text-[13px] w-full">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-sub)' }}>
                <button type="button" onClick={() => setEditExtra(null)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
