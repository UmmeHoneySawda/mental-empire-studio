import type Database from 'better-sqlite3'
import type {
  DownloadedVideo,
  MyChannel,
  Profile,
  SourceChannel,
  ThumbnailLayer,
  ActivityRow
} from '../../shared/types'

// First-run seed. Mirrors the M1 mock data so a fresh install shows the same
// content the UI was designed against; real scraped data replaces it from M3 on.

const sourceChannels: SourceChannel[] = [
  { id: 'src-pw', url: 'https://youtube.com/@PowerWithinOfficial', handle: '@PowerWithinOfficial', name: 'Power Within' },
  { id: 'src-ds', url: 'https://youtube.com/@DailyStoicTalks', handle: '@DailyStoicTalks', name: 'Daily Stoic Talks' },
  { id: 'src-rs', url: 'https://youtube.com/@RainSounds24', handle: '@RainSounds24', name: 'Rain Sounds 24' }
]

const myChannels: MyChannel[] = [
  { id: 'me', name: 'Mental Empire', handle: '@powerwithin', mono: 'ME', avatar: 'linear-gradient(135deg,#f5b323,#b9780a)', total: 25, views: '12.4K', subs: '455', weekDone: 3, weekGoal: 5, monthDone: 11, monthGoal: 20, source: '@PowerWithinOfficial', linkedSourceId: 'src-pw', mapDone: 12, mapTotal: 18, reminder: 'Fri Jun 27', reminderNote: '2 left to hit weekly goal' },
  { id: 'sh', name: 'Stoic Hour', handle: '@stoichour', mono: 'SH', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)', total: 40, views: '88.7K', subs: '2.1K', weekDone: 5, weekGoal: 5, monthDone: 18, monthGoal: 18, source: '@DailyStoicTalks', linkedSourceId: 'src-ds', mapDone: 18, mapTotal: 18, reminder: 'On track', reminderNote: 'Goal met — nice' },
  { id: 'sd', name: 'Sleep Deep', handle: '@sleepdeep', mono: 'SD', avatar: 'linear-gradient(135deg,#36c98e,#1f9c6b)', total: 12, views: '5.9K', subs: '640', weekDone: 1, weekGoal: 3, monthDone: 4, monthGoal: 12, source: '@RainSounds24', linkedSourceId: 'src-rs', mapDone: 6, mapTotal: 9, reminder: 'Tue Jun 24', reminderNote: 'Behind pace — 2 due this week' }
]

const downloads: DownloadedVideo[] = [
  { id: 'd1', sourceId: 'src-pw', title: 'Gaslighting Explained', channel: '@powerwithin', size: '9.1 MB', when: '19h ago', stage: 'Captioned', pct: '75%', action: 'Resume', thumb: 'linear-gradient(135deg,#1a2e3a,#0f3a32)' },
  { id: 'd2', sourceId: 'src-pw', title: 'Everything Was Fake', channel: '@powerwithin', size: '5.4 MB', when: '1d ago', stage: 'Needs thumbnail', pct: '50%', action: 'Resume', thumb: 'linear-gradient(135deg,#3a2440,#2a1530)' },
  { id: 'd3', sourceId: 'src-pw', title: 'The Moment I Realized', channel: '@powerwithin', size: '6.7 MB', when: '2d ago', stage: 'Downloaded only', pct: '15%', action: 'Resume', thumb: 'linear-gradient(135deg,#23304a,#1a2438)' },
  { id: 'd4', sourceId: 'src-ds', title: 'Marcus Aurelius on Anger', channel: '@stoichour', size: '8.0 MB', when: '3d ago', stage: 'Uploaded ✓', pct: '100%', action: 'Open', thumb: 'linear-gradient(135deg,#16323a,#0f2630)' }
]

const profiles: Profile[] = [
  { id: 'me', name: 'Mental Empire', mono: 'ME', avatar: 'linear-gradient(135deg,#f5b323,#b9780a)', rule: 'Latest · 5 videos', images: 'Pool of 10 · shuffle', thumb: 'Full Bleed · White', cap: 'Hormozi · 16:9', out: '/Desktop/ME_out', autoWatch: true },
  { id: 'sh', name: 'Stoic Hour', mono: 'SH', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)', rule: 'Popular · 10 videos', images: 'Single image', thumb: 'Subject Left · Amber', cap: 'Pop · 16:9', out: '/Desktop/Stoic_out', autoWatch: true },
  { id: 'sd', name: 'Sleep Deep', mono: 'SD', avatar: 'linear-gradient(135deg,#36c98e,#1f9c6b)', rule: 'Latest · 3 videos', images: 'Pool of 20 · shuffle', thumb: 'Centered · Cyan', cap: 'Minimal · 16:9', out: '/Desktop/Sleep_out', autoWatch: true }
]

const activity: ActivityRow[] = [
  { t: '08:55', icon: '!', color: '#ff5a6e', text: 'Skipped 1 video — members only' },
  { t: '09:30', icon: '◉', color: '#f5b323', text: 'Auto-watch found 5 new uploads' },
  { t: '09:31', icon: '✓', color: '#36c98e', text: 'Downloaded 5 mp3 from @stoichour' },
  { t: '09:38', icon: '↻', color: '#8b7cff', text: 'Captions burned (Hormozi)' },
  { t: '09:42', icon: '✓', color: '#36c98e', text: 'Rendered Gaslighting Explained → ME_out' }
]

const defaultTemplate: { id: string; name: string; layers: ThumbnailLayer[] } = {
  id: 'tpl-full-bleed',
  name: 'Full Bleed',
  layers: [
    { id: 'headline', kind: 'text', name: 'Headline', visible: true, locked: false, text: 'EVERYTHING WAS FAKE', lines: [{ text: 'EVERYTHING', size: 52 }, { text: 'WAS FAKE', size: 72 }], highlightWord: 'FAKE', highlightColor: '#ffffff', highlightSquare: true, effects: { shadow: true, stroke: false, glow: false, caps: true } },
    { id: 'subject', kind: 'subject', name: 'Subject', visible: true, locked: true, mode: 'cutout', outline: true, shadow: true, glow: false },
    { id: 'bg', kind: 'background', name: 'Background', visible: true, locked: true, fill: 'linear-gradient(135deg,#2a2540,#46243a)', mode: 'gradient' }
  ]
}

export function seedIfEmpty(d: Database.Database): void {
  const count = (d.prepare('SELECT COUNT(*) AS n FROM my_channels').get() as { n: number }).n
  if (count > 0) return

  const tx = d.transaction(() => {
    const src = d.prepare('INSERT INTO source_channels (id,url,handle,name) VALUES (@id,@url,@handle,@name)')
    sourceChannels.forEach((s) => src.run(s))

    const mc = d.prepare(
      `INSERT INTO my_channels (id,name,handle,mono,avatar,views,subs,total,linkedSourceId,source,mapDone,mapTotal,weekDone,weekGoal,monthDone,monthGoal,reminder,reminderNote)
       VALUES (@id,@name,@handle,@mono,@avatar,@views,@subs,@total,@linkedSourceId,@source,@mapDone,@mapTotal,@weekDone,@weekGoal,@monthDone,@monthGoal,@reminder,@reminderNote)`
    )
    myChannels.forEach((c) => mc.run({ linkedSourceId: null, ...c }))

    const dv = d.prepare(
      `INSERT INTO downloaded_videos (id,sourceId,title,channel,size,"when",stage,pct,action,thumb)
       VALUES (@id,@sourceId,@title,@channel,@size,@when,@stage,@pct,@action,@thumb)`
    )
    downloads.forEach((v) => dv.run(v))

    const pf = d.prepare(
      `INSERT INTO profiles (id,name,mono,avatar,rule,images,thumb,cap,out,autoWatch)
       VALUES (@id,@name,@mono,@avatar,@rule,@images,@thumb,@cap,@out,@autoWatch)`
    )
    profiles.forEach((p) => pf.run({ ...p, autoWatch: p.autoWatch ? 1 : 0 }))

    d.prepare('INSERT INTO thumbnail_templates (id,name,layers) VALUES (@id,@name,@layers)').run({
      id: defaultTemplate.id, name: defaultTemplate.name, layers: JSON.stringify(defaultTemplate.layers)
    })

    const al = d.prepare('INSERT INTO activity_log (t,icon,color,text) VALUES (@t,@icon,@color,@text)')
    activity.forEach((a) => al.run(a))
  })
  tx()
}
