import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const pidFile = process.argv[2]
if (!pidFile) process.exit(64)

const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  windowsHide: true,
  stdio: 'ignore'
})
writeFileSync(pidFile, JSON.stringify({ parentPid: process.pid, childPid: child.pid }), 'utf8')
setInterval(() => {}, 1_000)
