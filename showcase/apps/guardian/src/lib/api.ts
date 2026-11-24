import { createDpopFetch, type SolidSession } from '@skpods/solid-web'
import { BRIDGE_URL, CONSENT_URL } from '../config'
import type { AuditEntry, ConsentRequest, Grant, Health, Policy, VerifyResult } from './types'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * fetch that sends the logged-in user's DPoP-bound token to sk-consent.
 *
 * SolidSession.fetch only attaches the token to the identity provider's origin (a sensible default),
 * and its key is private. This app has to call a second origin (the guardian service), so it reaches the
 * session's key and token provider at runtime. Proposed library change: `SolidSession.fetchFor(origins)`.
 */
export function brokerFetchFor(session: SolidSession): typeof fetch {
  const internals = session as unknown as { p?: { key: Parameters<typeof createDpopFetch>[0]['key'] }; accessToken(): Promise<string> }
  if (!internals.p) throw new Error('Not logged in')
  return createDpopFetch({
    key: internals.p.key,
    allowedOrigins: [new URL(CONSENT_URL).origin],
    getAccessToken: () => internals.accessToken(),
    onUnauthorized: () => session.refresh().catch(() => undefined),
  })
}

async function parse<T>(r: Response): Promise<T> {
  const text = await r.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }
  if (!r.ok) throw new ApiError((body as { error?: string } | undefined)?.error ?? `HTTP ${r.status}`, r.status)
  return body as T
}

export class Broker {
  constructor(private f: typeof fetch, readonly subject: string) {}
  private q = () => `subject=${encodeURIComponent(this.subject)}`
  private async get<T>(path: string): Promise<T> {
    return parse<T>(await this.f(`${CONSENT_URL}${path}`))
  }
  health = () => this.get<Health>('/healthz')
  requests = () => this.get<ConsentRequest[]>(`/requests?${this.q()}`)
  grants = () => this.get<Grant[]>(`/grants?${this.q()}`)
  audit = () => this.get<AuditEntry[]>(`/audit?${this.q()}`)
  verify = () => this.get<VerifyResult>(`/audit/verify?${this.q()}`)
  policy = () => this.get<Policy>(`/policy?${this.q()}`)
  async decide(requestId: string, decisions: { item_id: string; action: 'approve' | 'deny'; duration?: string; reason?: string }[]): Promise<ConsentRequest> {
    return parse(await this.f(`${CONSENT_URL}/requests/${requestId}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisions }) }))
  }
  async revoke(grantId: string, reason?: string): Promise<Grant> {
    return parse(await this.f(`${CONSENT_URL}/grants/${grantId}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }))
  }
  /** Server-sent events: audit, request and grant, each carrying the full object. */
  events(on: { audit: (e: AuditEntry) => void; request: (r: ConsentRequest) => void; grant: (g: Grant) => void; state: (live: boolean) => void }): () => void {
    const es = new EventSource(`${CONSENT_URL}/events?${this.q()}`)
    const wrap = (name: string, cb: (v: any) => void) => es.addEventListener(name, (ev) => {
      try {
        cb(JSON.parse((ev as MessageEvent).data))
      } catch {
        /* ignore a malformed frame */
      }
    })
    wrap('audit', (v) => on.audit(v.entry))
    wrap('request', (v) => on.request(v.request))
    wrap('grant', (v) => on.grant(v.grant))
    es.onopen = () => on.state(true)
    es.onerror = () => on.state(false)
    return () => es.close()
  }
}

// ---------- the clinic bridge ----------
export interface BridgeHealth {
  ok: boolean
  webid: string
  name: string
}
export interface ReadResult {
  status: number
  text?: string
  at: string
}

async function bridge<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BRIDGE_URL}${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return parse<T>(r)
}
export const Bridge = {
  health: () => bridge<BridgeHealth>('/health'),
  request: (subject: string, extra: Record<string, unknown> = {}) => bridge<{ status: number; ms: number; request: ConsentRequest }>('/request', { subject, ...extra }),
  read: (resource: string, grantId?: string) => bridge<ReadResult>('/read', { resource, grant_id: grantId }),
  release: (grantId: string) => bridge<Grant>('/release', { grant_id: grantId }),
}
