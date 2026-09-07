import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const skillPath = resolve(repositoryRoot, '.agents/skills/mental-empire-daily-production/SKILL.md')
const skill = readFileSync(skillPath, 'utf8')

test('routes Video Express image-to-video work to a readable provider reference', () => {
  const match = skill.match(/\[[^\]]*VIDEOEXPRESS-INTEGRATION\.md[^\]]*\]\(([^)]+)\)/i)
  assert.ok(match, 'Mental Empire skill does not route Video Express work to its provider reference')
  assert.equal(existsSync(resolve(dirname(skillPath), match[1])), true)
})

test('preserves the verified runner command and uncertain-submission stop condition', () => {
  assert.match(skill, /run-videoexpress\.mjs/)
  assert.match(skill, /submission_uncertain/)
})
