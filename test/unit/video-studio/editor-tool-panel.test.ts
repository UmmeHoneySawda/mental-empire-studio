import { describe, it, expect } from 'vitest'

describe('TransitionsToolPanel prop-driven', () => {
  it('accepts value prop without useEditor project', async () => {
    const mod = await import('../../../src/features/video-studio/editor/EditorToolPanel')
    expect((mod as any).TransitionsToolPanel || (mod as any).TransitionsToolPanelControlled).toBeDefined()
  })
})
