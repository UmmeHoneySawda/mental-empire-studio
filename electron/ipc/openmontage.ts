import { ipcMain } from 'electron'
import { openMontageService } from '../services/openmontage'
import type { OpenMontageJobPackage } from '../../shared/openmontage'

export function requiredOpenMontageId(value: string, field: string): string {
  const id = String(value ?? '').trim()
  if (!id || id.length > 200 || /[\u0000-\u001f]/.test(id)) throw new Error(`${field} is invalid.`)
  return id
}

export function registerOpenMontageIpc(): void {
  ipcMain.handle('openmontage:health', (_event, force?: boolean) =>
    openMontageService.health(Boolean(force)))
  ipcMain.handle('openmontage:prepareAssisted', (_event, jobPackage: OpenMontageJobPackage) =>
    openMontageService.prepareAssisted(jobPackage))
  ipcMain.handle('openmontage:assistedHandoff', (_event, jobId: string) =>
    openMontageService.assistedHandoff(requiredOpenMontageId(jobId, 'jobId')))
  ipcMain.handle('openmontage:recoverAssisted', () => openMontageService.recoverAssisted())
  ipcMain.handle('openmontage:copyPrompt', (_event, jobId: string, kind?: string) =>
    openMontageService.copyAssistedPrompt(
      requiredOpenMontageId(jobId, 'jobId'),
      kind === 'recovery' ? 'recovery' : 'handoff'
    ))
  ipcMain.handle('openmontage:openProjectFolder', (_event, jobId: string) =>
    openMontageService.openProjectFolder(requiredOpenMontageId(jobId, 'jobId')))
  ipcMain.handle('openmontage:openBacklot', (_event, jobId: string) =>
    openMontageService.openBacklot(requiredOpenMontageId(jobId, 'jobId')))
  ipcMain.handle('openmontage:jobs', () => openMontageService.jobs())
  ipcMain.handle('openmontage:job', (_event, id: string) =>
    openMontageService.job(requiredOpenMontageId(id, 'id')) ?? null)
  ipcMain.handle('openmontage:events', (_event, jobId: string, limit?: number) =>
    openMontageService.events(
      requiredOpenMontageId(jobId, 'jobId'),
      Math.max(1, Math.min(1_000, Number.isFinite(limit) ? Math.round(Number(limit)) : 250))
    ))
  ipcMain.handle('openmontage:outputs', (_event, jobId: string) =>
    openMontageService.outputs(requiredOpenMontageId(jobId, 'jobId')))
  ipcMain.handle('openmontage:backlotProject', (_event, projectId: string) =>
    openMontageService.backlotProject(requiredOpenMontageId(projectId, 'projectId')))
}
