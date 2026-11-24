// WebCrypto helpers for DPoP (RFC 9449). Works in browsers and Node 22 (globalThis.crypto).

export type DpopAlg = 'RS256' | 'ES256'

export interface DpopKey {
  alg: DpopAlg
  privateKey: CryptoKey
  publicKey: CryptoKey
  /** Public JWK (kty, n/e or crv/x/y only), as embedded in proofs. */
  publicJwk: JsonWebKey
}

const enc = new TextEncoder()

export function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256b64url(input: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(input)))
}

export function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Pick the proof algorithm from `dpop_signing_alg_values_supported`. pods-dev advertises RS256 only. */
export function pickDpopAlg(supported: string[] | undefined, preferred?: DpopAlg): DpopAlg {
  const list = supported && supported.length ? supported : ['ES256']
  if (preferred && list.includes(preferred)) return preferred
  if (list.includes('ES256')) return 'ES256'
  if (list.includes('RS256')) return 'RS256'
  throw new Error(`Server supports no DPoP algorithm we implement (advertised: ${list.join(', ')})`)
}

export async function generateDpopKey(alg: DpopAlg, extractable = false): Promise<DpopKey> {
  // The public key is always exportable; extractable only controls the private key.
  const params: RsaHashedKeyGenParams | EcKeyGenParams =
    alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' }
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair
  let privateKey = pair.privateKey
  if (!extractable) {
    // Re-import non-extractable so the private key cannot be read back by script (XSS hardening).
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    privateKey = await crypto.subtle.importKey('jwk', jwk, params.name === 'ECDSA' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  }
  const publicJwk = cleanJwk(await crypto.subtle.exportKey('jwk', pair.publicKey))
  return { alg, privateKey, publicKey: pair.publicKey, publicJwk }
}

function cleanJwk(jwk: JsonWebKey): JsonWebKey {
  return jwk.kty === 'RSA' ? { kty: 'RSA', n: jwk.n, e: jwk.e } : { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y }
}

/** RFC 7638 thumbprint, the value of `cnf.jkt` in a DPoP-bound token. */
export async function jwkThumbprint(jwk: JsonWebKey): Promise<string> {
  const canonical =
    jwk.kty === 'RSA'
      ? `{"e":"${jwk.e}","kty":"RSA","n":"${jwk.n}"}`
      : `{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`
  return sha256b64url(canonical)
}

/** htu per RFC 9449: the request URL without query and fragment. */
export function dpopHtu(url: string): string {
  const u = new URL(url)
  u.search = ''
  u.hash = ''
  return u.toString()
}

export interface ProofOptions {
  accessToken?: string
  nonce?: string
}

export async function createDpopProof(key: DpopKey, method: string, url: string, opts: ProofOptions = {}): Promise<string> {
  const header = { typ: 'dpop+jwt', alg: key.alg, jwk: key.publicJwk }
  const payload: Record<string, unknown> = {
    htm: method.toUpperCase(),
    htu: dpopHtu(url),
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
  }
  if (opts.accessToken) payload.ath = await sha256b64url(opts.accessToken)
  if (opts.nonce) payload.nonce = opts.nonce
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const algo = key.alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' }
  const sig = await crypto.subtle.sign(algo, key.privateKey, enc.encode(signingInput))
  return `${signingInput}.${b64url(sig)}`
}

export function decodeJwt(jwt: string): { header: any; payload: any } {
  const [h, p] = jwt.split('.')
  const dec = new TextDecoder()
  return { header: JSON.parse(dec.decode(b64urlDecode(h))), payload: JSON.parse(dec.decode(b64urlDecode(p))) }
}
