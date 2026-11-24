import test from 'node:test'
import assert from 'node:assert/strict'
import { canonical, entryHash, genesis, verifyAll } from './chain.ts'
import type { AuditEntry } from './types.ts'

const S = 'https://example.org/alice#me'
async function make(n: number): Promise<AuditEntry[]> {
  const out: AuditEntry[] = []
  let prev = await genesis(S)
  for (let i = 0; i < n; i++) {
    const e = { subject: S, seq: i, prev, event: 'test', ts: '2026-01-01T00:00:00.000Z', detail: { z: 1, a: [2, 'x'] } } as AuditEntry
    e.hash = await entryHash(e)
    prev = e.hash
    out.push(e)
  }
  return out
}

test('canonical sorts keys and is compact', () => {
  assert.equal(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}')
})
test('good chain verifies, edit is found at the right index', async () => {
  const c = await make(6)
  assert.equal((await verifyAll(c, S)).ok, true)
  c[3] = { ...c[3], event: 'edited' }
  const r = await verifyAll(c, S)
  assert.equal(r.ok, false)
  assert.equal(r.firstBad, 3)
})
test('removing an entry breaks the sequence', async () => {
  const c = await make(5)
  c.splice(2, 1)
  assert.equal((await verifyAll(c, S)).firstBad, 2)
})
