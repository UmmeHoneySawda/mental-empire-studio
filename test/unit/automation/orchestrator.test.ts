import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
describe('Profiles orchestrator size', () => {
  it('is under 400 lines after split', () => {
    const lines = fs.readFileSync('src/screens/Profiles.tsx', 'utf8').split('\n').length
    expect(lines).toBeLessThan(400)
  })
})
