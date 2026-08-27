import { useRef, useState } from 'react'
import { SliderRow, Btn, Banner } from '../../components/ui/kit'
import { previewUrlForPath } from '../video-studio/editor/assetUrl'
import { mergeImagePaths } from './useAutomationDraft'
import { CINEMATIC_PORTRAIT_MOCKUP } from './mockupBackdrops'

export function TemplateImagePool({
  paths,
  durationSec,
  onChange
}: {
  paths: string[]
  durationSec: number
  onChange: (patch: { imagePaths?: string[]; imageDurationSec?: number }) => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const importFromFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const raw = Array.from(files)
      .map((f) => {
        try {
          return window.api.pathForFile(f)
        } catch {
          return ''
        }
      })
      .filter(Boolean) as string[]
    if (raw.length === 0) {
      setError('Could not resolve those files to disk paths. Try dragging them from a folder.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const imported = await window.api.assets.import(raw, { channel: 'automation' })
      const canonicals = imported.map((r) => r.canonicalPath).filter(Boolean) as string[]
      if (canonicals.length === 0) {
        setError('No images were imported. Check that the files are valid images.')
        return
      }
      const merged = mergeImagePaths(paths || [], canonicals)
      onChange({ imagePaths: merged })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Import failed: ${msg.slice(0, 200)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    await importFromFiles(e.dataTransfer.files)
  }

  const removeOne = (p: string) => {
    onChange({ imagePaths: (paths || []).filter((x) => x !== p) })
  }

  const clearAll = () => onChange({ imagePaths: [] })

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        border: dragOver ? '1px solid var(--accent)' : '1px dashed var(--border-2)',
        borderRadius: 10,
        background: dragOver ? 'var(--accent-soft)' : 'var(--bg-inset)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)' }}>
          Images · {paths?.length ?? 0} {paths?.length === 1 ? 'item' : 'items'}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="soft" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? 'Importing…' : 'Add images'}
          </Btn>
          {paths.length > 0 && (
            <Btn size="sm" variant="ghost" onClick={clearAll}>
              Clear all
            </Btn>
          )}
        </div>
      </div>

      {error && (
        <Banner kind="error" style={{ fontSize: 11, whiteSpace: 'normal', WebkitLineClamp: 'unset', display: 'block', overflow: 'visible' }}>
          {error}
        </Banner>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void importFromFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {paths.length === 0 ? (
        <div
          style={{
            padding: 18,
            textAlign: 'center',
            color: 'var(--text-dim)',
            fontSize: 11,
            lineHeight: 1.5,
            border: '1px dashed var(--border-2)',
            borderRadius: 8,
            background: 'var(--bg-card)'
          }}
        >
          No images yet. Drag images here or click “Add images”.
          <br />
          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>Image slideshow needs at least one image.</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {paths.map((p) => (
            <div
              key={p}
              style={{
                position: 'relative',
                border: '1px solid var(--border)',
                borderRadius: 8,
                overflow: 'hidden',
                background: 'var(--bg-card)'
              }}
            >
              <div style={{ aspectRatio: '16 / 9', background: 'var(--bg-inset)', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
                {/* Thumbnails via mestudio:// allowlist widened to asset-library */}
                <img
                  src={previewUrlForPath(p)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    const el = e.currentTarget as HTMLImageElement
                    if (el.src !== CINEMATIC_PORTRAIT_MOCKUP) {
                      el.src = CINEMATIC_PORTRAIT_MOCKUP
                    }
                  }}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </div>
              <div
                style={{
                  padding: '6px 6px 6px 7px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0
                }}
              >
                <span
                  title={p}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  {p.split(/[\\/]/).pop()}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${p.split(/[\\/]/).pop()}`}
                  onClick={() => removeOne(p)}
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                    padding: 2
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-2)', paddingTop: 10 }}>
        <SliderRow
          label="Duration"
          value={durationSec ?? 5}
          min={1}
          max={12}
          step={0.5}
          format={(v) => `${v}s`}
          onChange={(v) => onChange({ imageDurationSec: v })}
        />
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>How long each image holds on screen.</div>
      </div>
    </div>
  )
}
