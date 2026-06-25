// Mock data ported from the prototype's renderVals(). Replaced by scraped/DB data in M2+.
import type {
  DownloadedVideo,
  MyChannel,
  Profile,
  ThumbnailLayer,
  UploadStatus
} from '@shared/types'

export interface LibraryChannel {
  name: string
  handle: string
  mono: string
  avatar: string
  views: string
  subs: string
  uploaded: string
  bars: number[]
}

export const libraryChannels: LibraryChannel[] = [
  { name: 'Mental Empire', handle: '@powerwithin', mono: 'ME', avatar: 'linear-gradient(135deg,#f5b323,#b9780a)', views: '12.4K', subs: '455', uploaded: '18/25', bars: [40, 62, 48, 80, 66, 95, 78, 100] },
  { name: 'Stoic Hour', handle: '@stoichour', mono: 'SH', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)', views: '88.7K', subs: '2.1K', uploaded: '40/40', bars: [55, 68, 60, 82, 90, 76, 96, 100] },
  { name: 'Sleep Deep', handle: '@sleepdeep', mono: 'SD', avatar: 'linear-gradient(135deg,#36c98e,#1f9c6b)', views: '5.9K', subs: '640', uploaded: '9/12', bars: [38, 46, 58, 52, 70, 64, 84, 92] }
]

export interface UploadRow {
  title: string
  channel: string
  status: UploadStatus
  views: string
  when: string
  thumb: string
}

export const uploads: UploadRow[] = [
  { title: 'Narcissism and Depression', channel: 'Mental Empire', status: 'Uploaded', views: '72', when: '8h', thumb: 'linear-gradient(135deg,#2a2540,#46243a)' },
  { title: 'Gaslighting Explained', channel: 'Mental Empire', status: 'Uploaded', views: '97', when: '19h', thumb: 'linear-gradient(135deg,#1a2e3a,#0f3a32)' },
  { title: 'Everything Was Fake', channel: 'Mental Empire', status: 'Scheduled', views: '—', when: '2h', thumb: 'linear-gradient(135deg,#3a2440,#2a1530)' },
  { title: 'Marcus Aurelius on Anger', channel: 'Stoic Hour', status: 'Uploaded', views: '1.2K', when: '2d', thumb: 'linear-gradient(135deg,#23304a,#1a2438)' },
  { title: 'Rain for Deep Sleep 8h', channel: 'Sleep Deep', status: 'Uploaded', views: '3.4K', when: '4d', thumb: 'linear-gradient(135deg,#16323a,#0f2630)' }
]

export const statusStyle: Record<UploadStatus, { bg: string; color: string; dot: string }> = {
  Uploaded: { bg: 'rgba(54,201,142,.14)', color: '#4fd6a0', dot: '#36c98e' },
  Scheduled: { bg: 'rgba(245,179,35,.14)', color: '#f5b323', dot: '#f5b323' },
  Draft: { bg: 'rgba(255,255,255,.06)', color: '#8a909c', dot: '#5b616f' }
}

export interface ActivityItem {
  t: string
  icon: string
  color: string
  text: string
}

export const activity: ActivityItem[] = [
  { t: '09:42', icon: '✓', color: '#36c98e', text: 'Rendered Gaslighting Explained → ME_out' },
  { t: '09:38', icon: '↻', color: '#8b7cff', text: 'Captions burned (Hormozi)' },
  { t: '09:31', icon: '✓', color: '#36c98e', text: 'Downloaded 5 mp3 from @stoichour' },
  { t: '09:30', icon: '◉', color: '#f5b323', text: 'Auto-watch found 5 new uploads' },
  { t: '08:55', icon: '!', color: '#ff5a6e', text: 'Skipped 1 video — members only' }
]

export const myChannels: MyChannel[] = [
  { id: 'me', name: 'Mental Empire', handle: '@powerwithin', mono: 'ME', avatar: 'linear-gradient(135deg,#f5b323,#b9780a)', total: 25, views: '12.4K', subs: '455', weekDone: 3, weekGoal: 5, monthDone: 11, monthGoal: 20, source: '@PowerWithinOfficial', linkedSourceId: 'src-pw', mapDone: 12, mapTotal: 18, reminder: 'Fri Jun 27', reminderNote: '2 left to hit weekly goal' },
  { id: 'sh', name: 'Stoic Hour', handle: '@stoichour', mono: 'SH', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)', total: 40, views: '88.7K', subs: '2.1K', weekDone: 5, weekGoal: 5, monthDone: 18, monthGoal: 18, source: '@DailyStoicTalks', linkedSourceId: 'src-ds', mapDone: 18, mapTotal: 18, reminder: 'On track', reminderNote: 'Goal met — nice' },
  { id: 'sd', name: 'Sleep Deep', handle: '@sleepdeep', mono: 'SD', avatar: 'linear-gradient(135deg,#36c98e,#1f9c6b)', total: 12, views: '5.9K', subs: '640', weekDone: 1, weekGoal: 3, monthDone: 4, monthGoal: 12, source: '@RainSounds24', linkedSourceId: 'src-rs', mapDone: 6, mapTotal: 9, reminder: 'Tue Jun 24', reminderNote: 'Behind pace — 2 due this week' }
]

export const dlHistory: DownloadedVideo[] = [
  { id: 'd1', sourceId: 'src-pw', title: 'Gaslighting Explained', channel: '@powerwithin', size: '9.1 MB', when: '19h ago', stage: 'Captioned', pct: '75%', action: 'Resume', thumb: 'linear-gradient(135deg,#1a2e3a,#0f3a32)' },
  { id: 'd2', sourceId: 'src-pw', title: 'Everything Was Fake', channel: '@powerwithin', size: '5.4 MB', when: '1d ago', stage: 'Needs thumbnail', pct: '50%', action: 'Resume', thumb: 'linear-gradient(135deg,#3a2440,#2a1530)' },
  { id: 'd3', sourceId: 'src-pw', title: 'The Moment I Realized', channel: '@powerwithin', size: '6.7 MB', when: '2d ago', stage: 'Downloaded only', pct: '15%', action: 'Resume', thumb: 'linear-gradient(135deg,#23304a,#1a2438)' },
  { id: 'd4', sourceId: 'src-ds', title: 'Marcus Aurelius on Anger', channel: '@stoichour', size: '8.0 MB', when: '3d ago', stage: 'Uploaded ✓', pct: '100%', action: 'Open', thumb: 'linear-gradient(135deg,#16323a,#0f2630)' }
]

export interface VideoPick {
  title: string
  dur: string
  views: string
  sel: boolean
  thumb: string
}

const vThumbs = [
  'linear-gradient(135deg,#2a2540,#46243a)', 'linear-gradient(135deg,#1a2e3a,#0f3a32)',
  'linear-gradient(135deg,#3a2440,#2a1530)', 'linear-gradient(135deg,#23304a,#1a2438)',
  'linear-gradient(135deg,#16323a,#0f2630)', 'linear-gradient(135deg,#2e2440,#3a1f2e)',
  'linear-gradient(135deg,#1f3340,#102a3a)', 'linear-gradient(135deg,#332a40,#241a30)'
]

export const videos: VideoPick[] = [
  { title: 'Narcissism and Depression: The Hidden Link', dur: '19:25', views: '72', sel: true },
  { title: 'Gaslighting Explained in 20 Minutes', dur: '20:05', views: '97', sel: true },
  { title: 'Everything Was Fake — A Story', dur: '11:29', views: '118', sel: false },
  { title: 'The Moment I Realized the Truth', dur: '14:02', views: '60', sel: false },
  { title: 'Why Narcissists Never Apologize', dur: '16:40', views: '203', sel: false },
  { title: 'How to Spot a Covert Manipulator', dur: '18:12', views: '154', sel: false },
  { title: "You Were Manipulated — Here's How", dur: '12:55', views: '89', sel: false },
  { title: 'Stop Explaining Yourself to Them', dur: '15:30', views: '47', sel: false }
].map((v, i) => ({ ...v, thumb: vThumbs[i] }))

export interface ImageItem {
  name: string
  range: string
  thumb: string
}

export const imageList: ImageItem[] = [
  { name: 'image_01.jpg', range: '0:00–6:40', thumb: 'linear-gradient(135deg,#2a2540,#46243a)' },
  { name: 'image_02.jpg', range: '6:40–13:20', thumb: 'linear-gradient(135deg,#1a2e3a,#0f3a32)' },
  { name: 'image_03.jpg', range: '13:20–20:05', thumb: 'linear-gradient(135deg,#23304a,#1a2438)' }
]

export const thumbTemplates = ['Subject Left', 'Subject Right', 'Centered', 'Full Bleed']
export const activeThumbTemplate = 'Full Bleed'

export const batchTitles = [
  { a: "YOU'RE NOT", b: 'CRAZY' },
  { a: 'IT ALL', b: 'BROKE' },
  { a: 'NEVER', b: 'APOLOGIZE' },
  { a: 'STOP', b: 'EXPLAINING' },
  { a: 'IT WAS', b: 'A LIE' },
  { a: 'COVERT', b: 'NARCISSIST' }
]

export const capPresets = ['Pop', 'Bold', 'Hormozi', 'Word', 'Neon', 'Min']
export const activeCapPreset = 'Hormozi'

export interface QueueRow {
  title: string
  channel: string
  mp3: string
  mp3c: string
  images: string
  thumbi: string
  thumbc: string
  cap: string
  capc: string
  pct: string
  barColor: string
  statusText: string
  statusColor: string
  thumb: string
}

export const queue: QueueRow[] = [
  { title: 'Narcissism and Depression', channel: 'Mental Empire', mp3: '✓', mp3c: '#36c98e', images: '3', thumbi: '✓', thumbc: '#36c98e', cap: '✓', capc: '#36c98e', pct: '100%', barColor: '#36c98e', statusText: 'done', statusColor: '#4fd6a0', thumb: 'linear-gradient(135deg,#2a2540,#46243a)' },
  { title: 'Gaslighting Explained', channel: 'Mental Empire', mp3: '✓', mp3c: '#36c98e', images: '2', thumbi: '✓', thumbc: '#36c98e', cap: '✓', capc: '#36c98e', pct: '60%', barColor: 'var(--accent)', statusText: '60%', statusColor: '#f5b323', thumb: 'linear-gradient(135deg,#1a2e3a,#0f3a32)' },
  { title: 'Everything Was Fake', channel: 'Mental Empire', mp3: '✓', mp3c: '#36c98e', images: '1', thumbi: '!', thumbc: '#ff5a6e', cap: '—', capc: '#5b616f', pct: '0%', barColor: '#5b616f', statusText: 'needs thumb', statusColor: '#ff8a96', thumb: 'linear-gradient(135deg,#3a2440,#2a1530)' },
  { title: 'Marcus Aurelius on Anger', channel: 'Stoic Hour', mp3: '✓', mp3c: '#36c98e', images: '5', thumbi: '✓', thumbc: '#36c98e', cap: '✓', capc: '#36c98e', pct: '0%', barColor: '#5b616f', statusText: 'queued', statusColor: '#8a909c', thumb: 'linear-gradient(135deg,#23304a,#1a2438)' }
]

export const profiles: Profile[] = [
  { id: 'me', name: 'Mental Empire', mono: 'ME', avatar: 'linear-gradient(135deg,#f5b323,#b9780a)', rule: 'Latest · 5 videos', images: 'Pool of 10 · shuffle', thumb: 'Full Bleed · White', cap: 'Hormozi · 16:9', out: '/Desktop/ME_out', autoWatch: true, sourceUrl: 'https://youtube.com/@PowerWithinOfficial', sourceOrder: 'Latest', sourceCount: 5, imageMode: 'pool', poolSize: 10, kenBurns: true, captionPreset: 'Hormozi', captionAspect: '16:9' },
  { id: 'sh', name: 'Stoic Hour', mono: 'SH', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)', rule: 'Popular · 10 videos', images: 'Single image', thumb: 'Subject Left · Amber', cap: 'Pop · 16:9', out: '/Desktop/Stoic_out', autoWatch: true, sourceUrl: 'https://youtube.com/@DailyStoicTalks', sourceOrder: 'Popular', sourceCount: 10, imageMode: 'sequence', poolSize: 1, kenBurns: true, captionPreset: 'Pop', captionAspect: '16:9' },
  { id: 'sd', name: 'Sleep Deep', mono: 'SD', avatar: 'linear-gradient(135deg,#36c98e,#1f9c6b)', rule: 'Latest · 3 videos', images: 'Pool of 20 · shuffle', thumb: 'Centered · Cyan', cap: 'Minimal · 16:9', out: '/Desktop/Sleep_out', autoWatch: true, sourceUrl: 'https://youtube.com/@RainSounds24', sourceOrder: 'Latest', sourceCount: 3, imageMode: 'pool', poolSize: 20, kenBurns: true, captionPreset: 'Minimal', captionAspect: '16:9' }
]

// Initial thumbnail editor layer stack (req #4). Geometry is logical px on the 1280×720 stage.
export const initialLayers: ThumbnailLayer[] = [
  {
    id: 'headline', kind: 'text', name: 'Headline', visible: true, locked: false,
    frame: { x: 80, y: 426, width: 780, height: 250, rotation: 0 },
    text: 'EVERYTHING WAS FAKE',
    lines: [{ text: 'EVERYTHING', size: 92 }, { text: 'WAS FAKE', size: 128 }],
    highlightWord: 'FAKE', highlightColor: '#ffffff', highlightSquare: true,
    color: '#ffffff', fontFamily: 'Anton', align: 'left',
    effects: { shadow: true, stroke: false, glow: false, caps: true }
  },
  {
    id: 'subline', kind: 'text', name: 'Subline', visible: true, locked: false,
    frame: { x: 80, y: 372, width: 600, height: 48, rotation: 0 },
    text: '', lines: [{ text: '', size: 40 }],
    highlightColor: '#f2c200', highlightSquare: false,
    color: '#ffffff', fontFamily: 'Anton', align: 'left',
    effects: { shadow: true, stroke: false, glow: false, caps: false }
  },
  {
    id: 'badge', kind: 'shape', name: 'Badge (shape)', visible: true, locked: false,
    frame: { x: 1064, y: 48, width: 150, height: 150, rotation: -8 },
    shape: 'circle', color: '#e8403a'
  },
  {
    id: 'subject', kind: 'subject', name: 'Subject', visible: true, locked: false,
    frame: { x: 96, y: 80, width: 470, height: 640, rotation: 0 },
    src: '', outline: true, outlineColor: '#ffffff', outlineWidth: 6, shadow: true, glow: false
  },
  {
    id: 'bg', kind: 'background', name: 'Background', visible: true, locked: true,
    frame: { x: 0, y: 0, width: 1280, height: 720, rotation: 0 },
    fill: 'linear-gradient(135deg,#2a2540,#46243a)', mode: 'gradient'
  }
]
