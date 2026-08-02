import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runHyperframeLint } from '@hyperframes/producer'
import { describe, expect, it } from 'vitest'
import { CAPTION_STYLE_IDS, VideoProjectSchema } from '../../../shared/video-engine'
import { BUILTIN_VIDEO_TEMPLATES } from '../../../electron/services/video-engine/templates/builtins'
import {
  HYPERFRAMES_CAPTION_TEMPLATE_IDS,
  compileHyperframesProject,
  createHyperframesSmokeProject,
  getHyperframesTemplateManifest,
  hyperframesCaptionStyle,
  openHyperframesEditingSession,
} from '../../../video-engine/hyperframes'
import {
  HOOK_TEMPLATE_IDS,
  REMOTION_CAPTION_TEMPLATE_IDS,
} from '../../../video-engine/remotion/constants'

const canonicalHyperframesCaptionIds = CAPTION_STYLE_IDS.map(
  (id) => `hyperframes-caption-${id}`,
)

describe('renderer template alignment', () => {
  it('advertises only hook and caption IDs implemented by Remotion', () => {
    const remotion = BUILTIN_VIDEO_TEMPLATES.filter(
      (template) => template.rendererId === 'remotion',
    )
    const hooks = remotion.filter((template) => template.kind === 'hook')
    const captions = remotion.filter((template) => template.kind === 'caption')
    expect(hooks).toHaveLength(7)
    expect(captions).toHaveLength(10)
    expect(hooks.every((template) => HOOK_TEMPLATE_IDS.has(template.id))).toBe(true)
    expect(captions.map((template) => template.id).sort()).toEqual(
      [...REMOTION_CAPTION_TEMPLATE_IDS].sort(),
    )
  })

  it('advertises only hook and caption IDs implemented by HyperFrames', () => {
    const hyperframes = BUILTIN_VIDEO_TEMPLATES.filter(
      (template) => template.rendererId === 'hyperframes',
    )
    const hooks = hyperframes.filter((template) => template.kind === 'hook')
    const captions = hyperframes.filter((template) => template.kind === 'caption')
    expect(hooks).toHaveLength(2)
    expect(captions).toHaveLength(10)
    for (const template of [...hooks, ...captions]) {
      expect(getHyperframesTemplateManifest(template.id, template.version)).toBeDefined()
    }
  })

  it('keeps legacy HyperFrames caption aliases in addition to the ten canonical styles', () => {
    expect(HYPERFRAMES_CAPTION_TEMPLATE_IDS).toEqual(
      expect.arrayContaining([
        ...canonicalHyperframesCaptionIds,
        'caption-clean',
        'caption-karaoke',
        'caption-punch',
      ]),
    )
  })
})

describe.each(canonicalHyperframesCaptionIds)('HyperFrames caption %s', (templateId) => {
  it('compiles a local, lint-clean composition with its own style class', async () => {
    const base = createHyperframesSmokeProject()
    const project = VideoProjectSchema.parse({
      ...base,
      captions: {
        ...base.captions!,
        templateId,
      },
    })
    const compiled = compileHyperframesProject(project)
    expect(compiled.html).toContain(`hf-caption-${hyperframesCaptionStyle(templateId)}`)
    expect(compiled.html).toContain('--hfCaptionImportant')
    expect(compiled.html).not.toMatch(/https?:\/\//u)
    const lint = await runHyperframeLint({
      entryFile: 'index.html',
      html: compiled.html,
      source: 'html',
    })
    expect(
      lint.findings
        .filter((finding) => finding.severity === 'error')
        .map((finding) => `${finding.code}: ${finding.message}`),
    ).toEqual([])
  })
})

describe('HyperFrames headless editing', () => {
  it('edits stable fields with persistence and undo/redo without exposing raw script mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mental-empire-hf-editor-'))
    const html = compileHyperframesProject(createHyperframesSmokeProject()).html
    const session = await openHyperframesEditingSession(html, {
      rootDirectory: root,
      persistPath: 'composition.html',
      coalesceMs: 0,
    })
    try {
      expect(
        session.elements().some((element) => element.id === 'scene:title-scene:headline'),
      ).toBe(true)
      session.setText('scene:title-scene:headline', 'A stronger edited hook.')
      expect(session.serialize()).toContain('A stronger edited hook.')
      expect(session.canUndo()).toBe(true)
      expect(session.undo()).toBe(true)
      expect(session.serialize()).toContain('Deliver the promise.')
      expect(session.redo()).toBe(true)
      session.setVariable('hfCaptionImportant', '#FF00AA')
      await session.flush()
      expect(await readFile(join(root, 'composition.html'), 'utf8')).toContain(
        'A stronger edited hook.',
      )
    } finally {
      await session.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
