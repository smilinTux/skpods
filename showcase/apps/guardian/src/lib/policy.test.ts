import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DURATIONS, DEFAULT_MATRIX, buildPolicy, deriveMatrix, evaluate, generateRules, parseDuration, plainWords, trace } from './policy.ts'
import type { Policy } from './types.ts'

const base: Policy = { version: 1, owner: 'https://x/alice#me', agent: 'https://x/agent#me', managedContainers: ['skpods/v1/health/'], catalog: {}, rules: [] }
const policy = () => buildPolicy(base, DEFAULT_MATRIX, DEFAULT_DURATIONS)
const booked = { requesterInProviders: true, hasBooking: true }

test('durations', () => {
  assert.equal(parseDuration('72h'), 72 * 3600)
  assert.equal(parseDuration('PT2H'), 7200)
  assert.equal(parseDuration('30d'), 30 * 86400)
  assert.equal(parseDuration('nonsense'), undefined)
})

test('default toggles reproduce the clinic story', () => {
  const p = policy()
  for (const c of ['dob', 'allergies', 'medications']) {
    const d = evaluate(p, c, 'clinic', booked)
    assert.equal(d.action, 'approve', c)
    assert.equal(d.durationS, 72 * 3600)
  }
  assert.equal(evaluate(p, 'insurance_member_id', 'clinic', booked).action, 'ask_owner')
  assert.equal(evaluate(p, 'ssn', 'clinic', booked).action, 'deny')
  assert.equal(evaluate(p, 'ssn', 'agent', booked).action, 'deny')
})

test('auto needs a booking and a known provider, otherwise the owner is asked', () => {
  const p = policy()
  assert.equal(evaluate(p, 'dob', 'clinic', { requesterInProviders: true, hasBooking: false }).action, 'ask_owner')
  assert.equal(evaluate(p, 'dob', 'clinic', { requesterInProviders: false, hasBooking: false }).action, 'ask_owner')
  assert.equal(evaluate(p, 'dob', 'business', booked).action, 'ask_owner')
})

test('toggles round trip through rules', () => {
  const m = structuredClone(DEFAULT_MATRIX)
  m.dob.business = 'auto'
  m.allergies.clinic = 'never'
  m.insurance_member_id.clinic = 'auto'
  const d = { ...DEFAULT_DURATIONS, insurance_member_id: '1h' }
  const back = deriveMatrix(buildPolicy(base, m, d))
  assert.deepEqual(back.matrix.dob, m.dob)
  assert.deepEqual(back.matrix.allergies, m.allergies)
  assert.equal(back.durations.insurance_member_id, '1h')
  assert.equal(evaluate(buildPolicy(base, m, d), 'insurance_member_id', 'clinic', booked).durationS, 3600)
})

test('default durations survive a round trip as the editor options', () => {
  const back = deriveMatrix(policy())
  assert.equal(back.durations.dob, '72h')
  assert.equal(back.durations.allergies, '72h')
  assert.deepEqual(back.matrix, DEFAULT_MATRIX)
})

test('ssn keeps its counter offer and later rules are marked unreached', () => {
  const t = trace(policy(), 'ssn', 'clinic', booked)
  assert.equal(t.matched?.id, 'never-share-ssn')
  assert.equal(t.matched?.counterOffer?.dataClass, 'insurance_member_id')
  assert.equal(t.steps[0].state, 'matched')
  assert.ok(t.steps.slice(1).every((s) => s.state === 'unreached'))
})

test('trace explains skipped rules', () => {
  const t = trace(policy(), 'dob', 'clinic', { requesterInProviders: true, hasBooking: false })
  assert.equal(t.matched?.id, 'ask-dob-conditions')
  const skipped = t.steps.find((s) => s.rule.id === 'auto-dob-booked-provider')!
  assert.equal(skipped.state, 'skipped')
  assert.ok(skipped.checks.some((c) => !c.ok && /booking/.test(c.label)))
})

test('plain words mention every class', () => {
  const w = plainWords(DEFAULT_MATRIX, DEFAULT_DURATIONS)
  assert.equal(w.length, 5)
  assert.match(w[0].text, /Clinics get it automatically for up to 3 days/)
  assert.match(w[4].text, /nobody gets it/i)
  assert.ok(generateRules(DEFAULT_MATRIX, DEFAULT_DURATIONS).length >= 6)
})
