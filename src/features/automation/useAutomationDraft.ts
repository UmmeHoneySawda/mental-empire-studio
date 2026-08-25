import { useMemo, useState } from 'react'
import type { VisualTemplate } from '@shared/types'

/**
 * Pure validation — mirrors the save guards in Profiles.tsx:522-533.
 * Keeping it pure lets the sheet and the orchestrator share one error string
 * and lets unit tests cover the contract without mounting React.
 */
export function validateVisualTemplate(t: VisualTemplate): string {
  if (!t.name || !t.name.trim()) return 'Enter a template name before saving.'
  if (t.mode === 'Image slideshow' && (!t.imagePaths || t.imagePaths.length === 0)) {
    return 'Add at least 1 image for Image Slideshow mode, or select Auto B-roll.'
  }
  return ''
}

/**
 * Extracted draft state for the automation template builder.
 * The 1809-line Profiles.tsx owned 20+ useState/useMemo for the draft —
 * this hook owns the 4 that actually shape the draft lifecycle.
 */
export function useAutomationDraft(initial: VisualTemplate | null) {
  const [draft, setDraft] = useState<VisualTemplate | null>(initial)
  const validation = useMemo(() => (draft ? validateVisualTemplate(draft) : ''), [draft])
  const canSave = !validation
  return { draft, setDraft, validation, canSave }
}

export function mergeImagePaths(existing: string[], canonicals: string[]): string[] {
  return Array.from(new Set([...(existing || []), ...(canonicals || [])]))
}
