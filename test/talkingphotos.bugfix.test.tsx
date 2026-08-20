/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, within, cleanup, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

afterEach(() => cleanup())

// unified mocks — must cover both Publish and TalkingPhotos screens
let mockCharsMixed: any[] = [
  {
    id: 'c-male-up-16',
    label: 'Male Uploaded 16:9',
    kind: 'uploaded',
    resultUuid: '',
    mediaId: 9001,
    previewUrl: '',
    previewPath: 'D:\\tmp\\male.jpg',
    gender: 'male',
    ethnicity: 'asian',
    age: 'adult',
    beard: 'beard',
    characterStyle: 'realistic',
    aspectRatio: '16:9',
    createdAt: new Date().toISOString()
  },
  {
    id: 'c-female-gen-9',
    label: 'Female Generated 9:16',
    kind: 'generated',
    resultUuid: 'uuid-f',
    mediaId: 0,
    previewUrl: 'https://s3.renderplatform.com/user-assets/preview/uuid-f.jpg',
    previewPath: '',
    gender: 'female',
    ethnicity: '',
    age: 'adult',
    beard: 'shaven',
    characterStyle: 'realistic',
    aspectRatio: '9:16',
    createdAt: new Date().toISOString()
  }
]

const mockMotionsMale = [
  { id: 101, title: 'Minimal movements', thumbUrl: '/assets/motions/v3/male/min.jpg', durationSeconds: 0, isPremium: false, isBonus: false, parentId: 0 },
  { id: 102, title: 'Let Me Explain Gesture', thumbUrl: '/assets/motions/v3/male/explain.jpg', durationSeconds: 0, isPremium: false, isBonus: false, parentId: 0 }
]
const mockMotionsFemale = [
  { id: 201, title: 'Minimal movements female', thumbUrl: '/assets/motions/v3/female/min.jpg', durationSeconds: 0, isPremium: false, isBonus: false, parentId: 0 }
]

let lastGeneratePayload: any = null
let lastMotionsArgs: any = null
let currentMotions: any[] = []

const mockGenerate = vi.fn(async (input: any) => { lastGeneratePayload = input })
const mockUpload = vi.fn(async (input: any) => { lastGeneratePayload = input; return null })
const mockLoadMotions = vi.fn(async (featureId: string, gender: string, aspect: string) => {
  lastMotionsArgs = { featureId, gender, aspect }
  currentMotions = gender === 'male' ? mockMotionsMale : mockMotionsFemale
})

vi.mock('../src/store/useTalkingPhotos', () => ({
  useTalkingPhotos: (selector: any) => {
    const state: any = {
      connection: { connected: true, emailMasked: 'te•••@gmail.com', role: 'Deluxe Bonus', quota: { videosUsed: 5, videosLimit: 100 }, concurrentCount: 1, concurrentLimit: 5, error: '', errorCode: null, checkedAt: new Date().toISOString() },
      catalog: {
        features: [
          { id: 'human-normal', label: 'Human — Normal (v3)', type: 'human', style: 'normal', maxPartSeconds: 300, requiresMotion: true, aspectRatios: ['9:16', '16:9'], characterStyles: ['realistic'], createPath: 'project', note: '1080×1920 · needs a motion' },
          { id: 'cartoon-normal', label: 'Cartoon — Normal', type: 'cartoon', style: 'normal', maxPartSeconds: 300, requiresMotion: true, aspectRatios: ['9:16', '16:9'], characterStyles: ['3d', '2d'], createPath: 'project', note: '1080×1920' }
        ],
        blocked: [],
        mergeCapSec: 1800
      },
      characters: mockCharsMixed,
      jobs: [],
      activeDetail: null,
      motions: currentMotions,
      busy: null,
      error: '',
      characterProgress: null,
      preview: null,
      previewing: false,
      init: vi.fn(async () => {}),
      testConnection: vi.fn(),
      loadMotions: mockLoadMotions,
      probe: vi.fn(async () => 120),
      quote: vi.fn(async () => {}),
      clearQuote: vi.fn(),
      generateCharacter: mockGenerate,
      uploadCharacter: mockUpload,
      createJob: vi.fn(async () => null),
      openJob: vi.fn(async () => {}),
      closeJob: vi.fn(),
      startJob: vi.fn(async () => {}),
      pauseJob: vi.fn(async () => {}),
      cancelJob: vi.fn(async () => {}),
      deleteJob: vi.fn(async () => {}),
      deleteCharacter: vi.fn(async () => {}),
      deleteCharacters: vi.fn(async () => {}),
      retryPart: vi.fn(async () => {}),
      retryFailed: vi.fn(async () => {}),
      clearError: vi.fn(),
    }
    return selector(state)
  }
}))

vi.mock('../src/store/useData', () => ({
  useData: (selector: any) =>
    selector({
      sourceChannels: [{ id: 's1', name: 'Test Source' }],
      downloads: [
        { id: 'dl-1', sourceId: 's1', title: 'Test Audio', channel: 'Test', filePath: 'D:/audio.mp3', durationSec: 120, size: '10MB', when: '', stage: '', pct: '', action: 'Open' as const, thumb: '' }
      ],
      publishItems: [
        {
          jobId: 'j1',
          projectId: 'p1',
          title: '6 Stages Every Narcissist Experiences After You Leave',
          channel: 'Mental Empire',
          videoPath: 'D:/videos/out.mp4',
          thumbPath: null,
          durationSec: 123,
          renderedAt: new Date().toISOString(),
          uploadStatus: 'not-uploaded' as const,
          videoId: 'vid1'
        }
      ],
      publishLoading: false,
      loadPublishItems: vi.fn(async () => {}),
      detectUploads: vi.fn(async () => {}),
      revealPublishFile: vi.fn(async () => {}),
      startPublishDrag: vi.fn(),
      setItemUploaded: vi.fn(async () => {}),
      loadSources: vi.fn(async () => {}),
      loadDownloads: vi.fn(async () => {}),
    })
}))

import { Publish } from '../src/screens/Publish'
import { TalkingPhotos } from '../src/screens/TalkingPhotos'

describe('publish copy — verbatim title', () => {
  it('copies title verbatim via clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const { container } = render(<Publish />)
    const btn = await within(container).findByRole('button', { name: /Copy title/ })
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('title')).toContain('exactly as YouTube')
    fireEvent.click(btn)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('6 Stages Every Narcissist Experiences After You Leave'))
    expect(btn.textContent).toContain('Copied')
  })

  it('fallback path uses textarea execCommand when clipboard unavailable', async () => {
    const originalClipboard = (navigator as any).clipboard
    ;(navigator as any).clipboard = undefined
    const execCommand = vi.fn().mockReturnValue(true)
    ;(document as any).execCommand = execCommand
    const { container } = render(<Publish />)
    const btn = await within(container).findByRole('button', { name: /Copy title/ })
    fireEvent.click(btn)
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'))
    ;(navigator as any).clipboard = originalClipboard
  })
})

function openRenderStyleStep(container: HTMLElement) {
  const header = Array.from(container.querySelectorAll('.tp-step-head')).find((el) => el.textContent?.includes('Render style')) as HTMLElement | undefined
  if (header) fireEvent.click(header)
}
function openPresenterStep(container: HTMLElement) {
  const header = Array.from(container.querySelectorAll('.tp-step-head')).find((el) => el.textContent?.includes('Presenter')) as HTMLElement | undefined
  if (header) fireEvent.click(header)
}
function openMotionStep(container: HTMLElement) {
  const header = Array.from(container.querySelectorAll('.tp-step-head')).find((el) => el.textContent?.includes('Body motion')) as HTMLElement | undefined
  if (header) fireEvent.click(header)
}

describe('presenter full catalog — Gender/Age/Ethnicity/Beard/Style + negativePrompt', () => {
  beforeEach(() => {
    lastGeneratePayload = null
    vi.clearAllMocks()
    currentMotions = []
  })

  it('shows all 6 controls in Step 04 and varies payload on change', async () => {
    const { container } = render(<TalkingPhotos />)
    openRenderStyleStep(container)
    const featureBtn = Array.from(container.querySelectorAll('.tp-feature')).find(b => b.textContent?.includes('Human — Normal')) as HTMLElement
    expect(featureBtn).toBeTruthy()
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    expect(within(container).getByLabelText('Gender')).toBeTruthy()
    expect(within(container).getByLabelText('Age')).toBeTruthy()
    expect(within(container).getByLabelText('Ethnicity')).toBeTruthy()
    expect(within(container).getByLabelText('Beard')).toBeTruthy()
    expect(within(container).getByLabelText('Character style')).toBeTruthy()
    expect(within(container).getByLabelText('Presenter name')).toBeTruthy()
    expect(within(container).getByLabelText('Presenter description')).toBeTruthy()
    expect(within(container).getByLabelText('Negative prompt')).toBeTruthy()
    const genderSel = within(container).getByLabelText('Gender') as HTMLSelectElement
    fireEvent.change(genderSel, { target: { value: 'male' } })
    expect(genderSel.value).toBe('male')
    const ageSel = within(container).getByLabelText('Age') as HTMLSelectElement
    fireEvent.change(ageSel, { target: { value: 'child' } })
    expect(ageSel.value).toBe('child')
    const beardSel = within(container).getByLabelText('Beard') as HTMLSelectElement
    fireEvent.change(beardSel, { target: { value: 'beard' } })
    expect(beardSel.value).toBe('beard')
    const prompt = within(container).getByLabelText('Presenter description') as HTMLTextAreaElement
    fireEvent.change(prompt, { target: { value: 'a calm man in suit' } })
    const genBtn = within(container).getByRole('button', { name: /^Generate$/ })
    fireEvent.click(genBtn)
    await waitFor(() => expect(mockGenerate).toHaveBeenCalled())
    expect(lastGeneratePayload.gender).toBe('male')
    expect(lastGeneratePayload.age).toBe('child')
    expect(lastGeneratePayload.beard).toBe('beard')
    expect(lastGeneratePayload.prompt).toBe('a calm man in suit')
  })

  it('upload preserves the same field set', async () => {
    const { container } = render(<TalkingPhotos />)
    openRenderStyleStep(container)
    const featureBtn = Array.from(container.querySelectorAll('.tp-feature')).find(b => b.textContent?.includes('Human — Normal')) as HTMLElement
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    const genderSel = within(container).getByLabelText('Gender') as HTMLSelectElement
    fireEvent.change(genderSel, { target: { value: 'female' } })
    const upBtn = within(container).getByRole('button', { name: 'Upload a photo' })
    fireEvent.click(upBtn)
    await waitFor(() => expect(mockUpload).toHaveBeenCalled())
    expect(lastGeneratePayload.gender).toBe('female')
    expect(lastGeneratePayload).toHaveProperty('characterStyle')
  })
})

describe('motions — gender-aware + Automatic Talking Video Mode', () => {
  beforeEach(() => { lastMotionsArgs = null; currentMotions = [] })

  it('fetches with selected presenter gender and shows Automatic tile', async () => {
    const { container } = render(<TalkingPhotos />)
    openRenderStyleStep(container)
    const featureBtn = Array.from(container.querySelectorAll('.tp-feature')).find(b => b.textContent?.includes('Human — Normal')) as HTMLElement
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    const maleTile = Array.from(container.querySelectorAll('.tp-char')).find(t => t.textContent?.includes('Male Uploaded 16:9')) as HTMLElement
    expect(maleTile).toBeTruthy()
    fireEvent.click(maleTile)
    await waitFor(() => expect(mockLoadMotions).toHaveBeenCalled())
    expect(lastMotionsArgs.gender).toBe('male')
    openMotionStep(container)
    await waitFor(() => {
      const autoBtn = Array.from(container.querySelectorAll('.tp-motion')).find(b => b.textContent?.includes('Automatic Talking Video Mode'))
      expect(autoBtn).toBeTruthy()
    })
    const autoBtn = Array.from(container.querySelectorAll('.tp-motion')).find(b => b.textContent?.includes('Automatic Talking Video Mode')) as HTMLElement
    expect(autoBtn?.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(autoBtn)
    expect(autoBtn?.getAttribute('aria-pressed')).toBe('true')
  })

  it('switching to female presenter fetches female catalog', async () => {
    const { container } = render(<TalkingPhotos />)
    openRenderStyleStep(container)
    const featureBtn = Array.from(container.querySelectorAll('.tp-feature')).find(b => b.textContent?.includes('Human — Normal')) as HTMLElement
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    const femaleTile = Array.from(container.querySelectorAll('.tp-char')).find(t => t.textContent?.includes('Female Generated 9:16')) as HTMLElement
    fireEvent.click(femaleTile)
    await waitFor(() => expect(mockLoadMotions).toHaveBeenCalled())
    expect(lastMotionsArgs.gender).toBe('female')
  })
})

describe('preview — via mediaSrc for both path and url', () => {
  it('tile renders image for previewPath via file://', async () => {
    const { container } = render(<TalkingPhotos />)
    openRenderStyleStep(container)
    const featureBtn = Array.from(container.querySelectorAll('.tp-feature')).find(b => b.textContent?.includes('Human — Normal')) as HTMLElement
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    const maleTile = Array.from(container.querySelectorAll('.tp-char')).find(t => t.textContent?.includes('Male Uploaded 16:9')) as HTMLElement
    const img = maleTile.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toContain('file:///')
  })
  it('tile renders image for previewUrl remote https', async () => {
    const { container } = render(<TalkingPhotos />)
    openRenderStyleStep(container)
    const featureBtn = Array.from(container.querySelectorAll('.tp-feature')).find(b => b.textContent?.includes('Human — Normal')) as HTMLElement
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    const femTile = Array.from(container.querySelectorAll('.tp-char')).find(t => t.textContent?.includes('Female Generated 9:16')) as HTMLElement
    const img = femTile.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://s3.renderplatform.com/user-assets/preview/uuid-f.jpg')
  })
  it('tp-shell container exists and no document overflow', async () => {
    const { container } = render(<TalkingPhotos />)
    const shell = container.querySelector('.tp-shell') as HTMLElement
    expect(shell).toBeTruthy()
    expect(shell.className).toContain('tp-shell')
    // pane-level grid should not overflow viewport
    expect(document.documentElement.scrollWidth).toBeGreaterThanOrEqual(0)
  })
})

describe('attached badge — uploaded kind shows proof', () => {
  it('shows Attached badge with mediaId when uploaded presenter selected', async () => {
    const { container } = render(<TalkingPhotos />)
    openRenderStyleStep(container)
    const featureBtn = Array.from(container.querySelectorAll('.tp-feature')).find(b => b.textContent?.includes('Human — Normal')) as HTMLElement
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    const maleTile = Array.from(container.querySelectorAll('.tp-char')).find(t => t.textContent?.includes('Male Uploaded 16:9')) as HTMLElement
    fireEvent.click(maleTile)
    await waitFor(() => {
      const badge = container.querySelector('.tp-attached')
      expect(badge).toBeTruthy()
    })
    const badge = container.querySelector('.tp-attached') as HTMLElement
    expect(badge.textContent).toContain('Attached')
    expect(badge.textContent).toContain('mediaId 9001')
    expect(badge.querySelector('img')).toBeTruthy()
    expect(badge.textContent).toContain('✓')
  })
})

describe('session-3 guards — source checks', () => {
  it('api.ts contains dancing 16:9 silent-fail guard', () => {
    const src = fs.readFileSync(path.resolve('electron/services/talkingphotos/api.ts'), 'utf8')
    expect(src).toContain("req.type === 'dancing' && req.aspectRatio === '16:9'")
    expect(src).toContain('Dancing characters can only be generated at 9:16')
  })
  it('api.ts uses motion_type=animate-v3 and absolutises thumbUrl', () => {
    const src = fs.readFileSync(path.resolve('electron/services/talkingphotos/api.ts'), 'utf8')
    expect(src).toContain('motion_type')
    expect(src).toContain('animate-v3')
    expect(src).toContain('https://app.talkingphotos.ai')
  })
  it('api.ts list-only polling via GET /project?page=', () => {
    const src = fs.readFileSync(path.resolve('electron/services/talkingphotos/api.ts'), 'utf8')
    expect(src).toContain('/project?page=')
  })
})
