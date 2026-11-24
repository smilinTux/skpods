import type { Grant, Item, RequesterKind } from './types'
import type { ConsentState } from '@skpods/ui'

export const KIND_LABEL: Record<RequesterKind, string> = {
  clinic: 'Clinic',
  care_facility: 'Care facility',
  business: 'Business',
  person: 'Person',
  agent: 'Agent',
}

export function time(t: string | number | Date, withDay = true): string {
  const d = new Date(t)
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (!withDay || sameDay) return hm
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${hm}`
}

export function clock(t: string | number | Date): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ago(t: string | number | Date, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(t).getTime()) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export function span(secs: number): string {
  if (secs % 86400 === 0 && secs >= 86400 && secs > 72 * 3600) return `${secs / 86400} day${secs === 86400 ? '' : 's'}`
  if (secs % 3600 === 0 && secs >= 3600) return `${secs / 3600} hour${secs === 3600 ? '' : 's'}`
  if (secs % 60 === 0 && secs >= 60) return `${secs / 60} minute${secs === 60 ? '' : 's'}`
  if (secs >= 3600) return `${Math.round(secs / 360) / 10} hours`
  return `${secs} second${secs === 1 ? '' : 's'}`
}

export const shortHash = (h: string, n = 8) => h.replace(/^sha256:/, '').slice(0, n)
export const lastSegment = (u: string) => decodeURIComponent(u.replace(/[#?].*$/, '').replace(/\/$/, '').split('/').pop() ?? u)

export function itemState(i: Item): ConsentState {
  const byGuardian = i.decision.decided_by === 'guardian'
  switch (i.status) {
    case 'awaiting_owner': return 'pending'
    case 'granted': return byGuardian ? 'auto-approved' : 'granted'
    case 'denied': return byGuardian ? 'auto-denied' : 'denied'
    case 'revoked': return 'revoked'
    case 'expired': return 'expired'
    default: return 'denied'
  }
}

export const isLive = (g: Grant) => g.status === 'active'
export const endedAt = (g: Grant) => g.revoked_at ?? g.ends

export const reasonText = (r?: string) =>
  r === 'expired' ? 'Expired on schedule' : r === 'revoked-by-owner' ? 'Revoked by you' : r === 'released-by-grantee' ? 'Released by the requester' : r ?? 'Ended'
