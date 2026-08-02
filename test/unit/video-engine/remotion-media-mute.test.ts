import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type {
  VideoAsset,
  VideoProject,
  VideoScene,
} from '../../../shared/video-engine'
import { AudioAsset, VisualAsset } from '../../../video-engine/remotion/asset'
import { SceneContent } from '../../../video-engine/remotion/scene'

function asElement(value: unknown): ReactElement<Record<string, unknown>> {
  expect(isValidElement(value)).toBe(true)
  return value as ReactElement<Record<string, unknown>>
}

function asset(kind: 'audio' | 'video'): VideoAsset {
  return {
    id: `${kind}-asset`,
    name: `${kind} asset`,
    kind,
    uri: `https://example.com/${kind}.mp4`,
  }
}

function scene(kind: 'audio' | 'media', volume = 1): VideoScene {
  return {
    id: `${kind}-scene`,
    trackId: `${kind}-track`,
    kind,
    startFrame: 0,
    durationFrames: 30,
    zIndex: 0,
    assetId: kind === 'audio' ? 'audio-asset' : 'video-asset',
    volume,
  }
}

function projectWith(
  mediaAsset: VideoAsset,
  mediaScene: VideoScene,
  muted: boolean,
): VideoProject {
  return {
    assets: [mediaAsset],
    tracks: [
      {
        id: mediaScene.trackId,
        name: 'Media track',
        kind: mediaAsset.kind === 'audio' ? 'audio' : 'video',
        order: 0,
        muted,
        locked: false,
      },
    ],
    scenes: [mediaScene],
  } as VideoProject
}

function visualMediaElement(mediaScene: VideoScene): ReactElement<Record<string, unknown>> {
  const wrapper = asElement(
    VisualAsset({
      asset: asset('video'),
      scene: mediaScene,
    }),
  )
  return asElement(wrapper.props['children'])
}

describe('Remotion media mute behavior', () => {
  it('forwards a muted video track to the visual asset', () => {
    const mediaAsset = asset('video')
    const mediaScene = scene('media')
    const rendered = asElement(
      SceneContent({
        project: projectWith(mediaAsset, mediaScene, true),
        scene: mediaScene,
      }),
    )

    expect(rendered.type).toBe(VisualAsset)
    expect(rendered.props['muted']).toBe(true)
  })

  it('forwards a muted audio track to the audio asset', () => {
    const mediaAsset = asset('audio')
    const mediaScene = scene('audio')
    const rendered = asElement(
      SceneContent({
        project: projectWith(mediaAsset, mediaScene, true),
        scene: mediaScene,
      }),
    )

    expect(rendered.type).toBe(AudioAsset)
    expect(rendered.props['muted']).toBe(true)
  })

  it('treats a scene volume of zero as muted', () => {
    const audio = asElement(
      AudioAsset({
        asset: asset('audio'),
        scene: scene('audio', 0),
      }),
    )
    const video = visualMediaElement(scene('media', 0))

    expect(audio.props['muted']).toBe(true)
    expect(audio.props['volume']).toBeUndefined()
    expect(video.props['muted']).toBe(true)
    expect(video.props['volume']).toBeUndefined()
  })

  it('preserves normal scene volume when the track is unmuted', () => {
    const audio = asElement(
      AudioAsset({
        asset: asset('audio'),
        scene: scene('audio', 0.65),
      }),
    )
    const video = visualMediaElement(scene('media', 0.65))

    expect(audio.props['muted']).toBe(false)
    expect(audio.props['volume']).toBe(0.65)
    expect(video.props['muted']).toBe(false)
    expect(video.props['volume']).toBe(0.65)
  })
})
