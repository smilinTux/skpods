import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { grantAccess, parseWacAllow, readAcl, revokeAccess, discoverAcl, writeAcl } from '../../src/wac'
import { agentFor, haveEnv, run, storageOf, storeFor, webIdOf } from './env'

describe.skipIf(!haveEnv)('WAC: alice shares with bob via .acl', () => {
  const dir = `${haveEnv ? storageOf('alice') : ''}private/${run()}/`
  const res = `${dir}shared-note.ttl`
  const alice = haveEnv ? webIdOf('alice') : ''
  beforeAll(async () => {
    const a = await storeFor('alice')
    await a.ensureContainer(dir)
    await a.put(res, '<#n> <http://schema.org/name> "for bob" .')
  })
  afterAll(async () => {
    await (await storeFor('alice')).deleteRecursive(dir)
  })

  it('bob is denied, is granted Read via .acl, can read but not write, then loses access on revoke', async () => {
    const a = await storeFor('alice')
    const b = await storeFor('bob')
    const bobId = webIdOf('bob')
    expect((await b.request(res)).status).toBe(403)

    const aclUrl = await grantAccess(a, { resource: res, agent: bobId, modes: ['Read'], owner: alice })
    expect(aclUrl).toBe(`${res}.acl`)
    const rules = await readAcl(a, aclUrl)
    expect(rules?.find((r) => r.agents.includes(bobId))?.modes).toEqual(['Read'])

    const ok = await b.request(res)
    expect(ok.status).toBe(200)
    expect(ok.text).toContain('for bob')
    expect(parseWacAllow(ok.headers.get('wac-allow')).user).toEqual(['read'])
    expect((await b.request(res, { method: 'PUT', headers: { 'Content-Type': 'text/turtle' }, body: '<#n> <http://schema.org/name> "hacked" .' })).status).toBe(403)

    expect(await revokeAccess(a, { resource: res, agent: bobId, owner: alice })).toBe(true)
    expect((await b.request(res)).status).toBe(403)
    // alice still has full access (owner Control retained)
    expect((await a.request(res)).status).toBe(200)
    expect((await a.get(res))?.text).toContain('for bob')
  })

  it('container grant with acl:default is inherited by existing and later children', async () => {
    const a = await storeFor('alice')
    const b = await storeFor('bob')
    const sub = `${dir}inherit/`
    await a.ensureContainer(sub)
    await a.put(`${sub}early.ttl`, '<#n> <http://schema.org/name> "early" .')
    await grantAccess(a, { resource: sub, agent: webIdOf('bob'), modes: ['Read'], owner: alice, inherit: true })
    await a.put(`${sub}late.ttl`, '<#n> <http://schema.org/name> "late" .')
    expect((await b.request(`${sub}early.ttl`)).status).toBe(200)
    expect((await b.request(`${sub}late.ttl`)).status).toBe(200)
    expect((await b.list(sub)).map((e) => e.url.split('/').pop()).sort()).toEqual(['early.ttl', 'late.ttl'])
    await revokeAccess(a, { resource: sub, agent: webIdOf('bob'), owner: alice })
    expect((await b.request(`${sub}early.ttl`)).status).toBe(403)
  })

  it('Append-only inbox: practitioner can POST but not read, overwrite, patch or delete', async () => {
    const a = await storeFor('alice')
    const p = await storeFor('practitioner')
    const inbox = `${dir}inbox/`
    await a.ensureContainer(inbox)
    await a.put(`${inbox}existing.ttl`, '<#n> <http://schema.org/name> "mine" .')
    await grantAccess(a, { resource: inbox, agent: webIdOf('practitioner'), modes: ['Append'], owner: alice, inherit: true })

    const created = await p.post(inbox, '<#r> <http://schema.org/name> "request" .', { slug: 'req-1.ttl' })
    expect(created).toBe(`${inbox}req-1.ttl`)
    expect((await a.get(created))?.text).toContain('request')

    expect((await p.request(inbox)).status).toBe(403) // cannot list
    expect((await p.request(`${inbox}existing.ttl`)).status).toBe(403) // cannot read
    expect((await p.request(`${inbox}existing.ttl`, { method: 'PUT', headers: { 'Content-Type': 'text/turtle' }, body: 'x' })).status).toBe(403)
    expect((await p.request(`${inbox}existing.ttl`, { method: 'DELETE' })).status).toBe(403)
    expect((await a.get(`${inbox}existing.ttl`))?.text).toContain('mine')
  })

  it('writeAcl refuses garbage and owner lockout before touching the server', async () => {
    const a = await storeFor('alice')
    const aclUrl = `${dir}lockout.ttl.acl`
    await expect(writeAcl(a, aclUrl, [{ id: 'b', agents: [webIdOf('bob')], agentClasses: [], agentGroups: [], modes: ['Read'], accessTo: [dir], defaultFor: [] }], alice)).rejects.toThrow(/lock the owner out/)
    expect(await a.exists(aclUrl)).toBe(false)
  })
})
