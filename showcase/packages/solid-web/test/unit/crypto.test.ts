import { describe, expect, it } from 'vitest'
import { b64url, b64urlDecode, createDpopProof, decodeJwt, dpopHtu, generateDpopKey, jwkThumbprint, pickDpopAlg, sha256b64url } from '../../src/crypto'

describe('base64url', () => {
  it('round trips and has no padding', () => {
    const bytes = new Uint8Array([251, 255, 254, 1, 2])
    const s = b64url(bytes)
    expect(s).not.toMatch(/[+/=]/)
    expect(Array.from(b64urlDecode(s))).toEqual(Array.from(bytes))
  })
  it('matches the RFC 7636 PKCE example', async () => {
    expect(await sha256b64url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('pickDpopAlg', () => {
  it('uses what the server advertises', () => {
    expect(pickDpopAlg(['RS256'])).toBe('RS256')
    expect(pickDpopAlg(['RS256', 'ES256'])).toBe('ES256')
    expect(pickDpopAlg(['RS256', 'ES256'], 'RS256')).toBe('RS256')
    expect(pickDpopAlg(undefined)).toBe('ES256')
  })
  it('throws on an algorithm we do not implement', () => {
    expect(() => pickDpopAlg(['PS512'])).toThrow()
  })
})

describe('dpopHtu', () => {
  it('drops query and fragment', () => {
    expect(dpopHtu('https://h.example/a/b?x=1#frag')).toBe('https://h.example/a/b')
  })
})

describe.each(['RS256', 'ES256'] as const)('DPoP proof (%s)', (alg) => {
  it('is a verifiable JWT with htm, htu, iat, jti, ath', async () => {
    const key = await generateDpopKey(alg)
    const proof = await createDpopProof(key, 'get', 'https://h.example/r?q=1', { accessToken: 'tok', nonce: 'n1' })
    const { header, payload } = decodeJwt(proof)
    expect(header).toMatchObject({ typ: 'dpop+jwt', alg })
    expect(header.jwk.d).toBeUndefined()
    expect(payload).toMatchObject({ htm: 'GET', htu: 'https://h.example/r', nonce: 'n1' })
    expect(payload.ath).toBe(await sha256b64url('tok'))
    expect(Math.abs(payload.iat - Date.now() / 1000)).toBeLessThan(5)
    const [h, p, sig] = proof.split('.')
    const pub = await crypto.subtle.importKey('jwk', key.publicJwk, alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify(alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlDecode(sig) as unknown as BufferSource, new TextEncoder().encode(`${h}.${p}`))
    expect(ok).toBe(true)
  })
  it('uses a new jti each time and omits ath without a token', async () => {
    const key = await generateDpopKey(alg)
    const a = decodeJwt(await createDpopProof(key, 'POST', 'https://h.example/t')).payload
    const b = decodeJwt(await createDpopProof(key, 'POST', 'https://h.example/t')).payload
    expect(a.jti).not.toBe(b.jti)
    expect(a.ath).toBeUndefined()
  })
  it('keeps the private key non-extractable', async () => {
    const key = await generateDpopKey(alg)
    expect(key.privateKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('jwk', key.privateKey)).rejects.toThrow()
  })
  it('thumbprint is stable for one key and differs between keys', async () => {
    const k1 = await generateDpopKey(alg)
    const k2 = await generateDpopKey(alg)
    expect(await jwkThumbprint(k1.publicJwk)).toBe(await jwkThumbprint(k1.publicJwk))
    expect(await jwkThumbprint(k1.publicJwk)).not.toBe(await jwkThumbprint(k2.publicJwk))
  })
})
