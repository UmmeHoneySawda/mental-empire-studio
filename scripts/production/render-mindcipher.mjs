import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const channelRoot = process.argv[2]
if (!channelRoot) throw new Error('Usage: node render-mindcipher.mjs <mindcipher-channel-root>')
const runDate = basename(dirname(resolve(channelRoot)))
if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error(`Channel root must be inside a YYYY-MM-DD run directory: ${channelRoot}`)

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe'
const fontsDir = resolve(process.env.CAPTION_FONTS_DIR || 'resources/fonts')
const audioPath = join(channelRoot, 'source', 'source.mp3')
const assPath = join(channelRoot, 'captions', 'captions.ass')
const timelinePath = join(channelRoot, 'intermediate', 'broll-timeline.json')
const slotsDir = join(channelRoot, 'intermediate', 'broll-slots')
const batchesDir = join(channelRoot, 'intermediate', 'broll-batches')
const finalPath = join(channelRoot, 'final', `MindCipher-${runDate}.mp4`)
const partialFinalPath = `${finalPath}.partial.mp4`

for (const path of [audioPath, assPath, timelinePath]) {
  if (!existsSync(path)) throw new Error(`Required input is missing: ${path}`)
}
mkdirSync(slotsDir, { recursive: true })
mkdirSync(batchesDir, { recursive: true })
mkdirSync(join(channelRoot, 'final'), { recursive: true })

function probe(path) {
  const result = spawnSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-of', 'json', path
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}: ${(result.stderr || '').slice(-300)}`)
  return JSON.parse(result.stdout)
}

function validVideo(path, expectedDuration, tolerance = 0.35) {
  if (!existsSync(path) || statSync(path).size < 16 * 1024) return false
  try {
    const info = probe(path)
    const video = info.streams.find((stream) => stream.codec_type === 'video')
    return video?.codec_name === 'h264'
      && Number(video.width) === 1920
      && Number(video.height) === 1080
      && Math.abs(Number(info.format.duration) - expectedDuration) <= tolerance
  } catch {
    return false
  }
}

function runProcess(bin, args, quiet = false) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: quiet ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'inherit', 'inherit']
    })
    let stderr = ''
    if (quiet) child.stderr.on('data', (data) => { stderr += data.toString() })
    child.on('error', rejectProcess)
    child.on('close', (code) => code === 0
      ? resolveProcess()
      : rejectProcess(new Error(`${basename(bin)} exited with code ${code}: ${stderr.slice(-800)}`)))
  })
}

function slotPath(slot) {
  return join(slotsDir, `slot-${String(slot.index).padStart(4, '0')}.mp4`)
}

async function renderSlot(slot) {
  const output = slotPath(slot)
  if (validVideo(output, slot.durationSec)) return false
  const partial = `${output}.partial.mp4`
  await runProcess(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-stream_loop', '-1', '-ss', Number(slot.sourceStartSec || 0).toFixed(3),
    '-i', slot.sourcePath,
    '-t', Number(slot.durationSec).toFixed(3),
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30,eq=contrast=1.04:brightness=-0.025:saturation=0.88,format=yuv420p',
    '-an',
    '-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq',
    '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-maxrate', '10M', '-bufsize', '20M',
    '-g', '60',
    partial
  ], true)
  if (!validVideo(partial, slot.durationSec)) throw new Error(`B-roll slot failed validation: ${partial}`)
  if (existsSync(output)) throw new Error(`Refusing to overwrite unexpected slot: ${output}`)
  renameSync(partial, output)
  return true
}

const timeline = JSON.parse(readFileSync(timelinePath, 'utf8'))
const slots = timeline.slots
if (!Array.isArray(slots) || slots.length === 0) throw new Error('MindCipher B-roll timeline has no slots')
const audioDuration = Number(probe(audioPath).format.duration)

let cursor = 0
let rendered = 0
const workers = Array.from({ length: 2 }, async () => {
  while (true) {
    const index = cursor
    cursor += 1
    if (index >= slots.length) return
    if (await renderSlot(slots[index])) rendered += 1
    const complete = index + 1
    if (complete % 12 === 0 || complete === slots.length) {
      console.log(`MindCipher: normalized ${complete}/${slots.length} B-roll slots (${rendered} newly rendered)`)
    }
  }
})
await Promise.all(workers)

const plannedDuration = slots.reduce((sum, slot) => sum + Number(slot.durationSec), 0)
const batchSize = 12
const batches = []
for (let start = 0; start < slots.length; start += batchSize) {
  const group = slots.slice(start, start + batchSize)
  const batchNumber = batches.length + 1
  const output = join(batchesDir, `batch-${String(batchNumber).padStart(3, '0')}.mp4`)
  const partial = `${output}.partial.mp4`
  const expectedDuration = group.reduce((sum, slot) => sum + Number(slot.durationSec), 0)
  if (!validVideo(output, expectedDuration, 0.75)) {
    const inputArgs = group.flatMap((slot) => ['-i', slotPath(slot)])
    const resetFilters = group.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}]`)
    const concatInputs = group.map((_, index) => `[v${index}]`).join('')
    const filter = [...resetFilters, `${concatInputs}concat=n=${group.length}:v=1:a=0,fps=30,format=yuv420p[out]`].join(';')
    await runProcess(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[out]', '-an',
      '-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq',
      '-rc', 'vbr', '-cq', '22', '-b:v', '0', '-maxrate', '11M', '-bufsize', '22M',
      '-g', '60', '-movflags', '+faststart', partial
    ], true)
    if (!validVideo(partial, expectedDuration, 0.75)) throw new Error(`MindCipher batch failed validation: ${partial}`)
    if (existsSync(output)) throw new Error(`Refusing to overwrite unexpected batch: ${output}`)
    renameSync(partial, output)
  }
  batches.push({ path: output, expectedDuration })
  console.log(`MindCipher: prepared B-roll batch ${batchNumber}/${Math.ceil(slots.length / batchSize)}`)
}

const batchedDuration = batches.reduce((sum, batch) => sum + batch.expectedDuration, 0)
if (Math.abs(batchedDuration - plannedDuration) > 0.01) throw new Error('MindCipher batch timeline duration mismatch')

function filterPath(path) {
  return resolve(path).replaceAll('\\', '/').replace(/^([A-Za-z]):/, '$1\\:').replaceAll("'", "\\'")
}

if (!validVideo(finalPath, audioDuration, 1.5)) {
  const resetFilters = batches.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}]`)
  const concatInputs = batches.map((_, index) => `[v${index}]`).join('')
  const filter = [
    ...resetFilters,
    `${concatInputs}concat=n=${batches.length}:v=1:a=0[joined]`,
    `[joined]tpad=stop_mode=clone:stop_duration=3,trim=duration=${audioDuration.toFixed(3)},ass=filename='${filterPath(assPath)}':fontsdir='${filterPath(fontsDir)}',format=yuv420p[vout]`
  ].join(';')
  await runProcess(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'warning', '-stats', '-stats_period', '15',
    ...batches.flatMap((batch) => ['-i', batch.path]),
    '-i', audioPath,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', `${batches.length}:a:0`,
    '-t', audioDuration.toFixed(3),
    '-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq',
    '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-maxrate', '12M', '-bufsize', '24M',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', partialFinalPath
  ])
  if (!validVideo(partialFinalPath, audioDuration, 1.5)) throw new Error('MindCipher final failed validation')
  if (existsSync(finalPath)) throw new Error(`Refusing to overwrite unexpected final: ${finalPath}`)
  renameSync(partialFinalPath, finalPath)
}
console.log(`MindCipher: completed ${finalPath}`)
