import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __setEncryptionAvailable } from 'electron'
import { __resetStores, __storeFile } from 'electron-store'

// The settings store encrypts the Groq + stock-footage keys at rest with Electron
// safeStorage. The risk these tests pin down is the read/write round trip: a session that
// cannot DECRYPT (no keychain backend, a different Windows profile, a rotated machine key)
// reads the key back as '' so the UI shows it unset — and the very next persist() used to
// write that '' straight over the ciphertext, destroying the user's key permanently.

const STORE_NAME = 'mental-empire-settings'
const ENC_PREFIX = 'enc:v1:'

/** Ciphertext exactly as encryptValue() would have written it on a healthy machine. */
function sealed(plain: string): string {
  return ENC_PREFIX + Buffer.from(plain, 'utf8').toString('base64')
}

function onDisk(): Record<string, never> {
  return (__storeFile(STORE_NAME)['settings'] ?? {}) as Record<string, never>
}

function diskApiKey(): string {
  return (onDisk() as { transcription?: { apiKey?: string } }).transcription?.apiKey ?? ''
}

function diskPexelsKey(): string {
  return (onDisk() as { beta?: { pexelsKey?: string } }).beta?.pexelsKey ?? ''
}

/** The module keeps `store` and the unreadable-secret map in module scope, so each test
 *  needs a fresh copy alongside a fresh backing file. */
function freshSettingsModule(): Promise<typeof import('../../electron/store/settings')> {
  vi.resetModules()
  return import('../../electron/store/settings')
}

beforeEach(() => {
  __resetStores()
  __setEncryptionAvailable(true)
})

describe('settings secrets survive a failed decrypt', () => {
  it('does not overwrite ciphertext it could not read', async () => {
    __storeFile(STORE_NAME)['settings'] = {
      transcription: { apiKey: sealed('groq-real-key'), model: 'whisper-large-v3-turbo' },
      beta: { enabled: true, pexelsKey: sealed('pexels-real-key'), pixabayKey: '', coverrKey: '' }
    }
    // This machine cannot open the ciphertext this session.
    __setEncryptionAvailable(false)

    const settings = await freshSettingsModule()
    const loaded = settings.initSettings()

    // The UI is told the key is unset rather than shown ciphertext…
    expect(loaded.transcription.apiKey).toBe('')
    expect(loaded.beta.pexelsKey).toBe('')
    // …but the file still holds the real, recoverable secret.
    expect(diskApiKey()).toBe(sealed('groq-real-key'))
    expect(diskPexelsKey()).toBe(sealed('pexels-real-key'))
  })

  it('keeps the secret through an unrelated settings patch', async () => {
    __storeFile(STORE_NAME)['settings'] = {
      transcription: { apiKey: sealed('groq-real-key'), model: 'whisper-large-v3-turbo' }
    }
    __setEncryptionAvailable(false)

    const settings = await freshSettingsModule()
    settings.initSettings()
    const next = settings.setSettings({ background: { tray: false } })

    expect(next.background.tray).toBe(false)
    expect(diskApiKey()).toBe(sealed('groq-real-key'))
  })

  it('still lets the user replace an unreadable key by typing a new one', async () => {
    __storeFile(STORE_NAME)['settings'] = {
      transcription: { apiKey: sealed('groq-old-key'), model: 'whisper-large-v3-turbo' }
    }
    __setEncryptionAvailable(false)

    const settings = await freshSettingsModule()
    settings.initSettings()
    settings.setSettings({ transcription: { apiKey: 'groq-typed-key' } })

    // No encryption available, so it lands as plaintext — but it is the NEW value, and
    // the stale ciphertext is gone.
    expect(diskApiKey()).toBe('groq-typed-key')
    expect(settings.getSettings().transcription.apiKey).toBe('groq-typed-key')
  })

  it('round-trips normally when encryption works', async () => {
    const settings = await freshSettingsModule()
    settings.initSettings()
    settings.setSettings({ transcription: { apiKey: 'groq-key' } })

    expect(diskApiKey()).toBe(sealed('groq-key'))
    expect(settings.getSettings().transcription.apiKey).toBe('groq-key')
  })

  it('migrates a legacy plaintext key to ciphertext on load', async () => {
    __storeFile(STORE_NAME)['settings'] = {
      transcription: { apiKey: 'legacy-plaintext', model: 'whisper-large-v3-turbo' }
    }

    const settings = await freshSettingsModule()
    const loaded = settings.initSettings()

    expect(loaded.transcription.apiKey).toBe('legacy-plaintext')
    expect(diskApiKey()).toBe(sealed('legacy-plaintext'))
  })

  it('lets the user genuinely clear a readable key', async () => {
    const settings = await freshSettingsModule()
    settings.initSettings()
    settings.setSettings({ transcription: { apiKey: 'groq-key' } })
    settings.setSettings({ transcription: { apiKey: '' } })

    expect(diskApiKey()).toBe('')
    expect(settings.getSettings().transcription.apiKey).toBe('')
  })
})
