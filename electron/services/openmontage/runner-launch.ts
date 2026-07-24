import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { OpenMontageSettings } from '../../../shared/openmontage'
import { ffprobePath } from '../bin'

const require = createRequire(import.meta.url)

interface CodexPlatform {
  packageName: string
  triple: string
  executable: string
}

export interface OpenMontageRunnerLaunch {
  executable: string
  args: string[]
  fixedEnvironment: NodeJS.ProcessEnv
  kind: OpenMontageSettings['runner']
}

function codexPlatform(): CodexPlatform {
  const key = `${process.platform}-${process.arch}`
  const platforms: Record<string, CodexPlatform> = {
    'win32-x64': {
      packageName: '@openai/codex-win32-x64',
      triple: 'x86_64-pc-windows-msvc',
      executable: 'codex.exe'
    },
    'win32-arm64': {
      packageName: '@openai/codex-win32-arm64',
      triple: 'aarch64-pc-windows-msvc',
      executable: 'codex.exe'
    },
    'darwin-x64': {
      packageName: '@openai/codex-darwin-x64',
      triple: 'x86_64-apple-darwin',
      executable: 'codex'
    },
    'darwin-arm64': {
      packageName: '@openai/codex-darwin-arm64',
      triple: 'aarch64-apple-darwin',
      executable: 'codex'
    },
    'linux-x64': {
      packageName: '@openai/codex-linux-x64',
      triple: 'x86_64-unknown-linux-musl',
      executable: 'codex'
    },
    'linux-arm64': {
      packageName: '@openai/codex-linux-arm64',
      triple: 'aarch64-unknown-linux-musl',
      executable: 'codex'
    }
  }
  const selected = platforms[key]
  if (!selected) throw new Error(`The bundled Codex runner does not support ${key}.`)
  return selected
}

function unpackedPath(candidate: string): string {
  const marker = `${path.sep}app.asar${path.sep}`
  if (!candidate.includes(marker)) return candidate
  const unpacked = candidate.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`)
  return existsSync(unpacked) ? unpacked : candidate
}

export function resolveBundledCodexExecutable(): string {
  const platform = codexPlatform()
  let packageJson: string
  try {
    packageJson = require.resolve(`${platform.packageName}/package.json`)
  } catch {
    throw new Error(`Bundled Codex runtime package is missing: ${platform.packageName}.`)
  }
  const executable = unpackedPath(path.join(
    path.dirname(packageJson),
    'vendor',
    platform.triple,
    'bin',
    platform.executable
  ))
  if (!existsSync(executable)) throw new Error('Bundled Codex executable was not found after installation.')
  return executable
}

export function resolveCodexRunnerScript(): string {
  const packaged = typeof process.resourcesPath === 'string'
    ? path.join(process.resourcesPath, 'openmontage-runner', 'codex-runner.mjs')
    : ''
  const candidate = packaged && existsSync(packaged)
    ? packaged
    : path.resolve(process.cwd(), 'resources', 'openmontage-runner', 'codex-runner.mjs')
  if (!existsSync(candidate)) throw new Error('MES Codex OpenMontage runner script is missing.')
  return candidate
}

export function resolveOpenMontageRunnerLaunch(settings: OpenMontageSettings): OpenMontageRunnerLaunch {
  if (settings.runner === 'codex-cli') {
    const codexExecutable = settings.runnerExecutable.trim() || resolveBundledCodexExecutable()
    if (!existsSync(codexExecutable)) throw new Error('Configured Codex executable was not found.')
    return {
      executable: process.execPath,
      args: [
        resolveCodexRunnerScript(),
        '--codex-executable',
        codexExecutable,
        '--ffprobe-executable',
        ffprobePath(),
        ...settings.runnerArguments.flatMap((argument) => ['--codex-argument', argument]),
        '--stall-timeout-sec',
        String(Math.max(30, settings.stallTimeoutSec))
      ],
      fixedEnvironment: {
        ELECTRON_RUN_AS_NODE: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      kind: settings.runner
    }
  }
  if (settings.runner === 'none') throw new Error('Managed runner is not configured.')
  if (!settings.runnerExecutable.trim()) throw new Error('Managed runner executable is not configured.')
  return {
    executable: settings.runnerExecutable,
    args: [...settings.runnerArguments],
    fixedEnvironment: { PYTHONIOENCODING: 'utf-8' },
    kind: settings.runner
  }
}
