import { describe, expect, it } from 'vitest'
import { NS, all, one, parseTurtle, serializeTurtle, triple } from '../../src/turtle'
import { AUTHENTICATED_CLASS, grantAccess, parseAcl, parseWacAllow, revokeAccess, serializeAcl, writeAcl, discoverAcl, type AclRule } from '../../src/wac'
import { PodStore } from '../../src/store'

const OWNER = 'https://pod.example/~a/profile/card#me'
const BOB = 'https://pod.example/~b/profile/card#me'

describe('turtle', () => {
  it('parses with a base IRI and serializes back', () => {
    const s = parseTurtle('<#x> <http://schema.org/name> "Alice Rivera" .', 'https://pod.example/r.ttl')
    expect(one(s, 'https://pod.example/r.ttl#x', NS.schema + 'name')).toBe('Alice Rivera')
    const out = serializeTurtle(s)
    expect(parseTurtle(out).size).toBe(1)
  })
  it('builds typed literals', () => {
    const q = triple('https://e.org/a', NS.schema + 'price', 12.5)
    expect(q.object.value).toBe('12.5')
    expect((q.object as any).datatype.value).toBe(NS.xsd + 'decimal')
    expect(triple('https://e.org/a', NS.schema + 'url', 'https://e.org/b').object.termType).toBe('NamedNode')
  })
  it('lists all objects', () => {
    const s = parseTurtle('<https://e.org/a> <http://schema.org/knows> <https://e.org/b>, <https://e.org/c> .')
    expect(all(s, 'https://e.org/a', NS.schema + 'knows').sort()).toEqual(['https://e.org/b', 'https://e.org/c'])
  })
})

describe('acl', () => {
  const rules: AclRule[] = [
    { id: 'owner', agents: [OWNER], agentClasses: [], agentGroups: [], modes: ['Read', 'Write', 'Control'], accessTo: ['https://pod.example/d/'], defaultFor: ['https://pod.example/d/'] },
    { id: 'pub', agents: [], agentClasses: [AUTHENTICATED_CLASS], agentGroups: [], modes: ['Append'], accessTo: ['https://pod.example/d/'], defaultFor: [] },
  ]
  it('serializes and parses without loss', () => {
    const back = parseAcl(serializeAcl(rules, 'https://pod.example/d/.acl'), 'https://pod.example/d/.acl')
    expect(back.find((r) => r.id === 'owner')).toMatchObject({ agents: [OWNER], defaultFor: ['https://pod.example/d/'] })
    expect(back.find((r) => r.id === 'pub')?.modes).toEqual(['Append'])
  })
  it('parses relative IRIs against the acl URL', () => {
    const t = `@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#o> a acl:Authorization; acl:agent <${OWNER}>; acl:accessTo <./>; acl:mode acl:Read.`
    expect(parseAcl(t, 'https://pod.example/d/.acl')[0].accessTo).toEqual(['https://pod.example/d/'])
  })
  it('parseWacAllow reads user and public modes', () => {
    expect(parseWacAllow('user="read write control",public="read"')).toEqual({ user: ['read', 'write', 'control'], public: ['read'] })
    expect(parseWacAllow(null)).toEqual({ user: [], public: [] })
  })
})

function fakePod() {
  const files = new Map<string, string>()
  const fetchImpl = (async (input: any, init: RequestInit = {}) => {
    const url = String(input)
    const m = init.method ?? 'GET'
    if (m === 'PUT') {
      files.set(url, String(init.body))
      return new Response('', { status: 201 })
    }
    if (m === 'HEAD') return new Response(null, { status: files.has(url) || !url.endsWith('.acl') ? 200 : 404, headers: { Link: '<r.ttl.acl>; rel="acl", </.well-known/solid>; rel="http://www.w3.org/ns/solid#storageDescription"' } })
    if (m === 'GET') return files.has(url) ? new Response(files.get(url), { status: 200 }) : new Response('nope', { status: 404 })
    return new Response('', { status: 400 })
  }) as typeof fetch
  return { files, store: new PodStore(fetchImpl) }
}

describe('WAC helpers (against a fake pod)', () => {
  it('discoverAcl resolves the Link rel=acl relative to the resource', async () => {
    const { store } = fakePod()
    expect(await discoverAcl(store, 'https://pod.example/d/r.ttl')).toBe('https://pod.example/d/r.ttl.acl')
  })
  it('grantAccess creates an ACL that keeps owner Control, revokeAccess removes the grant', async () => {
    const { store, files } = fakePod()
    const res = 'https://pod.example/d/r.ttl'
    await grantAccess(store, { resource: res, agent: BOB, modes: ['Read'], owner: OWNER })
    const rules = parseAcl(files.get(res + '.acl')!, res + '.acl')
    expect(rules.find((r) => r.agents.includes(OWNER))?.modes).toContain('Control')
    expect(rules.find((r) => r.agents.includes(BOB))?.modes).toEqual(['Read'])
    expect(await revokeAccess(store, { resource: res, agent: BOB, owner: OWNER })).toBe(true)
    const after = parseAcl(files.get(res + '.acl')!, res + '.acl')
    expect(after.some((r) => r.agents.includes(BOB))).toBe(false)
    expect(after.some((r) => r.agents.includes(OWNER))).toBe(true)
    expect(await revokeAccess(store, { resource: res, agent: BOB, owner: OWNER })).toBe(false)
  })
  it('granting twice merges modes in one rule', async () => {
    const { store, files } = fakePod()
    const res = 'https://pod.example/d/r.ttl'
    await grantAccess(store, { resource: res, agent: BOB, modes: ['Read'], owner: OWNER })
    await grantAccess(store, { resource: res, agent: BOB, modes: ['Write'], owner: OWNER })
    const rules = parseAcl(files.get(res + '.acl')!, res + '.acl').filter((r) => r.agents.includes(BOB))
    expect(rules).toHaveLength(1)
    expect(rules[0].modes.sort()).toEqual(['Read', 'Write'])
  })
  it('refuses an ACL that would lock the owner out', async () => {
    const { store, files } = fakePod()
    const bobOnly: AclRule[] = [{ id: 'b', agents: [BOB], agentClasses: [], agentGroups: [], modes: ['Read'], accessTo: ['https://pod.example/d/r.ttl'], defaultFor: [] }]
    await expect(writeAcl(store, 'https://pod.example/d/r.ttl.acl', bobOnly, OWNER)).rejects.toThrow(/lock the owner out/)
    expect(files.size).toBe(0)
  })
  it('refuses to revoke the owner', async () => {
    const { store } = fakePod()
    await expect(revokeAccess(store, { resource: 'https://pod.example/d/r.ttl', agent: OWNER, owner: OWNER })).rejects.toThrow()
  })
})

describe('PodStore.patch', () => {
  it('sends one N3 InsertDeletePatch per triple, deletes first (engine applies only the last triple of a clause)', async () => {
    const seen: { method?: string; ct?: string; body: string }[] = []
    const store = new PodStore((async (_u: any, init: RequestInit) => {
      seen.push({ method: init.method, ct: new Headers(init.headers).get('content-type') ?? undefined, body: String(init.body) })
      return new Response('', { status: 201 })
    }) as typeof fetch)
    const s = 'https://pod.example/r.ttl#x'
    await store.patch('https://pod.example/r.ttl', { insert: [triple(s, NS.schema + 'name', 'N'), triple(s, NS.schema + 'url', 'U')], delete: [triple(s, NS.schema + 'name', 'O')] })
    expect(seen).toHaveLength(3)
    expect(seen.every((x) => x.method === 'PATCH' && x.ct === 'text/n3')).toBe(true)
    expect(seen[0].body).toContain('solid:deletes')
    expect(seen[0].body).toContain('<https://pod.example/r.ttl#x> <http://schema.org/name> "O"')
    expect(seen[1].body).toContain('solid:inserts')
    expect(seen[2].body).toContain('"U"')
  })
})
