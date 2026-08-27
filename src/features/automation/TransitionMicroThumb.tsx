import type { CSSProperties, JSX } from 'react'

export function TransitionMicroThumb({
  presetId,
  active
}: {
  presetId: string
  active?: boolean
}): JSX.Element {
  return (
    <div
      className="tr-micro-box"
      style={{
        width: 44,
        height: 28,
        borderRadius: 6,
        overflow: 'hidden',
        position: 'relative',
        background: '#181b22',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border-2)',
        flex: 'none'
      }}
    >
      <style>{`
        @keyframes tr-fade { 0%, 15% { opacity: 0; } 50%, 85% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes tr-slide-l { 0%, 15% { transform: translateX(100%); } 50%, 85% { transform: translateX(0%); } 100% { transform: translateX(100%); } }
        @keyframes tr-slide-r { 0%, 15% { transform: translateX(-100%); } 50%, 85% { transform: translateX(0%); } 100% { transform: translateX(-100%); } }
        @keyframes tr-slide-u { 0%, 15% { transform: translateY(100%); } 50%, 85% { transform: translateY(0%); } 100% { transform: translateY(100%); } }
        @keyframes tr-slide-d { 0%, 15% { transform: translateY(-100%); } 50%, 85% { transform: translateY(0%); } 100% { transform: translateY(-100%); } }
        @keyframes tr-wipe-l { 0%, 15% { clip-path: inset(0 0 0 100%); } 50%, 85% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 0 0 100%); } }
        @keyframes tr-wipe-r { 0%, 15% { clip-path: inset(0 100% 0 0); } 50%, 85% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 100% 0 0); } }
        @keyframes tr-zoom { 0%, 15% { transform: scale(0.3); opacity: 0; } 50%, 85% { transform: scale(1); opacity: 1; } 100% { transform: scale(0.3); opacity: 0; } }
        @keyframes tr-blur { 0%, 15% { filter: blur(6px); opacity: 0; } 50%, 85% { filter: blur(0px); opacity: 1; } 100% { filter: blur(6px); opacity: 0; } }
        @keyframes tr-dip-b { 0%, 45% { opacity: 0; } 60%, 85% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes tr-dip-black { 0%, 25% { opacity: 0; } 45%, 55% { opacity: 1; } 75%, 100% { opacity: 0; } }
      `}</style>

      {/* Base frame (clip A) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, #1e293b, #334155)',
          display: 'grid',
          placeItems: 'center'
        }}
      >
        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)' }}>A</span>
      </div>

      {/* Transitioning frame (clip B) or Cut */}
      {presetId === 'cut' ? (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '50%',
            background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
            display: 'grid',
            placeItems: 'center',
            borderLeft: '1px dashed rgba(255,255,255,0.4)'
          }}
        >
          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#fff', fontWeight: 700 }}>B</span>
        </div>
      ) : (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(135deg, #3b82f6, #60a5fa)',
              display: 'grid',
              placeItems: 'center',
              ...getAnimationForPreset(presetId)
            }}
          >
            <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#fff', fontWeight: 700 }}>B</span>
          </div>
          {presetId === 'dip-to-black' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: '#000',
                pointerEvents: 'none',
                animation: 'tr-dip-black 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite'
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

function getAnimationForPreset(presetId: string): CSSProperties {
  const dur = presetId === 'fade-quick' ? '1.6s' : presetId === 'fade-slow' ? '3.2s' : '2.4s'
  const timing = `${dur} cubic-bezier(0.4, 0, 0.2, 1) infinite`

  if (presetId.includes('fade') || presetId === 'crossfade') return { animation: `tr-fade ${timing}` }
  if (presetId === 'slide-left') return { animation: `tr-slide-l ${timing}` }
  if (presetId === 'slide-right') return { animation: `tr-slide-r ${timing}` }
  if (presetId === 'slide-up') return { animation: `tr-slide-u ${timing}` }
  if (presetId === 'slide-down') return { animation: `tr-slide-d ${timing}` }
  if (presetId === 'wipe-left') return { animation: `tr-wipe-l ${timing}` }
  if (presetId === 'wipe-right') return { animation: `tr-wipe-r ${timing}` }
  if (presetId === 'zoom') return { animation: `tr-zoom ${timing}` }
  if (presetId === 'blur') return { animation: `tr-blur ${timing}` }
  if (presetId === 'dip-to-black') return { animation: `tr-dip-b ${timing}` }
  return { animation: `tr-fade ${timing}` }
}
