import { useState } from 'react'
import type { DownloadedVideo } from '@shared/types'
import { youtubeIdFromDownloadId, youtubeThumbUrl, type YoutubeThumbQuality } from '@shared/youtube'
import { formatDuration } from './shared'

function DownloadThumb({ download }: { download: DownloadedVideo }): JSX.Element {
  const videoId = youtubeIdFromDownloadId(download.id)
  const [quality, setQuality] = useState<YoutubeThumbQuality>('max')
  const [failed, setFailed] = useState(false)
  const src = videoId && !failed ? youtubeThumbUrl(videoId, quality) : ''
  return (
    <div style={{ width: 108, aspectRatio: '16/9', flex: 'none', borderRadius: 9, overflow: 'hidden', border: '1px solid #1d2129', background: 'linear-gradient(135deg,#23304a,#15171d)' }}>
      {src && (
        <img
          src={src}
          alt=""
          onError={() => { if (quality === 'max') setQuality('hq'); else if (quality === 'hq') setQuality('mq'); else setFailed(true) }}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </div>
  )
}

export function ComposeProjectPicker({
  downloads,
  openingId,
  error,
  onOpen,
  onSources
}: {
  downloads: DownloadedVideo[]
  openingId: string
  error: string
  onOpen: (downloadId: string) => void
  onSources: () => void
}): JSX.Element {
  const readyDownloads = downloads.filter((d) => !!d.filePath && (d.durationSec ?? 0) > 0)
  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, color: '#eef0f3' }}>Pick a video</div>
          <div style={{ fontSize: 11.5, color: '#6a7180', marginTop: 4 }}>Finished downloads ready for video editing.</div>
        </div>
        <button type="button" onClick={onSources} className="me-btn" style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 9, padding: '8px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Open Sources</button>
      </div>
      {error && <div title={error} className="me-clamp-2" style={{ marginBottom: 12, border: '1px solid #5a2530', background: 'rgba(255,90,110,.1)', color: '#ff8a96', borderRadius: 10, padding: '9px 12px', fontSize: 11.5 }}>{error}</div>}
      {readyDownloads.length === 0 ? (
        <div style={{ border: '1.5px dashed #23272f', borderRadius: 12, padding: '34px 16px', textAlign: 'center', color: '#6a7180', fontSize: 12.5 }}>No finished downloads yet. Download an MP3 from Sources, then come back here.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12 }}>
          {readyDownloads.map((d) => {
            const busy = openingId === d.id
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onOpen(d.id)}
                disabled={!!openingId}
                className="me-btn"
                style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, border: '1px solid #1d2129', background: '#0e1116', borderRadius: 12, padding: 10, cursor: openingId ? 'wait' : 'pointer', textAlign: 'left', opacity: openingId && !busy ? 0.55 : 1 }}
              >
                <DownloadThumb download={d} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span title={d.title} className="me-ellipsis" style={{ display: 'block', color: '#dde0e5', fontSize: 12.5, fontWeight: 700 }}>{d.title}</span>
                  <span className="me-ellipsis" style={{ display: 'block', color: '#6a7180', fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{d.channel || 'Source'}{formatDuration(d.durationSec) ? ` · ${formatDuration(d.durationSec)}` : ''}</span>
                </span>
                <span style={{ flex: 'none', color: busy ? '#f5b323' : 'var(--accent)', fontSize: 11.5, fontWeight: 700 }}>{busy ? 'Opening...' : 'Open'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
