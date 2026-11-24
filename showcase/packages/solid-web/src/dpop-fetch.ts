import { createDpopProof, type DpopKey } from './crypto'

export interface DpopFetchOptions {
  key: DpopKey
  /** Returns the current access token (refreshing it if needed). */
  getAccessToken: () => Promise<string>
  /** Called when the server answers 401 to a request that carried a token, so the caller can refresh. */
  onUnauthorized?: () => Promise<string | undefined>
  /** Only requests to these origins get the token. Everything else is sent as a plain fetch. */
  allowedOrigins: string[]
  fetchImpl?: typeof fetch
}

/**
 * fetch() replacement that sends `Authorization: DPoP <token>` and a fresh proof (with `ath`) per request.
 * Handles `DPoP-Nonce` challenges (one retry) and one token-refresh retry on 401.
 * Redirects: a followed redirect reuses the same proof (htu mismatch). Use full container URLs (trailing slash) and treat a 3xx as a caller bug.
 */
export function createDpopFetch(opts: DpopFetchOptions): typeof fetch {
  const base = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a))
  const nonces = new Map<string, string>()

  const send = async (url: string, init: RequestInit, method: string, token: string, nonce?: string) => {
    const proof = await createDpopProof(opts.key, method, url, { accessToken: token, nonce })
    const headers = new Headers(init.headers)
    headers.set('Authorization', `DPoP ${token}`)
    headers.set('DPoP', proof)
    return base(url, { ...init, headers })
  }

  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req = input instanceof Request ? input : undefined
    const url = req ? req.url : String(input)
    const origin = new URL(url).origin
    if (!opts.allowedOrigins.includes(origin)) return base(input, init)
    const method = (init.method ?? req?.method ?? 'GET').toUpperCase()
    // A Request body can only be read once, so materialize everything we may need to resend.
    let effective: RequestInit = init
    if (req) {
      const body = method === 'GET' || method === 'HEAD' ? undefined : await req.clone().arrayBuffer()
      effective = { method, headers: init.headers ?? req.headers, body: init.body ?? body, signal: init.signal ?? req.signal, ...init }
    }
    let token = await opts.getAccessToken()
    let res = await send(url, effective, method, token, nonces.get(origin))
    const nonce = res.headers.get('DPoP-Nonce')
    if (nonce) nonces.set(origin, nonce)
    if (res.status === 401 && nonce) res = await send(url, effective, method, token, nonce)
    if (res.status === 401 && opts.onUnauthorized) {
      const fresh = await opts.onUnauthorized()
      if (fresh && fresh !== token) {
        token = fresh
        res = await send(url, effective, method, token, nonces.get(origin))
        const n2 = res.headers.get('DPoP-Nonce')
        if (n2) nonces.set(origin, n2)
      }
    }
    return res
  }
}
