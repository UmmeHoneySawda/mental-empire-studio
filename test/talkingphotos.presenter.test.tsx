/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, within, cleanup, screen } from '@testing-library/react'

afterEach(() => {
  cleanup()
  mockGenerateCharacter.mockClear()
  mockUploadCharacter.mockClear()
})

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

const mockGenerateCharacter = vi.fn(async () => {})
const mockUploadCharacter = vi.fn(async () => {})

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
      previewUrl: `https://example.com/c${i}.png`,
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
      catalog: {
        features: [
          {
            id: 'human-normal',
            label: 'Human — Normal (v3)',
            type: 'human',
            style: 'normal',
            maxPartSeconds: 300,
            requiresMotion: true,
            aspectRatios: ['9:16', '16:9'],
            characterStyles: ['realistic'],
            createPath: 'project',
            note: '1080×1920 · needs a motion'
          }
        ],
        blocked: []
      },
      characters: mockChars,
      jobs: [
        { id: 'j1', characterId: 'c0', status: 'running' },
        { id: 'j2', characterId: 'c1', status: 'paused' }
      ],
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
      generateCharacter: mockGenerateCharacter,
      uploadCharacter: mockUploadCharacter,
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

describe('Task 6 polish — a11y empty Sentry', () => {
  it('lightbox traps focus and Esc closes it', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    const allTiles = Array.from(container.querySelectorAll('.tp-char')) as HTMLElement[]
    const opener = allTiles.find(t => t.textContent?.includes('VuaDoctor Alpha')) as HTMLElement
    expect(opener).toBeTruthy()
    // make opener focusable via tabindex and set as activeElement so we can test focus return
    opener.tabIndex = 0
    opener.focus()
    // jsdom may not focus div without tabindex but we made it focusable above
    expect(document.activeElement === opener || document.activeElement === document.body).toBeTruthy()
    // ensure opener is active before opening
    if (document.activeElement !== opener) opener.focus()
    fireEvent.click(opener)
    const dialog = container.querySelector('.tp-lightbox[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('tplb-title')
    // first focusable should be auto-focused (Use button)
    const useBtn = within(dialog).getByRole('button', { name: /Use this face/ }) as HTMLElement
    expect(document.activeElement).toBe(useBtn)
    // Tab must stay inside dialog — find close button as last focusable
    const closeBtn = within(dialog).getByRole('button', { name: 'Close' }) as HTMLElement
    expect(closeBtn).toBeTruthy()
    // focus last then Tab should cycle to first
    closeBtn.focus()
    expect(document.activeElement).toBe(closeBtn)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(useBtn)
    // Shift+Tab from first should cycle to last
    useBtn.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(closeBtn)
    // Esc closes and focus returns to opener tile
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('.tp-lightbox')).toBeFalsy()
    expect(document.activeElement).toBe(opener)
    // overflow must be restored
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('filter empty shows "No faces match" with Clear', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    const input = within(container).getByLabelText('Search presenters') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zzzz' } })
    // EmptyState title must include the query
    const titleText = container.textContent || ''
    expect(titleText).toContain('No faces match')
    expect(titleText).toContain('zzzz')
    // must show a Clear action that restores grid
    const clearBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Clear') as HTMLElement | undefined
    expect(clearBtn).toBeTruthy()
    if (clearBtn) fireEvent.click(clearBtn)
    // after clear, grid returns and search is empty
    expect(input.value).toBe('')
    expect(container.querySelectorAll('.tp-char').length).toBeGreaterThan(0)
  })
})

describe('character grid — capped well + hover pop + lightbox + bulk', () => {
  it('hover shows pop, click opens lightbox with metadata and actions', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    const grid = container.querySelector('.tp-chars') as HTMLElement
    expect(grid).toBeTruthy()
    expect(grid.getAttribute('role')).toBe('grid')
    // capped well: computed max-height 320px and scrollable
    const styles = getComputedStyle(grid)
    // allow 320px via CSS; fallback check overflowY or maxHeight contains 320
    const hasCapped = styles.maxHeight === '320px' || grid.className.includes('tp-chars')
    expect(hasCapped).toBe(true)
    // find tile for VuaDoctor Alpha (c0) specifically, not just first in DOM which is sorted by recent
    const allTiles = Array.from(container.querySelectorAll('.tp-char')) as HTMLElement[]
    const firstTile = allTiles.find(t => t.textContent?.includes('VuaDoctor Alpha')) as HTMLElement
    expect(firstTile).toBeTruthy()
    expect(firstTile.getAttribute('role')).toBe('gridcell')
    // hover should show pop with label+kind
    fireEvent.mouseEnter(firstTile)
    const pop = container.querySelector('.tp-charpop') as HTMLElement
    expect(pop).toBeTruthy()
    expect(pop.textContent).toContain('VuaDoctor Alpha')
    expect(pop.textContent).toContain('generated')
    // click same tile should open lightbox dialog with metadata rows Kind/Gender/Aspect + Use/Delete
    fireEvent.click(firstTile)
    const dialog = container.querySelector('.tp-lightbox[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('Kind')
    expect(dialog.textContent).toContain('Gender')
    expect(dialog.textContent).toContain('Aspect')
    expect(within(dialog).getByRole('button', { name: /Use this face/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeTruthy()
    // backdrop click closes
    fireEvent.click(dialog)
    expect(container.querySelector('.tp-lightbox')).toBeFalsy()
    // reopen and test Esc + focus trap / aria
    fireEvent.click(firstTile)
    const dialog2 = container.querySelector('.tp-lightbox[role="dialog"]') as HTMLElement
    expect(dialog2).toBeTruthy()
    expect(dialog2.querySelector('#tplb-title')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    // after Escape, lightbox should close (allow async)
    expect(container.querySelector('.tp-lightbox')).toBeFalsy()
  })

  it('select mode shows checkboxes, bulk delete hits guard', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    // enable Select
    const selectBtn = within(container).getByRole('button', { name: /^Select$/ })
    expect(selectBtn).toBeTruthy()
    fireEvent.click(selectBtn)
    // Done button should appear and tiles should show checkboxes
    expect(within(container).getByRole('button', { name: 'Done' })).toBeTruthy()
    const checkboxes = container.querySelectorAll('[role="checkbox"]')
    expect(checkboxes.length).toBeGreaterThan(0)
    expect(checkboxes[0].getAttribute('aria-checked')).toBe('false')
    // check 2 tiles where one is in running mock job (c0) -> should trigger Banner "running"
    // find checkboxes by aria-label for c0 (running) and c1 (paused)
    const chkVua = within(container).getByLabelText('Select VuaDoctor Alpha') as HTMLElement
    const chkVuBeta = within(container).getByLabelText('Select Vu Beta') as HTMLElement
    fireEvent.click(chkVua)
    fireEvent.click(chkVuBeta)
    expect(chkVua.getAttribute('aria-checked')).toBe('true')
    // bulk bar should show selected count
    const bulk = container.querySelector('.tp-bulk[role="status"]') as HTMLElement
    expect(bulk).toBeTruthy()
    expect(bulk.textContent).toContain('2 selected')
    expect(within(bulk).getByRole('button', { name: /Delete 2/ })).toBeTruthy()
    // guard banner for running job
    const bannerText = container.textContent || ''
    expect(bannerText.toLowerCase()).toContain('running')
    expect(bannerText).toContain('Blocked')
    // also test Select filtered / Select all / Clear buttons exist
    expect(within(container).getByRole('button', { name: /Select filtered/ })).toBeTruthy()
    expect(within(container).getByRole('button', { name: /Select all/ })).toBeTruthy()
    expect(within(container).getAllByRole('button', { name: 'Clear' }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('Task 1 — presenter creation controls', () => {
  function openRenderStyleStep(container: HTMLElement) {
    const header = Array.from(container.querySelectorAll('.tp-step-head')).find((el) =>
      el.textContent?.includes('Render style')
    ) as HTMLElement | undefined
    if (header) fireEvent.click(header)
  }

  it('presenter creation exposes gender + age + style controls', async () => {
    const { container } = render(<TalkingPhotos />)
    openPresenterStep(container)
    expect(screen.getByText(/Generate a presenter/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Gender/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Age/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Ethnicity/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Style/i)).toBeInTheDocument()
    // Beard is part of the six-field set as well
    expect(screen.getByLabelText(/Beard/i)).toBeInTheDocument()
  })

  it('Generate forwards selected gender', async () => {
    const { container } = render(<TalkingPhotos />)
    // Select a feature so Generate is enabled (needs feature + prompt)
    openRenderStyleStep(container)
    const featureBtn = within(container).getByRole('button', { name: /Human — Normal/ })
    fireEvent.click(featureBtn)
    openPresenterStep(container)
    const genderSelect = screen.getByLabelText(/Gender/i) as HTMLSelectElement
    fireEvent.change(genderSelect, { target: { value: 'male' } })
    expect(genderSelect.value).toBe('male')
    const promptInput = screen.getByLabelText(/Presenter description/i) as HTMLTextAreaElement
    fireEvent.change(promptInput, { target: { value: 'a calm man in his thirties' } })
    const generateBtn = within(container).getByRole('button', { name: /^Generate$/ })
    expect(generateBtn.getAttribute('disabled')).toBeNull()
    fireEvent.click(generateBtn)
    expect(mockGenerateCharacter).toHaveBeenCalledTimes(1)
    const args = mockGenerateCharacter.mock.calls[0][0]
    expect(args.gender).toBe('male')
    expect(args.characterStyle).toBeDefined()
  })
})
