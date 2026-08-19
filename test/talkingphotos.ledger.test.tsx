/** @vitest-environment jsdom */
import '../src/screens/talkingphotos/talkingphotos.css'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

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
})
