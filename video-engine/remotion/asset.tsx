import type { CSSProperties } from 'react'
import {
  Audio as WebCodecsAudio,
  Video as WebCodecsVideo,
} from '@remotion/media'
import {
  AbsoluteFill,
  Audio as ElementAudio,
  Img,
  Video as ElementVideo,
} from 'remotion'
import type { VideoAsset, VideoScene } from '../../shared/video-engine'

/**
 * `@remotion/media` reads media by `fetch`ing the URL. That is fine while rendering —
 * the composition is served over http from Remotion's own bundle server — but the studio
 * preview renders this same component inside the app window, whose document origin is
 * `file://`, and Chromium refuses to fetch a custom scheme from a file origin no matter
 * what `registerSchemesAsPrivileged` declares. Project media is served over `mestudio://`,
 * so in the preview every fetch fails and the video plays silently with no audio.
 *
 * An HTML media element loads the exact same URL without complaint, so the preview uses
 * Remotion's element-based Audio/Video and the render keeps the WebCodecs ones. Detected
 * from the origin rather than threaded through as a prop, because the distinction IS the
 * origin — anything else would let the two drift apart.
 */
const PREFER_ELEMENT_MEDIA =
  typeof window !== 'undefined' && window.location?.protocol === 'file:'

const Audio = PREFER_ELEMENT_MEDIA ? ElementAudio : WebCodecsAudio
const Video = PREFER_ELEMENT_MEDIA ? ElementVideo : WebCodecsVideo

function sourceTrim(scene: VideoScene): {
  trimBefore: number | undefined
  trimAfter: number | undefined
} {
  if (!scene.sourceRange) {
    return { trimBefore: undefined, trimAfter: undefined }
  }
  return {
    trimBefore: scene.sourceRange.startFrame,
    trimAfter: scene.sourceRange.startFrame + scene.sourceRange.durationFrames,
  }
}

export function sceneTransformStyle(scene: VideoScene): CSSProperties {
  const transform = scene.transform
  if (!transform) {
    return {
      opacity: scene.opacity ?? 1,
    }
  }

  return {
    opacity: scene.opacity ?? 1,
    transformOrigin: `${transform.anchorX * 100}% ${transform.anchorY * 100}%`,
    transform: [
      `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      `rotate(${transform.rotationDeg}deg)`,
      `scale(${transform.scaleX}, ${transform.scaleY})`,
    ].join(' '),
  }
}

export function AudioAsset({
  asset,
  scene,
}: {
  readonly asset: VideoAsset
  readonly scene: VideoScene
}) {
  const trim = sourceTrim(scene)
  return (
    <Audio
      src={asset.uri}
      trimBefore={trim.trimBefore}
      trimAfter={trim.trimAfter}
      volume={scene.volume ?? 1}
    />
  )
}

export function VisualAsset({
  asset,
  scene,
  muted = false,
}: {
  readonly asset: VideoAsset
  readonly scene: VideoScene
  readonly muted?: boolean
}) {
  const fit = scene.fit ?? 'cover'
  const trim = sourceTrim(scene)
  const wrapperStyle = sceneTransformStyle(scene)
  const volume = scene.volume ?? 1
  const isMuted = muted || volume <= 0

  if (asset.kind === 'image') {
    return (
      <AbsoluteFill style={wrapperStyle}>
        <Img
          src={asset.uri}
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit,
          }}
        />
      </AbsoluteFill>
    )
  }

  if (asset.kind === 'video') {
    return (
      <AbsoluteFill style={wrapperStyle}>
        <Video
          src={asset.uri}
          trimBefore={trim.trimBefore}
          trimAfter={trim.trimAfter}
          volume={isMuted ? undefined : volume}
          muted={isMuted}
          objectFit={fit}
          style={{
            width: '100%',
            height: '100%',
          }}
        />
      </AbsoluteFill>
    )
  }

  return null
}

