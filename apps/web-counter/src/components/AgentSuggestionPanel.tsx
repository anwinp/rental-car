import { tenantId } from '../tenant'
import { useEffect, useRef, useState } from 'react'

interface Suggestion {
  id: string
  type: 'alert' | 'warn' | 'info'
  title: string
  body: string
  action: string | null
}

interface Props {
  checkoutSessionId?: string | null
}

const T = {
  canvas:         '#181818',
  canvasElevated: '#303030',
  primary:        '#da291c',
  ink:            '#ffffff',
  body:           '#969696',
  muted:          '#666666',
  hairline:       '#303030',
}


const TYPE_COLORS: Record<string, { dot: string; border: string; bg: string }> = {
  alert: { dot: '#f47272', border: 'rgba(244,114,114,0.2)', bg: 'rgba(244,114,114,0.05)' },
  warn:  { dot: '#fbbf24', border: 'rgba(251,191,36,0.2)',  bg: 'rgba(251,191,36,0.05)' },
  info:  { dot: '#38bdf8', border: 'rgba(56,189,248,0.2)',  bg: 'rgba(56,189,248,0.05)' },
}

export function AgentSuggestionPanel({ checkoutSessionId }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSuggestions = async () => {
    try {
      const url = `/api/v1/agents/counter-suggestions${checkoutSessionId ? `?session=${checkoutSessionId}` : ''}`
      const res = await fetch(url, {
        headers: { 'X-Tenant-ID': tenantId() },
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setSuggestions(data.suggestions ?? [])
        setLastUpdated(new Date())
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchSuggestions()
    intervalRef.current = setInterval(() => { void fetchSuggestions() }, 8_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [checkoutSessionId])

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 64,
      height: 'calc(100vh - 64px)',
      width: 280,
      background: T.canvas,
      borderLeft: `1px solid ${T.hairline}`,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 10,
      boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: `1px solid ${T.hairline}`,
      }}>
        <p style={{
          margin: 0,
          fontSize: 10, fontWeight: 700, letterSpacing: '1.1px',
          textTransform: 'uppercase', color: T.muted,
        }}>
          AI Suggestions
        </p>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {loading && (
          <div style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginTop: 16 }}>
            Loading…
          </div>
        )}

        {!loading && suggestions.map(s => {
          const c = TYPE_COLORS[s.type] ?? TYPE_COLORS.info
          return (
            <div
              key={s.id}
              style={{
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: 4,
                padding: '10px 12px',
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>{s.title}</span>
              </div>
              <p style={{ margin: 0, fontSize: 11.5, color: T.body, lineHeight: 1.5 }}>{s.body}</p>
              {s.action && (
                <button
                  style={{
                    marginTop: 8,
                    fontSize: 11, fontWeight: 600,
                    letterSpacing: '0.5px',
                    color: T.primary,
                    background: 'none', border: 'none',
                    padding: 0, cursor: 'pointer',
                  }}
                >
                  {s.action} →
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 16px',
        borderTop: `1px solid ${T.hairline}`,
        fontSize: 10, color: T.muted,
        textAlign: 'center',
      }}>
        {lastUpdated
          ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
          : 'Loading…'}
      </div>
    </div>
  )
}
