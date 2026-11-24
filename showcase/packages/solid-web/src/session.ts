// Browser Solid-OIDC login: discovery, dynamic client registration (cached), authorization code + PKCE (S256),
// DPoP-bound tokens, restore after reload, refresh, logout.
import { createDpopFetch } from './dpop-fetch'
import { decodeJwt, generateDpopKey, pickDpopAlg, randomString, sha256b64url, type DpopAlg, type DpopKey } from './crypto'
import { discover, OidcError, registerClient, tokenRequest, type OidcConfig, type RegisteredClient, type TokenResponse } from './oidc'
import { defaultKV, safeLocal, safeSession, type KV } from './storage'
import { fetchProfileIssuer } from './profile'

export type SessionState = 'anonymous' | 'active' | 'expired'

export interface SolidSessionOptions {
  /** Used when `login()` is called without an argument. */
  defaultIssuer?: string
  clientName?: string
  /** Defaults to the current page without query or hash. Must be stable: it is registered exactly. */
  redirectUri?: string
  scope?: string
  dpopAlg?: DpopAlg
  kv?: KV
}

interface Persisted {
  issuer: string
  clientId: string
  clientSecret?: string
  key: DpopKey
  accessToken: string
  refreshToken?: string
  expiresAt: number
  webId: string
}

interface Pending {
  issuer: string
  clientId: string
  redirectUri: string
  verifier: string
}

const REFRESH_MARGIN_MS = 60_000

export class SolidSession {
  state: SessionState = 'anonymous'
  webId?: string
  issuer?: string
  error?: string
  private p?: Persisted
  private conf?: OidcConfig
  private listeners = new Set<() => void>()
  private refreshing?: Promise<string>
  private readonly kv: KV
  private readonly opts: Required<Pick<SolidSessionOptions, 'clientName' | 'scope'>> & SolidSessionOptions

  private constructor(opts: SolidSessionOptions) {
    this.kv = opts.kv ?? defaultKV()
    this.opts = { clientName: 'SKPods showcase', scope: 'openid webid offline_access', ...opts }
  }

  /** Create a session, finish a redirect if the URL carries one, otherwise restore a stored session. */
  static async init(opts: SolidSessionOptions = {}): Promise<SolidSession> {
    const s = new SolidSession(opts)
    try {
      if (!(await s.handleRedirect())) await s.restore()
    } catch (e) {
      s.error = (e as Error).message
    }
    return s
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  get redirectUri(): string {
    if (this.opts.redirectUri) return this.opts.redirectUri
    const u = new URL(location.href)
    return u.origin + u.pathname
  }

  /** The authenticated fetch. Safe to hand to PodStore even before login: then it is a plain fetch. */
  fetch: typeof fetch = async (input, init) => {
    if (!this.p) return globalThis.fetch(input, init)
    return this.dpopFetch()(input, init)
  }
  private dpopFetchCache?: { p: Persisted; f: typeof fetch }
  private dpopFetch(): typeof fetch {
    const p = this.p!
    if (this.dpopFetchCache?.p === p) return this.dpopFetchCache.f
    const f = createDpopFetch({
      key: p.key,
      allowedOrigins: [new URL(p.issuer).origin],
      getAccessToken: () => this.accessToken(),
      onUnauthorized: () => this.refresh().catch(() => undefined),
    })
    this.dpopFetchCache = { p, f }
    return f
  }

  private async accessToken(): Promise<string> {
    if (!this.p) throw new Error('Not logged in')
    if (Date.now() < this.p.expiresAt - REFRESH_MARGIN_MS) return this.p.accessToken
    try {
      return await this.refresh()
    } catch (e) {
      if (Date.now() < this.p.expiresAt) return this.p.accessToken
      throw e
    }
  }

  /** Refresh with the refresh token. If that is impossible the session becomes 'expired' (call login() again). */
  refresh(): Promise<string> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = undefined))
    return this.refreshing
  }
  private async doRefresh(): Promise<string> {
    const p = this.p
    if (!p) throw new Error('Not logged in')
    if (!p.refreshToken) return this.expire('No refresh token')
    try {
      const conf = this.conf ?? (this.conf = await discover(p.issuer))
      // pods-dev only accepts the refresh grant with client authentication (see ENGINE-NOTES.md).
      const t = await tokenRequest({
        conf,
        key: p.key,
        params: { grant_type: 'refresh_token', refresh_token: p.refreshToken, client_id: p.clientId },
        basicAuth: p.clientSecret ? { id: p.clientId, secret: p.clientSecret } : undefined,
      })
      this.apply(p, t)
      await this.persist()
      this.emit()
      return p.accessToken
    } catch (e) {
      if (e instanceof OidcError && (e.status === 400 || e.status === 401)) return this.expire(e.message)
      throw e
    }
  }
  private expire(reason: string): never {
    this.state = 'expired'
    this.error = reason
    this.emit()
    throw new Error(`Session expired: ${reason}`)
  }

  private apply(p: Persisted, t: TokenResponse) {
    p.accessToken = t.access_token
    p.refreshToken = t.refresh_token ?? p.refreshToken
    p.expiresAt = Date.now() + (t.expires_in ?? 3600) * 1000
    p.webId = decodeJwt(t.access_token).payload.webid ?? p.webId
  }

  private persistKey() {
    return 'session'
  }
  private async persist() {
    if (this.p) await this.kv.set(this.persistKey(), this.p)
  }

  private async restore() {
    const p = await this.kv.get<Persisted>(this.persistKey())
    if (!p) return
    this.p = p
    this.issuer = p.issuer
    this.webId = p.webId
    if (Date.now() < p.expiresAt - REFRESH_MARGIN_MS) {
      this.state = 'active'
    } else {
      try {
        await this.refresh()
        this.state = 'active'
      } catch {
        this.state = 'expired'
      }
    }
    this.emit()
  }

  /** Where to send the browser: an issuer origin or a WebID (then its solid:oidcIssuer is looked up). */
  async resolveIssuer(issuerOrWebId?: string): Promise<string> {
    const input = (issuerOrWebId ?? this.opts.defaultIssuer ?? '').trim()
    if (!input) throw new Error('No identity provider given')
    const url = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`)
    if (url.pathname.length > 1 || url.hash) {
      const found = await fetchProfileIssuer(url.toString())
      if (found) return found
      return url.origin
    }
    return url.origin
  }

  private async clientFor(conf: OidcConfig, redirectUri: string): Promise<RegisteredClient> {
    const ls = safeLocal()
    const cacheKey = `skpods:client:${conf.issuer}:${redirectUri}`
    try {
      const cached = ls?.getItem(cacheKey)
      if (cached) return JSON.parse(cached)
    } catch {
      /* ignore */
    }
    const c = await registerClient(conf, { redirectUris: [redirectUri], clientName: this.opts.clientName })
    try {
      ls?.setItem(cacheKey, JSON.stringify(c))
    } catch {
      /* ignore */
    }
    return c
  }
  private forgetClient(issuer: string, redirectUri: string) {
    try {
      safeLocal()?.removeItem(`skpods:client:${issuer}:${redirectUri}`)
    } catch {
      /* ignore */
    }
  }

  /** Redirects the browser to the provider. Resolves only if something fails before the redirect. */
  async login(issuerOrWebId?: string): Promise<void> {
    const issuer = await this.resolveIssuer(issuerOrWebId)
    const conf = await discover(issuer)
    const redirectUri = this.redirectUri
    const client = await this.clientFor(conf, redirectUri)
    const verifier = randomString(48)
    const state = randomString(16)
    const pending: Pending = { issuer: conf.issuer, clientId: client.client_id, redirectUri, verifier }
    const ss = safeSession()
    if (!ss) throw new Error('sessionStorage is unavailable, cannot start login')
    ss.setItem(`skpods:pending:${state}`, JSON.stringify(pending))
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: this.opts.scope,
      state,
      code_challenge: await sha256b64url(verifier),
      code_challenge_method: 'S256',
      prompt: 'consent',
    })
    location.assign(`${conf.authorization_endpoint}?${q}`)
  }

  /** Complete a login if the current URL is an authorization response. Returns true if it handled one. */
  async handleRedirect(): Promise<boolean> {
    const url = new URL(location.href)
    const state = url.searchParams.get('state')
    const code = url.searchParams.get('code')
    const err = url.searchParams.get('error')
    if (!state || (!code && !err)) return false
    const ss = safeSession()
    const raw = ss?.getItem(`skpods:pending:${state}`)
    if (!raw) return false // not ours (or a replay)
    ss!.removeItem(`skpods:pending:${state}`)
    const pending = JSON.parse(raw) as Pending
    // Clean the URL before anything else so a reload does not replay the code.
    history.replaceState(null, '', pending.redirectUri)
    if (err) {
      this.error = url.searchParams.get('error_description') || err
      this.emit()
      return true
    }
    const conf = await discover(pending.issuer)
    const key = await generateDpopKey(pickDpopAlg(conf.dpop_signing_alg_values_supported, this.opts.dpopAlg))
    let t: TokenResponse
    try {
      t = await tokenRequest({
        conf,
        key,
        params: { grant_type: 'authorization_code', code: code!, redirect_uri: pending.redirectUri, client_id: pending.clientId, code_verifier: pending.verifier },
      })
    } catch (e) {
      // A stale cached client (server reset) shows up here as invalid_client: forget it so the next login re-registers.
      this.forgetClient(pending.issuer, pending.redirectUri)
      throw e
    }
    const client = await this.clientFor(conf, pending.redirectUri)
    const p: Persisted = { issuer: conf.issuer, clientId: pending.clientId, clientSecret: client.client_secret, key, accessToken: '', expiresAt: 0, webId: '' }
    this.apply(p, t)
    if (!p.webId) throw new Error('Token carries no webid claim')
    this.p = p
    this.conf = conf
    this.issuer = p.issuer
    this.webId = p.webId
    this.state = 'active'
    this.error = undefined
    await this.persist()
    this.emit()
    return true
  }

  /** Forget the session locally. Pass `endProvider: true` to also end the provider session (redirects). */
  async logout(opts: { endProvider?: boolean } = {}): Promise<void> {
    const issuer = this.p?.issuer
    this.p = undefined
    this.dpopFetchCache = undefined
    this.webId = undefined
    this.state = 'anonymous'
    await this.kv.del(this.persistKey())
    this.emit()
    if (opts.endProvider && issuer) {
      const conf = this.conf ?? (await discover(issuer))
      if (conf.end_session_endpoint) location.assign(conf.end_session_endpoint)
    }
  }
}
