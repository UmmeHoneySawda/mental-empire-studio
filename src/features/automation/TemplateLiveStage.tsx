import { useState, useEffect, useMemo, type CSSProperties, type JSX } from 'react'
import type { VisualTemplate } from '@shared/types'
import { getMockupBackdrop, CINEMATIC_PORTRAIT_MOCKUP } from './mockupBackdrops'
import { resolveTemplatePreview } from './templatePreviewModel'
import { gradeFilter, gradeTintLayer, gradeVignetteLayer, gradePreviewCaveat } from '../video-studio/editor/gradePreview'
import { getHookMicroType, type HookMicroType } from './HookMicroThumb'

export type PreviewMode = 'Composite' | 'Hook' | 'Transition'

interface CaptionTypography {
  fontFamily: string
  activeTreatment: string
  placement: 'lower' | 'center'
  uppercase: boolean
  textColor: string
  activeColor: string
  importantColor: string
  fontWeight: number
}

function resolveCaptionTypography(caption: { isCinematic: boolean; definition: unknown; templateId: string }): CaptionTypography {
  const def = caption.definition as Record<string, any> | undefined
  let fontFamily = 'Anton, sans-serif'
  let activeTreatment = 'punch'
  let placement: 'lower' | 'center' = 'lower'
  let uppercase = true
  let textColor = '#FFFFFF'
  let activeColor = '#FFE44D'
  let importantColor = '#FF6B4A'
  let fontWeight = 700

  if (caption.isCinematic) {
    textColor = (def?.textColor as string) || '#ECE5D8'
    activeColor = (def?.accentColor as string) || '#C9553C'
    importantColor = (def?.accentColor as string) || '#C9553C'

    if (caption.templateId === 'remotion-caption-cine-word-pop') {
      fontFamily = 'Anton, Oswald, sans-serif'
      activeTreatment = 'punch'
      placement = 'center'
      uppercase = true
      fontWeight = 800
    } else if (caption.templateId === 'remotion-caption-cine-keyword-stack') {
      fontFamily = 'Cinzel, Georgia, serif'
      activeTreatment = 'underline'
      placement = 'lower'
      uppercase = true
      fontWeight = 700
    } else if (caption.templateId === 'remotion-caption-cine-scrim-roll') {
      fontFamily = 'JetBrains Mono, monospace'
      activeTreatment = 'box'
      placement = 'lower'
      uppercase = false
      fontWeight = 500
    } else if (caption.templateId === 'remotion-caption-cine-line-build') {
      fontFamily = 'Space Grotesk, sans-serif'
      activeTreatment = 'highlight'
      placement = 'lower'
      uppercase = false
      fontWeight = 700
    } else if (caption.templateId === 'remotion-caption-cine-held') {
      fontFamily = 'Cinzel, Georgia, serif'
      activeTreatment = 'underline'
      placement = 'center'
      uppercase = true
      fontWeight = 600
    }
  } else if (def) {
    fontFamily = def.fontFamily ? `${def.fontFamily}, sans-serif` : 'Anton, sans-serif'
    activeTreatment = def.activeTreatment || 'punch'
    placement = def.placement || 'lower'
    uppercase = def.uppercase ?? true
    textColor = def.textColor || '#FFFFFF'
    activeColor = def.activeColor || '#FFE44D'
    importantColor = def.importantColor || '#FF6B4A'
    fontWeight = def.fontWeight || 700
  }

  return {
    fontFamily,
    activeTreatment,
    placement,
    uppercase,
    textColor,
    activeColor,
    importantColor,
    fontWeight,
  }
}

function getTransitionStyle(presetId: string): CSSProperties {
  const dur = presetId === 'fade-quick' ? '1.8s' : presetId === 'fade-slow' ? '3.2s' : '2.4s'
  const timing = `${dur} cubic-bezier(0.4, 0, 0.2, 1) infinite`

  if (presetId === 'cut') return {}
  if (presetId.includes('wipe') || presetId === 'wipe-left') return { animation: `tls-tr-wipe-l ${timing}` }
  if (presetId === 'wipe-right') return { animation: `tls-tr-wipe-r ${timing}` }
  if (presetId === 'slide-left' || presetId.includes('slide')) return { animation: `tls-tr-slide-l ${timing}` }
  if (presetId === 'slide-right') return { animation: `tls-tr-slide-r ${timing}` }
  if (presetId === 'slide-up') return { animation: `tls-tr-slide-u ${timing}` }
  if (presetId === 'slide-down') return { animation: `tls-tr-slide-d ${timing}` }
  if (presetId === 'zoom') return { animation: `tls-tr-zoom ${timing}` }
  if (presetId === 'blur') return { animation: `tls-tr-blur ${timing}` }
  if (presetId === 'dip-to-black') return { animation: `tls-tr-dip-b ${timing}` }
  return { animation: `tls-tr-fade ${timing}` }
}

export function TemplateLiveStage({ template }: { template: VisualTemplate }): JSX.Element {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('Composite')

  const backdrop = useMemo(
    () => getMockupBackdrop(template.mode, template.imagePaths),
    [template.mode, template.imagePaths]
  )

  const [activeImageUri, setActiveImageUri] = useState(backdrop.uri)
  const [hasImageError, setHasImageError] = useState(false)

  useEffect(() => {
    setActiveImageUri(backdrop.uri)
    setHasImageError(false)
  }, [backdrop.uri])

  const { grading, caption, aspect, caveat } = useMemo(
    () => resolveTemplatePreview(template),
    [template]
  )

  const filter = useMemo(() => gradeFilter(grading), [grading])
  const tint = useMemo(() => gradeTintLayer(grading), [grading])
  const vignette = useMemo(() => gradeVignetteLayer(grading), [grading])
  const activeCaveat = useMemo(() => caveat || gradePreviewCaveat(grading), [caveat, grading])

  const trueAspect = aspect.replace(':', ' / ')
  const hookType = getHookMicroType(template.hookTemplateId)
  const typography = useMemo(() => resolveCaptionTypography(caption), [caption])
  const hookLineText = template.hookLine?.trim() || 'First line of your video'

  return (
    <div
      className="template-live-stage"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        /* Hook Keyframe Animations */
        @keyframes tls-hk-bounce {
          0%, 100% { transform: scale(0.9) rotate(-3deg); opacity: 0.85; }
          35% { transform: scale(1.18) rotate(2deg); opacity: 1; }
          50% { transform: scale(0.96) rotate(-1deg); }
          65% { transform: scale(1.06) rotate(0deg); opacity: 1; }
        }
        @keyframes tls-hk-typewriter-text {
          0%, 15% { width: 0%; }
          55%, 85% { width: 100%; }
          100% { width: 0%; }
        }
        @keyframes tls-hk-typewriter-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes tls-hk-title-rule {
          0%, 15% { transform: scaleX(0); opacity: 0; }
          45%, 80% { transform: scaleX(1); opacity: 0.9; }
          95%, 100% { transform: scaleX(0); opacity: 0; }
        }
        @keyframes tls-hk-title-rise {
          0%, 15% { transform: translateY(6px); opacity: 0; letter-spacing: 1px; }
          45%, 80% { transform: translateY(0); opacity: 1; letter-spacing: 2px; }
          95%, 100% { transform: translateY(-4px); opacity: 0; letter-spacing: 2.5px; }
        }
        @keyframes tls-hk-reel-leak {
          0% { transform: translateX(-150%) rotate(15deg); opacity: 0; }
          30%, 65% { opacity: 0.95; }
          100% { transform: translateX(150%) rotate(15deg); opacity: 0; }
        }
        @keyframes tls-hk-hard-light-sweep {
          0%, 15% { transform: translateX(-100%); opacity: 0.2; }
          50%, 80% { transform: translateX(0%); opacity: 0.9; }
          95%, 100% { transform: translateX(100%); opacity: 0.2; }
        }
        @keyframes tls-hk-trailer-zoom {
          0%, 15% { transform: scale(0.65); opacity: 0; }
          30% { transform: scale(1.2); opacity: 1; }
          45%, 80% { transform: scale(1); opacity: 1; }
          95%, 100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes tls-hk-trailer-flare {
          0%, 20% { transform: scaleX(0.05); opacity: 0; }
          30%, 55% { transform: scaleX(1.4); opacity: 1; }
          75%, 100% { transform: scaleX(0.05); opacity: 0; }
        }
        @keyframes tls-hk-bold-slam {
          0% { transform: scale(2.2); opacity: 0; }
          25% { transform: scale(1); opacity: 1; }
          35% { transform: scale(1.08); }
          45%, 80% { transform: scale(1); opacity: 1; }
          95%, 100% { transform: scale(0.85); opacity: 0; }
        }
        @keyframes tls-hk-slide {
          0%, 15% { transform: translateX(-14px); opacity: 0; }
          40%, 80% { transform: translateX(0); opacity: 1; }
          95%, 100% { transform: translateX(14px); opacity: 0; }
        }
        @keyframes tls-hk-fade {
          0%, 15% { opacity: 0; transform: translateY(4px); }
          45%, 80% { opacity: 1; transform: translateY(0); }
          95%, 100% { opacity: 0; transform: translateY(-4px); }
        }
        @keyframes tls-hk-stat-meter {
          0%, 15% { width: 0%; }
          50%, 80% { width: 85%; }
          95%, 100% { width: 0%; }
        }

        /* Transition Keyframe Animations */
        @keyframes tls-tr-fade { 0%, 15% { opacity: 0; } 50%, 85% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes tls-tr-slide-l { 0%, 15% { transform: translateX(100%); } 50%, 85% { transform: translateX(0%); } 100% { transform: translateX(100%); } }
        @keyframes tls-tr-slide-r { 0%, 15% { transform: translateX(-100%); } 50%, 85% { transform: translateX(0%); } 100% { transform: translateX(-100%); } }
        @keyframes tls-tr-slide-u { 0%, 15% { transform: translateY(100%); } 50%, 85% { transform: translateY(0%); } 100% { transform: translateY(100%); } }
        @keyframes tls-tr-slide-d { 0%, 15% { transform: translateY(-100%); } 50%, 85% { transform: translateY(0%); } 100% { transform: translateY(-100%); } }
        @keyframes tls-tr-wipe-l { 0%, 15% { clip-path: inset(0 0 0 100%); } 50%, 85% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 0 0 100%); } }
        @keyframes tls-tr-wipe-r { 0%, 15% { clip-path: inset(0 100% 0 0); } 50%, 85% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 100% 0 0); } }
        @keyframes tls-tr-zoom { 0%, 15% { transform: scale(0.4); opacity: 0; } 50%, 85% { transform: scale(1); opacity: 1; } 100% { transform: scale(0.4); opacity: 0; } }
        @keyframes tls-tr-blur { 0%, 15% { filter: blur(10px); opacity: 0; } 50%, 85% { filter: blur(0px); opacity: 1; } 100% { filter: blur(10px); opacity: 0; } }
        @keyframes tls-tr-dip-b { 0%, 45% { opacity: 0; } 60%, 85% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes tls-tr-dip-black { 0%, 25% { opacity: 0; } 45%, 55% { opacity: 1; } 75%, 100% { opacity: 0; } }
      `}</style>

      {/* Preview Controls Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          padding: '4px 2px',
        }}
      >
        {/* Mode Toggle Pills */}
        <div
          role="tablist"
          aria-label="Preview mode selection"
          style={{
            display: 'inline-flex',
            padding: 3,
            borderRadius: 999,
            background: 'var(--bg-inset, #13171f)',
            border: '1px solid var(--border, #262c38)',
            gap: 2,
          }}
        >
          {(['Composite', 'Hook', 'Transition'] as const).map((mode) => {
            const active = previewMode === mode
            return (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPreviewMode(mode)}
                style={{
                  border: 'none',
                  background: active ? 'var(--accent, #6366f1)' : 'transparent',
                  color: active ? '#ffffff' : 'var(--text-muted, #94a3b8)',
                  padding: '4px 12px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans, system-ui)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {mode}
              </button>
            )
          })}
        </div>

        {/* Status Tag / Backdrop & Caveats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            data-testid="stage-backdrop-badge"
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 6,
              background: (backdrop.isMockup || hasImageError) ? 'rgba(99, 102, 241, 0.12)' : 'rgba(34, 197, 94, 0.12)',
              color: (backdrop.isMockup || hasImageError) ? 'var(--accent, #818cf8)' : '#4ade80',
              border: `1px solid ${(backdrop.isMockup || hasImageError) ? 'rgba(99, 102, 241, 0.25)' : 'rgba(34, 197, 94, 0.25)'}`,
            }}
          >
            {hasImageError ? 'Sample fallback' : backdrop.label}
          </span>
          {activeCaveat && (
            <span
              data-testid="stage-caveat-badge"
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 9,
                color: 'var(--text-faint, #64748b)',
              }}
            >
              {activeCaveat}
            </span>
          )}
        </div>
      </div>

      {/* Main Live Stage: Letterbox Outer + True-Aspect Inner Frame */}
      <div
        role="region"
        aria-label="Template live preview"
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--bg-inset, #0b0d13)',
          border: '1px solid var(--border, #262c38)',
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Inner True-Aspect Frame with Color Grade */}
        <div
          data-testid="stage-inner-frame"
          data-aspect-ratio={aspect}
          style={{
            aspectRatio: trueAspect,
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            position: 'relative',
            overflow: 'hidden',
            background: '#090a0f',
            justifySelf: 'center',
            alignSelf: 'center',
          }}
        >
          {/* Graded Media Layer: Wraps backdrop, tint, and vignette with CSS filter */}
          <div
            data-testid="stage-media-layer"
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              ...(filter ? { filter } : {}),
            }}
          >
            {/* Layer 1: Backdrop Image */}
            <img
              data-testid="stage-backdrop-img"
              src={hasImageError ? CINEMATIC_PORTRAIT_MOCKUP : activeImageUri}
              alt="Template live backdrop"
              onError={() => setHasImageError(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
                position: 'absolute',
                inset: 0,
              }}
            />

            {/* Layer 2: Color Grading Overlays */}
            {tint && (
              <div
                data-testid="grade-tint"
                aria-hidden
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2, ...tint }}
              />
            )}
            {vignette && (
              <div
                data-testid="grade-vignette"
                aria-hidden
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3, ...vignette }}
              />
            )}
          </div>

          {/* Layer 3: Composite Mode Live Captions */}
          {previewMode === 'Composite' && (
            <CompositeCaptionOverlay typography={typography} />
          )}

          {/* Layer 4: Hook Mode Typography Entrance */}
          {previewMode === 'Hook' && (
            <HookEntranceOverlay hookType={hookType} hookLineText={hookLineText} />
          )}

          {/* Layer 5: Transition Mode Animated Sweep */}
          {previewMode === 'Transition' && (
            <TransitionSweepOverlay presetId={template.transition || 'fade'} />
          )}
        </div>
      </div>
    </div>
  )
}

function CompositeCaptionOverlay({ typography }: { typography: CaptionTypography }): JSX.Element {
  const words = typography.uppercase
    ? ['STILL', 'PAYING', 'RENT', 'IN', 'YOUR', 'HEAD']
    : ['Still', 'paying', 'rent', 'in', 'your', 'head']

  const activeIndex = 2
  const importantIndex = 5

  const isCenter = typography.placement === 'center'

  return (
    <div
      data-testid="stage-caption-layer"
      data-placement={typography.placement}
      data-font-family={typography.fontFamily}
      style={{
        position: 'absolute',
        left: '50%',
        transform: isCenter ? 'translate(-50%, -50%)' : 'translateX(-50%)',
        ...(isCenter ? { top: '50%' } : { bottom: '14%' }),
        width: '90%',
        maxWidth: 380,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '4px 8px',
        textAlign: 'center',
        zIndex: 10,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      {words.map((word, idx) => {
        if (idx === activeIndex) {
          return (
            <ActiveWord
              key={idx}
              word={word}
              treatment={typography.activeTreatment}
              fontFamily={typography.fontFamily}
              activeColor={typography.activeColor}
              textColor={typography.textColor}
              fontWeight={typography.fontWeight}
            />
          )
        }

        const isImp = idx === importantIndex
        const color = isImp ? typography.importantColor : typography.textColor

        return (
          <span
            key={idx}
            style={{
              fontFamily: typography.fontFamily,
              fontWeight: typography.fontWeight,
              fontSize: 'clamp(14px, 3.8vw, 22px)',
              color,
              lineHeight: 1.2,
              textShadow: '0 2px 8px rgba(0,0,0,0.85), 0 0 2px #000',
              display: 'inline-block',
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}

function ActiveWord({
  word,
  treatment,
  fontFamily,
  activeColor,
  textColor,
  fontWeight,
}: {
  word: string
  treatment: string
  fontFamily: string
  activeColor: string
  textColor: string
  fontWeight: number
}): JSX.Element {
  const baseStyle: CSSProperties = {
    fontFamily,
    fontWeight,
    fontSize: 'clamp(14px, 3.8vw, 22px)',
    lineHeight: 1.2,
    display: 'inline-block',
  }

  if (treatment === 'pill') {
    return (
      <span
        data-testid="caption-active-word"
        data-active-treatment="pill"
        style={{
          ...baseStyle,
          background: activeColor,
          color: '#090a0f',
          padding: '2px 10px',
          borderRadius: 999,
          fontWeight: 800,
          transform: 'scale(1.06)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
        }}
      >
        {word}
      </span>
    )
  }

  if (treatment === 'highlight') {
    return (
      <span
        data-testid="caption-active-word"
        data-active-treatment="highlight"
        style={{
          ...baseStyle,
          background: activeColor,
          color: '#090a0f',
          padding: '2px 8px',
          borderRadius: 4,
          fontWeight: 800,
          transform: 'scale(1.05)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
      >
        {word}
      </span>
    )
  }

  if (treatment === 'underline') {
    return (
      <span
        data-testid="caption-active-word"
        data-active-treatment="underline"
        style={{
          ...baseStyle,
          color: activeColor,
          borderBottom: `3px solid ${activeColor}`,
          paddingBottom: 2,
          textShadow: '0 2px 8px rgba(0,0,0,0.85)',
        }}
      >
        {word}
      </span>
    )
  }

  if (treatment === 'neon' || treatment === 'glow') {
    return (
      <span
        data-testid="caption-active-word"
        data-active-treatment="neon"
        style={{
          ...baseStyle,
          color: activeColor,
          textShadow: `0 0 8px ${activeColor}, 0 0 16px ${activeColor}, 0 0 24px ${activeColor}, 0 2px 8px rgba(0,0,0,0.9)`,
        }}
      >
        {word}
      </span>
    )
  }

  if (treatment === 'box') {
    return (
      <span
        data-testid="caption-active-word"
        data-active-treatment="box"
        style={{
          ...baseStyle,
          color: activeColor,
          border: `2px solid ${activeColor}`,
          background: 'rgba(0, 0, 0, 0.65)',
          padding: '2px 8px',
          borderRadius: 6,
        }}
      >
        {word}
      </span>
    )
  }

  if (treatment === 'punch' || treatment === 'burst' || treatment === 'bounce') {
    return (
      <span
        data-testid="caption-active-word"
        data-active-treatment="punch"
        style={{
          ...baseStyle,
          color: activeColor,
          transform: 'scale(1.18)',
          fontWeight: 900,
          textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 0 4px #000',
        }}
      >
        {word}
      </span>
    )
  }

  return (
    <span
      data-testid="caption-active-word"
      data-active-treatment={treatment}
      style={{
        ...baseStyle,
        color: activeColor || textColor,
        fontWeight: 800,
        textShadow: '0 2px 8px rgba(0,0,0,0.85)',
      }}
    >
      {word}
    </span>
  )
}

function HookEntranceOverlay({
  hookType,
  hookLineText,
}: {
  hookType: HookMicroType
  hookLineText: string
}): JSX.Element {
  return (
    <div
      data-testid="stage-hook-overlay"
      data-hook-type={hookType}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        zIndex: 10,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Title Card: Hairline rule + serif rise */}
      {hookType === 'title-card' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 8,
            maxWidth: '85%',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(8px, 2vw, 12px)',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              color: 'var(--accent, #c5a868)',
              letterSpacing: 3,
              textTransform: 'uppercase',
            }}
          >
            INTRODUCTION
          </span>
          <span
            style={{
              fontSize: 'clamp(16px, 4.5vw, 28px)',
              fontFamily: 'Cinzel, Georgia, serif',
              fontWeight: 700,
              color: '#f8f5ea',
              textTransform: 'uppercase',
              lineHeight: 1.25,
              textShadow: '0 4px 14px rgba(0,0,0,0.9)',
              animation: 'tls-hk-title-rise 3.4s cubic-bezier(0.16, 1, 0.3, 1) infinite',
            }}
          >
            {hookLineText}
          </span>
          <div
            style={{
              width: '80%',
              maxWidth: 240,
              height: 2,
              background: 'linear-gradient(90deg, transparent, #c5a868, transparent)',
              animation: 'tls-hk-title-rule 3.4s cubic-bezier(0.16, 1, 0.3, 1) infinite',
            }}
          />
        </div>
      )}

      {/* Reel Burn: Light leak horizontal sweep */}
      {hookType === 'reel-burn' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(18px, 5vw, 30px)',
              fontWeight: 900,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#fbbf24',
              textAlign: 'center',
              textTransform: 'uppercase',
              textShadow: '0 4px 16px rgba(0,0,0,0.95), 0 0 20px rgba(245, 158, 11, 0.6)',
              zIndex: 2,
            }}
          >
            {hookLineText}
          </span>
          <div
            style={{
              position: 'absolute',
              top: -40,
              bottom: -40,
              width: 140,
              background: 'linear-gradient(90deg, transparent, rgba(251, 146, 60, 0.85), rgba(254, 240, 138, 0.95), transparent)',
              filter: 'blur(8px)',
              pointerEvents: 'none',
              zIndex: 3,
              animation: 'tls-hk-reel-leak 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite',
            }}
          />
        </div>
      )}

      {/* Hard Light: Noir blinds shadow sweep */}
      {hookType === 'hard-light' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'repeating-linear-gradient(-35deg, rgba(0,0,0,0.85) 0px, rgba(0,0,0,0.85) 8px, transparent 8px, transparent 16px)',
              pointerEvents: 'none',
              zIndex: 3,
              animation: 'tls-hk-hard-light-sweep 3.2s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontSize: 'clamp(18px, 4.8vw, 30px)',
              fontWeight: 900,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#f8fafc',
              textAlign: 'center',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              textShadow: '0 4px 16px rgba(0,0,0,0.9)',
              zIndex: 2,
            }}
          >
            {hookLineText}
          </span>
        </div>
      )}

      {/* Trailer Drop: Anamorphic flare + punch zoom */}
      {hookType === 'trailer-drop' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(20px, 5.2vw, 34px)',
              fontWeight: 900,
              fontFamily: 'var(--font-sans, system-ui)',
              color: '#38bdf8',
              textAlign: 'center',
              textTransform: 'uppercase',
              textShadow: '0 0 20px rgba(56, 189, 248, 0.7), 0 4px 16px rgba(0,0,0,0.95)',
              zIndex: 2,
              animation: 'tls-hk-trailer-zoom 2.6s cubic-bezier(0.2, 0.8, 0.2, 1) infinite',
            }}
          >
            {hookLineText}
          </span>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: 4,
              marginTop: -2,
              background: 'linear-gradient(90deg, transparent, #38bdf8, #ffffff, #38bdf8, transparent)',
              filter: 'blur(1px)',
              zIndex: 3,
              pointerEvents: 'none',
              animation: 'tls-hk-trailer-flare 2.6s cubic-bezier(0.2, 0.8, 0.2, 1) infinite',
            }}
          />
        </div>
      )}

      {/* Kinetic / Big Bold: Kinetic bounce & slam */}
      {(hookType === 'kinetic' || hookType === 'big-bold') && (
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            maxWidth: '90%',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(20px, 5.6vw, 36px)',
              fontWeight: 900,
              fontFamily: 'Anton, var(--font-sans, impact)',
              color: '#ffd43b',
              textTransform: 'uppercase',
              lineHeight: 1.1,
              textShadow: '0 4px 16px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8)',
              animation: hookType === 'kinetic'
                ? 'tls-hk-bounce 2.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite'
                : 'tls-hk-bold-slam 2.4s cubic-bezier(0.2, 0.9, 0.3, 1.2) infinite',
            }}
          >
            {hookLineText}
          </span>
        </div>
      )}

      {/* Typewriter: Text typing + blinking cursor */}
      {hookType === 'typewriter' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            maxWidth: '90%',
          }}
        >
          <div
            style={{
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              animation: 'tls-hk-typewriter-text 3s steps(16, end) infinite',
            }}
          >
            <span
              style={{
                fontSize: 'clamp(14px, 3.8vw, 24px)',
                fontFamily: 'JetBrains Mono, var(--font-mono, monospace)',
                fontWeight: 800,
                color: '#34d399',
                textShadow: '0 2px 10px rgba(0,0,0,0.9)',
              }}
            >
              {hookLineText}
            </span>
          </div>
          <span
            style={{
              fontSize: 'clamp(16px, 4vw, 26px)',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              color: '#34d399',
              marginLeft: 2,
              animation: 'tls-hk-typewriter-blink 0.8s infinite',
            }}
          >
            ▌
          </span>
        </div>
      )}

      {/* Margin Note: Timecode + note slide */}
      {hookType === 'margin-note' && (
        <div
          style={{
            position: 'absolute',
            left: 20,
            top: '40%',
            borderLeft: '4px solid #f59e0b',
            paddingLeft: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            animation: 'tls-hk-slide 2.8s cubic-bezier(0.16, 1, 0.3, 1) infinite',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(9px, 2.2vw, 13px)',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              color: '#f59e0b',
            }}
          >
            00:12:44 [SCENE 01]
          </span>
          <span
            style={{
              fontSize: 'clamp(14px, 3.6vw, 22px)',
              fontFamily: 'var(--font-sans, system-ui)',
              fontWeight: 700,
              color: '#f1f5f9',
              textShadow: '0 2px 8px rgba(0,0,0,0.9)',
            }}
          >
            {hookLineText}
          </span>
        </div>
      )}

      {/* Stat Reveal: Number count + meter */}
      {hookType === 'stat-reveal' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            maxWidth: '85%',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(16px, 4.5vw, 28px)',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              color: '#48e5c2',
              textAlign: 'center',
              textShadow: '0 4px 14px rgba(0,0,0,0.9)',
            }}
          >
            {hookLineText}
          </span>
          <div
            style={{
              width: 140,
              height: 4,
              background: 'rgba(72, 229, 194, 0.2)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: '#48e5c2',
                animation: 'tls-hk-stat-meter 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite',
              }}
            />
          </div>
        </div>
      )}

      {/* Quote: Serif quote */}
      {hookType === 'quote' && (
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            maxWidth: '85%',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(16px, 4.2vw, 26px)',
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic',
              fontWeight: 600,
              color: '#ebcb83',
              lineHeight: 1.3,
              textShadow: '0 4px 12px rgba(0,0,0,0.9)',
              animation: 'tls-hk-fade 3s ease-in-out infinite',
            }}
          >
            “{hookLineText}”
          </span>
        </div>
      )}

      {/* Question Burst / Auto / Minimal */}
      {hookType !== 'title-card' &&
        hookType !== 'reel-burn' &&
        hookType !== 'hard-light' &&
        hookType !== 'trailer-drop' &&
        hookType !== 'kinetic' &&
        hookType !== 'big-bold' &&
        hookType !== 'typewriter' &&
        hookType !== 'margin-note' &&
        hookType !== 'stat-reveal' &&
        hookType !== 'quote' && (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              textAlign: 'center',
              maxWidth: '85%',
            }}
          >
            <span
              style={{
                fontSize: 'clamp(16px, 4.5vw, 28px)',
                fontFamily: 'var(--font-sans, system-ui)',
                fontWeight: 700,
                color: '#f8fafc',
                textShadow: '0 4px 14px rgba(0,0,0,0.9)',
                animation: 'tls-hk-fade 2.6s ease-in-out infinite',
              }}
            >
              {hookLineText}
            </span>
          </div>
        )}
    </div>
  )
}

function TransitionSweepOverlay({ presetId }: { presetId: string }): JSX.Element {
  const animStyle = getTransitionStyle(presetId)
  const isCut = presetId === 'cut'
  const isDipToBlack = presetId === 'dip-to-black'

  return (
    <div
      data-testid="stage-transition-overlay"
      data-transition-preset={presetId}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Frame B: The incoming next scene */}
      {isCut ? (
        <div
          data-testid="stage-transition-incoming"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '50%',
            background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
            display: 'grid',
            placeItems: 'center',
            borderLeft: '2px dashed rgba(255,255,255,0.6)',
            boxShadow: '0 0 20px rgba(0,0,0,0.5)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              fontSize: 14,
              color: '#ffffff',
              letterSpacing: 1,
            }}
          >
            NEXT SCENE
          </span>
        </div>
      ) : (
        <div
          data-testid="stage-transition-incoming"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
            display: 'grid',
            placeItems: 'center',
            ...animStyle,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              fontSize: 16,
              color: '#ffffff',
              letterSpacing: 1.5,
              textShadow: '0 2px 10px rgba(0,0,0,0.6)',
            }}
          >
            NEXT SCENE
          </span>
        </div>
      )}

      {/* Dip to black full-screen flash */}
      {isDipToBlack && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: '#000000',
            zIndex: 12,
            animation: 'tls-tr-dip-black 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
          }}
        />
      )}
    </div>
  )
}
