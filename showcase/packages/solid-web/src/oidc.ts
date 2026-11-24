import { createDpopProof, type DpopKey } from './crypto'

export interface OidcConfig {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  jwks_uri?: string
  end_session_endpoint?: string
  userinfo_endpoint?: string
  dpop_signing_alg_values_supported?: string[]
  code_challenge_methods_supported?: string[]
  grant_types_supported?: string[]
  response_types_supported?: string[]
  scopes_supported?: string[]
  [k: string]: unknown
}

export interface RegisteredClient {
  client_id: string
  client_secret?: string
  redirect_uris: string[]
  /** What the server says it registered (pods-dev answers implicit defaults, see ENGINE-NOTES.md). */
  grant_types?: string[]
  response_types?: string[]
  token_endpoint_auth_method?: string
  registration_client_uri?: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
  scope?: string
}

export class OidcError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message)
    this.name = 'OidcError'
  }
}

export async function discover(issuer: string, f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<OidcConfig> {
  const url = issuer.replace(/\/$/, '') + '/.well-known/openid-configuration'
  const res = await f(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new OidcError(`OIDC discovery failed (${res.status}) at ${url}`, res.status)
  const conf = (await res.json()) as OidcConfig
  if (!conf.authorization_endpoint || !conf.token_endpoint) throw new OidcError('Discovery document lacks authorization or token endpoint')
  return conf
}

/**
 * Dynamic client registration for a public browser client (authorization code + PKCE).
 * The server may answer with different grant types than requested; callers should not rely on the echo.
 */
export async function registerClient(
  conf: OidcConfig,
  opts: { redirectUris: string[]; clientName: string },
  f: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<RegisteredClient> {
  if (!conf.registration_endpoint) throw new OidcError('Server has no registration_endpoint; a pre-registered client_id is required')
  const res = await f(conf.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      application_type: 'web',
      client_name: opts.clientName,
      redirect_uris: opts.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'openid webid offline_access',
    }),
  })
  if (!res.ok) throw new OidcError(`Client registration failed (${res.status})`, res.status, await res.text().catch(() => ''))
  const j = (await res.json()) as RegisteredClient
  return {
    client_id: j.client_id,
    client_secret: j.client_secret,
    redirect_uris: opts.redirectUris,
    grant_types: j.grant_types,
    response_types: j.response_types,
    token_endpoint_auth_method: j.token_endpoint_auth_method,
    registration_client_uri: j.registration_client_uri,
  }
}

export interface TokenRequestOptions {
  conf: OidcConfig
  key: DpopKey
  params: Record<string, string>
  /** Basic client authentication (client_credentials, or confidential clients). */
  basicAuth?: { id: string; secret: string }
  fetchImpl?: typeof fetch
}

/** POST to the token endpoint with a DPoP proof, retrying once on a DPoP-Nonce challenge. */
export async function tokenRequest(o: TokenRequestOptions): Promise<TokenResponse> {
  const f = o.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const body = new URLSearchParams(o.params).toString()
  const attempt = async (nonce?: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      DPoP: await createDpopProof(o.key, 'POST', o.conf.token_endpoint, { nonce }),
    }
    if (o.basicAuth) headers.Authorization = 'Basic ' + btoa(`${o.basicAuth.id}:${o.basicAuth.secret}`)
    return f(o.conf.token_endpoint, { method: 'POST', headers, body })
  }
  let res = await attempt()
  const nonce = res.headers.get('DPoP-Nonce')
  if (!res.ok && nonce) res = await attempt(nonce)
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  if (!res.ok || !json?.access_token) {
    const detail = json?.error_description || json?.error || ''
    throw new OidcError(`Token request failed (${res.status}) ${detail}`.trim(), res.status, json)
  }
  return json as TokenResponse
}
