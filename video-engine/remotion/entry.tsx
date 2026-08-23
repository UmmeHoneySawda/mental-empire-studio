import '@fontsource/anton/400.css'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/hanken-grotesk/700.css'
import '@fontsource/hanken-grotesk/900.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/700.css'
// Cinzel / Oswald / Courier Prime carry the fixed type roles of the New Templates set —
// statement, impact, apparatus. This is the bundle the final render loads, so the faces are
// registered here; src/main.tsx declares the same set for the live <Player>, which reads the
// renderer's own CSS instead.
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/oswald/300.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/600.css'
import '@fontsource/oswald/700.css'
import '@fontsource/courier-prime/400.css'
import { registerRoot } from 'remotion'
import { RemotionRoot } from './root'

registerRoot(RemotionRoot)
