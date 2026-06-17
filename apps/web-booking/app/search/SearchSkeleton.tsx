export function SearchSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }} aria-label="Loading available vehicles" aria-busy="true">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          style={{
            background: '#303030',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 0,
            display: 'flex',
            alignItems: 'stretch',
            overflow: 'hidden',
            height: 140,
          }}
        >
          {/* Left panel */}
          <div style={{ width: 200, flexShrink: 0, padding: '28px 24px', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
            <div style={{ width: 40, height: 10, background: 'rgba(255,255,255,0.08)', animation: 'sk-pulse 1.5s ease-in-out infinite' }} />
            <div style={{ width: 100, height: 16, background: 'rgba(255,255,255,0.06)', animation: 'sk-pulse 1.5s ease-in-out infinite 0.1s' }} />
            <div style={{ width: 80, height: 12, background: 'rgba(255,255,255,0.05)', animation: 'sk-pulse 1.5s ease-in-out infinite 0.2s' }} />
          </div>

          {/* Center */}
          <div style={{ flex: 1, padding: '24px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
            <div style={{ width: '60%', height: 12, background: 'rgba(255,255,255,0.06)', animation: 'sk-pulse 1.5s ease-in-out infinite 0.1s' }} />
            <div style={{ width: '45%', height: 12, background: 'rgba(255,255,255,0.05)', animation: 'sk-pulse 1.5s ease-in-out infinite 0.2s' }} />
            <div style={{ width: '55%', height: 12, background: 'rgba(255,255,255,0.04)', animation: 'sk-pulse 1.5s ease-in-out infinite 0.3s' }} />
          </div>

          {/* Right */}
          <div style={{ width: 196, flexShrink: 0, padding: '24px 20px', borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', gap: 14 }}>
            <div style={{ width: 90, height: 32, background: 'rgba(255,255,255,0.07)', animation: 'sk-pulse 1.5s ease-in-out infinite' }} />
            <div style={{ width: '100%', height: 48, background: 'rgba(218,41,28,0.12)', animation: 'sk-pulse 1.5s ease-in-out infinite 0.15s' }} />
          </div>
        </div>
      ))}
      <style>{`
        @keyframes sk-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  )
}
