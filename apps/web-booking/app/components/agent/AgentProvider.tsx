'use client'

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AgentCard, AgentChatResponse, AgentMessage } from '@rcm/shared-types'

interface AgentMessageWithCard extends AgentMessage {
  card?: AgentCard | null
  chips?: string[]
}

interface AgentState {
  sessionId: string | null
  messages: AgentMessageWithCard[]
  thinking: boolean
  panelOpen: boolean
}

export type { AgentMessageWithCard }

interface AgentContextValue extends AgentState {
  sendMessage: (text: string) => Promise<void>
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
}

export type { AgentContextValue }

const AgentContext = createContext<AgentContextValue | null>(null)

const SESSION_STORAGE_KEY = 'rcm_agent_session_id'
const LOCAL_STORAGE_KEY   = 'rcm_agent_session'

function restoreSessionId(): string | null {
  // Try sessionStorage first (same-tab page navigations)
  try {
    const id = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (id) return id
  } catch {}
  // Fall back to localStorage (cross-browser-session within 24h)
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const lastActive = new Date(parsed.last_active).getTime()
      const age = Date.now() - lastActive
      if (age < 86400_000 && parsed.session_id) {
        return parsed.session_id as string
      }
    }
  } catch {}
  return null
}

function persistSessionId(sessionId: string): void {
  try { sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId) } catch {}
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      session_id: sessionId,
      last_active: new Date().toISOString(),
    }))
  } catch {}
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AgentState>(() => ({
    sessionId: restoreSessionId(),
    messages: [],
    thinking: false,
    panelOpen: false,
  }))

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: AgentMessage = { role: 'user', content: text, ts: new Date().toISOString() }
    setState(s => ({ ...s, thinking: true, messages: [...s.messages, userMsg] }))

    try {
      const tenantId = typeof window !== 'undefined'
        ? (document.cookie.match(/rcm_tenant=([^;]+)/)?.[1] ?? process.env.NEXT_PUBLIC_TENANT_ID ?? '')
        : (process.env.NEXT_PUBLIC_TENANT_ID ?? '')

      const res = await fetch('/api/v1/agents/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ session_id: state.sessionId, message: text }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AgentChatResponse = await res.json()

      persistSessionId(data.session_id)

      const assistantMsg: AgentMessageWithCard = {
        role: 'assistant',
        content: data.message,
        ts: new Date().toISOString(),
        agent: data.agent,
        card: data.card,
        chips: data.chips,
      }

      setState(s => ({
        ...s,
        sessionId: data.session_id,
        thinking: false,
        messages: [...s.messages, assistantMsg],
      }))
    } catch {
      const errMsg: AgentMessage = {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again.",
        ts: new Date().toISOString(),
        agent: 'system',
      }
      setState(s => ({ ...s, thinking: false, messages: [...s.messages, errMsg] }))
    }
  }, [state.sessionId])

  const openPanel  = useCallback(() => setState(s => ({ ...s, panelOpen: true })), [])
  const closePanel = useCallback(() => setState(s => ({ ...s, panelOpen: false })), [])
  const togglePanel = useCallback(() => setState(s => ({ ...s, panelOpen: !s.panelOpen })), [])

  return (
    <AgentContext.Provider value={{ ...state, sendMessage, openPanel, closePanel, togglePanel }}>
      {children}
    </AgentContext.Provider>
  )
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider')
  return ctx
}
