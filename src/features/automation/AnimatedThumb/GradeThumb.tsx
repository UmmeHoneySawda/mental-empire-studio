import { ThumbShell } from './index'

const GRADE_WASH: Record<string, string> = {
  neutral: 'linear-gradient(135deg, #444, #888)',
  punch: 'linear-gradient(135deg, #1e3c72, #2a5298)',
  'teal-orange': 'linear-gradient(135deg, #008080, #ff7f50)',
  'warm-film': 'linear-gradient(135deg, #f59e0b, #b45309)',
  'cold-doc': 'linear-gradient(135deg, #0f172a, #38bdf8)',
  noir: 'linear-gradient(135deg, #000000, #475569)',
  vhs: 'linear-gradient(135deg, #881337, #f43f5e)',
  'clean-bright': 'linear-gradient(135deg, #e0f2fe, #38bdf8)',
  // legacy VisualTemplate.grade mapping
  Noir: 'linear-gradient(135deg, #000000, #475569)',
  Cinematic: 'linear-gradient(135deg, #0f172a, #1e293b)',
  Intense: 'linear-gradient(135deg, #7c2d12, #f59e0b)',
  Heartfelt: 'linear-gradient(135deg, #4a044e, #f43f5e)',
  Clean: 'linear-gradient(135deg, #e0f2fe, #38bdf8)',
  Gold: 'linear-gradient(135deg, #78350f, #fbbf24)'
}

export function GradeThumb({ grade }: { grade: string }): JSX.Element {
  const wash = GRADE_WASH[grade] ?? 'linear-gradient(135deg, #242933, #12151b)'
  return (
    <ThumbShell label={`Grade ${grade}`}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: wash,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            fontWeight: 700,
            color: '#fff',
            textShadow: '0 1px 8px rgba(0,0,0,.55)',
            letterSpacing: '.3px'
          }}
        >
          {grade}
        </span>
        <span
          style={{
            width: 28,
            height: 2,
            borderRadius: 999,
            background: 'rgba(255,255,255,.7)'
          }}
        />
      </div>
    </ThumbShell>
  )
}
