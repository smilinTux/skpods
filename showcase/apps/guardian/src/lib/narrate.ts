import { CLASS_LABEL } from '../config'
import { clock, humanSeconds } from './format'
import type { AuditEntry, ConsentRequest, Item } from './types'

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'brand'
export interface Line {
  id: string
  at: string
  tone: Tone
  icon: 'in' | 'check' | 'ask' | 'deny' | 'open' | 'read' | 'refused' | 'revoke' | 'expiry' | 'verify' | 'alert'
  text: string
  hash?: string
}

const lab = (dc?: string) => (dc ? (CLASS_LABEL[dc] ?? dc) : 'an item')
const detail = (e: AuditEntry) => (typeof e.detail === 'object' && e.detail ? (e.detail as Record<string, unknown>) : {})

/** Plain-language line for an audit entry, from Alice's point of view. */
export function narrate(e: AuditEntry, who: { clinic: string; owner: string }): Line {
  const d = detail(e)
  const base = { id: `${e.seq}`, at: e.ts, hash: e.hash }
  switch (e.event) {
    case 'request_received': {
      const n = Array.isArray(d.items) ? d.items.length : undefined
      return { ...base, tone: 'brand', icon: 'in', text: `${who.clinic} asked for ${n ?? 'some'} item${n === 1 ? '' : 's'}` }
    }
    case 'decision': {
      const byOwner = d.decided_by === 'owner'
      if (d.action === 'approve') return { ...base, tone: 'good', icon: 'check', text: byOwner ? `You approved ${lab(e.data_class)} for ${humanSeconds(Number(d.duration_s))}` : `Guardian approved ${lab(e.data_class)} for ${humanSeconds(Number(d.duration_s))}` }
      if (d.action === 'ask_owner') return { ...base, tone: 'warn', icon: 'ask', text: `Guardian asked you about ${lab(e.data_class)}` }
      return { ...base, tone: 'bad', icon: 'deny', text: byOwner ? `You declined ${lab(e.data_class)}` : `Guardian denied ${lab(e.data_class)}` }
    }
    case 'grant_written':
      return { ...base, tone: 'good', icon: 'open', text: `Access opened for ${lab(e.data_class)}${typeof d.ends === 'string' ? `, ends ${clock(d.ends)}` : ''}` }
    case 'grant_failed':
      return { ...base, tone: 'bad', icon: 'alert', text: `Could not open access to ${lab(e.data_class)}` }
    case 'data_read': {
      const ok = Number(d.http_status) === 200
      return { ...base, tone: ok ? 'good' : 'bad', icon: ok ? 'read' : 'refused', text: ok ? `${who.clinic} read ${lab(e.data_class)} (HTTP 200)` : `${who.clinic} was refused ${lab(e.data_class)} (HTTP ${d.http_status})` }
    }
    case 'revoke':
      return { ...base, tone: 'warn', icon: 'revoke', text: e.actor === who.owner ? `You revoked access to ${lab(e.data_class)}` : `${lab(e.data_class)} released by the clinic` }
    case 'expiry':
      return { ...base, tone: 'neutral', icon: 'expiry', text: `Access to ${lab(e.data_class)} expired on its own` }
    case 'revoke_verified':
      return { ...base, tone: 'good', icon: 'verify', text: d.acl_clean === false ? 'Revocation could not be confirmed' : 'Checked: the pod rule for this grant is gone' }
    default:
      return { ...base, tone: 'neutral', icon: 'in', text: e.event }
  }
}

/** Audit entries that belong to a request, in order. */
export const entriesFor = (audit: AuditEntry[], requestId?: string) => (requestId ? audit.filter((e) => e.request === requestId) : [])

export function outcomeOf(it: Item): { label: string; tone: Tone } {
  const d = it.decision
  switch (it.status) {
    case 'granted':
      return d.decided_by === 'owner' ? { label: `Alice approved${d.duration_s ? ` ${humanSeconds(d.duration_s)}` : ''}`, tone: 'good' } : { label: `Auto-approved${d.duration_s ? ` ${humanSeconds(d.duration_s)}` : ''}`, tone: 'brand' }
    case 'awaiting_owner':
      return { label: 'Asking Alice', tone: 'warn' }
    case 'denied':
      return d.decided_by === 'owner' ? { label: 'Alice declined', tone: 'bad' } : { label: 'Denied', tone: 'bad' }
    case 'revoked':
      return { label: 'Revoked', tone: 'neutral' }
    case 'expired':
      return { label: 'Expired', tone: 'neutral' }
    default:
      return { label: 'Error', tone: 'bad' }
  }
}

export const activeItems = (r?: ConsentRequest) => r?.items.filter((i) => i.status === 'granted') ?? []
