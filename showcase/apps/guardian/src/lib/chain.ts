// Independent verification of the audit chain, in the browser, with the same rule the service uses:
// hash = sha256(canonical JSON of the entry without `hash`), keys sorted, compact. Genesis is derived from the subject.
import type { AuditEntry } from './types'

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return 'sha256:' + Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

export const genesis = (subject: string) => sha256hex(`sk-consent audit genesis v1:${subject}`)

export async function entryHash(e: AuditEntry): Promise<string> {
  const { hash: _h, ...rest } = e
  void _h
  return sha256hex(canonical(rest))
}

export type LinkState = { ok: boolean; reason?: string }

/** Verify one entry given the hash of the previous one. */
export async function checkEntry(e: AuditEntry, index: number, subject: string, prev: string): Promise<LinkState> {
  if (e.seq !== index) return { ok: false, reason: 'sequence gap or reorder' }
  if (e.subject !== subject) return { ok: false, reason: 'entry belongs to another subject' }
  if (e.prev !== prev) return { ok: false, reason: 'prev hash does not match the previous entry' }
  if (e.hash !== (await entryHash(e))) return { ok: false, reason: 'entry content does not match its hash' }
  return { ok: true }
}

export async function verifyAll(entries: AuditEntry[], subject: string): Promise<{ ok: boolean; firstBad?: number; reason?: string; head?: string }> {
  let prev = await genesis(subject)
  for (let i = 0; i < entries.length; i++) {
    const r = await checkEntry(entries[i], i, subject, prev)
    if (!r.ok) return { ok: false, firstBad: i, reason: r.reason }
    prev = entries[i].hash
  }
  return { ok: true, head: entries.length ? prev : undefined }
}
