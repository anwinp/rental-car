import { tenantId } from '../tenant'
'use client'

import { useEffect, useRef, useState } from 'react'
import { useAdminStore } from '../store/adminStore'

interface Suggestion {
  id: string
  type: 'alert' | 'warn' | 'info'
  title: string
  body: string
  action?: string
}


const PLACEHOLDER_SUGGESTIONS: Suggestion[] = [
  { id: 's1', type: 'alert', title: 'Overdue rentals', body: 'Check active rentals dashboard for vehicles past return time.', action: 'View rentals' },
  { id: 's2', type: 'warn', title: 'Fleet utilization high', body: 'Airport location at 87% — consider rebalancing from Downtown.', action: 'Open fleet map' },
  { id: 's3', type: 'info', title: 'Peak pricing active', body: 'Dynamic rate +18% applied for this weekend at Airport.', action: 'Review pricing' },
]

function SuggestionChip({ s }: { s: Suggestion }) {
  const colors: Record<string, { bg: string; border: string; dot: string }> = {
    alert: { bg: 'rgba(244,114,114,0.06)', border: 'rgba(244,114,114,0.18)', dot: 'var(--agent-alert-danger)' },
    warn:  { bg: 'rgba(251,191,36,0.06)',  border: 'rgba(251,191,36,0.18)',  dot: 'var(--agent-alert-warn)' },
    info:  { bg: 'rgba(56,189,248,0.06)',  border: 'rgba(56,189,248,0.18)',  dot: 'var(--agent-alert-info)' },
  }
  const c = colors[s.type]

  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{s.title}</span>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>{s.body}</p>
      {s.action && (
        <button
          style={{
            marginTop: 7,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--sb-accent)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          {s.action} →
        </button>
      )}
    </div>
  )
}

export function AdminIntelligencePanel() {
  const { intelligencePanelOpen, setIntelligencePanelOpen } = useAdminStore()
  const [message, setMessage] = useState('')
  const [chatLines, setChatLines] = useState<{ role: 'user' | 'ai'; text: string }[]>([])
  const [sending, setSending] = useState(false)
  const sessionRef = useRef<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatLines])

  const sendMessage = async (text: string) => {
    if (!text.trim() || sending) return
    setSending(true)
    setChatLines(prev => [...prev, { role: 'user', text }])
    setMessage('')

    try {
      const res = await fetch('/api/v1/agents/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId(),
        },
        credentials: 'include',
        body: JSON.stringify({ message: text, session_id: sessionRef.current }),
      })
      if (res.ok) {
        const data = await res.json()
        sessionRef.current = data.session_id
        setChatLines(prev => [...prev, { role: 'ai', text: data.message }])
      } else {
        setChatLines(prev => [...prev, { role: 'ai', text: 'Sorry, I could not process that request.' }])
      }
    } catch {
      setChatLines(prev => [...prev, { role: 'ai', text: 'Connection error — please try again.' }])
    } finally {
      setSending(false)
    }
  }

  if (!intelligencePanelOpen) return null

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 54,
      height: 'calc(100vh - 54px)',
      width: 'var(--agent-panel-width)',
      background: 'var(--agent-panel-bg)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 40,
      boxShadow: '-4px 0 20px rgba(0,0,0,0.25)',
    }}>
      {/* Panel header */}
      <div style={{
        height: 54,
        borderBottom: '1px solid var(--border)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            width: 18, height: 18, borderRadius: 4,
            background: 'var(--agent-chip-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--sb-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.912 5.813a2 2 0 001.272 1.272L21 12l-5.816 1.912a2 2 0 00-1.272 1.272L12 21l-1.912-5.816a2 2 0 00-1.272-1.272L3 12l5.816-1.912a2 2 0 001.272-1.272z"/>
            </svg>
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)' }}>Intelligence</span>
        </div>
        <button
          onClick={() => setIntelligencePanelOpen(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4, borderRadius: 4 }}
          aria-label="Close intelligence panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Suggestions */}
      <div style={{ padding: '12px 12px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 8 }}>
          Suggestions
        </div>
        {PLACEHOLDER_SUGGESTIONS.map(s => <SuggestionChip key={s.id} s={s} />)}
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {chatLines.length === 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center', marginTop: 12 }}>
            Ask me about fleet status, revenue, or operational issues.
          </div>
        )}
        {chatLines.map((line, i) => (
          <div key={i} style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: line.role === 'user' ? 'var(--text-1)' : 'var(--text-2)',
            background: line.role === 'user' ? 'var(--agent-chip-bg)' : 'transparent',
            borderRadius: 6,
            padding: line.role === 'user' ? '6px 9px' : '0',
            alignSelf: line.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '88%',
          }}>
            {line.text}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(message) } }}
            placeholder="Ask the AI…"
            disabled={sending}
            style={{
              flex: 1,
              height: 32,
              padding: '0 10px',
              fontSize: 12,
              background: 'var(--card-bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-1)',
              outline: 'none',
            }}
          />
          <button
            onClick={() => void sendMessage(message)}
            disabled={sending || !message.trim()}
            style={{
              width: 32, height: 32,
              borderRadius: 6,
              background: 'var(--accent)',
              border: 'none',
              cursor: sending || !message.trim() ? 'not-allowed' : 'pointer',
              opacity: sending || !message.trim() ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-label="Send"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
