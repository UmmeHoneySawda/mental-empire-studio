import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { terminateOpenMontageProcessTree } from '../../electron/services/openmontage/managed'

const spawnedPids = new Set<number>()

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for the Windows process-tree condition.')
}

afterEach(() => {
  for (const pid of spawnedPids) {
    if (!isAlive(pid)) continue
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  }
  spawnedPids.clear()
})

const describeWindows = process.platform === 'win32' ? describe : describe.skip

describeWindows('OpenMontage Windows process-tree cleanup', () => {
  it('terminates the runner and its descendant without leaving an orphan process', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'me-openmontage-process-tree-'))
    const pidFile = path.join(directory, 'pids.json')
    const fixture = path.resolve(process.cwd(), 'test', 'fixtures', 'process-tree-parent.mjs')
    const parent = spawn(process.execPath, [fixture, pidFile], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (!parent.pid) throw new Error('Windows process-tree fixture did not start.')
    spawnedPids.add(parent.pid)
    await waitFor(() => fs.existsSync(pidFile))
    const pids = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as {
      parentPid: number
      childPid: number
    }
    spawnedPids.add(pids.childPid)
    expect(isAlive(pids.parentPid)).toBe(true)
    expect(isAlive(pids.childPid)).toBe(true)

    terminateOpenMontageProcessTree(parent as never, 'win32')
    await waitFor(() => !isAlive(pids.parentPid) && !isAlive(pids.childPid), 10_000)

    expect(isAlive(pids.parentPid)).toBe(false)
    expect(isAlive(pids.childPid)).toBe(false)
  }, 15_000)
})
