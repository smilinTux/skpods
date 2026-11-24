export type Action = 'approve' | 'ask_owner' | 'deny'
export type ItemStatus = 'awaiting_owner' | 'granted' | 'denied' | 'revoked' | 'expired' | 'error'

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
  requester: { webid: string; name: string; kind: string }
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
  status: 'active' | 'revoked' | 'expired' | 'failed'
  approved_by: string
  revoked_at?: string
  revoke_reason?: string
}
export interface AuditEntry {
  seq: number
  ts: string
  event: string
  subject: string
  actor?: string
  request?: string
  item?: string
  grant?: string
  grantee?: string
  resource?: string
  data_class?: string
  detail?: Record<string, unknown> | string | null
  prev: string
  hash: string
  [k: string]: unknown
}
export interface ChainReport {
  subject: string
  entries: number
  ok: boolean
  head?: string
  first_bad_index?: number
  reason?: string
}
export interface VerifyResult {
  ok: boolean
  first_bad_index?: number
  first_bad_subject?: string
  chains: ChainReport[]
}
export interface Health {
  ok: boolean
  version: string
  agent?: string
  pods: string
  llm_explanations: boolean
  demo_insecure_owner: boolean
}

// ---- policy (the JSON-LD document in the pod) ----
export interface PolicyRule {
  id: string
  dataClasses: string[]
  requesterKinds?: string[]
  when?: { requesterInProviders?: boolean; hasBooking?: boolean }
  action: Action
  maxDuration?: string
  reason: string
  counterOffer?: { dataClass: string; message: string }
  recommend?: { action: Action; duration?: string; reason: string }
}
export interface Policy {
  '@context'?: unknown
  '@type'?: string
  version: number
  owner: string
  agent: string
  approvers?: string[]
  managedContainers: string[]
  catalog: Record<string, { path: string; label: string }>
  ceiling?: string
  rules: PolicyRule[]
}
