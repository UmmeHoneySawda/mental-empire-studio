export function isCssImageValue(value?: string): boolean {
  return !!value && /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(value.trim())
}

export function mediaSrc(path?: string): string {
  if (!path || isCssImageValue(path)) return ''
  if (/^(https?:|data:|file:|blob:)/i.test(path)) return path
  return `file:///${path.replace(/\\/g, '/')}`
}

export function videoSrc(path?: string): string {
  if (!path) return ''
  if (/^(https?:|data:video|file:|blob:)/i.test(path)) return path
  // Browser mock paths are intentionally fake file-system paths. Rendering an
  // invalid file:// URL creates console noise that hides real UI errors.
  if (path.startsWith('/Browser/')) return ''
  return `file:///${path.replace(/\\/g, '/')}`
}
