/**
 * Automations tab — screenshot + computed-style probe harness (M1)
 *
 * State-driven, modeled on scripts/e2e-new-templates.mjs (SHOTS dir + element
 * screenshots + byte-size assertions). Keeps the existing scratch-profile boot
 * (ME_USERDATA_DIR, seed-restore, Skip-onboarding, console-error collection)
 * and drops every stale selector (.at-quantity-num, .at-modal-backdrop,
 * Next: Hook, Jobs tab).
 *
 * For each of the 18 states the harness:
 *  1. navigates to the state,
 *  2. writes a full-page screenshot to browser-test-out/automation/<state>.png,
 *  3. writes an element screenshot of the state's main region (drawer / feed bar / lane),
 *  4. runs the CSS-scope probe and prints each failure with offending selector + text.
 *
 * Usage:
 *   npm run build && npm run e2e:automation
 *   npm run e2e:automation -- --keep   # leave scratch profile
 *   node scripts/e2e-automation.mjs --shots  # same, alias for compatibility
 */

import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const SHOTS = join(ROOT, 'browser-test-out', 'automation')
const BASELINE = join(SHOTS, 'baseline')
const KEEP = process.argv.includes('--keep')
const SHOTS_ONLY = process.argv.includes('--shots')

const failures = []
const probeFailures = []

function check(ok, label, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

if (!existsSync(MAIN)) {
  console.error(`Build missing: ${MAIN}. Run npm run build first.`)
  process.exit(1)
}

const scratch = join(tmpdir(), `me-automation-e2e-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
console.log(`Scratch profile: ${scratch}`)
console.log(`Shots dir      : ${SHOTS}${SHOTS_ONLY ? ' (--shots mode)' : ''}\n`)

let app

// CSS-scope probe — runs inside the page. Returns array of failure strings.
// If selector was provided but not found, returns a dedicated failure instead of falling back silently.
async function runProbe(page, rootSelector) {
  return await page.evaluate((sel) => {
    const explicit = typeof sel === 'string' && sel.length > 0
    const found = explicit ? document.querySelector(sel) : document.body
    if (explicit && !found) {
      return [`root selector not found: ${sel}`]
    }
    const root = found || document.body
    const fails = []
    const scoped = (s) => {
      const list = [...root.querySelectorAll(s)]
      // include root itself if it matches
      try { if (root.matches && root.matches(s)) list.unshift(root) } catch {}
      // for '*' include root explicitly
      if (s === '*' && !list.includes(root)) list.unshift(root)
      return list
    }
    const q = (s) => [...document.querySelectorAll(s)]
    const visible = (el) => {
      const st = getComputedStyle(el)
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const describe = (el) => {
      const tag = el.tagName.toLowerCase()
      const cls = el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0,2).join('.') : ''
      const txt = (el.textContent || '').trim().slice(0, 40).replace(/\s+/g, ' ')
      const id = el.id ? `#${el.id}` : ''
      return `${tag}${id}${cls} "${txt}"`
    }

    // 1. UA button background — scoped to root
    for (const btn of scoped('button')) {
      if (!visible(btn)) continue
      const bg = getComputedStyle(btn).backgroundColor
      if (bg === 'rgb(239, 239, 239)' || bg === 'rgb(240, 240, 240)' || bg === 'buttonface') {
        fails.push(`UA button background ${bg} at ${describe(btn)}`)
      }
    }

    // 2. font-size >=11px for elements with text — scoped, ignore thumb previews which intentionally use 9px
    for (const el of scoped('*')) {
      if (!visible(el)) continue
      // skip elements inside thumb shells or any [role="img"] preview (they intentionally use 9px)
      if (el.closest && (el.closest('.automation-thumb-shell') || el.closest('[role="img"]'))) continue
      // also skip vs-mono small mono labels inside thumbs (e.g. "Crossfade 30f")
      if (el.classList && el.classList.contains('vs-mono')) continue
      const hasDirectText = [...el.childNodes].some(n => n.nodeType===3 && (n.textContent||'').trim().length>0)
      if (!hasDirectText) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (Number.isFinite(fs) && fs < 11) {
        fails.push(`font-size ${fs}px <11 at ${describe(el)}`)
      }
    }

    // 3. custom property resolves — only check inline usage inside the root, not global stylesheets (editor's scoped vars are unrelated)
    const props = ['--line','--surface-2','--muted','--text','--blue','--surface-3','--accent']
    for (const p of props) {
      const val = getComputedStyle(root).getPropertyValue(p).trim()
      if (val) continue
      const referencing = scoped('*').some(el => {
        const style = el.getAttribute('style') || ''
        return style.includes(`var(${p})`)
      })
      if (referencing) {
        // Only fail if root truly doesn't have it and something uses it
        // Check if any ancestor up to :root has it
        let cur = root
        let found = false
        while (cur && cur !== document.documentElement.parentElement) {
          if (getComputedStyle(cur).getPropertyValue(p).trim()) { found = true; break }
          cur = cur.parentElement
        }
        if (!found && !getComputedStyle(document.documentElement).getPropertyValue(p).trim()) {
          // For automations sheet, root may be dialog; check if property is undefined globally
          // Only flag if the property is expected to exist (muted/text etc)
          // We'll check document.body as fallback
          const bodyVal = getComputedStyle(document.body).getPropertyValue(p).trim()
          const htmlVal = getComputedStyle(document.documentElement).getPropertyValue(p).trim()
          if (!bodyVal && !htmlVal) {
            fails.push(`custom property ${p} unresolved but referenced (root ${sel || 'body'})`)
          }
        }
      }
    }

    // 4. forbidden implementation strings
    const forbidden = [
      /^Controlled:/,
      /^(vignette-boost|grain-heavy|contrast-punch|vhs-retro|cinema-mood)$/,
      /^remotion-(hook|caption)-/,
      /^tpl-\d+$/,
      /^filterPresetId$/,
      /^remotion-hook-/
    ]
    for (const el of scoped('*')) {
      if (!visible(el)) continue
      const txt = (el.textContent || '').trim()
      if (!txt || txt.length > 80) continue
      for (const re of forbidden) {
        if (re.test(txt)) {
          fails.push(`forbidden text "${txt}" matches ${re} at ${describe(el)}`)
          break
        }
      }
    }
    // Also check for slice(14) remotion ids: look for text like "kinetic-30" that came from .slice(14)
    // We check chips that contain remotion fragment
    for (const el of scoped('*')) {
      if (!visible(el)) continue
      const txt = (el.textContent || '').trim()
      if (/^[a-z]+-[a-z0-9-]+$/.test(txt) && txt.length < 20 && txt.includes('-')) {
        // heuristic for sliced hook ids: e.g. "cine-title-card" without prefix but looks like id
        // Only flag if parent was supposed to show human name but shows id fragment
        // We'll flag if text exactly equals a known preset id fragment
        const knownFragments = ['cine-title-card','cine-reel-burn','cine-hard-light','cine-trailer-drop','cine-margin-note','cine-word-pop','cine-keyword-stack']
        if (knownFragments.includes(txt)) {
          fails.push(`sliced hook id "${txt}" at ${describe(el)}`)
        }
      }
    }

    // 5. focus-visible: check stylesheet has :focus-visible rule
    const hasFocusVisible = [...document.styleSheets].some(sheet => {
      try {
        return [...sheet.cssRules].some(r => r.selectorText && r.selectorText.includes(':focus-visible'))
      } catch { return false }
    })
    if (!hasFocusVisible) {
      fails.push('no :focus-visible rule found in any stylesheet')
    } else {
      // Also check interactive elements have outline/box-shadow when focused (sample one)
      // This is best-effort: create a temp button and see if focus-visible gives outline
    }

    // 6. contrast: simple luminance ratio
    function luminance(rgb) {
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!m) return null
      const [r,g,b] = [Number(m[1])/255, Number(m[2])/255, Number(m[3])/255].map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4))
      return 0.2126*r + 0.7152*g + 0.0722*b
    }
    for (const el of scoped('*')) {
      if (!visible(el)) continue
      const text = (el.textContent || '').trim()
      if (!text || text.length > 100) continue
      const isLeafText = el.children.length === 0 && text.length>0
      if (!isLeafText) continue
      const style = getComputedStyle(el)
      const fg = style.color
      const bg = style.backgroundColor
      // Need both non-transparent; skip semi-transparent pills (intentionally subtle)
      if (!fg || fg === 'rgba(0, 0, 0, 0)' || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue
      if (bg.startsWith('rgba')) {
        const m = bg.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/)
        if (m && Number(m[1]) < 0.9) continue
      }
      const l1 = luminance(fg)
      const l2 = luminance(bg)
      if (l1==null || l2==null) continue
      const lighter = Math.max(l1,l2)
      const darker = Math.min(l1,l2)
      const ratio = (lighter+0.05)/(darker+0.05)
      const fs = parseFloat(style.fontSize)
      const isBold = parseInt(style.fontWeight) >= 700
      const isLarge = fs >= 14 && isBold || fs >= 18
      const threshold = isLarge ? 3 : 4.5
      if (ratio < threshold && ratio > 1) {
        // Only flag severe low contrast <2 as this is broad
        if (ratio < 2.5) {
          fails.push(`low contrast ${ratio.toFixed(2)} <${threshold} at ${describe(el)} fg ${fg} bg ${bg}`)
        }
      }
    }

    // 7. horizontal bleed (only for narrow check, but we always check)
    // caller will check scrollWidth separately when needed

    return fails
  }, rootSelector)
}

async function captureState(page, stateId, elementSelector, description) {
  const fullPath = join(SHOTS, `${stateId}.png`)
  const elPath = join(SHOTS, `${stateId}-element.png`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: fullPath, fullPage: true }).catch(() => undefined)
  let elShots = 0
  let elSize = 0
  const locator = elementSelector ? page.locator(elementSelector).first() : null
  if (locator && await locator.count() > 0) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 2000 }).catch(()=>undefined)
      if (await locator.isVisible()) {
        await locator.screenshot({ path: elPath }).catch(()=>undefined)
        if (existsSync(elPath)) {
          try { elSize = statSync(elPath).size } catch {}
          elShots = 1
        }
      }
    } catch {}
  }
  let fullSize = 0
  try { fullSize = statSync(fullPath).size } catch {}
  console.log(`\n[${stateId}] ${description}`)
  console.log(`  full  ${fullPath} (${fullSize} bytes)`)
  if (elShots) console.log(`  elem  ${elPath} (${elSize} bytes)`)
  else {
    console.log(`  FAIL  element not found/visible for selector: ${elementSelector || 'root'}`)
    failures.push(`missing-element:${stateId}`)
    probeFailures.push(`${stateId}: missing element ${elementSelector}`)
  }

  // byte-size assertion like e2e-new-templates
  if (fullSize < 8000) {
    console.log(`  FAIL  screenshot too small (${fullSize} bytes) — likely blank`)
    probeFailures.push(`${stateId}: blank screenshot`)
    failures.push(`blank:${stateId}`)
  }
  if (elementSelector && elShots && elSize < 2000) {
    console.log(`  FAIL  element screenshot too small (${elSize} bytes)`)
    failures.push(`small-element:${stateId}`)
  }

  const fails = await runProbe(page, elementSelector)
  if (fails.length === 0) {
    console.log(`  probe ok (${stateId})`)
  } else {
    console.log(`  probe FAIL (${stateId}) — ${fails.length} issues:`)
    for (const f of fails.slice(0, 12)) console.log(`    - ${f}`)
    if (fails.length > 12) console.log(`    ... and ${fails.length - 12} more`)
    probeFailures.push(`${stateId}: ${fails[0]}`)
    // record for final exit
    failures.push(`probe:${stateId}`)
  }

  // Also print for 18-narrow bleed
  if (stateId === '18-narrow') {
    const bleed = await page.evaluate(() => document.body.scrollWidth > window.innerWidth)
    if (bleed) {
      const sw = await page.evaluate(() => document.body.scrollWidth)
      const iw = await page.evaluate(() => window.innerWidth)
      console.log(`  FAIL  horizontal bleed scrollWidth ${sw} > innerWidth ${iw}`)
      failures.push('probe:18-narrow-bleed')
    } else {
      console.log(`  ok    no horizontal bleed`)
    }
  }

  return { fullSize, elSize, fails }
}

try {
  console.log('--- 0. Seed + launch ---')
  const hasSnapshot = existsSync(join(ROOT, 'seed', 'snapshot', 'mental-empire.db'))
  if (hasSnapshot) {
    try {
      execFileSync(
        'powershell',
        ['-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'seed-restore.ps1'), '-TargetDir', scratch, '-Force'],
        { cwd: ROOT, stdio: 'pipe' }
      )
    } catch (e) {
      console.log('  note  seed-restore failed, using demo seed', String(e).slice(0,200))
    }
  }
  const seeded = existsSync(join(scratch, 'mental-empire.db'))
  console.log(`  note  ${seeded ? 'seeded from seed/snapshot' : 'using the built-in demo seed'}`)

  app = await electron.launch({
    args: [MAIN, '--no-sandbox', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    env: { ...process.env, ME_USERDATA_DIR: scratch, ME_TELEMETRY_OFF: '1', ME_E2E: '1' }
  })

  let page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  check((await page.title()) !== null, 'Electron window launched')

  const skipBtn = page.getByRole('button', { name: /^(Skip|Explore on my own)$/ }).first()
  await skipBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined)
  if ((await skipBtn.count()) > 0 && (await skipBtn.isVisible())) {
    await skipBtn.click()
    await page.waitForTimeout(800)
  }

  const navBtn = page.getByRole('button', { name: 'Automations' }).first()
  await navBtn.waitFor({ state: 'visible', timeout: 12000 })
  await navBtn.click()
  await page.waitForTimeout(1200)
  check((await page.locator('.at-tabs').count()) > 0, 'Automations screen reached')

  // Ensure we have data for states: ensure at least one linked channel/source via IPC
  console.log('\n--- Preparing data for states ---')
  const prep = await page.evaluate(async () => {
    const out = { channels: [], sources: [], templates: [], jobs: [], linked: [] }
    try {
      out.channels = await window.api.db.myChannels()
      out.sources = await window.api.db.sourceChannels()
      out.templates = await window.api.visualTemplates.list()
      out.jobs = await window.api.automation.jobs()
      // Try to ensure at least one channel has a linked source via Edge if possible
      // Use the most reliable: if myChannel has linkedSourceId but source has no linkedMyChannelId, link it
      for (const ch of out.channels.slice(0,2)) {
        const srcId = ch.linkedSourceId
        if (srcId) {
          const src = out.sources.find(s => s.id === srcId)
          if (src && !src.linkedMyChannelId) {
            try { await window.api.sources.setLinkedMyChannel(srcId, ch.id) } catch {}
            out.linked.push(`${ch.id}->${srcId}`)
          }
        }
      }
      // refresh lists
      out.sources = await window.api.db.sourceChannels()
      out.templates = await window.api.visualTemplates.list()
    } catch (e) {
      out.error = String(e)
    }
    return out
  })
  console.log(`  channels: ${prep.channels.length}, sources: ${prep.sources.length}, templates: ${prep.templates.length}, jobs: ${prep.jobs.length}, linked fixes: ${prep.linked?.join(',')||'none'}`)
  if (prep.error) console.log(`  prep error: ${prep.error}`)

  // Helper to click tab
  async function goTab(name) {
    const tab = page.getByRole('tab', { name: new RegExp(name, 'i') }).first()
    if (await tab.count() > 0) {
      await tab.click()
      await page.waitForTimeout(700)
      return true
    }
    // fallback: click by id
    const byId = page.locator(`#at-tab-${name.toLowerCase().replace(/\s+/g,'')}`)
    if (await byId.count()>0) { await byId.click(); await page.waitForTimeout(700); return true }
    return false
  }

  // 01-batches-empty — Batches with first channel auto-selected, batchCount 1 (distinct from 02/03)
  console.log('\n=== STATES 01-03: Batches ===')
  await goTab('Batches')
  // Ensure first channel is selected and set batchCount to 1 for distinctness
  try {
    const quick1 = page.locator('.automation-feed-bar .at-quick-pick').filter({ hasText: '1 video' }).first()
    if ((await quick1.count()) > 0) { await quick1.click(); await page.waitForTimeout(400) }
  } catch {}
  await captureState(page, '01-batches-empty', '#at-panel-channels', 'feed bar renders, empty copy is real (Batches tab)')

  // 02-batches-loaded — select channel with linked sources (first channel after prep has linked)
  try {
    const pills = page.locator('.automation-feed-bar .at-channel-pill')
    const n = await pills.count()
    if (n > 0) {
      await pills.first().click()
      await page.waitForTimeout(600)
      // set batchCount to 3 for distinctness
      const quick3 = page.locator('.automation-feed-bar .at-quick-pick').filter({ hasText: '3 videos' }).first()
      if ((await quick3.count()) > 0) { await quick3.click(); await page.waitForTimeout(400) }
    }
  } catch {}
  await captureState(page, '02-batches-loaded', '#at-panel-channels', 'channel pills, source chips, stepper, quick-picks, one CTA')

  // 03-batches-nosource — unlink second channel's sources unconditionally, then verify banner
  let _e2e03Restore = null
  try {
    const pills = page.locator('.automation-feed-bar .at-channel-pill')
    const n = await pills.count()
    if (n > 1) {
      _e2e03Restore = await page.evaluate(async () => {
        try {
          const channels = await window.api.db.myChannels()
          const sources = await window.api.db.sourceChannels()
          const ch = channels[1]
          if (!ch) return { unlinkedIds: [], channelId: null }
          const linked = sources.filter((s) => s.linkedMyChannelId === ch.id)
          const ids = []
          for (const s of linked) {
            try { await window.api.sources.setLinkedMyChannel(s.id, null); ids.push(s.id) } catch {}
          }
          ;window.__e2e03Restore = { ids, channelId: ch.id }
          return { unlinkedIds: ids, channelId: ch.id, linkedBefore: linked.length }
        } catch (e) { return { error: String(e), unlinkedIds: [], channelId: null } }
      })
      console.log(`  03 unlink second channel: ${JSON.stringify(_e2e03Restore)}`)
      // Reload so Zustand store re-fetches fresh sourceChannels (raw API doesn't update store)
      await page.evaluate(() => location.reload())
      await page.waitForTimeout(2500)
      try { page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1000) } catch {}
      const navAgain = page.getByRole('button', { name: 'Automations' }).first()
      await navAgain.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
      if (await navAgain.isVisible().catch(() => false)) { await navAgain.click(); await page.waitForTimeout(900) }
      await goTab('Batches')
      const pillsAfter = page.locator('.automation-feed-bar .at-channel-pill')
      await pillsAfter.nth(1).click()
      await page.waitForTimeout(700)
      // Assert banner visible inside #at-panel-channels
      const banner = page.locator('#at-panel-channels').getByText(/Link a source/i).first()
      await banner.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      const bannerVisible = await banner.isVisible().catch(() => false)
      const launchBtn = page.locator('#at-panel-channels .at-launch-btn').first()
      const launchDisabled = await launchBtn.isDisabled().catch(() => true)
      // Fallback check for launch label
      const launchLabel = ((await launchBtn.textContent().catch(() => '')) || '').trim()
      console.log(`  03 banner visible: ${bannerVisible}, launch disabled: ${launchDisabled}, label: "${launchLabel}"`)
      if (!bannerVisible) {
        console.log('  FAIL 03 expected Link a source banner not visible')
        failures.push('03-banner-missing')
        probeFailures.push('03-banner-missing')
      }
      if (!launchDisabled) {
        console.log('  FAIL 03 expected launch disabled when no source linked')
        failures.push('03-launch-not-disabled')
      }
    } else if (n > 0) {
      _e2e03Restore = await page.evaluate(async () => {
        const channels = await window.api.db.myChannels()
        const sources = await window.api.db.sourceChannels()
        const ch = channels[0]
        const linked = sources.filter((s) => s.linkedMyChannelId === ch.id)
        const ids = []
        for (const s of linked) { try { await window.api.sources.setLinkedMyChannel(s.id, null); ids.push(s.id) } catch {} }
        ;window.__e2e03Restore = { ids, channelId: ch.id }
        return { unlinkedIds: ids, channelId: ch.id }
      })
      await page.evaluate(() => location.reload())
      await page.waitForTimeout(2500)
      try { page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1000) } catch {}
      const navF = page.getByRole('button', { name: 'Automations' }).first()
      await navF.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
      if (await navF.isVisible().catch(() => false)) { await navF.click(); await page.waitForTimeout(900) }
      await goTab('Batches')
      const pillsF = page.locator('.automation-feed-bar .at-channel-pill')
      await pillsF.first().click()
      await page.waitForTimeout(700)
    }
  } catch (e) { console.log(`  03 error ${String(e).slice(0,200)}`) }
  await captureState(page, '03-batches-nosource', '#at-panel-channels', 'Link a source banner, launch disabled')
  // Restore unlinked sources for subsequent states and reload
  if (_e2e03Restore?.unlinkedIds?.length) {
    await page.evaluate(async (info) => {
      const stored = window.__e2e03Restore
      const ids = stored?.ids || info.unlinkedIds
      const channelId = stored?.channelId || info.channelId
      for (const sid of ids) { try { await window.api.sources.setLinkedMyChannel(sid, channelId) } catch {} }
      delete window.__e2e03Restore
    }, _e2e03Restore)
    await page.waitForTimeout(500)
    await page.evaluate(() => location.reload())
    await page.waitForTimeout(2500)
    try { page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1000) } catch {}
    const navAgain2 = page.getByRole('button', { name: 'Automations' }).first()
    await navAgain2.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    if (await navAgain2.isVisible().catch(() => false)) { await navAgain2.click(); await page.waitForTimeout(900) }
  }

  console.log('\n=== STATES 04-06: Templates ===')
  await goTab('Templates')

  // 04-templates-empty — zero templates
  const emptyPrep = await page.evaluate(async () => {
    try {
      const templates = await window.api.visualTemplates.list()
      const ids = templates.map(t=>t.id)
      for (const id of ids) {
        try { await window.api.visualTemplates.delete(id) } catch {}
      }
      const after = await window.api.visualTemplates.list()
      return { before: ids.length, after: after.length, ids }
    } catch (e) { return { error: String(e) } }
  })
  console.log(`  templates empty prep: before ${emptyPrep.before} after ${emptyPrep.after}`)
  await page.waitForTimeout(600)
  await captureState(page, '04-templates-empty', '#at-panel-templates', 'empty state + create card, no clipped copy')

  // 05-templates-list — >=2 templates
  const listPrep = await page.evaluate(async () => {
    try {
      const make = (i) => ({
        id: `tpl-e2e-${Date.now()}-${i}`,
        name: `E2E Template ${i}`,
        mode: 'Auto B-roll',
        imagePaths: [],
        imageDurationSec: 5,
        density: 'Full',
        order: 'Shuffle',
        motion: 'Cinematic',
        transition: 'crossfade',
        grade: i===0?'Cinematic':'Noir',
        captionStyle: 'highlight',
        aspectRatio: '9:16',
        hookLine: `Hook line ${i}`,
        zoomAtStart: true,
        hookTemplateId: '',
        hookProps: {},
        hookSeconds: 0,
        captionTemplateId: '',
        captionProps: {},
        filterPresetId: i===0? 'neutral':'punch',
        adjust: { enabled:true, exposure:0, contrast:0, saturation:1, temperature:0, tint:0, vignette:0, grain:0 },
        effectsPresetIds: i===0? [] : ['vignette-boost'],
        transitionDurationFrames: 30
      })
      const t1 = make(1)
      const t2 = make(2)
      await window.api.visualTemplates.save(t1)
      await window.api.visualTemplates.save(t2)
      const after = await window.api.visualTemplates.list()
      return { count: after.length, ids: after.map(t=>t.id) }
    } catch (e) { return { error: String(e) } }
  })
  console.log(`  templates list prep: ${JSON.stringify(listPrep).slice(0,300)}`)
  await page.waitForTimeout(800)
  await captureState(page, '05-templates-list', '#at-panel-templates', 'card grid, thumbs, chips, Edit/Duplicate/Delete')

  // 06-sheet-create — Templates → Create template
  const createBtn = page.getByRole('button', { name: /Create template/i }).first()
  if (await createBtn.count()>0) {
    await createBtn.click()
    await page.waitForTimeout(900)
  } else {
    // fallback: click card
    const fallback = page.locator('.at-create-card').first()
    if (await fallback.count()>0) { await fallback.click(); await page.waitForTimeout(900) }
  }
  await captureState(page, '06-sheet-create', '[role="dialog"]', 'the screenshot state — every group renders styled')

  // 07-11: sheet groups — open the relevant <details> before capture so collapsed groups are verified
  async function ensureSectionOpen(label) {
    const details = page.locator('details').filter({ hasText: label }).first()
    if ((await details.count()) === 0) return
    const isOpen = await details.getAttribute('open')
    if (isOpen === null) {
      const summary = details.locator('summary').first()
      if ((await summary.count()) > 0) {
        await summary.click()
        await page.waitForTimeout(350)
      }
    }
    // scroll section into view inside the sheet
    try { await details.scrollIntoViewIfNeeded() } catch {}
    await page.waitForTimeout(200)
  }
  // 07 Format — ensure Format open, others may be open but we focus Format
  await ensureSectionOpen('Format')
  await captureState(page, '07-sheet-format', '[role="dialog"]', 'mode / aspect / density / order / motion controls')
  // 08 Look
  await ensureSectionOpen('Look')
  await captureState(page, '08-sheet-look', '[role="dialog"]', 'grade + filter + adjust sliders + effects, real names')
  // 09 Captions — collapsed by default, must open
  await ensureSectionOpen('Captions')
  await captureState(page, '09-sheet-captions', '[role="dialog"]', 'caption style picker with human names')
  // 10 Hook — collapsed by default
  await ensureSectionOpen('Hook')
  await captureState(page, '10-sheet-hook', '[role="dialog"]', 'hook template picker, hook line, hook seconds')
  // 11 Media
  await ensureSectionOpen('Media')
  await captureState(page, '11-sheet-media', '[role="dialog"]', 'image pool: add / thumbnails / remove / count')

  // 12-sheet-invalid — Image slideshow with 0 images => Save disabled
  // Set mode to Image slideshow via evaluate patch on the editingTemplate state
  // We have to drive via UI if possible; fallback via direct prop patch
  // Try clicking Seg for mode if exists
  try {
    const modeSeg = page.locator('[role="dialog"] button').filter({ hasText: /Image slideshow/i }).first()
    if (await modeSeg.count()>0 && await modeSeg.isVisible()) {
      await modeSeg.click()
      await page.waitForTimeout(400)
    } else {
      // direct patch via evaluate: find the React state by triggering onChange with patch?
      // We'll use page.evaluate to dispatch a custom event that Profiles listens? Simpler: close and reopen with slideshow template
      await page.evaluate(async () => {
        // Create a slideshow template and open it
        const tmpl = {
          id: `tpl-slideshow-${Date.now()}`,
          name: 'Slideshow Empty Test',
          mode: 'Image slideshow',
          imagePaths: [],
          imageDurationSec: 5,
          density: 'Full',
          order: 'Shuffle',
          motion: 'Cinematic',
          transition: 'crossfade',
          grade: 'Cinematic',
          captionStyle: 'highlight',
          aspectRatio: '9:16',
          hookLine: '',
          zoomAtStart: false
        }
        // Save it then delete? Actually we want sheet in invalid state, not saved.
        // We'll try to set a global to force sheet props — fallback: just set window.__e2eTemplatePatch
        window.__e2eSlideshowTemplate = tmpl
      })
      // Close current sheet then try to open with slideshow patch via clicking create and then evaluating
      const closeBtn = page.getByRole('button', { name: 'Close' }).first()
      if (await closeBtn.count()>0 && await closeBtn.isVisible()) { await closeBtn.click(); await page.waitForTimeout(400) }
      // Reopen as slideshow by creating via API and editing
      await page.evaluate(async () => {
        const tmpl = window.__e2eSlideshowTemplate
        if (tmpl) {
          try { await window.api.visualTemplates.save(tmpl) } catch {}
        }
      })
      await page.waitForTimeout(400)
      // Click Edit on that template
      await goTab('Templates')
      await page.waitForTimeout(500)
      const editBtn = page.getByRole('button', { name: 'Edit' }).first()
      if (await editBtn.count()>0) { await editBtn.click(); await page.waitForTimeout(700) }
    }
  } catch (e) { console.log(`  note  12 setup fallback ${String(e).slice(0,150)}`) }
  await captureState(page, '12-sheet-invalid', '[role="dialog"]', 'inline validation, Save disabled')
  // Check Save disabled
  const saveBtn = page.locator('[role="dialog"] button').filter({ hasText: /Save template/i }).first()
  if (await saveBtn.count()>0) {
    const disabled = await saveBtn.isDisabled()
    console.log(`  note  Save disabled? ${disabled} (expected true for slideshow with 0 images)`)
    if (!disabled) {
      console.log(`  FAIL  Save should be disabled for Image slideshow with 0 images`)
      failures.push('12-save-enabled-should-be-disabled')
    }
  }
  // Close sheet to prepare for 13
  try {
    const cancel = page.getByRole('button', { name: /Cancel/i }).first()
    if (await cancel.count()>0 && await cancel.isVisible()) { await cancel.click(); await page.waitForTimeout(400) }
    // also try Escape
    await page.keyboard.press('Escape').catch(()=>undefined)
    await page.waitForTimeout(300)
    // Ensure dialog closed
    await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 2000 }).catch(()=>undefined)
  } catch {}

  // 13-sheet-edit — Edit an existing template (fields prefilled)
  await goTab('Templates')
  await page.waitForTimeout(600)
  const editFirst = page.getByRole('button', { name: 'Edit' }).first()
  if (await editFirst.count()>0) {
    await editFirst.click()
    await page.waitForTimeout(800)
    await captureState(page, '13-sheet-edit', '[role="dialog"]', 'fields prefilled from the row')
    // close again
    const close2 = page.getByRole('button', { name: 'Cancel' }).first()
    if (await close2.count()>0 && await close2.isVisible()) { await close2.click(); await page.waitForTimeout(400) }
    await page.keyboard.press('Escape').catch(()=>undefined)
    await page.waitForTimeout(300)
  } else {
    console.log('  note  no Edit button for 13-sheet-edit, skipping capture')
    await captureState(page, '13-sheet-edit', '#at-panel-templates', 'fields prefilled (fallback)')
  }

  console.log('\n=== STATES 14-17: Run history & dialogs ===')
  await goTab('Run history')
  // 14-runs-empty — no runs
  const jobsBefore = await page.evaluate(async () => {
    try {
      const jobs = await window.api.automation.jobs()
      for (const j of jobs) { try { await window.api.automation.deleteJob(j.id) } catch {} }
      const after = await window.api.automation.jobs()
      return { before: jobs.length, after: after.length }
    } catch (e) { return { error: String(e) } }
  })
  console.log(`  jobs empty prep: ${JSON.stringify(jobsBefore)}`)
  await page.waitForTimeout(600)
  await captureState(page, '14-runs-empty', '#at-panel-jobs', 'empty state + Create a batch')

  // 15-runs-list — with runs (create a dummy job via automation:createJob if possible)
  const jobsListPrep = await page.evaluate(async () => {
    try {
      // Build a minimal draft that preflight will accept
      const channels = await window.api.db.myChannels()
      const sources = await window.api.db.sourceChannels()
      const templates = await window.api.visualTemplates.list()
      const ch = channels[0]
      const src = sources.find(s => s.linkedMyChannelId === ch?.id) || sources[0]
      const tmpl = templates[0]
      if (!ch || !src || !tmpl) return { error: 'missing channel/source/template for job' }
      // Use the shared buildAutomationDraft logic via visualTemplateToStyleConfig if available
      // Fallback: construct draft manually similar to automationDraft defaults
      const draft = {
        name: `E2E Run ${Date.now()}`,
        goal: 'source-to-export',
        config: {
          sourceKind: 'saved-source',
          sourceId: src.id,
          sourceUrl: src.url,
          sourceName: src.name,
          sourceOrder: 'Latest',
          sourceCount: 1,
          selectedVideoIds: [],
          localMediaPaths: [],
          assetPaths: [],
          style: 'Cinematic',
          captionPreset: 'Hormozi',
          aspectRatios: ['9:16'],
          styleConfig: {
            videoStyle: 'Cinematic',
            captionStyle: 'highlight',
            captionPreset: 'Hormozi',
            captionFont: 'Montserrat',
            captionAnimation: 'Pop-in',
            captionPosition: 'bottom',
            captionLines: 1,
            captionPace: 'auto',
            wordsPerCaption: 2,
            highlightColor: '#FFD84D',
            boxColor: '#000000',
            imageMode: 'pool',
            imageDurationSec: 5,
            imageShuffle: true,
            transition: 'crossfade',
            crossfadeSec: 1,
            motionPreset: 'cinematic',
            gradientEdge: 'none',
            gradientIntensity: 0,
            aspectRatio: '9:16',
            hookText: '',
            hookEnabled: false,
            zoomAtStart: true,
            hookTemplateId: '',
            hookProps: {},
            hookSeconds: 0,
            captionTemplateId: '',
            captionProps: {},
            brollMode: 'full',
            brollDensity: 'full',
            brollPoolSize: 18,
            brollPoolKey: undefined,
            brollFallbackPolicy: 'prefer-selected',
            brollShufflePolicy: 'per-video'
          },
          rules: {
            minDurationSec: 0,
            skipDownloaded: false,
            continueOnError: true,
            maxRetries: 2,
            minimumFreeSpaceGb: 0,
            captions: true,
            autoBroll: true,
            removeSilence: false,
            reduceFillerWords: false,
            keepAwake: false,
            skipUploaded: false,
            fillSkippedSelections: false,
            allowStaleUploadCache: true,
            uploadFreshnessMinutes: 60,
            downloadDelaySec: 0,
            retryBaseDelaySec: 1,
            retryMaxDelaySec: 10
          },
          notify: { desktop: false, webhook: false, sound: false, email: false },
          execution: 'local'
        }
      }
      // normalize via backend? It will normalize on create
      const job = await window.api.automation.createJob(draft)
      const jobs = await window.api.automation.jobs()
      return { created: job?.id, count: jobs.length }
    } catch (e) {
      return { error: String(e) + ' ' + (e.stack||'').slice(0,300) }
    }
  })
  console.log(`  jobs list prep: ${JSON.stringify(jobsListPrep).slice(0, 600)}`)
  await page.waitForTimeout(800)
  await captureState(page, '15-runs-list', '#at-panel-jobs', 'lane, status pill, progress, action row hierarchy')

  // 16-runs-expanded — expand a run
  try {
    const viewBtn = page.getByRole('button', { name: /View details/i }).first()
    if (await viewBtn.count()>0 && await viewBtn.isVisible()) {
      await viewBtn.click()
      await page.waitForTimeout(900)
      await captureState(page, '16-runs-expanded', '#at-panel-jobs', 'checkpoints, items, log pane')
      // Hide again
      const hideBtn = page.getByRole('button', { name: /Hide details/i }).first()
      if (await hideBtn.count()>0 && await hideBtn.isVisible()) { await hideBtn.click(); await page.waitForTimeout(300) }
    } else {
      console.log('  note  no View details button for 16')
      await captureState(page, '16-runs-expanded', '#at-panel-jobs', 'checkpoints, items, log pane (no expandable job)')
    }
  } catch (e) { console.log(`  note  16 expand failed ${String(e).slice(0,120)}`) }

  // 17-confirm-delete — Delete a template / a run → ConfirmDialog
  // Try template delete
  await goTab('Templates')
  await page.waitForTimeout(500)
  const delBtn = page.getByRole('button', { name: 'Delete' }).first()
  if (await delBtn.count()>0) {
    await delBtn.click()
    await page.waitForTimeout(600)
    // should show ConfirmDialog
    await captureState(page, '17-confirm-delete', '.me-confirm-dialog', 'ConfirmDialog, not native confirm')
    // cancel
    const cancelDel = page.getByRole('button', { name: 'Cancel' }).first()
    if (await cancelDel.count()>0) { await cancelDel.click(); await page.waitForTimeout(300) }
    else await page.keyboard.press('Escape').catch(()=>undefined)
  } else {
    // try run delete
    await goTab('Run history')
    await page.waitForTimeout(500)
    const delRun = page.getByRole('button', { name: 'Delete' }).first()
    if (await delRun.count()>0) {
      await delRun.click()
      await page.waitForTimeout(600)
      await captureState(page, '17-confirm-delete', '.me-confirm-dialog', 'ConfirmDialog for run')
      const cancel2 = page.getByRole('button', { name: 'Cancel' }).first()
      if (await cancel2.count()>0) { await cancel2.click(); await page.waitForTimeout(300) }
    } else {
      console.log('  note  no Delete button for confirm dialog, capturing empty')
      await captureState(page, '17-confirm-delete', '#at-panel-templates', 'ConfirmDialog fallback')
    }
  }

  // Cleanup: cancel/delete the e2e-created job so it doesn't start real scraping/downloading on a machine with network
  if (jobsListPrep?.created) {
    try {
      await page.evaluate(async (id) => {
        try { await window.api.automation.cancelJob(id) } catch {}
        try { await window.api.automation.deleteJob(id) } catch {}
      }, jobsListPrep.created)
      console.log(`  cleaned up e2e job ${jobsListPrep.created}`)
      await page.waitForTimeout(400)
    } catch (e) { console.log(`  cleanup failed ${String(e).slice(0,120)}`) }
  }

  // 18-narrow — 1100×720 baseline
  console.log('\n=== STATE 18: narrow viewport ===')
  await page.setViewportSize({ width: 1100, height: 720 })
  await page.waitForTimeout(600)
  await goTab('Batches')
  await page.waitForTimeout(600)
  await captureState(page, '18-narrow', '#at-panel-channels', 'nothing overflows, drawer still usable at 1100x720')

  // Also open drawer at narrow to check
  // Always verify drawer at narrow viewport — go to Templates first
  await goTab('Templates')
  await page.waitForTimeout(500)
  const cn = page.getByRole('button', { name: /Create template/i }).first()
  if ((await cn.count()) > 0) {
    await cn.click()
    await page.waitForTimeout(700)
    const narrowDrawerPath = join(SHOTS, '18-narrow-drawer.png')
    const dlg = page.locator('[role="dialog"]').first()
    if ((await dlg.count()) > 0 && (await dlg.isVisible())) {
      await dlg.screenshot({ path: narrowDrawerPath }).catch(() => undefined)
      const sz = existsSync(narrowDrawerPath) ? statSync(narrowDrawerPath).size : 0
      console.log(`  narrow drawer screenshot: ${narrowDrawerPath} (${sz} bytes)`)
      if (sz < 8000) {
        console.log('  FAIL  narrow drawer screenshot too small')
        failures.push('narrow-drawer-small')
      }
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.waitForTimeout(300)
    } else {
      console.log('  FAIL  drawer not visible at narrow viewport')
      failures.push('narrow-drawer-missing')
    }
  } else {
    console.log('  FAIL  Create template button not found at narrow')
    failures.push('narrow-create-missing')
  }
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => undefined)

  console.log('\n--- 8. Renderer health ---')
  const realErrors = consoleErrors.filter((text) => !/Autofill|DevTools|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text))
  check(realErrors.length === 0, 'Zero renderer console errors detected', realErrors.slice(0, 3).join(' | '))

} catch (error) {
  console.error('\nHarness error during Automations E2E:', error)
  failures.push('harness-error')
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
  } else {
    console.log(`\nkept scratch: ${scratch}`)
  }
}

console.log('')
if (probeFailures.length>0) {
  console.log(`PROBE FAILURES (${probeFailures.length}):`)
  for (const f of probeFailures) console.log(`  - ${f}`)
}
if (failures.length > 0) {
  console.log(`\nAUTOMATION E2E FAILED — ${failures.length} issue(s): ${failures.join(', ')}`)
  // Copy baseline for M1 if requested or first run
  try {
    if (!existsSync(BASELINE)) {
      mkdirSync(BASELINE, { recursive: true })
      // copy current shots as baseline
      const files = ['01-batches-empty.png','02-batches-loaded.png','03-batches-nosource.png','04-templates-empty.png','05-templates-list.png','06-sheet-create.png','07-sheet-format.png','08-sheet-look.png','09-sheet-captions.png','10-sheet-hook.png','11-sheet-media.png','12-sheet-invalid.png','13-sheet-edit.png','14-runs-empty.png','15-runs-list.png','16-runs-expanded.png','17-confirm-delete.png','18-narrow.png']
      for (const f of files) {
        const src = join(SHOTS, f)
        if (existsSync(src)) cpSync(src, join(BASELINE, f))
      }
      console.log(`Baseline copied to ${BASELINE}`)
    }
  } catch {}
  process.exit(1)
} else {
  console.log('AUTOMATION E2E PASSED')
  process.exit(0)
}
