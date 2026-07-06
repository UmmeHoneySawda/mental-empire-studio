import { useState } from 'react'
import type { BetaVideoOpts } from '@shared/types'
import { asBetaOpts } from '@shared/types'
import { buildMasterPrompt, validateEffectPlan } from '@shared/effectPlan'
import { useData } from '../../../store/useData'
import { BetaHeader } from '../shared'

/** Compose "Advanced" tab — effect plan override. */
export function AdvancedTab(): JSX.Element {
  const project = useData((s) => s.activeProject)
  const transcript = useData((s) => s.transcript)
  const setCaptions = useData((s) => s.setCaptions)
  const o = asBetaOpts(project?.betaOpts)
  const patch = (p: Partial<BetaVideoOpts>): void => {
    void setCaptions({ betaOpts: { ...o, ...p } })
  }
  const [fxStatus, setFxStatus] = useState('')

  const copyPrompt = (): void => {
    void navigator.clipboard.writeText(buildMasterPrompt(transcript, o.style))
    setFxStatus('Master prompt copied — paste into ChatGPT/Gemini, then paste the JSON back.')
  }
  const genGroq = async (): Promise<void> => {
    if (!project) return
    setFxStatus('Generating with Groq…')
    try {
      const json = await window.api.effects.generate(project.id, o.style)
      patch({ effectPlanJson: json })
      setFxStatus('Generated ✓')
    } catch (e) {
      setFxStatus(`Failed: ${(e as Error).message}`)
    }
  }
  const planSummary = ((): string => {
    if (!o.effectPlanJson.trim()) return ''
    const { plan, warnings } = validateEffectPlan(o.effectPlanJson, project?.durationSec ?? 60)
    return `${plan.transitions.length} transitions · ${plan.textEffects.length} text effects${warnings.length ? ` · ${warnings.length} adjusted` : ''}`
  })()

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ position: 'relative', border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 13 }}>
        <BetaHeader />
        <div>
          <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Effect plan (advanced override)</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
            <button type="button" onClick={copyPrompt} className="me-btn" style={{ flex: 1, textAlign: 'center', border: '1px solid #262b34', borderRadius: 7, padding: '6px 8px', fontSize: 10.5, color: '#c4cad3', background: '#0e1116', cursor: 'pointer' }}>Copy master prompt</button>
            <button type="button" onClick={() => void genGroq()} className="me-btn" style={{ flex: 1, textAlign: 'center', border: '1px solid var(--accent)', borderRadius: 7, padding: '6px 8px', fontSize: 10.5, color: 'var(--accent)', background: 'var(--accent-soft)', cursor: 'pointer' }}>Auto-generate (Groq)</button>
          </div>
          <textarea value={o.effectPlanJson} onChange={(e) => patch({ effectPlanJson: e.target.value })} placeholder='Paste an effect-plan JSON, or auto-generate. Leave empty to use the Style defaults.' rows={4} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #23272f', borderRadius: 7, padding: 8, fontSize: 10, color: '#dde0e5', background: '#0e1116', fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
          {planSummary && <div style={{ fontSize: 9.5, color: '#36c98e', marginTop: 5 }}>{planSummary}</div>}
          {fxStatus && <div title={fxStatus} className="me-clamp-2" style={{ fontSize: 9.5, color: '#8a909c', marginTop: 4 }}>{fxStatus}</div>}
        </div>
      </div>
    </div>
  )
}
