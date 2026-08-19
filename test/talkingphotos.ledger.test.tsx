/** @vitest-environment jsdom */
import '../src/screens/talkingphotos/talkingphotos.css'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Ledger } from '../src/screens/TalkingPhotos'
import type { TpJobDetail } from '@shared/talkingphotos'
import { TP_MERGE_CAP_SECONDS } from '@shared/talkingphotos'

// synthetic harness: one ledger with one error row, read computed grid
function LedgerFixture() {
  return (
    <div className="tp-shell" style={{ width: 1100 }}>
      <div className="tp-ledger">
        <div className="tp-colhead">Plan</div><div className="tp-railhead">Chunk</div><div className="tp-colhead is-live">Live</div>
        <div className="tp-body">
          <div className="tp-outputband"><span className="tp-outputband-title">Video 1</span><span className="tp-meas">0:00–28:59</span><span className="tp-meas">28:59</span><span style={{flex:1}}/><span className="tp-meas">0/6</span><span>pill</span></div>
          <div className="tp-row">
            <div className="tp-cell plan"><span className="tp-meas">9:39–14:29</span><span className="tp-meas">4:49</span></div>
            <div className="tp-detent">03 <span className="tp-mark is-void"/></div>
            <div className="tp-cell tp-cell-live"><span className="state">Vendor rejected the audio chunk — retry to finish this video</span><span className="tp-meas">4:49</span><button>Retry</button></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function makeErrorDetail(): TpJobDetail {
  const jobId = 'test-job-1'
  const outputId = `${jobId}-o1`
  return {
    job: {
      id: jobId, sourceId: 's1', sourceVideoId: 'vid1', channel: '@test', videoTitle: 'Test Video',
      audioPath: '/tmp/test.mp3', sourceDurationSec: 600,
      featureId: 'human-normal', aspectRatio: '9:16', partSeconds: 300, mergeCapSec: TP_MERGE_CAP_SECONDS,
      characterId: 'c1', characterResultUuid: 'uuid-1', characterMediaId: 0,
      characterStyle: 'realistic', characterGender: 'female', characterAge: 'adult',
      characterEthnicity: '', characterBeard: 'shaven', motionId: 0, parentMotionId: 0,
      libraryCategoryId: 0, phase: 'await', status: 'running', error: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    },
    outputs: [{
      id: outputId, jobId, ord: 1, startSec: 0, endSec: 300,
      mergeProjectId: 0, status: 'waiting', localPath: '', error: ''
    }],
    parts: [{
      id: `${outputId}-p1`, jobId, outputId, ord: 1, startSec: 0, endSec: 300,
      audioPath: '/tmp/part.mp3', audioDurationSec: 300,
      mediaId: 1, projectId: 1, remoteTitle: `ME-${jobId}-o1-p1`,
      status: 'error', attempts: 1, error: 'Vendor rejected the audio chunk'
    }]
  }
}

describe('ledger rail', () => {
  it('pins Plan at ~260 and keeps Live measurement visible', () => {
    const { container } = render(<LedgerFixture />)
    const live = container.querySelector('.tp-cell-live') as HTMLElement
    const state = live.querySelector('.state') as HTMLElement
    // before fix: live is one flex row, long state pushes button out
    // after fix: Live must be a 3-slot grid with ellipsis on the state
    expect(getComputedStyle(live).display).toBe('grid')
    expect(getComputedStyle(state).textOverflow).toBe('ellipsis')
  })
  it('shares --tp-rail between header and body', () => {
    const { container } = render(<LedgerFixture />)
    const ledger = container.querySelector('.tp-ledger') as HTMLElement
    expect(getComputedStyle(ledger).getPropertyValue('--tp-rail').trim()).toBeTruthy()
  })
  it('renders Plan cell as .plan and Live cell as .live with .state', () => {
    const detail = makeErrorDetail()
    const { container } = render(<Ledger detail={detail} onRetryPart={() => {}} />)
    const row = container.querySelector('.tp-row') as HTMLElement
    expect(row).toBeTruthy()
    const planCell = row.querySelector('.tp-cell.plan') as HTMLElement
    expect(planCell).toBeTruthy()
    const liveCell = row.querySelector('.tp-cell.live') as HTMLElement
    expect(liveCell).toBeTruthy()
    // live cell must also carry .tp-cell-live for backward compat
    expect(liveCell.classList.contains('tp-cell-live')).toBe(true)
    const state = liveCell.querySelector('.state') as HTMLElement
    expect(state).toBeTruthy()
    expect(state.textContent).toContain('Vendor rejected the audio chunk')
    expect(state.style.color).toBe('var(--err-2)')
    expect(state.title).toBeTruthy()
  })
  it('wires plan/live grid slots in source (supplemental file-content check)', () => {
    const src = fs.readFileSync(path.resolve('src/screens/TalkingPhotos.tsx'), 'utf8')
    expect(src).toMatch(/className="tp-cell plan"/)
    expect(src).toMatch(/className="tp-cell tp-cell-live live"/)
    expect(src).toMatch(/className="state"/)
    const planMatches = (src.match(/className="tp-cell plan"/g) || []).length
    expect(planMatches).toBeGreaterThanOrEqual(2)
  })
})
