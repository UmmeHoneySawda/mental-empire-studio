import type { CSSProperties } from 'react'
import { Audio, Video } from '@remotion/media'
import { AbsoluteFill, Img } from 'remotion'
import type { VideoAsset, VideoScene } from '../../shared/video-engine'

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
  const mediaStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: fit,
  }

  if (asset.kind === 'image') {
    return (
      <AbsoluteFill style={wrapperStyle}>
        <Img src={asset.uri} style={mediaStyle} />
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
          volume={scene.volume ?? 1}
          muted={muted}
          objectFit={fit}
          style={mediaStyle}
        />
      </AbsoluteFill>
    )
  }

  return null
}

