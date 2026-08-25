/* Moved to shared/video-engine/new-templates-draft.ts.
 *
 * The Electron main process builds the same single-beat Cinematic plan for an unattended
 * automation batch (shared/automationRemotion.ts), and main cannot import from src/. This file
 * stays as the editor's import path so NewTemplatesAccordion.tsx and the unit suite that pins
 * these builders are untouched by the move. Add nothing here — extend the shared module. */
export type { NewCaptionDraft, NewHookDraft } from '@shared/video-engine'
export {
  newCaptionDraft,
  newCaptionDraftFromProps,
  newCaptionProps,
  newHookDraft,
  newHookDraftFromProps,
  newHookPlan
} from '@shared/video-engine'
