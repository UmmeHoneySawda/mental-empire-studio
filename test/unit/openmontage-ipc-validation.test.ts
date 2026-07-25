import { describe, expect, it } from 'vitest'
import { requiredOpenMontageId } from '../../electron/ipc/openmontage'

describe('OpenMontage IPC validation', () => {
  it('accepts bounded project and job identifiers', () => {
    expect(requiredOpenMontageId(' project-1 ', 'projectId')).toBe('project-1')
  })

  it('rejects empty, control-character, or oversized identifiers', () => {
    expect(() => requiredOpenMontageId('', 'jobId')).toThrow()
    expect(() => requiredOpenMontageId('job\u0000id', 'jobId')).toThrow()
    expect(() => requiredOpenMontageId('x'.repeat(201), 'jobId')).toThrow()
  })
})
