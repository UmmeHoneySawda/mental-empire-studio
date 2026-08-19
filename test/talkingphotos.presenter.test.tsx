/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, within, cleanup } from '@testing-library/react'

afterEach(() => cleanup())

vi.mock('../electron/db', () => ({
  getRepos: () => ({
    tpJobs: () => [
      { id: 'j1', characterId: 'c-run', status: 'running' },
      { id: 'j2', characterId: 'c-pause', status: 'paused' }
    ],
    tpCharacters: () => [{ id: 'c1' }, { id: 'c2' }],
    deleteTpCharacter: vi.fn(),
    deleteTpJob: vi.fn()
  })
}))

// --- presenter toolbar mocks ---
const mockChars = (() => {
  const chars: any[] = []
  for (let i = 0; i < 24; i++) {
    const isVu = i === 0 || i === 1
    const label = isVu ? (i === 0 ? 'VuaDoctor Alpha' : 'Vu Beta') : `Presenter ${i}`
    const kind = i < 10 ? 'generated' : 'uploaded'
    const aspectRatio = i % 2 === 0 ? '9:16' : '16:9'
    // stagger createdAt for sort test: recent = higher i is newer
    const createdAt = new Date(Date.UTC(2026, 0, 10 + i)).toISOString()
    chars.push({
      id: `c${i}`,
      label,
      kind,
      resultUuid: `uuid-${i}`,
      mediaId: i,
      previewUrl: '',
      previewPath: '',
      gender: 'female',
      ethnicity: '',
      age: 'adult',
      beard: 'shaven',
      characterStyle: 'realistic',
      aspectRatio,
      createdAt
    })
  }
  return chars
})()

vi.mock('../src/store/useTalkingPhotos', () => ({
  useTalkingPhotos: (selector: any) =>
    selector({
      connection: { connected: true, emailMasked: '', role: '', quota: null, concurrentCount: 0, concurrentLimit: 0, error: '', errorCode: null, checkedAt: '' },
      catalog: { features: [], blocked: [] },
      characters: mockChars,
      jobs: [],
      activeDetail: null,
      motions: [],
      busy: null,
      error: '',
      characterProgress: null,
      preview: null,
      previewing: false,
      init: vi.fn(async () => {}),
      testConnection: vi.fn(),
      loadMotions: vi.fn(async () => {}),
      probe: vi.fn(async () => 0),
      quote: vi.fn(async () => {}),
      clearQuote: vi.fn(),
      generateCharacter: vi.fn(async () => {}),
      uploadCharacter: vi.fn(async () => {}),
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
      retryFailed: vi.fn(async () => {})
    })
}))

vi.mock('../src/store/useData', () => ({
  useData: (selector: any) =>
    selector({
      sourceChannels: [],
      downloads: [],
      loadSources: vi.fn(async () => {}),
      loadDownloads: vi.fn(async () => {})
    })
}))

import { TalkingPhotos } from '../src/screens/TalkingPhotos'

function openPresenterStep(container: HTMLElement) {
  // Step 04 is closed by default (step===1). Click its header to open.
  const header = Array.from(container.querySelectorAll('.tp-step-head')).find((el) =>
    el.textContent?.includes('Presenter')
  ) as HTMLElement | undefined
  if (header) fireEvent.click(header)
}

describe('characterDeleteBulk guard', () => {
  it('blocks when any selected id is in a running job', async () => {
    const mod = await import('../electron/ipc/talkingphotos')
    await expect(mod.__testDeleteBulk(['c-run'])).rejects.toThrow('running')
  })
  it('allows paused jobs but returns their ids for confirm', async () => {
    const mod = await import('../electron/ipc/talkingphotos')
    const res = await mod.__testDeleteBulkDryRun(['c-pause'])
    expect(res.pausedJobIds).toEqual(['j2'])
  })
})

describe('presenter toolbar — search + chips + sort + density', () => {
  it('search filters live: typing "vu" shows 2 of 24', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    const input = within(container).getByLabelText('Search presenters') as HTMLInputElement
    expect(input).toBeTruthy()
    // initial shows 24
    expect(container.textContent).toContain('Showing')
    // type "vu"
    fireEvent.change(input, { target: { value: 'vu' } })
    // subbar should update to 2 of 24 filtered
    const filteredText = container.querySelector('.tp-pres-subbar')?.textContent || container.textContent || ''
    expect(filteredText).toContain('2')
    expect(filteredText).toContain('24')
    expect(filteredText.toLowerCase()).toContain('filtered')
    // grid has 2 tiles
    const tiles = container.querySelectorAll('.tp-char')
    expect(tiles.length).toBe(2)
  })

  it('chips: Generated filters to Uploaded set', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    // Generated
    const genBtn = within(container).getByRole('button', { name: /^Generated$/ })
    fireEvent.click(genBtn)
    let tiles = container.querySelectorAll('.tp-char')
    expect(tiles.length).toBe(10)
    let subbar = container.querySelector('.tp-pres-subbar')?.textContent || ''
    expect(subbar).toContain('10')
    // Uploaded
    const upBtn = within(container).getByRole('button', { name: /^Uploaded$/ })
    fireEvent.click(upBtn)
    tiles = container.querySelectorAll('.tp-char')
    expect(tiles.length).toBe(14)
    subbar = container.querySelector('.tp-pres-subbar')?.textContent || ''
    expect(subbar).toContain('14')
  })

  it('has required toolbar elements: chips All/9:16/16:9, sort Recent/A-Z, density toggle', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    expect(within(container).getByLabelText('Search presenters')).toBeTruthy()
    expect(within(container).getByRole('toolbar', { name: 'Presenter filters' })).toBeTruthy()
    expect(within(container).getByRole('group', { name: 'Filter presenters' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: /All 24/ })).toBeTruthy()
    expect(within(container).getByRole('button', { name: '9:16' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: '16:9' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Recent' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'A-Z' })).toBeTruthy()
    // density toggle: initially Comfortable-> Compact label, then toggles
    const densityBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Compact') || b.textContent?.includes('Comfortable')
    ) as HTMLElement
    expect(densityBtn).toBeTruthy()
    const charsEl = container.querySelector('.tp-chars') as HTMLElement
    expect(charsEl).toBeTruthy()
    expect(charsEl.className).toContain('is-comfortable')
    if (densityBtn) fireEvent.click(densityBtn)
    expect(charsEl.className).toContain('is-compact')
  })
})
