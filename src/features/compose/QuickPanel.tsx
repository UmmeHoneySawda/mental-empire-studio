import type { MotionPreset } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { LOOKS } from '@shared/looks'
import { useData } from '../../store/useData'

export function QuickPanel({ customizeOpen, onCustomizeToggle }: { customizeOpen: boolean; onCustomizeToggle: () => void }): JSX.Element | null {
  const project = useData((s) => s.activeProject)
  if (!project) return null

  const betaOpts = asBetaOpts(project.betaOpts)
  const selectedLook = LOOKS.find((look) => look.id === (project.lookLut ?? 'off')) ?? LOOKS[0]
  const lookStrength = selectedLook.id === 'off' ? 0 : Math.max(0, Math.min(1, project.lookStrength ?? selectedLook.defaultStrength))
  const motionPreset: MotionPreset = project.motionPreset ?? (project.kenBurns ? 'subtle' : 'off')
  const captionPreset = project.captionPreset ?? 'Hormozi'
  const aspect = project.captionAspect ?? '16:9'
  const style = betaOpts.style

  const badge = (label: string, value: string, accent?: boolean) => (
    <div style={{ border: accent ? '1px solid var(--accent)' : '1px solid #262b34', borderRadius: 8, padding: '6px 10px', background: accent ? 'var(--accent-soft)' : '#0e1116', fontSize: 10.5, color: accent ? 'var(--accent)' : '#cdd2da', fontFamily: 'var(--font-mono)' }}>
      <div style={{ fontSize: 8.5, letterSpacing: '.5px', color: '#5b616f', marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 11.5 }}>{value}</div>
    </div>
  )

  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', marginBottom: 18, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>PROJECT SETTINGS</span>
        <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#6a7180' }}>Read-only summary · click Customize to edit</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
        {badge('LOOK', `${selectedLook.name} · ${Math.round(lookStrength * 100)}%`, selectedLook.id !== 'off')}
        {badge('MOTION', motionPreset === 'off' ? 'Off' : motionPreset === 'subtle' ? 'Subtle' : 'Cinematic', motionPreset !== 'off')}
        {badge('CAPTIONS', captionPreset)}
        {badge('ASPECT', aspect)}
        {badge('STYLE', style)}
        {badge('B-ROLL', betaOpts.broll.enabled ? `On · ${betaOpts.broll.density}` : 'Off', betaOpts.broll.enabled)}
      </div>
      <button type="button" onClick={onCustomizeToggle} className="me-btn" style={{ alignSelf: 'flex-start', border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 9, padding: '8px 16px', fontSize: 11.5, color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>
        Customize
      </button>
    </div>
  )
}
