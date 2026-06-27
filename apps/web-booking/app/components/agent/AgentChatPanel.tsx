'use client'

import { useEffect, useRef, useState } from 'react'
import { useAgent } from './AgentProvider'
import { AgentCardRenderer } from './cards/AgentCard'
import type { AgentMessageWithCard } from './AgentProvider'

// ── Preset prompts (shown in the empty state, clickable) ──────────────────────

const PRESET_PROMPTS: { icon: string; label: string; send: string }[] = [
  { icon: '🚗', label: 'Book a car',            send: 'Book a car' },
  { icon: '🔎', label: 'Look up my reservation', send: 'Look up my reservation' },
  { icon: '📅', label: 'Change my dates',        send: 'I want to change my reservation dates' },
  { icon: '✖️', label: 'Cancel a booking',       send: 'I want to cancel my reservation' },
]

// ── Shared panel content ──────────────────────────────────────────────────────

interface PanelContentProps {
  messages: AgentMessageWithCard[]
  thinking: boolean
  input: string
  setInput: (v: string) => void
  onSend: (text?: string) => void
  onClose: () => void
}

function PanelContent({ messages, thinking, input, setInput, onSend, onClose }: PanelContentProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }

  return (
    <>
      {/* Header */}
      <div style={{
        padding: '0 16px',
        height: 54,
        borderBottom: '1px solid var(--agent-chip-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--p-brand)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--p-text-1)' }}>RCM Assistant</span>
        </div>
        {/* Minimise button */}
        <button
          onClick={onClose}
          title="Minimise"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--p-text-3)', padding: '4px 6px', borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--p-text-1)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'none'
            ;(e.currentTarget as HTMLElement).style.color = 'var(--p-text-3)'
          }}
          aria-label="Minimise chat"
        >
          {/* Chevron-down icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 21 6 15"/>
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ color: 'var(--p-text-2)', fontSize: 13, textAlign: 'center', lineHeight: 1.5 }}>
              How can I help with your rental today?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--p-text-3)', textTransform: 'uppercase', textAlign: 'center', marginBottom: 2 }}>
                Try one of these
              </div>
              {PRESET_PROMPTS.map(p => (
                <button
                  key={p.send}
                  onClick={() => onSend(p.send)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', textAlign: 'left',
                    padding: '11px 13px',
                    background: 'var(--agent-chip-bg)',
                    border: '1px solid var(--agent-chip-border)',
                    borderRadius: 10,
                    color: 'var(--p-text-1)', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(218,41,28,0.10)'
                    ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(218,41,28,0.35)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--agent-chip-bg)'
                    ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--agent-chip-border)'
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              padding: '8px 12px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? 'var(--agent-msg-user-bg)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${msg.role === 'user' ? 'var(--agent-msg-user-border)' : 'var(--agent-chip-border)'}`,
              color: 'var(--p-text-1)',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
            </div>
            {msg.role === 'assistant' && msg.card && (
              <div style={{ maxWidth: '96%' }}>
                <AgentCardRenderer card={msg.card} onChipClick={chip => onSend(chip)} />
              </div>
            )}
            {msg.role === 'assistant' && msg.chips && msg.chips.length > 0 && i === messages.length - 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 2 }}>
                {msg.chips.map((chip, ci) => (
                  <button
                    key={ci}
                    onClick={() => onSend(chip)}
                    disabled={thinking}
                    style={{
                      padding: '5px 10px', borderRadius: 20,
                      border: '1px solid var(--agent-chip-border)',
                      background: 'var(--agent-chip-bg)',
                      color: 'var(--p-text-2)', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--agent-chip-border)', borderRadius: '12px 12px 12px 2px' }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--p-brand)', opacity: 0.7, animation: `rcm-pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--agent-chip-border)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          disabled={thinking}
          style={{
            flex: 1,
            background: 'var(--agent-input-bg)',
            border: '1px solid var(--agent-input-border)',
            borderRadius: 8,
            padding: '10px 14px',
            color: 'var(--p-text-1)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          onClick={() => onSend()}
          disabled={!input.trim() || thinking}
          style={{
            background: 'var(--p-brand)', border: 'none', borderRadius: 8,
            width: 40, height: 40,
            cursor: input.trim() && !thinking ? 'pointer' : 'not-allowed',
            opacity: input.trim() && !thinking ? 1 : 0.4,
            color: '#fff', fontSize: 16, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label="Send message"
        >
          ↑
        </button>
      </div>
    </>
  )
}

// ── Mobile bottom bar ─────────────────────────────────────────────────────────

interface MobileBarProps { onOpen: () => void }

function MobileBar({ onOpen }: MobileBarProps) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
      background: 'var(--agent-panel-bg)',
      borderTop: '1px solid var(--agent-chip-border)',
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <button onClick={onOpen} style={{
        flex: 1, textAlign: 'left',
        background: 'var(--agent-input-bg)',
        border: '1px solid var(--agent-input-border)',
        borderRadius: 8, padding: '10px 14px',
        color: 'var(--agent-input-placeholder)', fontSize: 14, cursor: 'text',
        fontFamily: 'inherit',
      }}>
        Ask RCM assistant…
      </button>
    </div>
  )
}

// ── Mobile sheet ──────────────────────────────────────────────────────────────

interface MobileSheetProps extends PanelContentProps { onBackdropClick: () => void }

function MobileSheet({ onBackdropClick, ...rest }: MobileSheetProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} onClick={onBackdropClick} />
      <div style={{
        position: 'relative', height: 'var(--agent-sheet-height)',
        background: 'var(--agent-panel-bg)',
        borderRadius: '16px 16px 0 0',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ margin: '12px auto 0', width: 40, height: 4, borderRadius: 2, background: 'var(--agent-sheet-handle)' }} />
        <PanelContent {...rest} />
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AgentChatPanel() {
  const { messages, thinking, panelOpen, sendMessage, openPanel, closePanel, togglePanel } = useAgent()
  const [input, setInput] = useState('')

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || thinking) return
    if (!text) setInput('')
    await sendMessage(msg)
  }

  const panelProps: PanelContentProps = {
    messages,
    thinking,
    input,
    setInput,
    onSend: handleSend,
    onClose: closePanel,
  }

  const unreadCount = messages.filter(m => m.role === 'assistant').length

  return (
    <>
      <style>{`
        @keyframes rcm-pulse { 0%,100%{transform:scale(0.8);opacity:0.4} 50%{transform:scale(1);opacity:1} }
        @keyframes rcm-fab-in { from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }

        /* Desktop-only elements */
        .rcm-desktop-panel,
        .rcm-desktop-fab { display: none !important; }

        /* Mobile-only elements */
        .rcm-mobile-bar { display: flex; }

        @media (min-width: 1200px) {
          .rcm-desktop-panel { display: flex !important; }
          .rcm-desktop-fab   { display: flex !important; }
          .rcm-mobile-bar    { display: none !important; }
        }
      `}</style>

      {/* ── Desktop: sliding panel (fixed overlay, does not push content) ── */}
      <div
        className="rcm-desktop-panel"
        style={{
          position: 'fixed',
          right: 0,
          top: 64,
          height: 'calc(100vh - 64px)',
          width: 'var(--agent-panel-width)',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--agent-panel-bg)',
          borderLeft: '1px solid var(--agent-chip-border)',
          zIndex: 40,
          boxShadow: '-4px 0 32px rgba(0,0,0,0.35)',
          transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: panelOpen ? 'auto' : 'none',
        }}
        aria-hidden={!panelOpen}
      >
        <PanelContent {...panelProps} />
      </div>

      {/* ── Desktop: floating action button (shown when panel is closed) ── */}
      {!panelOpen && (
        <button
          className="rcm-desktop-fab"
          onClick={openPanel}
          aria-label="Open RCM Assistant"
          style={{
            position: 'fixed',
            bottom: 28,
            right: 28,
            width: 54,
            height: 54,
            borderRadius: '50%',
            background: 'var(--p-brand)',
            border: 'none',
            cursor: 'pointer',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            boxShadow: '0 4px 20px rgba(218,41,28,0.45), 0 2px 8px rgba(0,0,0,0.4)',
            animation: 'rcm-fab-in 0.22s ease',
            flexDirection: 'column',
            gap: 2,
            padding: 0,
          }}
        >
          {/* Chat bubble icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {/* Unread badge */}
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2,
              width: 18, height: 18, borderRadius: '50%',
              background: '#ffffff', color: 'var(--p-brand)',
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--p-brand)',
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* ── Mobile ── */}
      <div className="rcm-mobile-bar">
        {panelOpen
          ? <MobileSheet {...panelProps} onBackdropClick={closePanel} />
          : <MobileBar onOpen={openPanel} />}
      </div>
    </>
  )
}
