import { spawn } from 'node:child_process'
import { ensureBrowser } from '@remotion/renderer'
import { ffmpegPath, ffprobePath } from '../electron/services/bin'
import { configureVideoEngineBinaryEnvironment } from '../electron/services/video-engine/binary-env'
import { runHyperframesSmokeCheck } from '../video-engine/hyperframes/smoke'

function run(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout || stderr)
      else reject(new Error(`${executable} exited with ${code}: ${stderr.slice(-500)}`))
    })
  })
}

async function main(): Promise<void> {
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    throw new Error(`HyperFrames requires Node 22 or newer; found ${process.versions.node}`)
  }
  configureVideoEngineBinaryEnvironment()
  const [ffmpegVersion, ffprobeVersion, browser, hyperframes] = await Promise.all([
    run(ffmpegPath(), ['-version']),
    run(ffprobePath(), ['-version']),
    ensureBrowser({ chromeMode: 'headless-shell', logLevel: 'warn' }),
    runHyperframesSmokeCheck()
  ])
  if (browser.type === 'no-browser' || browser.type === 'version-mismatch') {
    throw new Error(`Remotion browser setup failed: ${browser.type}`)
  }
  if (!hyperframes.ok) {
    throw new Error(`HyperFrames compiler smoke failed: ${hyperframes.findings.join('; ')}`)
  }
  const ffmpeg = ffmpegVersion.split(/\r?\n/u)[0]
  const ffprobe = ffprobeVersion.split(/\r?\n/u)[0]
  console.log(JSON.stringify({
    ok: true,
    node: process.versions.node,
    ffmpeg,
    ffprobe,
    remotionBrowser: browser.type,
    hyperframesWarnings: hyperframes.warningCount
  }, null, 2))
}

await main()
