import type Database from 'better-sqlite3'
import type {
  ThumbnailLayer,
  DownloadedVideo,
  MyChannel,
  Profile,
  SourceChannel,
  ActivityRow
} from '../../shared/types'

// First-run seed. A fresh install starts CLEAN — no fake channels, downloads,
// profiles, or activity (those made the dashboard look fabricated and produced
// bogus "Incomplete YouTube ID" download errors). The only thing we seed is one
// ready-to-use thumbnail template so the Thumbnails editor opens with a sensible
// starting point. Everything else is populated by real scraping/downloads.
//
// The demo dataset below is NOT used in production — it exists only so the headless
// smoke/e2e harnesses (ME_SMOKE=*) have deterministic rows to assert against; they
// call seedDemoData() explicitly.

const defaultTemplate: { id: string; name: string; layers: ThumbnailLayer[] } = {
  id: 'tpl-full-bleed',
  name: 'Full Bleed',
  layers: [
    { id: 'headline', kind: 'text', name: 'Headline', visible: true, locked: false, frame: { x: 80, y: 426, width: 780, height: 250, rotation: 0 }, text: 'EVERYTHING WAS FAKE', lines: [{ text: 'EVERYTHING', size: 92 }, { text: 'WAS FAKE', size: 128 }], highlightWord: 'FAKE', highlightColor: '#ffffff', highlightSquare: true, color: '#ffffff', fontFamily: 'Anton', align: 'left', effects: { shadow: { enabled: true, color: '#000000', size: 0, opacity: 0.55, distance: 5, angle: 45 }, stroke: { enabled: false, color: '#000000', size: 6, opacity: 1 }, glow: { enabled: false, color: '#ffffff', size: 26, opacity: 0.85 }, caps: true } },
    { id: 'subject', kind: 'subject', name: 'Subject', visible: true, locked: true, frame: { x: 96, y: 80, width: 470, height: 640, rotation: 0 }, src: '', outline: { enabled: true, color: '#ffffff', size: 6, opacity: 1 }, shadow: { enabled: true, color: '#000000', size: 24, opacity: 0.6, distance: 10, angle: 90 }, glow: { enabled: false, color: '#19c3d6', size: 30, opacity: 0.85 } },
    { id: 'bg', kind: 'background', name: 'Background', visible: true, locked: true, frame: { x: 0, y: 0, width: 1280, height: 720, rotation: 0 }, fill: 'linear-gradient(135deg,#2a2540,#46243a)', mode: 'gradient' }
  ]
}

function seedTemplate(d: Database.Database): void {
  const exists = d.prepare('SELECT 1 FROM thumbnail_templates WHERE id=?').get(defaultTemplate.id)
  if (!exists) {
    d.prepare('INSERT INTO thumbnail_templates (id,name,layers) VALUES (@id,@name,@layers)').run({
      id: defaultTemplate.id, name: defaultTemplate.name, layers: JSON.stringify(defaultTemplate.layers)
    })
  }
}

export function seedIfEmpty(d: Database.Database): void {
  // A 'seeded' marker means we've already initialised once — never re-run.
  const marker = d.prepare("SELECT value FROM app_meta WHERE key='seeded'").get() as { value: string } | undefined
  if (marker) return

  const tx = d.transaction(() => {
    // Production: only a default thumbnail template — no fake demo content.
    seedTemplate(d)
    d.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES ('seeded','1')").run()
  })
  tx()
}

// --- demo dataset (smoke/e2e harnesses only) -------------------------------

const demoSourceChannels: SourceChannel[] = [
  { id: 'src-pw', url: 'https://youtube.com/@PowerWithinOfficial', handle: '@PowerWithinOfficial', name: 'Power Within' },
  { id: 'src-ds', url: 'https://youtube.com/@DailyStoicTalks', handle: '@DailyStoicTalks', name: 'Daily Stoic Talks' },
  { id: 'src-rs', url: 'https://youtube.com/@RainSounds24', handle: '@RainSounds24', name: 'Rain Sounds 24' }
]

const demoMyChannels: MyChannel[] = [
  { id: 'me', name: 'Mental Empire', handle: '@powerwithin', mono: 'ME', avatar: 'linear-gradient(135deg,#f5b323,#b9780a)', total: 25, views: '12.4K', subs: '455', weekDone: 3, weekGoal: 5, monthDone: 11, monthGoal: 20, source: '@PowerWithinOfficial', linkedSourceId: 'src-pw', mapDone: 12, mapTotal: 18, reminder: 'Fri Jun 27', reminderNote: '2 left to hit weekly goal' },
  { id: 'sh', name: 'Stoic Hour', handle: '@stoichour', mono: 'SH', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)', total: 40, views: '88.7K', subs: '2.1K', weekDone: 5, weekGoal: 5, monthDone: 18, monthGoal: 18, source: '@DailyStoicTalks', linkedSourceId: 'src-ds', mapDone: 18, mapTotal: 18, reminder: 'On track', reminderNote: 'Goal met — nice' },
  { id: 'sd', name: 'Sleep Deep', handle: '@sleepdeep', mono: 'SD', avatar: 'linear-gradient(135deg,#36c98e,#1f9c6b)', total: 12, views: '5.9K', subs: '640', weekDone: 1, weekGoal: 3, monthDone: 4, monthGoal: 12, source: '@RainSounds24', linkedSourceId: 'src-rs', mapDone: 6, mapTotal: 9, reminder: 'Tue Jun 24', reminderNote: 'Behind pace — 2 due this week' }
]

const demoDownloads: DownloadedVideo[] = [
  { id: 'd1', sourceId: 'src-pw', title: 'Gaslighting Explained', channel: '@powerwithin', size: '9.1 MB', when: '19h ago', stage: 'Captioned', pct: '75%', action: 'Resume', thumb: 'linear-gradient(135deg,#1a2e3a,#0f3a32)' },
  { id: 'd2', sourceId: 'src-pw', title: 'Everything Was Fake', channel: '@powerwithin', size: '5.4 MB', when: '1d ago', stage: 'Needs thumbnail', pct: '50%', action: 'Resume', thumb: 'linear-gradient(135deg,#3a2440,#2a1530)' },
  { id: 'd3', sourceId: 'src-pw', title: 'The Moment I Realized', channel: '@powerwithin', size: '6.7 MB', when: '2d ago', stage: 'Downloaded only', pct: '15%', action: 'Resume', thumb: 'linear-gradient(135deg,#23304a,#1a2438)' },
  { id: 'd4', sourceId: 'src-ds', title: 'Marcus Aurelius on Anger', channel: '@stoichour', size: '8.0 MB', when: '3d ago', stage: 'Uploaded ✓', pct: '100%', action: 'Open', thumb: 'linear-gradient(135deg,#16323a,#0f2630)' }
]

const demoProfiles: Profile[] = [
  { id: 'me', name: 'Mental Empire', mono: 'ME', avatar: 'linear-gradient(135deg,#f5b323,#b9780a)', rule: 'Latest · 5 videos', images: 'Pool of 10 · shuffle', thumb: 'Full Bleed · White', cap: 'Hormozi · 16:9', out: '/Desktop/ME_out', autoWatch: true, linkedSourceId: 'src-pw', sourceUrl: 'https://youtube.com/@PowerWithinOfficial', sourceOrder: 'Latest', sourceCount: 5, imageMode: 'pool', poolSize: 10, kenBurns: true, captionPreset: 'Hormozi', captionAspect: '16:9', thumbnailTemplateId: 'tpl-full-bleed' },
  { id: 'sh', name: 'Stoic Hour', mono: 'SH', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)', rule: 'Popular · 10 videos', images: 'Single image', thumb: 'Subject Left · Amber', cap: 'Pop · 16:9', out: '/Desktop/Stoic_out', autoWatch: true, linkedSourceId: 'src-ds', sourceUrl: 'https://youtube.com/@DailyStoicTalks', sourceOrder: 'Popular', sourceCount: 10, imageMode: 'sequence', poolSize: 1, kenBurns: true, captionPreset: 'Pop', captionAspect: '16:9' },
  { id: 'sd', name: 'Sleep Deep', mono: 'SD', avatar: 'linear-gradient(135deg,#36c98e,#1f9c6b)', rule: 'Latest · 3 videos', images: 'Pool of 20 · shuffle', thumb: 'Centered · Cyan', cap: 'Minimal · 16:9', out: '/Desktop/Sleep_out', autoWatch: true, linkedSourceId: 'src-rs', sourceUrl: 'https://youtube.com/@RainSounds24', sourceOrder: 'Latest', sourceCount: 3, imageMode: 'pool', poolSize: 20, kenBurns: true, captionPreset: 'Minimal', captionAspect: '16:9' }
]

const demoActivity: ActivityRow[] = [
  { t: '08:55', icon: '!', color: '#ff5a6e', text: 'Skipped 1 video — members only' },
  { t: '09:30', icon: '◉', color: '#f5b323', text: 'Auto-watch found 5 new uploads' },
  { t: '09:31', icon: '✓', color: '#36c98e', text: 'Downloaded 5 mp3 from @stoichour' },
  { t: '09:38', icon: '↻', color: '#8b7cff', text: 'Captions burned (Hormozi)' },
  { t: '09:42', icon: '✓', color: '#36c98e', text: 'Rendered Gaslighting Explained → ME_out' }
]

/** Insert the deterministic demo dataset — for the headless smoke/e2e harnesses ONLY. */
export function seedDemoData(d: Database.Database): void {
  if ((d.prepare('SELECT COUNT(*) AS n FROM my_channels').get() as { n: number }).n > 0) return
  const tx = d.transaction(() => {
    seedTemplate(d)
    const src = d.prepare('INSERT INTO source_channels (id,url,handle,name) VALUES (@id,@url,@handle,@name)')
    demoSourceChannels.forEach((s) => src.run(s))

    const mc = d.prepare(
      `INSERT INTO my_channels (id,name,handle,mono,avatar,views,subs,total,linkedSourceId,source,mapDone,mapTotal,weekDone,weekGoal,monthDone,monthGoal,reminder,reminderNote)
       VALUES (@id,@name,@handle,@mono,@avatar,@views,@subs,@total,@linkedSourceId,@source,@mapDone,@mapTotal,@weekDone,@weekGoal,@monthDone,@monthGoal,@reminder,@reminderNote)`
    )
    demoMyChannels.forEach((c) => mc.run({ linkedSourceId: null, ...c }))

    const dv = d.prepare(
      `INSERT INTO downloaded_videos (id,sourceId,title,channel,size,"when",stage,pct,action,thumb)
       VALUES (@id,@sourceId,@title,@channel,@size,@when,@stage,@pct,@action,@thumb)`
    )
    demoDownloads.forEach((v) => dv.run(v))

    const pf = d.prepare(
      `INSERT INTO profiles (id,name,mono,avatar,rule,images,thumb,cap,out,autoWatch,thumbnailTemplateId,linkedSourceId,sourceUrl,sourceOrder,sourceCount,imageMode,poolSize,kenBurns,captionPreset,captionAspect)
       VALUES (@id,@name,@mono,@avatar,@rule,@images,@thumb,@cap,@out,@autoWatch,@thumbnailTemplateId,@linkedSourceId,@sourceUrl,@sourceOrder,@sourceCount,@imageMode,@poolSize,@kenBurns,@captionPreset,@captionAspect)`
    )
    demoProfiles.forEach((p) => pf.run({ thumbnailTemplateId: null, ...p, autoWatch: p.autoWatch ? 1 : 0, kenBurns: p.kenBurns ? 1 : 0 }))

    const al = d.prepare('INSERT INTO activity_log (t,icon,color,text) VALUES (@t,@icon,@color,@text)')
    demoActivity.forEach((a) => al.run(a))
    // Mark demo as already-purged so the production cleanup never touches it mid-test.
    d.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES ('demo_purged_v2','1')").run()
    d.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES ('seeded','1')").run()
  })
  tx()
}
