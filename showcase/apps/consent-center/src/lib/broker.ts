import { CONSENT_URL } from '../config'
import type { AuditEntry, ChainReport, ConsentRequest, Grant, Policy } from './types'

export class BrokerError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'BrokerError'
  }
}

export interface OwnerDecision {
  item_id: string
  action: 'approve' | 'deny'
  /** "24h", "30s", "until_booking_end" ... */
  duration?: string
  reason?: string
}

export interface VerifyReport {
  ok: boolean
  first_bad_index?: number
  chains: ChainReport[]
}

/** Typed client for sk-consent. `authed` is a DPoP fetch (see brokerFetch); reads work with a plain fetch. */
export class Broker {
  constructor(private authed: typeof fetch, private base = CONSENT_URL) {}

  private async call<T>(path: string, init?: RequestInit, auth = false): Promise<T> {
    let res: Response
    try {
      res = await (auth ? this.authed : fetch)(this.base + path, init)
    } catch (e) {
      throw new BrokerError(`Cannot reach the consent service at ${this.base}. Is sk-consent running?`, 0)
    }
    const body = await res.text()
    let json: any
    try {
      json = body ? JSON.parse(body) : undefined
    } catch {
      json = undefined
    }
    if (!res.ok) throw new BrokerError(json?.error ?? (body.slice(0, 160) || `HTTP ${res.status}`), res.status)
    return json as T
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, true)
  }

  health = () => this.call<{ ok: boolean; agent?: string; llm_explanations: boolean }>('/healthz')
  requests = (subject: string) => this.call<ConsentRequest[]>(`/requests?subject=${encodeURIComponent(subject)}`)
  grants = (subject: string) => this.call<Grant[]>(`/grants?subject=${encodeURIComponent(subject)}`)
  audit = (subject: string) => this.call<AuditEntry[]>(`/audit?subject=${encodeURIComponent(subject)}`)
  verify = (subject: string) => this.call<VerifyReport>(`/audit/verify?subject=${encodeURIComponent(subject)}`)
  policy = (subject: string) => this.call<Policy>(`/policy?subject=${encodeURIComponent(subject)}`)

  decide = (requestId: string, decisions: OwnerDecision[]) => this.post<ConsentRequest>(`/requests/${requestId}/decide`, { decisions })
  revoke = (grantId: string, reason?: string) => this.post<Grant>(`/grants/${grantId}/revoke`, { reason })
  reportAccess = (grantId: string, httpStatus: number) => this.post<unknown>(`/grants/${grantId}/access`, { http_status: httpStatus })
  submit = (body: unknown) => this.post<ConsentRequest>('/requests', body)

  /** Server-sent events for one person: `request`, `grant` and `audit`, each with the full object. */
  events(subject: string, h: { onRequest?: (r: ConsentRequest) => void; onGrant?: (g: Grant) => void; onAudit?: (e: AuditEntry) => void; onOpen?: () => void; onDown?: () => void }): () => void {
    const es = new EventSource(`${this.base}/events?subject=${encodeURIComponent(subject)}`)
    const parse = (ev: MessageEvent) => JSON.parse(ev.data)
    es.addEventListener('request', (ev) => h.onRequest?.(parse(ev as MessageEvent).request))
    es.addEventListener('grant', (ev) => h.onGrant?.(parse(ev as MessageEvent).grant))
    es.addEventListener('audit', (ev) => h.onAudit?.(parse(ev as MessageEvent).entry))
    es.onopen = () => h.onOpen?.()
    es.onerror = () => h.onDown?.()
    return () => es.close()
  }
}
