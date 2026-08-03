import { useEffect, useMemo, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import type { VideoProject } from '@shared/video-engine'
import { RemotionVideo } from '../../../../video-engine/remotion/composition'
import { projectForPlayer } from '../editor/assetUrl'
import { gradeFilter, gradeTintLayer, gradeVignetteLayer } from '../editor/gradePreview'

export type FastPreviewControllerStatus =
  | 'loading'
  | 'ready'
  | 'playing'
  | 'finished'
  | 'error'

export interface FastPreviewController {
  status: FastPreviewControllerStatus
  frame: number
  error?: string
  play: () => void
  pause: () => void
}

declare global {
  interface Window {
    __mesFastPreview?: FastPreviewController
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(finish))
    setTimeout(finish, 200)
  })
}

function setControllerError(message: string): void {
  if (!window.__mesFastPreview) return
  window.__mesFastPreview.status = 'error'
  window.__mesFastPreview.error = message
}

function FastPreviewPlayerError({ error }: { error: Error }): JSX.Element {
  useEffect(() => setControllerError(error.message), [error])
  return (
    <div style={{ color: '#fff', padding: 32, fontFamily: 'sans-serif' }}>
      Fast preview failed: {error.message}
    </div>
  )
}

export function FastPreviewPage({ projectId }: { projectId: string }): JSX.Element {
  const player = useRef<PlayerRef>(null)
  const controller = useRef<FastPreviewController>({
    status: 'loading',
    frame: 0,
    play: () => undefined,
    pause: () => undefined,
  })
  const [project, setProject] = useState<VideoProject | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    window.__mesFastPreview = controller.current
    const root = document.documentElement
    const body = document.body
    const previous = {
      rootBackground: root.style.background,
      rootOverflow: root.style.overflow,
      bodyBackground: body.style.background,
      bodyMargin: body.style.margin,
      bodyOverflow: body.style.overflow,
    }
    root.style.background = '#000'
    root.style.overflow = 'hidden'
    body.style.background = '#000'
    body.style.margin = '0'
    body.style.overflow = 'hidden'
    return () => {
      delete window.__mesFastPreview
      root.style.background = previous.rootBackground
      root.style.overflow = previous.rootOverflow
      body.style.background = previous.bodyBackground
      body.style.margin = previous.bodyMargin
      body.style.overflow = previous.bodyOverflow
    }
  }, [])

  useEffect(() => {
    let canceled = false
    void window.api.videoEngine.project(projectId).then((loaded) => {
      if (canceled) return
      if (loaded.rendererId !== 'remotion') {
        throw new Error('Fast preview export is only available for Remotion projects.')
      }
      ;(window as unknown as { __mesProjectLoaded?: boolean }).__mesProjectLoaded = true
      setProject(projectForPlayer(loaded))
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      setControllerError(message)
    })
    return () => {
      canceled = true
      delete (window as unknown as { __mesProjectLoaded?: boolean }).__mesProjectLoaded
    }
  }, [projectId])

  useEffect(() => {
    if (!project) return
    const current = controller.current
    current.play = () => {
      const activePlayer = player.current
      if (!activePlayer) return
      try {
        activePlayer.seekTo(0)
      } catch {}
      current.frame = 0
      current.error = undefined
      current.status = 'playing'
      try {
        activePlayer.play()
      } catch (err: unknown) {
        current.error = err instanceof Error ? err.message : String(err)
      }
    }
    current.pause = () => {
      try {
        player.current?.pause()
      } catch {}
    }

    const onFrame = (event: { detail: { frame: number } }): void => {
      current.frame = event.detail.frame
      if (event.detail.frame >= project.canvas.durationFrames - 1) {
        current.status = 'finished'
      }
    }

    const activePlayer = player.current
    activePlayer?.addEventListener('frameupdate', onFrame)

    void Promise.resolve(document.fonts.ready)
      .then(nextPaint)
      .then(() => {
        if (current.status === 'loading') current.status = 'ready'
      })
      .catch((error: unknown) => {
        setControllerError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      activePlayer?.removeEventListener('frameupdate', onFrame)
    }
  }, [project])

  const inputProps = useMemo(() => project ? { project } : null, [project])
  const grading = project?.grading
  const filter = useMemo(() => gradeFilter(grading), [grading])
  const tint = useMemo(() => gradeTintLayer(grading), [grading])
  const vignette = useMemo(() => gradeVignetteLayer(grading), [grading])

  if (loadError) {
    return <div style={{ color: '#fff', padding: 32 }}>{loadError}</div>
  }
  if (!project || !inputProps) {
    return <div style={{ width: '100vw', height: '100vh', background: '#000' }} />
  }

  return (
    <div
      data-fast-preview-surface
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: project.canvas.backgroundColor,
        ...(filter ? { filter } : {}),
      }}
    >
      <Player
        ref={player}
        component={RemotionVideo}
        inputProps={inputProps}
        durationInFrames={Math.max(1, project.canvas.durationFrames)}
        fps={project.canvas.fps}
        compositionWidth={project.canvas.width}
        compositionHeight={project.canvas.height}
        style={{ width: '100%', height: '100%' }}
        acknowledgeRemotionLicense
        overflowVisible={false}
        numberOfSharedAudioTags={8}
        initialVolume={0}
        errorFallback={({ error }) => <FastPreviewPlayerError error={error} />}
      />
      {tint && <div style={{ ...tint, position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
      {vignette && <div style={{ ...vignette, position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
    </div>
  )
}
