import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyVideoProject,
  type HookPlan,
  type VideoProject,
  VideoProjectSchema,
} from '@shared/video-engine'
import { BrollCache } from '../../../electron/services/video-engine/broll/cache'
import { BrollService } from '../../../electron/services/video-engine/broll/service'
import { LocalBrollProvider } from '../../../electron/services/video-engine/broll/providers/local'
import type {
  BrollCandidate,
  BrollProvider,
  BrollSearchQuery,
} from '../../../electron/services/video-engine/broll/types'
import { compileHookPlan } from '../../../electron/services/video-engine/hook-compiler'
import {
  brollAssetForProject,
  VideoEngineService,
} from '../../../electron/services/video-engine/service'
import {
  buildGradeFilter,
  escapeFilterPath,
  isIdentityGrade,
} from '../../../electron/services/video-engine/render/postprocess/ffmpeg-grade'
import { RenderQueue } from '../../../electron/services/video-engine/render/queue'
import type {
  PreparedRender,
  PrepareContext,
  RenderArtifact,
  RenderJobRecord,
  RendererAdapter,
  RendererCapabilities,
} from '../../../electron/services/video-engine/render/types'
import { RenderJobStore } from '../../../electron/services/video-engine/storage/job-store'
import { VideoProjectStore } from '../../../electron/services/video-engine/storage/project-store'
import { VideoTemplateRegistry } from '../../../electron/services/video-engine/templates/registry'

const temporaryRoots: string[] = []

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `mental-empire-${label}-`))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

function projectFixture(input: {
  id?: string
  rendererId?: 'remotion' | 'hyperframes'
  revision?: number
  durationFrames?: number
} = {}): VideoProject {
  const project = createEmptyVideoProject({
    id: input.id ?? 'project-service',
    name: 'Service fixture',
    rendererId: input.rendererId ?? 'remotion',
    width: 1920,
    height: 1080,
    fps: 30,
    durationFrames: input.durationFrames ?? 900,
    now: '2026-07-30T10:00:00.000Z',
  })
  return {
    ...project,
    revision: input.revision ?? 0,
  }
}

function hookPlanFixture(input: {
  rendererId?: 'remotion' | 'hyperframes'
  templateId?: string
  assetId?: string
} = {}): HookPlan {
  const rendererId = input.rendererId ?? 'remotion'
  return {
    schemaVersion: 1,
    rendererId,
    templateId:
      input.templateId ??
      `${rendererId === 'remotion' ? 'remotion' : 'hyperframes'}-hook-kinetic-30`,
    templateVersion: '1.0.0',
    fps: 30,
    title: 'Compiled hook',
    durationFrames: 900,
    props: {
      headline: 'The truth changes everything',
      accentColor: '#F8E71C',
    },
    beats: [
      {
        id: 'beat-broll',
        startFrame: 0,
        durationFrames: 300,
        headline: 'Create tension',
        visual: { kind: 'broll', searchQuery: 'storm clouds over a city' },
      },
      {
        id: 'beat-asset',
        startFrame: 300,
        durationFrames: 300,
        headline: 'Show proof',
        visual: { kind: 'asset', assetId: input.assetId ?? 'known-asset' },
      },
      {
        id: 'beat-payoff',
        startFrame: 600,
        durationFrames: 300,
        headline: 'Promise the payoff',
        visual: { kind: 'none' },
      },
    ],
  }
}

function brollCandidate(input: {
  id?: string
  provider?: string
  sourceUrl?: string
  downloadUrl?: string
  title?: string
  description?: string
  tags?: string[]
} = {}): BrollCandidate {
  return {
    id: input.id ?? 'candidate-1',
    provider: input.provider ?? 'local',
    title: input.title ?? 'City skyline',
    description: input.description,
    sourceUrl: input.sourceUrl ?? 'https://example.test/videos/candidate-1',
    downloadUrl: input.downloadUrl ?? 'https://cdn.example.test/candidate-1.mp4',
    width: 1920,
    height: 1080,
    durationMs: 5_000,
    license: {
      name: 'Test commercial license',
      url: 'https://example.test/license',
      attributionRequired: true,
      commercialUseAllowed: true,
      attribution: 'Test Creator',
    },
    tags: input.tags ?? ['city', 'skyline'],
  }
}

async function waitForJob(
  queue: RenderQueue,
  id: string,
  predicate: (job: RenderJobRecord) => boolean,
  timeoutMs = 5_000,
): Promise<RenderJobRecord> {
  const deadline = Date.now() + timeoutMs
  let latest = await queue.get(id)
  while (!predicate(latest)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for render job ${id}; last stage was ${latest.stage}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    latest = await queue.get(id)
  }
  return latest
}

class FakeRendererAdapter implements RendererAdapter {
  readonly id = 'remotion' as const
  readonly preparedProjects: VideoProject[] = []
  readonly renderedOutputs: string[] = []
  activeRenders = 0
  maxActiveRenders = 0

  private gateReleased: boolean
  private releaseGate!: () => void
  private readonly gate: Promise<void>

  constructor(blockRendering = false) {
    this.gateReleased = !blockRendering
    this.gate = new Promise<void>((resolve) => {
      this.releaseGate = () => {
        this.gateReleased = true
        resolve()
      }
      if (!blockRendering) this.releaseGate()
    })
  }

  release(): void {
    this.releaseGate()
  }

  capabilities(): RendererCapabilities {
    return {
      rendererId: this.id,
      maxWidth: 7680,
      maxHeight: 4320,
      supportedFps: [24, 25, 30, 50, 60],
      supportsAudio: true,
      supportsVideo: true,
      supportsImages: true,
      supportsCaptions: true,
      supportsLuts: true,
      transitions: ['cut', 'fade', 'slide', 'wipe', 'zoom', 'dip-to-black'],
    }
  }

  async preflight(): Promise<[]> {
    return []
  }

  async prepare(project: VideoProject, context: PrepareContext): Promise<PreparedRender> {
    context.signal.throwIfAborted()
    this.preparedProjects.push(structuredClone(project))
    context.onProgress({ stage: 'preparing', progress: 1 })
    return {
      rendererId: this.id,
      durationFrames: project.canvas.durationFrames,
      width: project.canvas.width,
      height: project.canvas.height,
      payload: { projectId: project.id },
    }
  }

  async render(
    prepared: PreparedRender,
    outputPath: string,
    context: PrepareContext,
  ): Promise<RenderArtifact> {
    this.activeRenders += 1
    this.maxActiveRenders = Math.max(this.maxActiveRenders, this.activeRenders)
    try {
      if (!this.gateReleased) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => reject(context.signal.reason)
          context.signal.addEventListener('abort', onAbort, { once: true })
          this.gate.then(
            () => {
              context.signal.removeEventListener('abort', onAbort)
              resolve()
            },
            reject,
          )
        })
      }
      context.signal.throwIfAborted()
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, `fake-render:${String((prepared.payload as { projectId: string }).projectId)}`)
      this.renderedOutputs.push(outputPath)
      context.onProgress({ stage: 'rendering', progress: 1 })
      return {
        rendererId: this.id,
        path: outputPath,
        mimeType: 'video/mp4',
        durationFrames: prepared.durationFrames,
        width: prepared.width,
        height: prepared.height,
      }
    } finally {
      this.activeRenders -= 1
    }
  }
}

describe('built-in templates and hook compilation', () => {
  it('filters built-ins without leaking templates across renderer boundaries', () => {
    const registry = new VideoTemplateRegistry()
    const remotion = registry.list({ rendererId: 'remotion' })
    const hyperframes = registry.list({ rendererId: 'hyperframes' })

    expect(remotion.length).toBeGreaterThan(0)
    expect(hyperframes.length).toBeGreaterThan(0)
    expect(remotion.every((template) => template.rendererId === 'remotion')).toBe(true)
    expect(hyperframes.every((template) => template.rendererId === 'hyperframes')).toBe(true)
    expect(
      new Set(remotion.map((template) => template.id)).isDisjointFrom(
        new Set(hyperframes.map((template) => template.id)),
      ),
    ).toBe(true)
    expect(registry.list({ rendererId: 'remotion', kind: 'hook' })).toHaveLength(7)
    expect(registry.list({ rendererId: 'hyperframes', kind: 'caption' })).toHaveLength(10)
    expect(
      registry
        .list({ rendererId: 'remotion', kind: 'caption', capabilities: ['word-highlighting'] })
        .every((template) => template.kind === 'caption'),
    ).toBe(true)
  })

  it('compiles one trusted full-plan scene and reports unresolved B-roll', () => {
    const registry = new VideoTemplateRegistry()
    const project = {
      ...projectFixture(),
      assets: [
        {
          id: 'known-asset',
          name: 'Known image',
          kind: 'image' as const,
          uri: 'assets/known.png',
          width: 1920,
          height: 1080,
          source: { kind: 'local' as const },
        },
      ],
    }
    const plan = hookPlanFixture()
    const compiled = compileHookPlan(project, plan, registry)
    const hookScenes = compiled.project.scenes.filter(
      (scene) => scene.id === 'video-engine-hook-plan',
    )

    expect(hookScenes).toHaveLength(1)
    expect(hookScenes[0]).toMatchObject({
      trackId: 'video-engine-hook',
      kind: 'template',
      startFrame: 0,
      durationFrames: plan.durationFrames,
      template: {
        id: plan.templateId,
        version: plan.templateVersion,
        rendererId: 'remotion',
      },
    })
    expect(hookScenes[0]!.template!.props['hookPlan']).toEqual(plan)
    expect(registry.require(plan.templateId, plan.templateVersion).implementationId).toBe(
      plan.templateId,
    )
    expect(compiled.brollRequests).toEqual([
      {
        beatId: 'beat-broll',
        query: 'storm clouds over a city',
        startFrame: 0,
        durationFrames: 300,
      },
    ])
    expect(compiled.project.tracks.filter((track) => track.id === 'video-engine-hook')).toHaveLength(
      1,
    )
  })

  it('rejects renderer mismatch before compiling a hook', () => {
    const registry = new VideoTemplateRegistry()
    const plan = hookPlanFixture({
      rendererId: 'hyperframes',
      templateId: 'hyperframes-hook-kinetic-30',
    })

    expect(() => compileHookPlan(projectFixture(), plan, registry)).toThrow(
      /renderer does not match/i,
    )
  })

  it('rejects an asset visual whose asset is not present in the project snapshot', () => {
    const registry = new VideoTemplateRegistry()

    expect(() =>
      compileHookPlan(projectFixture(), hookPlanFixture({ assetId: 'unknown-asset' }), registry),
    ).toThrow(/references an unknown asset/i)
  })
})

describe('video engine service orchestration', () => {
  it('applies renderer-scoped captions, transitions, grading, and prompt contracts', async () => {
    const root = await temporaryRoot('service-orchestration')
    const service = new VideoEngineService(
      {
        projects: join(root, 'projects'),
        jobs: join(root, 'jobs'),
        brollCache: join(root, 'broll'),
      },
      [new FakeRendererAdapter()],
    )
    await service.initialize()
    try {
      let project = await service.createProject({
        id: 'orchestrated-project',
        name: 'Orchestrated project',
        rendererId: 'remotion',
        width: 1920,
        height: 1080,
        fps: 30,
        durationFrames: 180,
      })
      project = await service.saveProject({
        ...project,
        tracks: [
          {
            id: 'visual-track',
            name: 'Visual',
            kind: 'video',
            order: 0,
            muted: false,
            locked: false,
          },
        ],
        scenes: [
          {
            id: 'scene-a',
            trackId: 'visual-track',
            kind: 'solid',
            startFrame: 0,
            durationFrames: 105,
            zIndex: 0,
            color: '#000000',
          },
          {
            id: 'scene-b',
            trackId: 'visual-track',
            kind: 'solid',
            startFrame: 90,
            durationFrames: 90,
            zIndex: 1,
            color: '#FFFFFF',
          },
        ],
      })
      project = await service.setCaptionsFromSrt({
        projectId: project.id,
        templateId: 'remotion-caption-highlight',
        templateProps: {
          activeColor: '#E6FF38',
          importantColor: '#FF5A45',
          maxWordsPerCue: 6,
        },
        srt: [
          '1',
          '00:00:00,033 --> 00:00:01,333',
          'One choice',
          '',
        ].join('\n'),
      })
      expect(project.captions?.words.map((word) => word.text)).toEqual(['One', 'choice'])
      expect(
        project.scenes.find((scene) => scene.id === 'video-engine-captions')?.template?.props,
      ).toMatchObject({ activeColor: '#E6FF38', maxWordsPerCue: 6 })
      project = await service.setCaptionTemplate(
        project.id,
        'remotion-caption-neon-accent',
      )
      expect(project.captions?.templateId).toBe('remotion-caption-neon-accent')
      const beforeInvalidCaptionImport = project
      await expect(service.setCaptionsFromSrt({
        projectId: project.id,
        srt: [
          '1',
          '00:00:00,000 --> 00:00:00,050',
          'too many words',
          '',
        ].join('\n'),
      })).rejects.toThrow(/too short to assign 3 words/i)
      project = await service.openProject(project.id)
      expect(project.revision).toBe(beforeInvalidCaptionImport.revision)
      expect(project.captions).toEqual(beforeInvalidCaptionImport.captions)

      project = await service.applyTransitionTemplate(project.id, {
        templateId: 'remotion-transition-fade',
        id: 'scene-crossfade',
        fromSceneId: 'scene-a',
        toSceneId: 'scene-b',
        startFrame: 90,
        durationFrames: 15,
        easing: 'ease-in-out',
      })
      expect(project.transitions).toEqual([
        expect.objectContaining({ id: 'scene-crossfade', type: 'fade' }),
      ])

      project = await service.setGrading(project.id, {
        enabled: true,
        lutIntensity: 0.8,
        exposure: 0.1,
        contrast: 0.12,
        saturation: 1.05,
        temperature: 0.04,
        tint: -0.02,
        vignette: 0.2,
        grain: 0.05,
      })
      expect(project.grading).toMatchObject({ enabled: true, vignette: 0.2, grain: 0.05 })

      const localBrollPath = join(root, 'local source.mov')
      const localBrollUrl = pathToFileURL(localBrollPath).toString()
      const localCandidate = brollCandidate({
        provider: 'local-1',
        sourceUrl: localBrollUrl,
        downloadUrl: localBrollUrl,
      })
      project = await service.placeBroll(project.id, {
        candidate: localCandidate,
        cached: {
          id: localCandidate.id,
          provider: localCandidate.provider,
          absolutePath: localBrollPath,
          sha256: 'a'.repeat(64),
          bytes: 100,
          sourceUrl: localCandidate.sourceUrl,
          cachedAt: new Date(0).toISOString(),
          license: localCandidate.license,
        },
        startFrame: 30,
        durationFrames: 60,
      })
      expect(project.assets.at(-1)).toMatchObject({
        mimeType: 'video/quicktime',
        source: { kind: 'local' },
      })

      const prompt = service.buildHookPlanPrompt({
        rendererId: 'remotion',
        templateId: 'remotion-hook-kinetic-30',
        fps: 30,
        title: 'A safe hook',
      })
      expect(prompt).toContain('Template props contract:')
      expect(prompt).toContain('Only use keys from the template props contract')

      await expect(
        service.instantiateTemplate(project.id, {
          templateId: 'remotion-transition-fade',
          instanceId: 'not-a-scene',
          trackId: 'visual-track',
          startFrame: 0,
        }),
      ).rejects.toThrow(/dedicated service method/i)

      project = await service.removeTransition(project.id, 'scene-crossfade')
      expect(project.transitions).toEqual([])
    } finally {
      await service.shutdown()
    }
  })
})

describe('project store durability and boundaries', () => {
  it('atomically round-trips projects and increments revisions without temporary-file residue', async () => {
    const root = await temporaryRoot('project-store')
    const store = new VideoProjectStore(root)
    await store.initialize()
    const created = await store.create({
      id: 'atomic-project',
      name: 'Atomic project',
      rendererId: 'remotion',
      width: 1920,
      height: 1080,
      fps: 30,
      durationFrames: 900,
    })
    const saved = await store.save(
      { ...created, name: 'Updated atomically' },
      { expectedRevision: created.revision },
    )
    const reopened = await store.open(created.id)
    const serialized = JSON.parse(await readFile(store.projectPath(created.id), 'utf8'))

    expect(saved.revision).toBe(1)
    expect(reopened).toEqual(saved)
    expect(serialized).toEqual(saved)
    expect((await readdir(store.projectDirectory(created.id))).some((name) => name.endsWith('.tmp'))).toBe(
      false,
    )
  })

  it('rejects a stale expected revision without replacing the current project', async () => {
    const root = await temporaryRoot('revision-conflict')
    const store = new VideoProjectStore(root)
    const created = await store.create({
      id: 'revision-project',
      name: 'Revision zero',
      rendererId: 'remotion',
      width: 1280,
      height: 720,
      fps: 30,
      durationFrames: 300,
    })
    const current = await store.save(
      { ...created, name: 'Revision one' },
      { expectedRevision: 0 },
    )

    await expect(
      store.save({ ...created, name: 'Stale overwrite' }, { expectedRevision: 0 }),
    ).rejects.toThrow(/revision conflict/i)
    await expect(store.open(created.id)).resolves.toEqual(current)
  })

  it.each(['../escape', '..', 'nested/escape', 'C:\\outside'])(
    'rejects traversal-like project ID %s',
    async (id) => {
      const root = await temporaryRoot('path-boundary')
      const store = new VideoProjectStore(root)

      expect(() => store.projectDirectory(id)).toThrow(/invalid project id/i)
      await expect(store.open(id)).rejects.toThrow(/invalid project id/i)
    },
  )
})

describe('cinematic grading filter construction', () => {
  it('recognizes disabled and neutral grades as identity operations', () => {
    expect(isIdentityGrade(undefined)).toBe(true)
    expect(isIdentityGrade({ enabled: false, lutPath: 'missing.cube', exposure: 2 })).toBe(true)
    expect(
      isIdentityGrade({
        enabled: true,
        exposure: 0,
        contrast: 1,
        saturation: 1,
        temperature: 0,
        tint: 0,
        vignette: 0,
        grain: 0,
      }),
    ).toBe(true)
    expect(isIdentityGrade({ enabled: true, contrast: 1.1 })).toBe(false)
  })

  it('escapes filtergraph-sensitive LUT paths and embeds the escaped path', async () => {
    const root = await temporaryRoot('grading-path')
    const lutPath = join(root, "cinema's,final;v1[2].cube")
    await writeFile(lutPath, 'TITLE "fixture"\nLUT_3D_SIZE 2\n')
    const escaped = escapeFilterPath(lutPath)
    const filter = await buildGradeFilter({ enabled: true, lutPath, lutIntensity: 1 })

    expect(escaped).toContain("\\'")
    expect(escaped).toContain('\\,')
    expect(escaped).toContain('\\;')
    expect(escaped).toContain('\\[')
    expect(escaped).toContain('\\]')
    if (/^[A-Za-z]:/.test(lutPath)) expect(escaped).toMatch(/^[A-Za-z]\\:/)
    expect(filter).toContain(`lut3d=file='${escaped}'`)
  })

  it('rejects a missing LUT before constructing an FFmpeg filter', async () => {
    const root = await temporaryRoot('grading-missing')

    await expect(
      buildGradeFilter({ enabled: true, lutPath: join(root, 'missing.cube') }),
    ).rejects.toThrow(/lut file does not exist/i)
  })
})

describe('B-roll cache and provider service', () => {
  it('bounds provider titles before they enter the strict project schema', () => {
    const project = projectFixture()
    const candidate = brollCandidate({ title: `A descriptive stock title ${'detail '.repeat(120)}` })
    const asset = brollAssetForProject(project, candidate, {
      id: candidate.id,
      provider: candidate.provider,
      absolutePath: 'D:\\Mental Empire Studio\\broll-library\\fixture.mp4',
      sha256: 'a'.repeat(64),
      bytes: 123,
      sourceUrl: candidate.sourceUrl,
      cachedAt: '2026-08-02T00:00:00.000Z',
      license: candidate.license,
    })

    expect(asset.name.length).toBeLessThanOrEqual(512)
    expect(() => VideoProjectSchema.parse({ ...project, assets: [asset] })).not.toThrow()
  })

  it('content-addresses local media, deduplicates bytes, and writes a license sidecar', async () => {
    const root = await temporaryRoot('broll-cache')
    const cacheRoot = join(root, 'cache')
    const localPath = join(root, 'city # skyline.mp4')
    const bytes = Buffer.from('deterministic-local-video-fixture')
    await writeFile(localPath, bytes)
    const sourceUrl = pathToFileURL(localPath).toString()
    const candidate = brollCandidate({
      sourceUrl,
      downloadUrl: sourceUrl,
      title: 'Blue-hour city skyline',
      description: 'A slow aerial move over a modern city at blue hour.',
      tags: ['city', 'skyline', 'blue hour'],
    })
    const cache = new BrollCache(cacheRoot)

    const first = await cache.importLocal(localPath, candidate)
    const second = await cache.importLocal(localPath, candidate)
    const expectedHash = createHash('sha256').update(bytes).digest('hex')
    const sidecar = JSON.parse(await readFile(`${first.absolutePath}.license.json`, 'utf8'))
    const cacheEntries = await readdir(cacheRoot)

    expect(first.sha256).toBe(expectedHash)
    expect(first.bytes).toBe(bytes.length)
    expect(second.absolutePath).toBe(first.absolutePath)
    expect(cacheEntries.filter((name) => name === `${expectedHash}.mp4`)).toHaveLength(1)
    expect(cacheEntries.filter((name) => name === `${expectedHash}.mp4.license.json`)).toHaveLength(
      1,
    )
    expect(sidecar).toMatchObject({
      id: candidate.id,
      provider: candidate.provider,
      sha256: expectedHash,
      sourceUrl: candidate.sourceUrl,
      title: candidate.title,
      description: candidate.description,
      tags: candidate.tags,
      width: candidate.width,
      height: candidate.height,
      durationMs: candidate.durationMs,
      license: candidate.license,
    })
  })

  it('searches cached title, tags, and description even when the filename is only a hash', async () => {
    const root = await temporaryRoot('broll-metadata-search')
    const cacheRoot = join(root, 'library')
    const localPath = join(root, 'source.mp4')
    await writeFile(localPath, 'local metadata fixture')
    const sourceUrl = pathToFileURL(localPath).toString()
    const candidate = brollCandidate({
      provider: 'pexels',
      sourceUrl: 'https://www.pexels.com/video/1234/',
      downloadUrl: sourceUrl,
      title: 'Mountain lake at dawn',
      description: 'Mist drifts above a quiet alpine lake during sunrise.',
      tags: ['mountain', 'lake', 'sunrise', 'waterscape'],
    })
    await new BrollCache(cacheRoot).store(candidate)

    const provider = new LocalBrollProvider(cacheRoot)
    const [titleResults, tagResults, descriptionResults] = await Promise.all([
      provider.search({ query: 'dawn' }),
      provider.search({ query: 'waterscape' }),
      provider.search({ query: 'alpine' }),
    ])
    const results = titleResults

    expect(results).toHaveLength(1)
    expect(tagResults).toHaveLength(1)
    expect(descriptionResults).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: candidate.id,
      provider: candidate.provider,
      title: candidate.title,
      description: candidate.description,
      sourceUrl: candidate.sourceUrl,
      tags: candidate.tags,
      license: candidate.license,
    })
    expect(results[0]!.downloadUrl).toMatch(/^file:/u)
  })

  it('rejects insecure remote B-roll downloads before opening a network connection', async () => {
    const root = await temporaryRoot('broll-insecure-url')
    const cacheRoot = join(root, 'cache')
    const cache = new BrollCache(cacheRoot)
    const candidate = brollCandidate({
      sourceUrl: 'http://example.test/videos/insecure',
      downloadUrl: 'http://example.test/videos/insecure.mp4',
    })

    await expect(cache.store(candidate)).rejects.toThrow(/require HTTPS/i)
    expect(await readdir(cacheRoot)).toEqual([])
  })

  it('deduplicates provider results by provider and candidate ID', async () => {
    const root = await temporaryRoot('broll-service')
    const duplicate = brollCandidate({ id: 'duplicate', provider: 'pexels' })
    const unique = brollCandidate({ id: 'unique', provider: 'pixabay' })
    const providers: BrollProvider[] = [
      {
        id: 'provider-a',
        search: async (_query: BrollSearchQuery) => [duplicate, duplicate],
      },
      {
        id: 'provider-b',
        search: async (_query: BrollSearchQuery) => [{ ...duplicate }, unique],
      },
    ]
    const service = new BrollService(new BrollCache(join(root, 'cache')), providers)

    const results = await service.search({ query: 'city skyline' })

    expect(results).toEqual([duplicate, unique])
  })

  it('uses a local match before explicitly selected remote providers', async () => {
    const root = await temporaryRoot('broll-local-first')
    const local = brollCandidate({ id: 'cached', provider: 'pexels' })
    const localSearch = vi.fn(async () => [local])
    const remoteSearch = vi.fn(async () => [brollCandidate({ id: 'remote', provider: 'pixabay' })])
    const service = new BrollService(new BrollCache(join(root, 'cache')), [
      { id: 'local-1', search: localSearch },
      { id: 'pexels', search: remoteSearch },
    ])

    const results = await service.search(
      { query: 'city skyline' },
      { providers: ['pexels'], localFirst: true },
    )

    expect(results).toEqual([local])
    expect(localSearch).toHaveBeenCalledTimes(1)
    expect(remoteSearch).not.toHaveBeenCalled()
  })

  it('falls back remotely when a local path contains only a substring of the keyword', async () => {
    const root = await temporaryRoot('broll-local-whole-keyword')
    const libraryRoot = join(root, 'library')
    await mkdir(libraryRoot, { recursive: true })
    await writeFile(join(libraryRoot, 'location-scouting.mp4'), 'local substring fixture')
    const remote = brollCandidate({ id: 'cat', provider: 'pixabay', title: 'Cat by a window' })
    const remoteSearch = vi.fn(async () => [remote])
    const service = new BrollService(new BrollCache(join(root, 'cache')), [
      new LocalBrollProvider(libraryRoot, 'local-1'),
      { id: 'pixabay', search: remoteSearch },
    ])

    expect(await service.search({ query: 'cat' }, { localFirst: true })).toEqual([remote])
    expect(remoteSearch).toHaveBeenCalledTimes(1)
  })

  it('falls back to remote providers when a local-first search has no match', async () => {
    const root = await temporaryRoot('broll-local-fallback')
    const remote = brollCandidate({ id: 'remote', provider: 'pixabay' })
    const remoteSearch = vi.fn(async () => [remote])
    const service = new BrollService(new BrollCache(join(root, 'cache')), [
      { id: 'local-1', search: async () => [] },
      { id: 'pixabay', search: remoteSearch },
    ])

    expect(await service.search({ query: 'city skyline' }, { localFirst: true })).toEqual([remote])
    expect(remoteSearch).toHaveBeenCalledTimes(1)
  })
})

describe('durable render queue', () => {
  it('completes through a fake adapter and preserves an immutable project snapshot', async () => {
    const root = await temporaryRoot('render-complete')
    const store = new RenderJobStore(join(root, 'jobs'))
    const adapter = new FakeRendererAdapter()
    const queue = new RenderQueue(store, [adapter], 1)
    await queue.initialize()
    const project = projectFixture({ id: 'immutable-project', revision: 7 })
    const originalName = project.name
    const job = await queue.enqueue({
      project,
      outputPath: join(root, 'output.mp4'),
      workDirectory: join(root, 'work'),
    })
    project.name = 'Mutated after enqueue'
    project.revision = 999

    const completed = await waitForJob(queue, job.id, (candidate) => candidate.stage === 'completed')

    expect(completed.progress).toBe(1)
    expect(completed.projectRevision).toBe(7)
    expect(completed.projectSnapshot.name).toBe(originalName)
    expect(completed.projectSnapshot.revision).toBe(7)
    expect(adapter.preparedProjects[0]!.name).toBe(originalName)
    expect(await readFile(completed.outputPath, 'utf8')).toBe('fake-render:immutable-project')
    await queue.shutdown()
  })

  it('honors concurrency one while multiple jobs are queued', async () => {
    const root = await temporaryRoot('render-concurrency')
    const adapter = new FakeRendererAdapter(true)
    const queue = new RenderQueue(new RenderJobStore(join(root, 'jobs')), [adapter], 1)
    await queue.initialize()
    const first = await queue.enqueue({
      project: projectFixture({ id: 'concurrency-one' }),
      outputPath: join(root, 'one.mp4'),
      workDirectory: join(root, 'work'),
    })
    const second = await queue.enqueue({
      project: projectFixture({ id: 'concurrency-two' }),
      outputPath: join(root, 'two.mp4'),
      workDirectory: join(root, 'work'),
    })

    await waitForJob(queue, first.id, (job) => job.stage === 'rendering')
    expect((await queue.get(second.id)).stage).toBe('queued')
    expect(adapter.activeRenders).toBe(1)
    expect(adapter.maxActiveRenders).toBe(1)
    adapter.release()
    await waitForJob(queue, first.id, (job) => job.stage === 'completed')
    await waitForJob(queue, second.id, (job) => job.stage === 'completed')
    expect(adapter.maxActiveRenders).toBe(1)
    await queue.shutdown()
  })

  it('cancels an active job and retries the same durable snapshot', async () => {
    const root = await temporaryRoot('render-retry')
    const adapter = new FakeRendererAdapter(true)
    const queue = new RenderQueue(new RenderJobStore(join(root, 'jobs')), [adapter], 1)
    await queue.initialize()
    const job = await queue.enqueue({
      project: projectFixture({ id: 'retry-project', revision: 3 }),
      outputPath: join(root, 'retry.mp4'),
      workDirectory: join(root, 'work'),
    })
    await waitForJob(queue, job.id, (candidate) => candidate.stage === 'rendering')

    const canceled = await queue.cancel(job.id)
    expect(canceled.stage).toBe('canceled')
    adapter.release()
    const retried = await queue.retry(job.id)
    expect(retried.attempt).toBe(2)
    const completed = await waitForJob(queue, job.id, (candidate) => candidate.stage === 'completed')

    expect(completed.attempt).toBe(2)
    expect(completed.projectRevision).toBe(3)
    expect(completed.errorCode).toBeUndefined()
    await queue.shutdown()
  })

  it('recovers a persisted interrupted job and completes it on initialization', async () => {
    const root = await temporaryRoot('render-recovery')
    const jobsRoot = join(root, 'jobs')
    const workDirectory = join(root, 'work', 'recovered-job')
    await mkdir(workDirectory, { recursive: true })
    const store = new RenderJobStore(jobsRoot)
    const project = projectFixture({ id: 'recovered-project', revision: 4 })
    const interrupted: RenderJobRecord = {
      id: 'recovered-job',
      projectId: project.id,
      projectRevision: project.revision,
      projectHash: 'fixture-hash',
      rendererId: 'remotion',
      outputPath: join(root, 'recovered.mp4'),
      intermediatePath: join(workDirectory, 'ungraded.mp4'),
      workDirectory,
      stage: 'rendering',
      progress: 0.5,
      attempt: 1,
      createdAt: '2026-07-30T10:00:00.000Z',
      updatedAt: '2026-07-30T10:00:01.000Z',
      startedAt: '2026-07-30T10:00:01.000Z',
      projectSnapshot: project,
    }
    await store.save(interrupted)
    const queue = new RenderQueue(store, [new FakeRendererAdapter()], 1)

    await queue.initialize()
    const completed = await waitForJob(
      queue,
      interrupted.id,
      (candidate) => candidate.stage === 'completed',
    )

    expect(completed.progress).toBe(1)
    expect(completed.projectRevision).toBe(4)
    expect(await readFile(completed.outputPath, 'utf8')).toBe('fake-render:recovered-project')
    await queue.shutdown()
  })
})
