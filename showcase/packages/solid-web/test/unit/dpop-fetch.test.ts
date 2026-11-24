import { describe, expect, it } from 'vitest'
import { decodeJwt, generateDpopKey, sha256b64url } from '../../src/crypto'
import { createDpopFetch } from '../../src/dpop-fetch'

const key = await generateDpopKey('ES256')

function recorder(responses: Array<(req: { url: string; headers: Headers }) => Response>) {
  const calls: { url: string; headers: Headers; method?: string }[] = []
  const impl = (async (input: any, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    calls.push({ url: String(input), headers, method: init.method })
    return responses[Math.min(calls.length - 1, responses.length - 1)]({ url: String(input), headers })
  }) as typeof fetch
  return { calls, impl }
}

describe('createDpopFetch', () => {
  it('sends Authorization: DPoP and a proof bound to the token, method and URL', async () => {
    const r = recorder([() => new Response('ok')])
    const f = createDpopFetch({ key, getAccessToken: async () => 'tok1', allowedOrigins: ['https://pod.example'], fetchImpl: r.impl })
    await f('https://pod.example/a/b?x=1', { method: 'PUT', body: 'x' })
    const c = r.calls[0]
    expect(c.headers.get('Authorization')).toBe('DPoP tok1')
    const { payload } = decodeJwt(c.headers.get('DPoP')!)
    expect(payload).toMatchObject({ htm: 'PUT', htu: 'https://pod.example/a/b', ath: await sha256b64url('tok1') })
  })
  it('never attaches the token to other origins', async () => {
    const r = recorder([() => new Response('ok')])
    const f = createDpopFetch({ key, getAccessToken: async () => 'tok1', allowedOrigins: ['https://pod.example'], fetchImpl: r.impl })
    await f('https://elsewhere.example/x')
    expect(r.calls[0].headers.get('Authorization')).toBeNull()
    expect(r.calls[0].headers.get('DPoP')).toBeNull()
  })
  it('retries once with the server nonce', async () => {
    const r = recorder([() => new Response('', { status: 401, headers: { 'DPoP-Nonce': 'abc' } }), () => new Response('ok')])
    const f = createDpopFetch({ key, getAccessToken: async () => 't', allowedOrigins: ['https://pod.example'], fetchImpl: r.impl })
    const res = await f('https://pod.example/x')
    expect(res.status).toBe(200)
    expect(r.calls).toHaveLength(2)
    expect(decodeJwt(r.calls[1].headers.get('DPoP')!).payload.nonce).toBe('abc')
    // the nonce is remembered for the next request to that origin
    await f('https://pod.example/y')
    expect(decodeJwt(r.calls[2].headers.get('DPoP')!).payload.nonce).toBe('abc')
  })
  it('refreshes once on 401 and retries with the new token', async () => {
    const r = recorder([(q) => (q.headers.get('Authorization') === 'DPoP old' ? new Response('', { status: 401 }) : new Response('ok'))])
    const f = createDpopFetch({ key, getAccessToken: async () => 'old', onUnauthorized: async () => 'new', allowedOrigins: ['https://pod.example'], fetchImpl: r.impl })
    const res = await f('https://pod.example/x')
    expect(res.status).toBe(200)
    expect(r.calls.map((c) => c.headers.get('Authorization'))).toEqual(['DPoP old', 'DPoP new'])
  })
  it('gives up with the 401 when refresh yields nothing new', async () => {
    const r = recorder([() => new Response('', { status: 401 })])
    const f = createDpopFetch({ key, getAccessToken: async () => 'old', onUnauthorized: async () => 'old', allowedOrigins: ['https://pod.example'], fetchImpl: r.impl })
    expect((await f('https://pod.example/x')).status).toBe(401)
    expect(r.calls).toHaveLength(1)
  })
})
