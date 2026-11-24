// Shapes returned by sk-consent (services/sk-consent/src/model.rs).
export type Action = 'approve' | 'ask_owner' | 'deny'
export type ItemStatus = 'awaiting_owner' | 'granted' | 'denied' | 'revoked' | 'expired' | 'error'
export type GrantStatus = 'active' | 'revoked' | 'expired' | 'failed'
export type RequesterKind = 'clinic' | 'care_facility' | 'business' | 'person' | 'agent'

export interface Decision {
  action: Action
  duration_s?: number
  expires_at?: string
  reason: string
  explanation?: string
  counter_offer?: { data_class: string; message: string }
  recommendation?: { action: Action; duration_s?: number; reason: string }
  rule_id?: string
  decided_by: string
}

export interface Item {
  id: string
  data_class: string
  label: string
  resource: string
  status: ItemStatus
  decision: Decision
  grant_id?: string
}

export interface ConsentRequest {
  id: string
  requester: { webid: string; name: string; kind: RequesterKind }
  subject: string
  purpose: string
  requested_duration?: string
  context: { booking_ref?: string; note?: string }
  created: string
  status: 'awaiting_owner' | 'decided'
  items: Item[]
}

export interface Grant {
  id: string
  request_id: string
  item_id: string
  subject: string
  grantee: string
  grantee_name: string
  data_class: string
  resource: string
  modes: string[]
  starts: string
  ends: string
  status: GrantStatus
  approved_by: string
  revoked_at?: string
  revoke_reason?: string
  audit_ref?: string
}

export interface AuditEntry {
  seq: number
  ts: string
  event: string
  subject: string
  actor: string
  request?: string
  item?: string
  grant?: string
  grantee?: string
  resource?: string
  data_class?: string
  detail?: Record<string, any>
  prev: string
  hash: string
}

export interface ChainReport {
  subject: string
  entries: number
  ok: boolean
  head?: string
  first_bad_index?: number
  reason?: string
}

export interface Policy {
  owner: string
  agent: string
  approvers: string[]
  ceiling: string
  catalog: Record<string, { path: string; label: string }>
  rules: Array<{ id: string; dataClasses: string[]; action: Action; reason: string }>
}

export interface Person {
  webId: string
  name: string
  short: string
  relation: 'self' | 'attorney' | 'parent'
}
