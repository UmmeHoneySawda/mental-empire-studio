import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseEnv } from 'node:util'
import {
  type OpenMontageEnvironmentReport,
  type OpenMontageSettings
} from '../../../shared/openmontage'

const MAX_ENVIRONMENT_FILE_BYTES = 1024 * 1024
const BLOCKED_EXACT_KEYS = new Set([
  'COMSPEC',
  'ELECTRON_RUN_AS_NODE',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'PATHEXT',
  'PYTHONHOME',
  'PYTHONINSPECT',
  'PYTHONPATH',
  'PYTHONSTARTUP'
])

export interface OpenMontageChildEnvironment {
  env: NodeJS.ProcessEnv
  report: OpenMontageEnvironmentReport
}

function environmentFilePath(settings: OpenMontageSettings, root: string): {
  filePath: string
  explicit: boolean
} {
  const configured = settings.environmentFile.trim()
  return {
    filePath: path.resolve(root, configured || '.env'),
    explicit: Boolean(configured)
  }
}

function isBlockedEnvironmentKey(key: string): boolean {
  const normalized = key.toUpperCase()
  return BLOCKED_EXACT_KEYS.has(normalized) || normalized.startsWith('DYLD_')
}

function inheritedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

/**
 * Resolves OpenMontage's optional .env file without mutating MES process.env.
 * OS-provided values take precedence and execution-control keys are never
 * accepted from the file. The returned report contains names/counts only.
 */
export async function resolveOpenMontageEnvironment(
  settings: OpenMontageSettings,
  root: string,
  processEnvironment: NodeJS.ProcessEnv = process.env,
  fixed: NodeJS.ProcessEnv = {}
): Promise<OpenMontageChildEnvironment> {
  const { filePath, explicit } = environmentFilePath(settings, root)
  const base = inheritedEnvironment(processEnvironment)
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('Configured environment path is not a file.')
    if (fileStat.size > MAX_ENVIRONMENT_FILE_BYTES) {
      throw new Error('Environment file exceeds the 1 MiB safety limit.')
    }
    const parsed = parseEnv((await readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''))
    const allowed: NodeJS.ProcessEnv = {}
    const blockedVariableNames: string[] = []
    for (const [key, value] of Object.entries(parsed)) {
      if (isBlockedEnvironmentKey(key)) {
        blockedVariableNames.push(key)
      } else if (typeof value === 'string') {
        allowed[key] = value
      }
    }
    blockedVariableNames.sort((left, right) => left.localeCompare(right))
    return {
      env: { ...allowed, ...base, ...inheritedEnvironment(fixed) },
      report: {
        filePath,
        status: 'loaded',
        explicit,
        loadedVariableCount: Object.keys(allowed).length,
        blockedVariableNames
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      return {
        env: { ...base, ...inheritedEnvironment(fixed) },
        report: {
          filePath,
          status: 'not-found',
          explicit,
          loadedVariableCount: 0,
          blockedVariableNames: [],
          detail: explicit
            ? 'The configured environment file was not found.'
            : 'No repository .env file was found; inherited process variables will be used.'
        }
      }
    }
    return {
      env: { ...base, ...inheritedEnvironment(fixed) },
      report: {
        filePath,
        status: 'invalid',
        explicit,
        loadedVariableCount: 0,
        blockedVariableNames: [],
        detail: error instanceof Error && (
          error.message === 'Configured environment path is not a file.'
          || error.message === 'Environment file exceeds the 1 MiB safety limit.'
        )
          ? error.message
          : `Environment file could not be read or parsed${code ? ` (${code})` : ''}.`
      }
    }
  }
}

export function assertOpenMontageEnvironmentReady(report: OpenMontageEnvironmentReport): void {
  if (report.status === 'invalid' || (report.explicit && report.status === 'not-found')) {
    throw new Error(`OpenMontage environment is not usable: ${report.detail ?? report.status}`)
  }
}
