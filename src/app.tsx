import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Library } from './screens/Library'
import { MyChannels } from './screens/MyChannels'
import { Download } from './screens/Download'
import { Compose } from './screens/Compose'
import { Thumbnails } from './screens/Thumbnails'
import { RenderQueue } from './screens/RenderQueue'
import { Profiles } from './screens/Profiles'
import { Settings } from './screens/Settings'
import type { ScreenKey } from '@shared/types'

const SCREENS: Record<ScreenKey, () => JSX.Element> = {
  library: Library,
  channels: MyChannels,
  download: Download,
  compose: Compose,
  thumb: Thumbnails,
  render: RenderQueue,
  profiles: Profiles,
  settings: Settings
}

export function App(): JSX.Element {
  const { active, accent, ambientGlow } = useStore()

  // accent drives the CSS variable palette on :root
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  const pageBg = ambientGlow
    ? 'radial-gradient(70% 55% at 18% 0%, var(--accent-soft) 0%, rgba(0,0,0,0) 60%), radial-gradient(60% 50% at 100% 100%, rgba(80,90,120,.10) 0%, rgba(0,0,0,0) 55%), #070809'
    : '#070809'
  const mainBg = ambientGlow
    ? 'radial-gradient(90% 60% at 100% 0%, var(--accent-soft) 0%, rgba(0,0,0,0) 55%), #0d0f14'
    : '#0d0f14'

  const Screen = SCREENS[active]

  return (
    <div style={{ height: '100%', background: pageBg, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TitleBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, background: mainBg, position: 'relative', overflowY: 'auto', overflowX: 'hidden' }}>
          <Screen key={active} />
        </div>
      </div>
    </div>
  )
}
