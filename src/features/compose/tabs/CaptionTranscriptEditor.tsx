import { memo } from 'react'
import type { TranscriptWord } from '@shared/types'
import { useData } from '../../../store/useData'

/** Memoized so an emphasis toggle (which only replaces the touched word's object
 *  reference — see useData.toggleWordEmphasis/setWordsEmphasis) re-renders one span
 *  instead of diffing every word in the transcript. */
const TranscriptWordSpan = memo(function TranscriptWordSpan({ word, onToggle }: { word: TranscriptWord; onToggle: (id: string) => void }): JSX.Element {
  return (
    <span onClick={() => onToggle(word.id)} style={{ cursor: 'pointer', background: word.emphasis ? '#1f9c6b' : undefined, color: word.emphasis ? '#fff' : undefined, borderRadius: 4, padding: word.emphasis ? '0 5px' : undefined, fontWeight: word.emphasis ? 600 : undefined }}>{word.word} </span>
  )
})

const TranscriptWordChip = memo(function TranscriptWordChip({ word, onToggle }: { word: TranscriptWord; onToggle: (id: string) => void }): JSX.Element {
  return (
    <span onClick={() => onToggle(word.id)} style={{ flexShrink: 0, border: word.emphasis ? '1px solid #1f9c6b' : '1px solid #2c303b', borderRadius: 6, padding: '5px 9px', fontSize: 11.5, color: word.emphasis ? '#fff' : '#aab0bb', background: word.emphasis ? '#1f9c6b' : '#0e1116', fontWeight: word.emphasis ? 600 : undefined, cursor: 'pointer' }}>{word.word}{word.emphasis ? ' ★' : ''}</span>
  )
})

export function CaptionTranscriptEditor(): JSX.Element {
  const transcript = useData((s) => s.transcript)
  const transcribing = useData((s) => s.transcribing)
  const transcribeMessage = useData((s) => s.transcribeMessage)
  const transcribeError = useData((s) => s.transcribeError)
  const runTranscribe = useData((s) => s.runTranscribe)
  const toggleWordEmphasis = useData((s) => s.toggleWordEmphasis)
  const setWordsEmphasis = useData((s) => s.setWordsEmphasis)

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180' }}>TRANSCRIPT · WORD-LEVEL</span>
        <div style={{ flex: 1 }} />
        {transcribing && <span title={transcribeMessage || 'Transcribing…'} className="me-ellipsis" style={{ fontSize: 10.5, color: '#8a909c', maxWidth: 220 }}>{transcribeMessage || 'Transcribing…'}</span>}
        <button type="button" disabled={transcribing || transcript.length === 0} title="Mark meaningful words (≥4 chars, non-stop-words) for karaoke emphasis" onClick={() => {
          const stopWords = new Set(['that', 'this', 'with', 'from', 'they', 'have', 'were', 'been', 'will', 'your', 'when', 'then', 'than', 'what', 'also', 'just', 'like', 'more', 'some', 'into', 'their', 'there', 'about', 'which', 'would', 'could', 'should', 'these', 'those', 'being', 'after', 'over'])
          const candidates = transcript.filter((w) => w.word.length >= 4 && !stopWords.has(w.word.toLowerCase().replace(/[^a-z]/g, '')))
          // Spread emphasis evenly across the ENTIRE transcript (previously a slice(0,30)
          // cap only ever marked ~10 words at the very start). Aim for ~1 highlight per 10
          // transcript words, sampled at a stride over the candidate list so coverage runs
          // start→end regardless of length.
          const target = Math.max(1, Math.round(transcript.length / 10))
          const stride = Math.max(1, Math.round(candidates.length / target))
          const toMark = candidates.filter((_, i) => i % stride === 0)
          void setWordsEmphasis(toMark.filter((w) => !w.emphasis).map((w) => w.id), true)
        }} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '5px 10px', fontSize: 10.5, color: '#c4cad3', cursor: transcript.length === 0 ? 'not-allowed' : 'pointer', opacity: transcript.length === 0 ? 0.45 : 1 }}>Auto-detect emphasis</button>
        <button type="button" disabled={transcribing} onClick={() => void runTranscribe()} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '5px 10px', fontSize: 10.5, color: '#c4cad3', cursor: transcribing ? 'not-allowed' : 'pointer', opacity: transcribing ? 0.55 : 1 }}>{transcribing ? 'Transcribing…' : 'Re-transcribe ↻'}</button>
      </div>
      <div style={{ fontSize: 10.5, color: '#5b616f', marginBottom: 8 }}>Click a word to toggle emphasis for karaoke highlight, or use Auto-detect to mark key words automatically.</div>
      <div style={{ border: '1px solid #1d2129', borderRadius: 12, padding: 16, background: '#12151b', fontSize: 14, lineHeight: 2.1, color: '#cdd2da', height: 178, overflow: 'auto' }}>
        {transcribeError ? (
          <span title={transcribeError} className="me-clamp-2" style={{ color: '#ff8a96', fontSize: 12 }}>{transcribeError}</span>
        ) : transcript.length === 0 ? (
          <span style={{ color: '#4f5662', fontSize: 12 }}>— no transcript yet · click Re-transcribe to generate word-level timings —</span>
        ) : (
          transcript.map((w: TranscriptWord) => (
            <TranscriptWordSpan key={w.id} word={w} onToggle={toggleWordEmphasis} />
          ))
        )}
      </div>
      {transcript.length > 0 && (
        <details style={{ border: '1px solid #1d2129', borderRadius: 12, padding: 14, background: '#12151b', marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f' }}>WORD TIMELINE — click ★ to mark a word for karaoke emphasis</summary>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', overflowX: 'auto', paddingBottom: 6, marginTop: 10 }}>
            {transcript.map((w) => (
              <TranscriptWordChip key={w.id} word={w} onToggle={toggleWordEmphasis} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
