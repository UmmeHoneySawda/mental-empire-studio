import { BrowserWindow } from 'electron'
import { getRepos } from '../db'
import type { ActivityRow } from '../../shared/types'

// Main → renderer event helpers, shared by the scrape / download / transcribe
// orchestrators so progress + activity stream to every open window.

export function emit(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

export function hhmm(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Persist an activity-log row and broadcast it to the live feed. */
export function pushActivity(row: ActivityRow): void {
  getRepos().addActivity(row)
  emit('activity:new', row)
}
