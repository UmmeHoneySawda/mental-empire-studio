import { describe, it, expect } from 'vitest'
import { buildAutomationDraft, pickRotationSource, visualTemplateToStyleConfig } from '../../shared/automationTemplate'
import { DEFAULT_AUTOMATION_STYLE } from '../../shared/automationConfig'
import type { VisualTemplate } from '../../shared/types'

/** The Automations launch button used to call a second pipeline that never reached the
 *  Supervisor, so a saved template's fields were silently dropped (diag-automation F1/F4).
 *  These tests pin the one place the two vocabularies meet. */

const template = (over: Partial<VisualTemplate> = {}): VisualTemplate => ({
  id: 'tpl-1',
  name: 'Test System',
  mode: 'Auto B-roll',
  density: 'Full',
  order: 'Shuffle',
  motion: 'Cinematic',
  transition: 'crossfade',
  grade: 'Intense',
  captionStyle: 'motivation-bold',
  aspectRatio: '9:16',
  hookLine: 'HOOK',
  zoomAtStart: true,
  ...over
})

const source = { id: 'src-1', url: 'https://youtube.com/@example', name: 'Example Source' }

describe('visualTemplateToStyleConfig', () => {
  it('maps the look controls onto the Supervisor vocabulary', () => {
    const style = visualTemplateToStyleConfig(template())
    expect(style.videoStyle).toBe('Intense')
    expect(style.motionPreset).toBe('cinematic')
    expect(style.brollDensity).toBe('full')
    expect(style.aspectRatio).toBe('9:16')
    expect(style.captionPreset).toBe('Hormozi')
    expect(style.brollShufflePolicy).toBe('per-video')
  })

  it('turns b-roll off for an image slideshow, and on for Auto B-roll', () => {
    expect(visualTemplateToStyleConfig(template({ mode: 'Image slideshow' })).brollMode).toBe('off')
    expect(visualTemplateToStyleConfig(template({ mode: 'Image slideshow' })).imageMode).toBe('sequence')
    expect(visualTemplateToStyleConfig(template({ mode: 'Auto B-roll' })).brollMode).toBe('full')
    expect(visualTemplateToStyleConfig(template({ mode: 'Auto B-roll' })).imageMode).toBe('pool')
  })

  it('converts a transition preset to crossfade seconds at the table’s 30fps', () => {
    expect(visualTemplateToStyleConfig(template({ transition: 'crossfade' })).crossfadeSec).toBe(1)
    expect(visualTemplateToStyleConfig(template({ transition: 'fade-quick' })).crossfadeSec).toBe(0.5)
    expect(visualTemplateToStyleConfig(template({ transition: 'cut' })).crossfadeSec).toBe(0)
  })

  it('maps In order to a deterministic shuffle policy', () => {
    expect(visualTemplateToStyleConfig(template({ order: 'In order' })).brollShufflePolicy).toBe('ranked')
  })

  it('falls back to the canonical defaults when no template is chosen', () => {
    expect(visualTemplateToStyleConfig(undefined)).toEqual(DEFAULT_AUTOMATION_STYLE)
  })

  it('carries the hook line through, and an empty one still enables the auto hook', () => {
    /* `queue.ts` writes a hook from the first eight transcribed words when the text is
       empty but the hook is enabled, so an empty hookLine must not disable the card. */
    expect(visualTemplateToStyleConfig(template({ hookLine: 'STOP SCROLLING' })).hookText).toBe('STOP SCROLLING')
    expect(visualTemplateToStyleConfig(template({ hookLine: '' })).hookEnabled).toBe(true)
  })

  it('passes zoomAtStart through instead of inferring it from the grade', () => {
    expect(visualTemplateToStyleConfig(template({ zoomAtStart: false })).zoomAtStart).toBe(false)
    expect(visualTemplateToStyleConfig(template({ zoomAtStart: true })).zoomAtStart).toBe(true)
  })
})

describe('pickRotationSource', () => {
  it('draws the source that has waited longest', () => {
    const picked = pickRotationSource([
      { id: 'b', lastDrawnAt: '2026-08-05T10:00:00.000Z' },
      { id: 'a', lastDrawnAt: '2026-08-01T10:00:00.000Z' },
      { id: 'c', lastDrawnAt: '2026-08-03T10:00:00.000Z' }
    ])
    expect(picked?.id).toBe('a')
  })

  it('prefers a source that has never been drawn', () => {
    const picked = pickRotationSource([
      { id: 'b', lastDrawnAt: '2026-08-01T10:00:00.000Z' },
      { id: 'never' }
    ])
    expect(picked?.id).toBe('never')
  })

  it('actually rotates: drawing twice in a row picks two different sources', () => {
    /* The old flat `IN (…) ORDER BY ord` union always drew from the same source, which is
       why the screen's "Rotation Sources" label was fiction. */
    const sources = [{ id: 'a' }, { id: 'b' }] as Array<{ id: string; lastDrawnAt?: string }>
    const first = pickRotationSource(sources)!
    first.lastDrawnAt = '2026-08-05T10:00:00.000Z'
    const second = pickRotationSource(sources)!
    expect(first.id).not.toBe(second.id)
  })

  it('is deterministic when nothing has been drawn yet', () => {
    expect(pickRotationSource([{ id: 'z' }, { id: 'a' }])?.id).toBe('a')
  })

  it('returns undefined when the channel has no eligible source', () => {
    expect(pickRotationSource([])).toBeUndefined()
  })
})

describe('buildAutomationDraft', () => {
  it('produces a saved-source draft the Supervisor can run', () => {
    const draft = buildAutomationDraft({ source, count: 4, template: template(), channelName: 'My Channel' })
    expect(draft.goal).toBe('source-to-export')
    expect(draft.config.sourceKind).toBe('saved-source')
    expect(draft.config.sourceId).toBe('src-1')
    expect(draft.config.sourceUrl).toBe('https://youtube.com/@example')
    expect(draft.config.sourceCount).toBe(4)
    expect(draft.name).toBe('My Channel — Test System')
  })

  it('enables the autoBroll rule so preflight’s visual-media blocker is satisfied', () => {
    /* preflight blocks on "at least one image or enable Auto B-roll"; an Auto B-roll
       template must therefore set the rule, not just the style. */
    expect(buildAutomationDraft({ source, count: 1, template: template() }).config.rules.autoBroll).toBe(true)
    expect(
      buildAutomationDraft({ source, count: 1, template: template({ mode: 'Image slideshow' }) }).config.rules.autoBroll
    ).toBe(false)
  })

  it('keeps the legacy style mirrors consistent with styleConfig', () => {
    const { config } = buildAutomationDraft({ source, count: 2, template: template() })
    expect(config.style).toBe(config.styleConfig.videoStyle)
    expect(config.captionPreset).toBe(config.styleConfig.captionPreset)
    expect(config.aspectRatios).toEqual([config.styleConfig.aspectRatio])
  })

  it('never asks the Supervisor for fewer than one video', () => {
    expect(buildAutomationDraft({ source, count: 0, template: template() }).config.sourceCount).toBe(1)
  })

  it('names the job after the source when no channel or template is given', () => {
    expect(buildAutomationDraft({ source, count: 1 }).name).toBe('Example Source')
  })

  it('maps template imagePaths into draft assetPaths for image slideshow templates', () => {
    const draft = buildAutomationDraft({
      source,
      count: 1,
      template: template({ mode: 'Image slideshow', imagePaths: ['/path/to/img1.jpg', '/path/to/img2.jpg'] })
    })
    expect(draft.config.assetPaths).toEqual(['/path/to/img1.jpg', '/path/to/img2.jpg'])
  })
})
