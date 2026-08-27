import type { JSX } from 'react'

export type HookMicroType =
  | 'auto'
  | 'kinetic'
  | 'typewriter'
  | 'title-card'
  | 'reel-burn'
  | 'hard-light'
  | 'trailer-drop'
  | 'margin-note'
  | 'big-bold'
  | 'stat-reveal'
  | 'quote'
  | 'question-burst'
  | 'minimal'

export function getHookMicroType(hookId?: string): HookMicroType {
  if (!hookId || hookId.trim() === '') return 'auto'
  const id = hookId.toLowerCase()

  if (id === 'remotion-hook-cine-title-card' || id.includes('title-card')) return 'title-card'
  if (id === 'remotion-hook-cine-reel-burn' || id.includes('reel-burn')) return 'reel-burn'
  if (id === 'remotion-hook-cine-hard-light' || id.includes('hard-light')) return 'hard-light'
  if (id === 'remotion-hook-cine-trailer-drop' || id.includes('trailer-drop')) return 'trailer-drop'
  if (id === 'remotion-hook-cine-margin-note' || id.includes('margin-note')) return 'margin-note'
  if (id === 'remotion-hook-kinetic-30' || id.includes('kinetic')) return 'kinetic'
  if (id === 'remotion-hook-typewriter-40' || id.includes('typewriter')) return 'typewriter'
  if (id === 'remotion-hook-big-bold-20' || id.includes('big-bold') || id.includes('motivational')) return 'big-bold'
  if (id === 'remotion-hook-stat-reveal-35' || id.includes('stat') || id.includes('self-improvement')) return 'stat-reveal'
  if (id === 'remotion-hook-question-burst-30' || id.includes('question') || id.includes('psychological')) return 'question-burst'
  if (id === 'remotion-hook-cinematic-quote-45' || id.includes('quote') || id.includes('cinematic')) return 'quote'
  if (id === 'remotion-hook-minimal-fade-25' || id.includes('minimal') || id.includes('fade')) return 'minimal'

  return 'minimal'
}

export function HookMicroThumb({
  hookId,
  active
}: {
  hookId?: string
  active?: boolean
}): JSX.Element {
  const type = getHookMicroType(hookId)

  return (
    <div
      className="hook-micro-box"
      data-hook-type={type}
      style={{
        width: 44,
        height: 28,
        borderRadius: 6,
        overflow: 'hidden',
        position: 'relative',
        background: '#111318',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border-2)',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        boxSizing: 'border-box'
      }}
    >
      <style>{`
        @keyframes hk-auto-pulse {
          0%, 100% { transform: scale(0.92) translateY(1px); opacity: 0.7; }
          50% { transform: scale(1.05) translateY(-1px); opacity: 1; filter: drop-shadow(0 0 4px var(--accent, #6366f1)); }
        }
        @keyframes hk-kinetic-bounce {
          0%, 100% { transform: scale(0.8) rotate(-4deg); opacity: 0.75; }
          35% { transform: scale(1.2) rotate(3deg); opacity: 1; }
          50% { transform: scale(0.95) rotate(-1deg); }
          65% { transform: scale(1.05) rotate(0deg); opacity: 1; }
        }
        @keyframes hk-typewriter-text {
          0%, 15% { width: 0px; }
          55%, 85% { width: 28px; }
          100% { width: 0px; }
        }
        @keyframes hk-typewriter-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes hk-title-rule {
          0%, 15% { transform: scaleX(0); opacity: 0; }
          45%, 80% { transform: scaleX(1); opacity: 0.85; }
          95%, 100% { transform: scaleX(0); opacity: 0; }
        }
        @keyframes hk-title-rise {
          0%, 15% { transform: translateY(3px); opacity: 0; letter-spacing: 0.5px; }
          45%, 80% { transform: translateY(0); opacity: 1; letter-spacing: 1.5px; }
          95%, 100% { transform: translateY(-3px); opacity: 0; letter-spacing: 2px; }
        }
        @keyframes hk-reel-leak {
          0% { transform: translateX(-140%) rotate(15deg); opacity: 0; }
          30%, 65% { opacity: 0.9; }
          100% { transform: translateX(140%) rotate(15deg); opacity: 0; }
        }
        @keyframes hk-reel-burn-text {
          0%, 20% { opacity: 0.35; filter: brightness(0.9); }
          45%, 75% { opacity: 1; filter: brightness(1.3); }
          100% { opacity: 0.35; filter: brightness(0.9); }
        }
        @keyframes hk-hard-light-sweep {
          0%, 15% { transform: translateX(-100%); opacity: 0.2; }
          50%, 80% { transform: translateX(0%); opacity: 1; }
          95%, 100% { transform: translateX(100%); opacity: 0.2; }
        }
        @keyframes hk-trailer-zoom {
          0%, 15% { transform: scale(0.5); opacity: 0; }
          30% { transform: scale(1.25); opacity: 1; }
          45%, 80% { transform: scale(1); opacity: 1; }
          95%, 100% { transform: scale(1.4); opacity: 0; }
        }
        @keyframes hk-trailer-flare {
          0%, 20% { transform: scaleX(0.05); opacity: 0; }
          30%, 55% { transform: scaleX(1.4); opacity: 1; }
          75%, 100% { transform: scaleX(0.05); opacity: 0; }
        }
        @keyframes hk-margin-slide {
          0%, 15% { transform: translateX(-8px); opacity: 0; }
          40%, 80% { transform: translateX(0); opacity: 1; }
          95%, 100% { transform: translateX(8px); opacity: 0; }
        }
        @keyframes hk-tc-blink {
          0%, 49% { color: #f59e0b; }
          50%, 100% { color: #ef4444; }
        }
        @keyframes hk-bold-slam {
          0% { transform: scale(2.2); opacity: 0; }
          25% { transform: scale(1); opacity: 1; }
          35% { transform: scale(1.08); }
          45%, 80% { transform: scale(1); opacity: 1; }
          95%, 100% { transform: scale(0.85); opacity: 0; }
        }
        @keyframes hk-stat-up {
          0%, 15% { transform: translateY(4px); opacity: 0; }
          40%, 80% { transform: translateY(0); opacity: 1; }
          95%, 100% { transform: translateY(-4px); opacity: 0; }
        }
        @keyframes hk-stat-meter {
          0%, 15% { width: 0%; }
          50%, 80% { width: 75%; }
          95%, 100% { width: 0%; }
        }
        @keyframes hk-quote-fade {
          0%, 15% { transform: translateY(2px) scale(0.92); opacity: 0; }
          45%, 80% { transform: translateY(0) scale(1); opacity: 1; }
          95%, 100% { transform: translateY(-2px) scale(1.04); opacity: 0; }
        }
        @keyframes hk-question-burst {
          0%, 15% { transform: scale(0.3) rotate(-20deg); opacity: 0; }
          35% { transform: scale(1.25) rotate(6deg); opacity: 1; }
          50%, 80% { transform: scale(1) rotate(0deg); opacity: 1; }
          95%, 100% { transform: scale(0.7) rotate(0deg); opacity: 0; }
        }
        @keyframes hk-minimal-fade {
          0%, 15% { opacity: 0; letter-spacing: -0.5px; }
          45%, 80% { opacity: 1; letter-spacing: 0.5px; }
          95%, 100% { opacity: 0; letter-spacing: 1px; }
        }
      `}</style>

      {/* Automatic: Pulsing rise / grade sync badge */}
      {type === 'auto' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, #1e1b4b 0%, #09090b 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              animation: 'hk-auto-pulse 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite'
            }}
          >
            <span style={{ fontSize: 7, color: 'var(--accent, #818cf8)' }}>✦</span>
            <span
              style={{
                fontSize: 7.5,
                fontWeight: 700,
                fontFamily: 'var(--font-mono, monospace)',
                color: '#fff',
                letterSpacing: 0.5
              }}
            >
              AUTO
            </span>
          </div>
        </div>
      )}

      {/* Kinetic: Pop / bounce scale */}
      {type === 'kinetic' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, #14280d 0%, #090e06 100%)',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <span
            style={{
              fontSize: 8,
              fontWeight: 900,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#b8ff35',
              letterSpacing: 0.5,
              animation: 'hk-kinetic-bounce 2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite'
            }}
          >
            POP!
          </span>
        </div>
      )}

      {/* Typewriter: Character reveal + blinking cursor */}
      {type === 'typewriter' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#0a0f0d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                animation: 'hk-typewriter-text 2.6s steps(6, end) infinite'
              }}
            >
              <span
                style={{
                  fontSize: 7.5,
                  fontFamily: 'var(--font-mono, monospace)',
                  color: '#34d399',
                  fontWeight: 700
                }}
              >
                TYPE
              </span>
            </div>
            <span
              style={{
                fontSize: 8,
                fontFamily: 'var(--font-mono, monospace)',
                color: '#34d399',
                fontWeight: 700,
                animation: 'hk-typewriter-blink 0.8s infinite'
              }}
            >
              ▌
            </span>
          </div>
        </div>
      )}

      {/* Title Card: Hairline rule expanding + serif rise */}
      {type === 'title-card' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#060709',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2
          }}
        >
          <span
            style={{
              fontSize: 6.5,
              fontFamily: 'Cinzel, Georgia, serif',
              fontWeight: 600,
              color: '#f3e8c9',
              textTransform: 'uppercase',
              animation: 'hk-title-rise 3.2s cubic-bezier(0.16, 1, 0.3, 1) infinite'
            }}
          >
            TITLE
          </span>
          <div
            style={{
              width: 24,
              height: 1,
              background: 'linear-gradient(90deg, transparent, #c5a868, transparent)',
              animation: 'hk-title-rule 3.2s cubic-bezier(0.16, 1, 0.3, 1) infinite'
            }}
          />
        </div>
      )}

      {/* Reel Burn: Horizontal light leak sweep */}
      {type === 'reel-burn' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, #1c130b, #0c0805)',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden'
          }}
        >
          <span
            style={{
              fontSize: 7.5,
              fontWeight: 800,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#f59e0b',
              letterSpacing: 0.5,
              animation: 'hk-reel-burn-text 2.6s ease-in-out infinite'
            }}
          >
            BURN
          </span>
          <div
            style={{
              position: 'absolute',
              top: -10,
              bottom: -10,
              width: 20,
              background: 'linear-gradient(90deg, transparent, rgba(251, 146, 60, 0.8), rgba(254, 240, 138, 0.9), transparent)',
              filter: 'blur(2px)',
              pointerEvents: 'none',
              animation: 'hk-reel-leak 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite'
            }}
          />
        </div>
      )}

      {/* Hard Light: Noir blinds shadow sweep */}
      {type === 'hard-light' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#0b0c10',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'repeating-linear-gradient(-35deg, rgba(0,0,0,0.85) 0px, rgba(0,0,0,0.85) 3px, transparent 3px, transparent 6px)',
              pointerEvents: 'none',
              zIndex: 1,
              animation: 'hk-hard-light-sweep 3s ease-in-out infinite'
            }}
          />
          <span
            style={{
              fontSize: 8,
              fontWeight: 800,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#f8fafc',
              letterSpacing: 1
            }}
          >
            NOIR
          </span>
        </div>
      )}

      {/* Trailer Drop: Anamorphic flare flash & punch zoom */}
      {type === 'trailer-drop' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#040711',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden'
          }}
        >
          <span
            style={{
              fontSize: 8,
              fontWeight: 900,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#38bdf8',
              letterSpacing: 0.5,
              animation: 'hk-trailer-zoom 2.4s cubic-bezier(0.2, 0.8, 0.2, 1) infinite'
            }}
          >
            DROP
          </span>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: 2,
              marginTop: -1,
              background: 'linear-gradient(90deg, transparent, #38bdf8, #ffffff, #38bdf8, transparent)',
              filter: 'blur(0.5px)',
              pointerEvents: 'none',
              animation: 'hk-trailer-flare 2.4s cubic-bezier(0.2, 0.8, 0.2, 1) infinite'
            }}
          />
        </div>
      )}

      {/* Margin Note: Running timecode stamp + slide */}
      {type === 'margin-note' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#0d1117',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 4,
            borderLeft: '2px solid #f59e0b'
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              animation: 'hk-margin-slide 2.8s cubic-bezier(0.16, 1, 0.3, 1) infinite'
            }}
          >
            <span
              style={{
                fontSize: 6,
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 700,
                animation: 'hk-tc-blink 1s steps(2, start) infinite'
              }}
            >
              00:12:44
            </span>
            <span
              style={{
                fontSize: 6.5,
                fontFamily: 'var(--font-sans, system-ui)',
                color: '#e2e8f0',
                fontWeight: 600
              }}
            >
              NOTE
            </span>
          </div>
        </div>
      )}

      {/* Big Bold: Kinetic slamming typography */}
      {type === 'big-bold' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, #241407 0%, #0c0803 100%)',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 900,
              fontFamily: 'Anton, var(--font-sans, impact)',
              color: '#ffd43b',
              letterSpacing: 0.5,
              animation: 'hk-bold-slam 2.2s cubic-bezier(0.2, 0.9, 0.3, 1.2) infinite'
            }}
          >
            BOLD
          </span>
        </div>
      )}

      {/* Stat Reveal: Number count + meter */}
      {type === 'stat-reveal' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#081512',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2
          }}
        >
          <span
            style={{
              fontSize: 7.5,
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              color: '#48e5c2',
              animation: 'hk-stat-up 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite'
            }}
          >
            99%
          </span>
          <div
            style={{
              width: 22,
              height: 2,
              background: 'rgba(72, 229, 194, 0.2)',
              borderRadius: 1,
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                height: '100%',
                background: '#48e5c2',
                animation: 'hk-stat-meter 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite'
              }}
            />
          </div>
        </div>
      )}

      {/* Quote: Quote mark drift + serif text */}
      {type === 'quote' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, #1b170e 0%, #0a0805 100%)',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <span
            style={{
              fontSize: 7.5,
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic',
              fontWeight: 600,
              color: '#ebcb83',
              animation: 'hk-quote-fade 2.8s ease-in-out infinite'
            }}
          >
            “QUOTE”
          </span>
        </div>
      )}

      {/* Question Burst: Expanding ? and ripple ring */}
      {type === 'question-burst' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, #1e1329 0%, #0a0610 100%)',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 900,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#c084fc',
              animation: 'hk-question-burst 2.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite'
            }}
          >
            ?
          </span>
        </div>
      )}

      {/* Minimal Fade: Clean typography breathing fade */}
      {type === 'minimal' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#0f141a',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <span
            style={{
              fontSize: 7,
              fontWeight: 600,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#94a3b8',
              textTransform: 'uppercase',
              animation: 'hk-minimal-fade 2.4s ease-in-out infinite'
            }}
          >
            FADE
          </span>
        </div>
      )}
    </div>
  )
}
