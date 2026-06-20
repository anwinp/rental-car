export function SearchSkeleton() {
  return (
    <div aria-label="Loading available vehicles" aria-busy="true">
      {/* Controls row skeleton */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 30, height: 10, background: 'rgba(255,255,255,0.06)', animation: 'sk-pulse 1.5s ease-in-out infinite' }} />
          <div style={{ display: 'flex', gap: 2 }}>
            {[60, 60, 80].map((w, i) => (
              <div key={i} style={{ width: w, height: 30, background: 'rgba(255,255,255,0.06)', animation: `sk-pulse 1.5s ease-in-out ${i * 0.1}s infinite` }} />
            ))}
          </div>
          <div style={{ width: 1, height: 20, background: '#303030' }} />
          <div style={{ width: 140, height: 12, background: 'rgba(255,255,255,0.05)', animation: 'sk-pulse 1.5s ease-in-out 0.3s infinite' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 36, height: 10, background: 'rgba(255,255,255,0.06)', animation: 'sk-pulse 1.5s ease-in-out infinite' }} />
          {[70, 64, 72, 58, 54, 68].map((w, i) => (
            <div key={i} style={{ width: w, height: 28, background: 'rgba(255,255,255,0.05)', animation: `sk-pulse 1.5s ease-in-out ${i * 0.08}s infinite` }} />
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: '#282828', marginBottom: 16 }} />

      {/* Card skeletons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            style={{
              background: '#242424',
              border: '1px solid rgba(255,255,255,0.07)',
              display: 'flex',
              alignItems: 'stretch',
              overflow: 'hidden',
              height: 168,
              opacity: 1 - i * 0.06,
            }}
          >
            {/* Left panel */}
            <div style={{
              width: 200, flexShrink: 0,
              padding: '28px 24px',
              background: 'linear-gradient(135deg, #1c1c1c 0%, #1e1e1e 100%)',
              borderRight: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ width: 36, height: 9, background: 'rgba(255,255,255,0.07)', marginBottom: 12, animation: 'sk-pulse 1.5s ease-in-out infinite' }} />
                <div style={{ width: 90, height: 18, background: 'rgba(255,255,255,0.06)', marginBottom: 10, animation: 'sk-pulse 1.5s ease-in-out 0.1s infinite' }} />
                <div style={{ width: 110, height: 11, background: 'rgba(255,255,255,0.04)', animation: 'sk-pulse 1.5s ease-in-out 0.2s infinite' }} />
              </div>
              <div style={{ width: 80, height: 10, background: 'rgba(255,255,255,0.05)', animation: 'sk-pulse 1.5s ease-in-out 0.25s infinite' }} />
            </div>

            {/* Center */}
            <div style={{ flex: 1, padding: '28px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[52, 70, 62, 80, 56, 66].map((w, j) => (
                  <div key={j} style={{ width: w, height: 26, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', animation: `sk-pulse 1.5s ease-in-out ${j * 0.07}s infinite` }} />
                ))}
              </div>
            </div>

            {/* Right */}
            <div style={{
              width: 196, flexShrink: 0,
              padding: '28px 24px',
              borderLeft: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', gap: 16,
            }}>
              <div>
                <div style={{ width: 80, height: 30, background: 'rgba(255,255,255,0.08)', marginLeft: 'auto', marginBottom: 6, animation: 'sk-pulse 1.5s ease-in-out infinite' }} />
                <div style={{ width: 50, height: 9, background: 'rgba(255,255,255,0.05)', marginLeft: 'auto', marginBottom: 12, animation: 'sk-pulse 1.5s ease-in-out 0.1s infinite' }} />
                <div style={{ width: 100, height: 10, background: 'rgba(255,255,255,0.04)', marginLeft: 'auto', animation: 'sk-pulse 1.5s ease-in-out 0.15s infinite' }} />
              </div>
              <div style={{ width: '100%', height: 44, background: 'rgba(218,41,28,0.12)', animation: 'sk-pulse 1.5s ease-in-out 0.2s infinite' }} />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes sk-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
