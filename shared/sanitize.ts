// Single source of truth for turning an arbitrary title/name into a safe file name.
// Shared by the render output (.mp4/.ass/.log), the thumbnail PNG writer, and the
// folder picker so the rules can't drift apart (which underpinned output collisions).

/** Sanitize a string into a safe file-name stem (no extension). */
export function safeName(name: string, fallback = 'thumbnail'): string {
  return (name.replace(/[^a-z0-9\-_. ]/gi, '_').trim() || fallback).slice(0, 120)
}
