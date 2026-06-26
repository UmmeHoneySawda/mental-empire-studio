// Browser test mock for window.api.
//
// In Electron, the preload script sets window.api before the renderer runs, so this
// mock does nothing. In a plain browser (e.g. `npm run dev:browser`) there is no
// Electron backend, so we install a stateful, in-memory mock that lets every screen
// load with realistic data and simulates async progress (scrape / download / render).
// This is ONLY for UI testing in a browser — it never touches a real DB or ffmpeg.

import type { NativeApi } from '@shared/types'

function grad(a: string, b: string): string {
  return `linear-gradient(135deg,${a},${b})`
}

function installMock(): void {
  const channels = [
    { id: 'me', name: 'Mental Empire', handle: '@MentalEmpire', mono: 'ME', avatar: grad('#f5b323', '#b9780a'), views: '1.2M', subs: '455', total: 1240000, linkedSourceId: 'pw', source: '@PowerWithinOfficial', mapDone: 12, mapTotal: 18, weekDone: 3, weekGoal: 5, monthDone: 9, monthGoal: 20, reminder: 'Fri Jun 27', reminderNote: '' },
    { id: 'sh', name: 'Stoic Hour', handle: '@StoicHour', mono: 'SH', avatar: grad('#8b7cff', '#5b4fd6'), views: '880K', subs: '1.1K', total: 880000, linkedSourceId: 'ds', source: '@DailyStoicTalks', mapDone: 7, mapTotal: 10, weekDone: 2, weekGoal: 4, monthDone: 6, monthGoal: 16, reminder: '', reminderNote: '' },
    { id: 'sd', name: 'Sleep Deep', handle: '@SleepDeep', mono: 'SD', avatar: grad('#36c98e', '#1f9c6b'), views: '2.3M', subs: '8.4K', total: 2300000, linkedSourceId: 'rs', source: '@RainSounds24', mapDone: 3, mapTotal: 3, weekDone: 1, weekGoal: 3, monthDone: 4, monthGoal: 12, reminder: '', reminderNote: '' }
  ]
  const recentUploads = [
    { title: 'Why Narcissists Panic When You Go Quiet', channel: 'Mental Empire', views: '42K', publishedAt: '2d ago' },
    { title: 'The Stoic Secret to Never Being Angry', channel: 'Stoic Hour', views: '18K', publishedAt: '4d ago' },
    { title: '8 Hours Heavy Rain for Deep Sleep', channel: 'Sleep Deep', views: '120K', publishedAt: '1w ago' }
  ]
  const downloads = [
    { id: 'd1', sourceId: 'pw', title: 'How Narcissists Act When They Can No Longer Control You', channel: '@PowerWithinOfficial', size: '31 MB', when: 'just now', stage: 'Downloaded only', pct: '100', action: 'Open', thumb: grad('#2a2540', '#46243a'), durationSec: 1320 },
    { id: 'd2', sourceId: 'pw', title: 'The Final Dirty Trick Narcissists Use', channel: '@PowerWithinOfficial', size: '28 MB', when: '10m ago', stage: 'Downloading', pct: '64', action: 'Resume', thumb: grad('#143a32', '#0f3a32'), durationSec: 1190 }
  ]
  const srcTitles = ['How Narcissists React After Long No Contact', 'The Narcissist Can’t Escape What They Did to You', 'When The Narcissist Knows You Will Never Come Back', 'Narcissists Are 100% Done With You Forever', 'What Narcissists Do When They KNOW They’re Guilty', 'When A Narcissist And You BOTH Go No Contact', 'Universe Sends These 3 Signs Before Removing a Narcissist', 'How to RESPOND When a Narcissist Reaches Out']
  const sourceVideos = srcTitles.map((t, i) => ({ id: `sv${i}`, title: `${t} | Dr Ramani`, durationSec: 1150 + i * 97, views: 48000 + i * 15300, uploadDate: `2026-06-${10 + i}`, thumb: grad(['#23304a', '#2a2540', '#143a32', '#3a2330'][i % 4], '#15171d') }))
  const profiles = [
    { id: 'me', name: 'Mental Empire', mono: 'ME', avatar: grad('#f5b323', '#b9780a'), rule: 'Latest · 5 videos', images: 'Pool of 10 · shuffle', thumb: 'Full Bleed', cap: 'Hormozi · 16:9', out: '/Desktop/ME_out', autoWatch: true, sourceUrl: 'https://youtube.com/@PowerWithinOfficial', sourceOrder: 'Latest' as const, sourceCount: 5, imageMode: 'pool' as const, poolSize: 10, kenBurns: true, captionPreset: 'Hormozi', captionAspect: '16:9' as const }
  ]
  const activity = [
    { t: '09:42', icon: '✓', color: '#36c98e', text: 'Rendered "Gaslighting Explained" → ME_out' },
    { t: '09:31', icon: '✓', color: '#36c98e', text: 'Downloaded 5 mp3 from @PowerWithinOfficial' },
    { t: '09:30', icon: '◔', color: '#f5b323', text: 'Auto-watch found 5 new uploads' }
  ]
  const settings = {
    accent: 'Amber', ambientGlow: true, showActivityRail: true, defaultScreen: 'library', namingTemplate: '{channel} - {title}', outputFolder: '/Desktop/ME_out', concurrency: 2, quality: '1080p',
    autoScrape: { enabled: true, frequency: 'Every 6 hours', delaySec: 1.5, retries: 3, proxy: '', cookiesPath: '' },
    background: { tray: true, startOnSignIn: true, notifications: true, webhook: '' },
    transcription: { apiKey: '', model: 'whisper-large-v3-turbo' },
    beta: { enabled: true, pexelsKey: '', pixabayKey: '', coverrKey: '' }
  }
  const templates: Array<{ id: string; name: string; layers: unknown[] }> = []
  const dlCbs: Array<(p: unknown) => void> = []
  const noop = (): void => {}
  // Any method we didn't explicitly define resolves to an empty result (keeps screens safe).
  const ns = <T extends object>(o: T): T => new Proxy(o, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : async () => []) }) as T

  const api = {
    platform: 'web', appVersion: '0.1.3 (browser mock)', minimize: noop, maximize: noop, close: noop,
    openLogs: async () => '(browser mock — no logs)', logPath: async () => '(browser mock)',
    settings: ns({ get: async () => settings, set: async (p: object) => Object.assign(settings, p), reset: async () => settings }),
    db: ns({ myChannels: async () => channels, recentUploads: async () => recentUploads, downloads: async () => downloads, sourceChannels: async () => [], profiles: async () => profiles, templates: async () => templates, activity: async () => activity, upsertProfile: async () => profiles, saveTemplate: async (t: { id: string; name: string; layers: unknown[] }) => { templates.push(t); return templates }, updateChannelGoals: async () => channels }),
    scrape: ns({ channel: async () => ({}), addMyChannel: async () => channels[0], refreshChannel: async () => channels[0], all: async () => channels, sourceVideos: async () => sourceVideos }),
    reminders: ns({ check: async () => [] }),
    download: ns({
      start: async (vids: Array<{ id: string; title: string; durationSec: number }>) => {
        vids.forEach((v, i) => {
          let pct = 0
          const id = setInterval(() => {
            pct += 20
            dlCbs.forEach((cb) => cb({ downloadId: v.id, title: v.title, pct, stage: 'Downloading', done: pct >= 100 }))
            if (pct >= 100) { clearInterval(id); downloads.unshift({ id: v.id, sourceId: 'pw', title: v.title, channel: '@PowerWithinOfficial', size: '30 MB', when: 'just now', stage: 'Downloaded only', pct: '100', action: 'Open', thumb: grad('#2a2540', '#15171d'), durationSec: v.durationSec }) }
          }, 250 + i * 120)
        })
        return downloads
      },
      resume: async (id: string) => downloads.find((d) => d.id === id), openFolder: async () => {}
    }),
    compose: ns({ list: async () => [], get: async () => null, images: async () => [] }),
    transcribe: ns({ get: async () => [] }),
    thumbnails: ns({ templates: async () => templates, saveTemplate: async (t: { id: string; name: string; layers: unknown[] }) => { templates.push(t); return templates }, deleteTemplate: async (id: string) => { const i = templates.findIndex((t) => t.id === id); if (i >= 0) templates.splice(i, 1); return templates }, assignToProfile: async () => profiles, writePng: async (name: string) => `/out/${name}` }),
    render: ns({ jobs: async () => [], all: async () => {}, cancel: async () => {} }),
    effects: ns({ generate: async () => '{}' }),
    automation: ns({ runProfile: async () => [], upsertProfile: async () => profiles, deleteProfile: async () => profiles, tick: async () => {} }),
    onActivity: () => noop, onScrapeProgress: () => noop,
    onDownloadProgress: (cb: (p: unknown) => void) => { dlCbs.push(cb); return noop },
    onTranscribeProgress: () => noop, onRenderProgress: () => noop
  }
  ;(window as unknown as { api: NativeApi }).api = api as unknown as NativeApi
  // eslint-disable-next-line no-console
  console.info('[mockApi] browser test mock installed (no Electron backend detected)')
}

// Only install when there is no real Electron bridge.
if (typeof window !== 'undefined' && !(window as unknown as { api?: unknown }).api) {
  installMock()
}
