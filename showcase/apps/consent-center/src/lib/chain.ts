// Tamper-evident audit chain, recomputed in the browser. The same rules sk-consent uses
// (services/sk-consent/src/audit.rs): hash = sha256(canonical JSON of the entry without `hash`), keys sorted, compact;
// entry 0 links to sha256("sk-consent audit genesis v1:" + subject).
import type { AuditEntry } from './types'

/** Canonical JSON identical to serde_json's compact output over sorted maps. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return 'sha256:' + Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const genesis = (subject: string) => sha256Hex('sk-consent audit genesis v1:' + subject)

export async function entryHash(e: AuditEntry): Promise<string> {
  const { hash: _hash, ...rest } = e
  return sha256Hex(canonical(rest))
}

export interface LinkCheck {
  index: number
  seq: number
  /** seq equals the position in the chain. */
  seqOk: boolean
  /** prev equals the stored hash of the entry before (or the genesis hash). */
  linkOk: boolean
  /** The stored hash equals the hash recomputed from the entry's own content. */
  contentOk: boolean
  expectedPrev: string
  recomputed: string
  ok: boolean
  reason?: string
}

export interface ChainResult {
  ok: boolean
  checks: LinkCheck[]
  firstBad?: number
  head?: string
  genesis: string
}

/** Checks every entry on its own (does not stop at the first failure) so the UI can show exactly which links break. */
export async function verifyChain(subject: string, entries: AuditEntry[]): Promise<ChainResult> {
  const g = await genesis(subject)
  const checks: LinkCheck[] = []
  let prev = g
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const recomputed = await entryHash(e)
    const seqOk = e.seq === i
    const subjectOk = e.subject === subject
    const linkOk = e.prev === prev
    const contentOk = e.hash === recomputed
    const reason = !seqOk
      ? 'Sequence gap or reorder: an entry is missing or moved'
      : !subjectOk
        ? 'Entry belongs to another person'
        : !linkOk
          ? 'prev does not match the hash of the entry before it'
          : !contentOk
            ? 'The content does not match the stored hash: the entry was edited'
            : undefined
    checks.push({ index: i, seq: e.seq, seqOk, linkOk, contentOk, expectedPrev: prev, recomputed, ok: !reason, reason })
    prev = e.hash
  }
  const bad = checks.find((c) => !c.ok)
  return { ok: !bad, checks, firstBad: bad?.index, head: bad ? undefined : entries.at(-1)?.hash, genesis: g }
}

export type TamperMode = 'edit' | 'rehash' | 'delete'

/** What an attacker with write access to a copy of the log could do. Applied to a copy only, never to the stored chain. */
export async function tamper(entries: AuditEntry[], index: number, mode: TamperMode): Promise<AuditEntry[]> {
  const out = entries.map((e) => structuredClone(e))
  if (mode === 'delete') {
    out.splice(index, 1)
    return out
  }
  const e = out[index]
  if (e.grantee) e.grantee = 'https://attacker.example/profile#me'
  else e.actor = 'https://attacker.example/profile#me'
  if (mode === 'rehash') e.hash = await entryHash(e)
  return out
}
