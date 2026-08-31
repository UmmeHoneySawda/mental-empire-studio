import { spawn, spawnSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join, resolve } from 'node:path'

const channelRoot = process.argv[2]
if (!channelRoot) throw new Error('Usage: node run-talkingphotos.mjs <neural-vault-channel-root>')
const runDate = basename(dirname(resolve(channelRoot)))
if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error(`Channel root must be inside a YYYY-MM-DD run directory: ${channelRoot}`)

const email = process.env.TALKINGPHOTOS_EMAIL || ''
const password = process.env.TALKINGPHOTOS_PASSWORD || ''
if (!email || !password) throw new Error('TalkingPhotos credentials are unavailable')

const host = 'https://app.talkingphotos.ai'
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe'
const fontsDir = resolve(process.env.CAPTION_FONTS_DIR || 'resources/fonts')
const sourcePath = join(channelRoot, 'source', 'source.mp3')
const assPath = join(channelRoot, 'captions', 'captions.ass')
const workDir = join(channelRoot, 'intermediate', 'talkingphotos')
const partsDir = join(workDir, 'parts')
const statePath = join(workDir, 'state.json')
const mergedPath = join(workDir, 'talkingphotos-merged.mp4')
const finalPath = join(channelRoot, 'final', `NeuralVault-${runDate}.mp4`)
const partialFinalPath = `${finalPath}.partial.mp4`
const runPrefix = `ME-${runDate.replaceAll('-', '')}-NeuralVault`
const partSeconds = 300
const templateProjectId = 1112000
const fallbackCharacterUuid = '64ccfdd9-0169-42b3-b561-152bca3783a3'
const fallbackMotionId = 328

for (const path of [sourcePath, assPath]) {
  if (!existsSync(path)) throw new Error(`Required input is missing: ${path}`)
}
for (const path of [workDir, partsDir, join(channelRoot, 'final')]) mkdirSync(path, { recursive: true })

function atomicJson(path, value) {
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

function readState() {
  if (!existsSync(statePath)) return null
  try { return JSON.parse(readFileSync(statePath, 'utf8')) } catch { return null }
}

function probe(path) {
  const result = spawnSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=codec_type,width,height,codec_name',
    '-of', 'json', path
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}: ${(result.stderr || '').slice(-300)}`)
  return JSON.parse(result.stdout)
}

function durationOf(path) {
  return Number.parseFloat(probe(path).format.duration)
}

function validMedia(path, expectedDuration, tolerance = 2) {
  if (!existsSync(path) || statSync(path).size < 1024 * 1024) return false
  try { return Math.abs(durationOf(path) - expectedDuration) <= tolerance } catch { return false }
}

function runProcess(bin, args) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', rejectProcess)
    child.on('close', (code) => code === 0 ? resolveProcess() : rejectProcess(new Error(`${basename(bin)} exited with code ${code}`)))
  })
}

function ensurePlan() {
  const sourceDuration = durationOf(sourcePath)
  const saved = readState()
  if (saved?.runPrefix === runPrefix && Array.isArray(saved.parts) && saved.parts.length > 0) return saved
  const parts = []
  for (let start = 0, ord = 1; start < sourceDuration - 2; start += partSeconds, ord += 1) {
    const end = Math.min(sourceDuration, start + partSeconds)
    parts.push({
      ord,
      startSec: start,
      endSec: end,
      audioPath: join(partsDir, `part-${String(ord).padStart(3, '0')}.mp3`),
      durationSec: null,
      mediaId: null,
      projectId: null,
      remoteTitle: `${runPrefix}-p${String(ord).padStart(2, '0')}`,
      status: 'planned',
      attempts: 0,
      mediaUrl: null
    })
  }
  const state = {
    version: 1,
    runPrefix,
    sourceDurationSec: sourceDuration,
    categoryId: null,
    template: null,
    parts,
    merge: { title: `${runPrefix}-merge`, projectId: null, status: 'planned', mediaUrl: null },
    phase: 'split',
    updatedAt: new Date().toISOString()
  }
  atomicJson(statePath, state)
  return state
}

function saveState(state) {
  state.updatedAt = new Date().toISOString()
  atomicJson(statePath, state)
}

async function ensureLocalParts(state) {
  for (const part of state.parts) {
    const expected = part.endSec - part.startSec
    if (!validMedia(part.audioPath, expected, 1.5)) {
      const partial = `${part.audioPath}.partial.mp3`
      await runProcess(ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', part.startSec.toFixed(3), '-t', expected.toFixed(3),
        '-i', sourcePath,
        '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k',
        partial
      ])
      if (!validMedia(partial, expected, 1.5)) throw new Error(`Split part failed validation: ${partial}`)
      if (existsSync(part.audioPath)) throw new Error(`Refusing to overwrite unexpected part: ${part.audioPath}`)
      renameSync(partial, part.audioPath)
    }
    part.durationSec = durationOf(part.audioPath)
    part.status = part.mediaId ? part.status : 'split'
    saveState(state)
    console.log(`NeuralVault: part ${part.ord}/${state.parts.length} ready (${part.durationSec.toFixed(2)}s)`)
  }
  state.phase = 'login'
  saveState(state)
}

const cookieJar = new Map()
let reloginUsed = false

function absorbCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  for (const value of values) {
    const pair = String(value).split(';', 1)[0]
    const equals = pair.indexOf('=')
    if (equals > 0) cookieJar.set(pair.slice(0, equals), pair.slice(equals + 1))
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function rawRequest(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const cookies = cookieHeader()
  if (cookies) headers.set('Cookie', cookies)
  if (!headers.has('X-Requested-With')) headers.set('X-Requested-With', 'XMLHttpRequest')
  const response = await fetch(`${host}${path}`, {
    ...options,
    headers,
    redirect: options.redirect || 'manual',
    signal: options.signal || AbortSignal.timeout(120000)
  })
  absorbCookies(response)
  return response
}

async function login() {
  const loginPage = await rawRequest('/login', { headers: { 'X-Requested-With': '' } })
  const html = await loginPage.text()
  const match = html.match(/name=["']_csrf_token["'][^>]*value=["']([^"']+)["']/i)
    || html.match(/value=["']([^"']+)["'][^>]*name=["']_csrf_token["']/i)
  if (!match) throw new Error('TalkingPhotos login CSRF token was not found')
  const body = new URLSearchParams({
    _csrf_token: match[1],
    _username: email,
    _password: password,
    _remember_me: 'on'
  })
  const response = await rawRequest('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': '' },
    body
  })
  const location = response.headers.get('location') || ''
  if (response.status < 300 || response.status >= 400 || /\/login/i.test(location)) {
    throw new Error(`TalkingPhotos login failed (HTTP ${response.status})`)
  }
  console.log('NeuralVault: TalkingPhotos login succeeded')
}

async function api(path, options = {}, allowRelogin = true) {
  let response = await rawRequest(path, options)
  const location = response.headers.get('location') || ''
  if ((response.status === 401 || response.status === 403 || /\/login/i.test(location)) && allowRelogin && !reloginUsed) {
    reloginUsed = true
    await login()
    response = await rawRequest(path, options)
  }
  return response
}

async function jsonApi(path, options = {}, allowRelogin = true) {
  const response = await api(path, options, allowRelogin)
  const text = await response.text()
  let value
  try { value = text ? JSON.parse(text) : null } catch { value = { raw: text.slice(0, 500) } }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} failed HTTP ${response.status}: ${JSON.stringify(value).slice(0, 500)}`)
  return value
}

function itemsOf(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.data?.items)) return value.data.items
  if (Array.isArray(value?.data)) return value.data
  return []
}

async function projectList(limit = 100) {
  return itemsOf(await jsonApi(`/project?page=1&limit=${limit}`))
}

async function findProject(title) {
  return (await projectList(100)).find((project) => project.title === title) || null
}

async function ensureCategory(state) {
  if (state.categoryId) return
  const categories = itemsOf(await jsonApi('/library/categories?query=Mental%20Empire'))
  let category = categories.find((item) => item.title === 'Mental Empire')
  if (!category) {
    category = await jsonApi('/library/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Mental Empire' })
    }, false)
  }
  state.categoryId = Number(category.id || category.data?.id)
  if (!state.categoryId) throw new Error('TalkingPhotos category id was not returned')
  saveState(state)
}

async function uploadPart(state, part) {
  if (part.mediaId) return
  const stem = basename(part.audioPath, '.mp3')
  const listed = itemsOf(await jsonApi(
    `/library/categories/media/${state.categoryId}?page=1&limit=100&query=${encodeURIComponent(stem)}`
  ))
  const recovered = listed.find((item) => {
    const remoteDuration = Number(item.data?.duration || item.duration || 0)
    const titleMatches = item.title === stem || item.filename === basename(part.audioPath)
    return titleMatches && (!remoteDuration || Math.abs(remoteDuration - part.durationSec) <= 2)
  })
  if (recovered?.id) {
    part.mediaId = Number(recovered.id)
    part.status = 'uploaded'
    saveState(state)
    console.log(`NeuralVault: recovered uploaded part ${part.ord}/${state.parts.length} as media ${part.mediaId}`)
    return
  }
  const buffer = readFileSync(part.audioPath)
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), basename(part.audioPath))
  form.append('type', 'audio')
  const response = await jsonApi(`/library/categories/upload/${state.categoryId}`, {
    method: 'POST', body: form
  }, false)
  const media = response.media || response.data?.media || (response.id ? response : response.data)
  part.mediaId = Number(media.id)
  const remoteDuration = Number(media.data?.duration || media.duration || 0)
  if (!part.mediaId) throw new Error(`Upload did not return a media id for part ${part.ord}`)
  if (remoteDuration && Math.abs(remoteDuration - part.durationSec) > 2) {
    throw new Error(`Uploaded duration mismatch for part ${part.ord}: local ${part.durationSec}, remote ${remoteDuration}`)
  }
  part.status = 'uploaded'
  saveState(state)
  console.log(`NeuralVault: uploaded part ${part.ord}/${state.parts.length} as media ${part.mediaId}`)
}

async function loadTemplate(state) {
  if (state.template?.options) return state.template
  let project = null
  try { project = await jsonApi(`/project/${templateProjectId}`) } catch { /* use proven fallback below */ }
  const options = project?.options ? { ...project.options } : {
    aspectRatio: '16:9',
    characterPrompt: '', characterNegativePrompt: '',
    motionId: fallbackMotionId, parentMotionId: 0, motionPrompt: '',
    characterResultUuid: fallbackCharacterUuid,
    characterDrivingMediaId: 0, characterGender: 'male', characterEthnicity: '',
    characterAge: 'adult', characterStyle: 'realistic', characterBeard: 'shaven',
    backgroundResultUuid: '', backgroundPrompt: '', backgroundMediaId: 0,
    audioSource: 'library', audioMediaId: 0, audioVocalUrl: '', characterImageMediaId: 0,
    ttsText: '', ttsLanguage: 'en-US', ttsVoice: '', ttsVoiceGender: '', ttsEmotion: '',
    ttsSpeed: 50, ttsPitch: 50, voiceCloneCategory: 'cloned', voiceCloneLanguage: 1,
    voiceCloneVoice: null, songPrompt: '', songLyrics: '', songLength: 'short',
    songStylesSelectedList: [], songResultUuid: '', audioResultUuid: '',
    replicateMotionUseSource: true, replicateUseVoiceChanger: false,
    replicateMotionMode: 'animate', reverseVideoMode: true
  }
  options.aspectRatio = '16:9'
  options.audioSource = 'library'
  options.audioMediaId = 0
  options.motionId = Number(options.motionId || fallbackMotionId)
  options.parentMotionId = Number(options.parentMotionId || 0)
  options.characterResultUuid = options.characterResultUuid || fallbackCharacterUuid
  state.template = { type: 'human', style: 'normal', options }
  saveState(state)
  return state.template
}

function projectPayload(template, part) {
  return {
    id: 0,
    parentId: null,
    title: part.remoteTitle,
    userId: 0,
    type: 'human',
    style: 'normal',
    status: 'draft',
    taskUuid: null,
    taskPrevUuid: null,
    taskStepNumber: 0,
    taskStepsTotal: 0,
    options: { ...template.options, aspectRatio: '16:9', audioSource: 'library', audioMediaId: part.mediaId },
    subtitlesOptions: []
  }
}

async function readConcurrency() {
  const value = await jsonApi('/project/concurrent_limit/human')
  return {
    count: Number(value.concurrentCount || value.data?.concurrentCount || 0),
    limit: Number(value.concurrentLimit || value.data?.concurrentLimit || 5)
  }
}

async function submitPart(state, template, part) {
  const existing = await findProject(part.remoteTitle)
  if (existing) {
    part.projectId = existing.id
    part.status = existing.status
    part.mediaUrl = existing.media?.mediaPath || null
    saveState(state)
    return
  }
  part.attempts += 1
  saveState(state)
  let created
  try {
    created = await jsonApi('/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectPayload(template, part)),
      signal: AbortSignal.timeout(120000)
    }, false)
  } catch (error) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000))
    const recovered = await findProject(part.remoteTitle)
    if (!recovered) throw new Error(`Submission outcome is uncertain for ${part.remoteTitle}; not retrying blindly: ${error.message}`)
    created = recovered
  }
  part.projectId = Number(created.id)
  part.status = created.status || 'pending'
  if (!part.projectId) throw new Error(`Project submission did not return an id for part ${part.ord}`)
  saveState(state)
  console.log(`NeuralVault: submitted part ${part.ord}/${state.parts.length} as project ${part.projectId}`)
}

async function refreshParts(state) {
  const projects = await projectList(100)
  let changed = false
  for (const part of state.parts) {
    const project = projects.find((item) => item.id === part.projectId || item.title === part.remoteTitle)
    if (!project) continue
    part.projectId = project.id
    part.status = project.status
    part.mediaUrl = project.media?.mediaPath || null
    changed = true
  }
  if (changed) saveState(state)
}

async function submitAndAwaitParts(state, template) {
  while (state.parts.some((part) => part.status !== 'completed')) {
    await refreshParts(state)
    for (const part of state.parts.filter((item) => item.status === 'error')) {
      if (part.attempts >= 3) throw new Error(`TalkingPhotos part ${part.ord} failed after ${part.attempts} attempts`)
      part.projectId = null
      part.mediaUrl = null
      part.remoteTitle = `${runPrefix}-p${String(part.ord).padStart(2, '0')}-r${part.attempts + 1}`
      part.status = 'uploaded'
      saveState(state)
    }

    const waiting = state.parts.filter((part) => !part.projectId)
    if (waiting.length > 0) {
      const concurrency = await readConcurrency()
      let capacity = Math.max(0, concurrency.limit - concurrency.count)
      for (const part of waiting) {
        if (capacity <= 0) break
        await submitPart(state, template, part)
        capacity -= 1
      }
    }

    const complete = state.parts.filter((part) => part.status === 'completed').length
    const processing = state.parts.filter((part) => ['pending', 'processing'].includes(part.status)).length
    console.log(`NeuralVault: remote parts ${complete}/${state.parts.length} completed, ${processing} active`)
    if (complete < state.parts.length) await new Promise((resolveWait) => setTimeout(resolveWait, 60000))
  }
  state.phase = 'merge'
  saveState(state)
}

async function ensureMerge(state) {
  if (state.parts.some((part) => part.status !== 'completed')) throw new Error('Refusing to merge incomplete TalkingPhotos parts')
  const measuredTotal = state.parts.reduce((sum, part) => sum + Number(part.durationSec), 0)
  if (measuredTotal > 1800) throw new Error(`Merge duration exceeds 1800 seconds: ${measuredTotal}`)

  let merge = state.merge.projectId ? await findProject(state.merge.title) : null
  if (!merge) merge = await findProject(state.merge.title)
  if (!merge) {
    try {
      merge = await jsonApi('/project/merge_videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsIds: state.parts.map((part) => part.projectId),
          title: state.merge.title,
          audioMediaId: 0
        }),
        signal: AbortSignal.timeout(120000)
      }, false)
    } catch (error) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20000))
      merge = await findProject(state.merge.title)
      if (!merge) throw new Error(`Merge outcome is uncertain; not retrying blindly: ${error.message}`)
    }
    state.merge.projectId = Number(merge.id)
    state.merge.status = merge.status || 'pending'
    saveState(state)
    console.log(`NeuralVault: server-side merge submitted as project ${state.merge.projectId}`)
  }

  while (state.merge.status !== 'completed') {
    const current = await findProject(state.merge.title)
    if (current) {
      state.merge.projectId = current.id
      state.merge.status = current.status
      state.merge.mediaUrl = current.media?.mediaPath || null
      saveState(state)
    }
    if (state.merge.status === 'error') throw new Error('TalkingPhotos server-side merge failed')
    console.log(`NeuralVault: merge status ${state.merge.status}`)
    if (state.merge.status !== 'completed') await new Promise((resolveWait) => setTimeout(resolveWait, 60000))
  }
  if (!state.merge.mediaUrl) {
    const completed = await jsonApi(`/project/${state.merge.projectId}`)
    state.merge.mediaUrl = completed.media?.mediaPath || null
    saveState(state)
  }
  if (!state.merge.mediaUrl) throw new Error('Completed merge has no downloadable media URL')
  state.phase = 'download'
  saveState(state)
}

async function downloadMerge(state) {
  if (validMedia(mergedPath, state.sourceDurationSec, 8)) return
  const partial = `${mergedPath}.partial`
  const response = await fetch(state.merge.mediaUrl, { signal: AbortSignal.timeout(300000) })
  if (!response.ok || !response.body) throw new Error(`TalkingPhotos download failed HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  if (!validMedia(partial, state.sourceDurationSec, 8)) throw new Error('Downloaded TalkingPhotos merge failed media validation')
  if (existsSync(mergedPath)) throw new Error(`Refusing to overwrite unexpected merge: ${mergedPath}`)
  renameSync(partial, mergedPath)
  state.phase = 'caption'
  saveState(state)
  console.log(`NeuralVault: downloaded server merge to ${mergedPath}`)
}

function filterPath(path) {
  return resolve(path).replaceAll('\\', '/').replace(/^([A-Za-z]):/, '$1\\:').replaceAll("'", "\\'")
}

async function renderFinal(state) {
  if (validMedia(finalPath, state.sourceDurationSec, 8)) return
  const filter = [
    'scale=1920:1080:force_original_aspect_ratio=increase',
    'crop=1920:1080',
    'setsar=1',
    `ass=filename='${filterPath(assPath)}':fontsdir='${filterPath(fontsDir)}'`,
    'format=yuv420p'
  ].join(',')
  await runProcess(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'warning', '-stats', '-stats_period', '15',
    '-i', mergedPath,
    '-vf', filter,
    '-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq',
    '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-maxrate', '12M', '-bufsize', '24M',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    partialFinalPath
  ])
  if (!validMedia(partialFinalPath, state.sourceDurationSec, 8)) throw new Error('Captioned NeuralVault final failed validation')
  if (existsSync(finalPath)) throw new Error(`Refusing to overwrite unexpected final: ${finalPath}`)
  renameSync(partialFinalPath, finalPath)
  state.phase = 'done'
  saveState(state)
  console.log(`NeuralVault: completed ${finalPath}`)
}

let loggedIn = false
try {
  const state = ensurePlan()
  await ensureLocalParts(state)
  await login()
  loggedIn = true
  const usage = await jsonApi('/project/video_daily_usage')
  const dailyUsage = Number(usage.dailyUsage || usage.data?.dailyUsage || 0)
  const dailyLimit = Number(usage.dailyLimit || usage.data?.dailyLimit || 100)
  const needed = state.parts.filter((part) => !part.projectId).length
  if (dailyLimit - dailyUsage < needed) throw new Error(`TalkingPhotos quota insufficient: ${dailyUsage}/${dailyLimit}, need ${needed}`)
  console.log(`NeuralVault: quota ${dailyUsage}/${dailyLimit}; ${needed} new renders required`)
  await ensureCategory(state)
  for (const part of state.parts) await uploadPart(state, part)
  const template = await loadTemplate(state)
  await submitAndAwaitParts(state, template)
  await ensureMerge(state)
  await downloadMerge(state)
  await renderFinal(state)
} finally {
  if (loggedIn) {
    try { await rawRequest('/logout', { signal: AbortSignal.timeout(15000) }) } catch { /* session expires naturally */ }
  }
}
