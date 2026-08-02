import type { VideoProject } from '@shared/video-engine'

/* The renderer-side mirror of `projectForPreview` / `previewUrlForPath` in
 * electron/services/video-engine/studio.ts.
 *
 * Why mirror rather than call over IPC: this is the last thing standing between the live
 * project and the Player. Doing it here means an edit reaches the picture with no main
 * process round trip at all, which is the whole point of the rewrite — the old studio had
 * to ask the engine to restage a preview before anything appeared on screen.
 *
 * It stays a mirror and not a shared module because the main-process version depends on
 * `node:path` and `node:buffer`; the encoding is the contract, and it is one line. The
 * protocol handler re-`resolve()`s whatever it decodes, so separator style is forgiving. */

/** `mestudio://` is registered privileged in electron/main.ts and serves only files
 *  inside approved engine/B-roll roots, with real Range support so `<video>` can seek. */
const PREVIEW_PROTOCOL = 'mestudio'

/** base64url of the path's UTF-8 bytes — what `Buffer.from(p,'utf8').toString('base64url')`
 *  produces in the main process. `btoa` needs latin1, hence the TextEncoder hop. */
function base64UrlPath(absolutePath: string): string {
  const bytes = new TextEncoder().encode(absolutePath)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function previewUrlForPath(absolutePath: string): string {
  return `${PREVIEW_PROTOCOL}://asset/${base64UrlPath(absolutePath)}`
}

/** `file:///C:/a/b.mp3` → `C:\a\b.mp3`; `file:///home/a/b.mp3` → `/home/a/b.mp3`. */
function pathFromFileUri(uri: string): string | null {
  try {
    const { pathname } = new URL(uri)
    const decoded = decodeURIComponent(pathname)
    // A Windows URI carries a leading slash before the drive letter.
    if (/^\/[a-zA-Z]:/.test(decoded)) return decoded.slice(1).replace(/\//g, '\\')
    return decoded
  } catch {
    return null
  }
}

/** Rewrites every `file:` asset URI to `mestudio://` so the Player can load it under the
 *  renderer CSP, where `img-src` does not include `file:` at all. Assets already on
 *  another scheme (`mestudio:`, `http:`, `data:`) pass through untouched.
 *
 *  Returns the SAME object when nothing needed rewriting, so this can sit inside a memo
 *  without manufacturing a new project identity on every render. */
export function projectForPlayer(project: VideoProject): VideoProject {
  let changed = false
  const assets = project.assets.map((asset) => {
    if (!asset.uri.startsWith('file:')) return asset
    const absolute = pathFromFileUri(asset.uri)
    if (!absolute) return asset
    changed = true
    return { ...asset, uri: previewUrlForPath(absolute) }
  })
  return changed ? { ...project, assets } : project
}
