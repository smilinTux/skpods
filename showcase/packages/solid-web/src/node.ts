// Node-side helpers for tests and services: client-credentials login for an agent, plus minting credentials.
import { createDpopFetch } from './dpop-fetch'
import { decodeJwt, generateDpopKey, pickDpopAlg, type DpopAlg, type DpopKey } from './crypto'
import { discover, tokenRequest, OidcError, type OidcConfig } from './oidc'

export interface ClientCredentials {
  client_id: string
  client_secret: string
  webid?: string
  issuer?: string
}

/**
 * Mint client credentials for a pod owner (POST /apps/solid/client-credentials, Basic auth).
 * `secret` is the Nextcloud password or an app password. The result is a credential: store it like a password.
 */
export async function mintClientCredentials(opts: {
  base: string
  user: string
  secret: string
  name?: string
  fetchImpl?: typeof fetch
}): Promise<ClientCredentials> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const res = await f(opts.base.replace(/\/$/, '') + '/apps/solid/client-credentials', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${opts.user}:${opts.secret}`).toString('base64'),
      'OCS-APIRequest': 'true',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ name: opts.name ?? 'skpods-showcase agent' }),
  })
  if (!res.ok) throw new OidcError(`Minting client credentials failed (${res.status})`, res.status)
  const j: any = await res.json()
  return { client_id: j.client_id, client_secret: j.client_secret, webid: j.webid, issuer: j.issuer }
}

export async function revokeClientCredentials(opts: { base: string; user: string; secret: string; clientId: string; fetchImpl?: typeof fetch }): Promise<boolean> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const res = await f(`${opts.base.replace(/\/$/, '')}/apps/solid/client-credentials/${opts.clientId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Basic ' + Buffer.from(`${opts.user}:${opts.secret}`).toString('base64'), 'OCS-APIRequest': 'true' },
  })
  return res.ok
}

export interface AgentSession {
  /** Authenticated fetch (Authorization: DPoP + proof with ath). Refreshes the token before it expires. */
  fetch: typeof fetch
  webId: string
  issuer: string
  config: OidcConfig
  key: DpopKey
  /** Force a new token now. */
  refresh: () => Promise<void>
  accessToken: () => string
}

/** Client-credentials login for a headless agent. Re-requests the token at 80 percent of its lifetime (same key). */
export async function agentLogin(opts: {
  issuer: string
  clientId: string
  clientSecret: string
  alg?: DpopAlg
  fetchImpl?: typeof fetch
}): Promise<AgentSession> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const conf = await discover(opts.issuer, f)
  const alg = pickDpopAlg(conf.dpop_signing_alg_values_supported, opts.alg)
  const key = await generateDpopKey(alg)
  let token = ''
  let expiresAt = 0
  let webId = ''
  const refresh = async () => {
    const t = await tokenRequest({
      conf,
      key,
      params: { grant_type: 'client_credentials', scope: 'webid' },
      basicAuth: { id: opts.clientId, secret: opts.clientSecret },
      fetchImpl: f,
    })
    token = t.access_token
    expiresAt = Date.now() + (t.expires_in ?? 3600) * 800
    webId = decodeJwt(token).payload.webid ?? webId
  }
  await refresh()
  let inflight: Promise<void> | undefined
  const getAccessToken = async () => {
    if (Date.now() >= expiresAt) {
      inflight ??= refresh().finally(() => (inflight = undefined))
      await inflight
    }
    return token
  }
  const authed = createDpopFetch({
    key,
    getAccessToken,
    onUnauthorized: async () => {
      await refresh()
      return token
    },
    allowedOrigins: [new URL(conf.issuer).origin],
    fetchImpl: f,
  })
  return { fetch: authed, webId, issuer: conf.issuer, config: conf, key, refresh, accessToken: () => token }
}
