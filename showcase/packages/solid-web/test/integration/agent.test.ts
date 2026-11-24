import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeJwt, jwkThumbprint } from '../../src/crypto'
import { NS, one, parseTurtle, triple } from '../../src/turtle'
import { agentFor, BASE, haveEnv, run, storageOf, storeFor, webIdOf } from './env'

describe.skipIf(!haveEnv)('agent client-credentials flow against the live pod server', () => {
  const dir = `${haveEnv ? storageOf('alice') : ''}private/${run()}/`
  beforeAll(async () => {
    await (await storeFor('alice')).ensureContainer(dir)
  })
  afterAll(async () => {
    await (await storeFor('alice')).deleteRecursive(dir)
  })

  it('logs in with DPoP-bound token using the advertised algorithm (RS256)', async () => {
    const a = await agentFor('alice')
    expect(a.config.dpop_signing_alg_values_supported).toContain(a.key.alg)
    expect(a.webId).toBe(webIdOf('alice'))
    const claims = decodeJwt(a.accessToken()).payload
    expect(claims.webid).toBe(webIdOf('alice'))
    expect(claims.cnf.jkt).toBe(await jwkThumbprint(a.key.publicJwk))
  })

  it('reads the WebID profile and finds the storage and type indexes', async () => {
    const store = await storeFor('alice')
    expect(await store.storageRoot(webIdOf('alice'))).toBe(storageOf('alice'))
    const idx = await store.typeIndexUrls(webIdOf('alice'))
    expect(idx.public).toContain('publicTypeIndex.ttl')
    expect(idx.private).toContain('privateTypeIndex.ttl')
  })

  it('PUT, GET, PATCH (N3), list and DELETE on its own pod', async () => {
    const store = await storeFor('alice')
    const url = `${dir}note.ttl`
    await store.put(url, '<#n> <http://schema.org/name> "first" .')
    let g = await store.getTurtle(url)
    expect(one(g!, `${url}#n`, NS.schema + 'name')).toBe('first')
    await store.patch(url, { delete: [triple(`${url}#n`, NS.schema + 'name', 'first')], insert: [triple(`${url}#n`, NS.schema + 'name', 'second'), triple(`${url}#n`, NS.schema + 'description', 'patched')] })
    g = await store.getTurtle(url)
    expect(one(g!, `${url}#n`, NS.schema + 'name')).toBe('second')
    expect(one(g!, `${url}#n`, NS.schema + 'description')).toBe('patched')
    expect((await store.list(dir)).map((e) => e.url)).toContain(url)
    expect(await store.delete(url)).toBe(true)
    expect(await store.get(url)).toBeUndefined()
  })

  it('creates nested containers and lists them', async () => {
    const store = await storeFor('alice')
    await store.ensureContainer(`${dir}a/b/`)
    const top = await store.list(dir)
    expect(top.find((e) => e.url === `${dir}a/`)?.isContainer).toBe(true)
    await store.ensureContainer(`${dir}a/b/`) // idempotent
  })

  it('registers a class in the private type index (idempotent) and finds it again', async () => {
    const store = await storeFor('alice')
    const idx = (await store.typeIndexUrls(webIdOf('alice'))).private!
    const cls = `${NS.skp}ShowcaseTestThing${Math.random().toString(36).slice(2, 8)}`
    expect(await store.registerType(idx, cls, dir)).toBe('added')
    expect(await store.registerType(idx, cls, dir)).toBe('present')
    expect(await store.findType(idx, cls)).toEqual([dir])
    // clean the registration up again
    const g = await store.getTurtle(idx)
    const reg = g!.getSubjects(null, null, null).find((s) => s.value.includes('#reg-') && g!.getObjects(s, null, null).some((o) => o.value === cls))
    if (reg) await store.patch(idx, { delete: g!.getQuads(reg, null, null, null) })
    expect(await store.findType(idx, cls)).toEqual([])
  })

  it('is denied on another user private area (403) and anonymous is denied', async () => {
    const agent = await agentFor('agent')
    const r = await agent.fetch(`${storageOf('alice')}private/`)
    expect(r.status).toBe(403)
    expect((await fetch(`${storageOf('alice')}private/`)).status).toBe(403)
  })

  it('exposes the pod root listing publicly (default root ACL)', async () => {
    const r = await fetch(storageOf('alice'), { headers: { Accept: 'text/turtle' } })
    expect(r.status).toBe(200)
    expect(parseTurtle(await r.text(), storageOf('alice')).size).toBeGreaterThan(0)
  })

  it('discovery advertises RS256 DPoP and the registration endpoint', async () => {
    const conf = (await (await fetch(`${BASE}/.well-known/openid-configuration`)).json()) as any
    expect(conf.dpop_signing_alg_values_supported).toEqual(['RS256'])
    expect(conf.registration_endpoint).toBeTruthy()
  })
})
