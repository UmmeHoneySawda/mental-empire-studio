import React from 'react'
import { AbsoluteFill } from 'remotion'
import {
  NEW_TEMPLATE_ACCENT,
  NEW_TEMPLATE_BONE,
  type JsonObject,
} from '../../../shared/video-engine'

/* The Cinematic Hooks and Captions film kit.
 *
 * A port of the delivered theme.tsx and film.tsx (see the working copy under
 * scratch/cinematic-hooks-and-captions/). The numbers are the delivered numbers: three motion
 * helpers and no fourth easing, every value a pure function of t in seconds, so frame N renders
 * identically on every machine and the scrubber does not lie.
 *
 * Two deliberate departures from the delivered source, both because a template here composites
 * over a timeline rather than standing alone:
 *   · FilmFrame takes `background`. Footage-backed templates pass 'transparent' so the clip
 *     underneath shows through, which is what a hook on an overlay lane means in this app. The
 *     delivered striped FootagePlate placeholder is dropped — it exists to make a standalone
 *     catalog readable and has no place in a product render.
 *   · FilmFrame takes `vignette` and `dust` flags, so the caption layer can carry grain without
 *     also stamping a vignette across the user's whole video.
 *
 * BONE and ACCENT are re-exports of the shared table's constants rather than fresh literals: a
 * second copy of a colour is a second source of truth, and the whole point of
 * shared/video-engine/new-templates.ts is that there is only one. BLACK and DIM stay as delivered
 * literals because neither exists in that table. */

/* ---- type. Roles are fixed: Cinzel = statement, Oswald = impact, Courier Prime = apparatus.
 *      The fallbacks are the faces this app self-hosts; the delivered 'Helvetica Neue' and
 *      'Courier New' are not available under the renderer CSP. ---- */
export const SERIF = "'Cinzel', 'Times New Roman', serif"
export const COND = "'Oswald', 'Hanken Grotesk', sans-serif"
export const MONO = "'Courier Prime', 'JetBrains Mono', monospace"

/* ---- palette ---- */
export const BLACK = '#0b0a08'
export const BONE = NEW_TEMPLATE_BONE
export const DIM = 'rgba(236,229,216,0.42)'
/** Ember. Alternates sanctioned by the delivered set: #C19A5B brass, #6D8BB0 steel, #E8E0D2 bone. */
export const ACCENT = NEW_TEMPLATE_ACCENT

export const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v))

/* ---- easings, kept local so the look is identical outside Remotion too ---- */
export const Ease = {
  outQuart: (p: number): number => 1 - Math.pow(1 - p, 4),
  inOutQuart: (p: number): number => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2),
  outExpo: (p: number): number => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  inOutCubic: (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outBack: (p: number): number => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
}

/* ---- the ONLY three motion helpers. Every template uses these. Do not add a fourth easing. ---- */
export const MOTION = {
  rise: (t: number, s: number, d = 0.9, y = 22): { opacity: number; transform: string } => {
    const e = Ease.outQuart(clamp((t - s) / d))
    return { opacity: e, transform: `translateY(${((1 - e) * y).toFixed(2)}px)` }
  },
  sweep: (t: number, s: number, d = 1, ease: (p: number) => number = Ease.inOutQuart): number =>
    ease(clamp((t - s) / d)),
  pop: (t: number, s: number, d = 0.46): { opacity: number; transform: string } => {
    const p = clamp((t - s) / d)
    return {
      opacity: clamp(p * 3.2),
      transform: `scale(${(0.82 + 0.18 * Ease.outBack(p)).toFixed(3)})`,
    }
  },
}

/** Wrap a word in *asterisks* to make it the accent word. */
export const Mark: React.FC<{ text: string; accent?: string; glow?: boolean }> = ({
  text,
  accent = ACCENT,
  glow,
}) => (
  <>
    {text
      .split(/(\*[^*]+\*)/)
      .filter(Boolean)
      .map((part, index) =>
        part[0] === '*' ? (
          <span
            key={index}
            style={{ color: accent, textShadow: glow ? `0 0 28px ${accent}66` : 'none' }}
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
  </>
)

const GRAIN_TILE =
  "url(\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScyMDAnIGhlaWdodD0nMjAwJz48ZmlsdGVyIGlkPSduJz48ZmVUdXJidWxlbmNlIHR5cGU9J2ZyYWN0YWxOb2lzZScgYmFzZUZyZXF1ZW5jeT0nMC44NScgbnVtT2N0YXZlcz0nMicgc3RpdGNoVGlsZXM9J3N0aXRjaCcvPjxmZUNvbG9yTWF0cml4IHR5cGU9J3NhdHVyYXRlJyB2YWx1ZXM9JzAnLz48L2ZpbHRlcj48cmVjdCB3aWR0aD0nMjAwJyBoZWlnaHQ9JzIwMCcgZmlsdGVyPSd1cmwoI24pJyBvcGFjaXR5PScwLjU1Jy8+PC9zdmc+\")"

/** 35mm grain. Deterministic from time, so every render of frame N is identical. */
export const Grain: React.FC<{ t: number; amount?: number }> = ({ t, amount = 0.55 }) => {
  if (amount <= 0.01) return null
  const k = Math.floor(t * 20)
  return (
    <AbsoluteFill
      style={{
        opacity: amount * 0.5,
        mixBlendMode: 'overlay',
        backgroundImage: GRAIN_TILE,
        backgroundRepeat: 'repeat',
        backgroundPosition: `${(k * 37) % 200}px ${(k * 91) % 200}px`,
      }}
    />
  )
}

const SPECKS = [
  [212, 190, 3],
  [640, 880, 2],
  [1480, 320, 4],
  [1010, 640, 2],
  [1760, 810, 3],
  [380, 520, 2],
  [1290, 150, 3],
] as const

/** Dust and hair on the gate. The delivered coordinates are authored at 1920x1080, so they are
 *  expressed here as percentages — otherwise every speck clusters in the top-left of a 9:16 frame. */
export const Dust: React.FC<{ t: number; amount?: number }> = ({ t, amount = 0.45 }) => {
  if ((amount ?? 0) <= 0.01) return null
  const k = Math.floor(t * 11)
  return (
    <AbsoluteFill style={{ opacity: amount }}>
      {SPECKS.map((speck, index) =>
        (k + index) % 5 === 0 ? (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: `${((speck[0] / 1920) * 100).toFixed(3)}%`,
              top: `${((speck[1] / 1080) * 100).toFixed(3)}%`,
              width: speck[2],
              height: speck[2] * 3,
              background: 'rgba(255,248,232,0.5)',
              borderRadius: 2,
            }}
          />
        ) : null,
      )}
    </AbsoluteFill>
  )
}

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background: 'radial-gradient(130% 110% at 50% 50%, transparent 52%, rgba(0,0,0,0.55) 100%)',
    }}
  />
)

/** Gate weave — the whole frame breathing a pixel. Wrap a template in this. */
export const Weave: React.FC<{ t: number; on?: boolean; children: React.ReactNode }> = ({
  t,
  on = true,
  children,
}) => (
  <AbsoluteFill
    style={{ transform: on ? `translateY(${(Math.sin(t * 3.1) * 0.9).toFixed(2)}px)` : undefined }}
  >
    {children}
  </AbsoluteFill>
)

/** Every template sits on this: grain and vignette above everything, never per-template. */
export const FilmFrame: React.FC<{
  t: number
  grain?: number
  weave?: boolean
  /** 'transparent' lets the clip on the timeline underneath show through — see the header. */
  background?: string
  vignette?: boolean
  dust?: boolean
  children: React.ReactNode
}> = ({
  t,
  grain = 0.55,
  weave = true,
  background = BLACK,
  vignette = true,
  dust = true,
  children,
}) => (
  <AbsoluteFill style={{ background, overflow: 'hidden' }}>
    <Weave t={t} on={weave}>
      {children}
    </Weave>
    <Grain t={t} amount={grain} />
    {dust ? <Dust t={t} amount={grain * 0.8} /> : null}
    {vignette ? <Vignette /> : null}
  </AbsoluteFill>
)

/* ---- prop readers.
 *
 * resolveTemplateProps has already validated these against the manifest before they reach a scene,
 * but a project written by an older build or edited by hand can still carry anything, and a render
 * that throws mid-frame is worse than one that falls back. ---- */

export function textProp(props: JsonObject | undefined, key: string, fallback: string): string {
  const value = props?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

export function numberProp(props: JsonObject | undefined, key: string, fallback: number): number {
  const value = props?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const HEX = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u

export function colorProp(props: JsonObject | undefined, key: string, fallback: string): string {
  const value = props?.[key]
  return typeof value === 'string' && HEX.test(value) ? value : fallback
}
