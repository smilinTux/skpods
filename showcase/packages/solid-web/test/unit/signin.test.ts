import { describe, expect, it } from 'vitest'
import {
  ACCOUNTS_KEY,
  LOOKUP_MESSAGES,
  PodLookupError,
  accountDisplayName,
  classifyPodInput,
  forgetAccount,
  listAccounts,
  normalizePodUrl,
  rememberAccount,
  resolvePodInput,
} from '../../src/signin'

// A fake web: map of URL to a response factory. Anything else is a 404. Records every URL fetched.
function fakeWeb(routes: Record<string, () => Response>) {
  const calls: string[] = []
  const f = (async (input: any) => {
    const url = String(input)
    calls.push(url)
    const r = routes[url]
    if (!r) return new Response('not found', { status: 404 })
    return r()
  }) as typeof fetch
  return { f, calls }
}
const json = (b: unknown) => () => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } })
const turtle = (t: string) => () => new Response(t, { headers: { 'Content-Type': 'text/turtle' } })
const discovery = (issuer: string) => json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token` })

const POD = 'https://pods.example.com'
const WEBID = `${POD}/apps/solid/~alex/profile/card#me`
const PROFILE = turtle(`@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<#me> solid:oidcIssuer <https://login.example.com/> ; foaf:name "Alex Test" .`)

describe('normalizePodUrl and classifyPodInput', () => {
  it('adds https to a bare host', () => expect(normalizePodUrl('pods.example.com')?.toString()).toBe('https://pods.example.com/'))
  it('upgrades http to https', () => expect(normalizePodUrl('http://pods.example.com')?.protocol).toBe('https:'))
  it('keeps http for localhost', () => expect(normalizePodUrl('http://localhost:3000')?.toString()).toBe('http://localhost:3000/'))
  it('rejects things that are not web addresses', () => {
    for (const x of ['', 'alex', 'hello world', 'ftp://pods.example.com', 'not a url.com']) expect(normalizePodUrl(x)).toBeUndefined()
  })
  it('classifies handles, WebIDs and servers', () => {
    expect(classifyPodInput('alex@pods.example.com')).toMatchObject({ kind: 'handle', user: 'alex', host: 'pods.example.com' })
    expect(classifyPodInput('@alex@Pods.Example.com')).toMatchObject({ kind: 'handle', host: 'pods.example.com' })
    expect(classifyPodInput('acct:alex@pods.example.com')?.kind).toBe('handle')
    expect(classifyPodInput(WEBID)?.kind).toBe('webid')
    expect(classifyPodInput('pods.example.com/apps/solid/~alex/profile/card')?.kind).toBe('webid')
    expect(classifyPodInput('  https://pods.example.com/ ')?.kind).toBe('server')
  })
})

describe('resolvePodInput', () => {
  it('WebID: reads solid:oidcIssuer and the name from the profile', async () => {
    const web = fakeWeb({ [WEBID.split('#')[0]]: PROFILE })
    expect(await resolvePodInput(WEBID, { fetch: web.f })).toEqual({ issuer: 'https://login.example.com', webId: WEBID, name: 'Alex Test', via: 'webid' })
  })

  it('profile URL without #me: finds the <#me> subject', async () => {
    const web = fakeWeb({ [WEBID.split('#')[0]]: PROFILE })
    const r = await resolvePodInput(WEBID.split('#')[0], { fetch: web.f })
    expect(r).toMatchObject({ issuer: 'https://login.example.com', webId: WEBID })
  })

  it('http WebID is fetched over https', async () => {
    const web = fakeWeb({ [WEBID.split('#')[0]]: PROFILE })
    const r = await resolvePodInput(WEBID.replace('https:', 'http:'), { fetch: web.f })
    expect(r.issuer).toBe('https://login.example.com')
    expect(web.calls[0].startsWith('https://')).toBe(true)
  })

  it('handle: WebFinger gives the WebID, the profile gives the issuer', async () => {
    const web = fakeWeb({
      [`${POD}/.well-known/webfinger?resource=${encodeURIComponent('acct:alex@pods.example.com')}`]: json({
        subject: 'acct:alex@pods.example.com',
        links: [{ rel: 'http://www.w3.org/ns/solid/terms#webid', href: WEBID }],
      }),
      [WEBID.split('#')[0]]: PROFILE,
    })
    expect(await resolvePodInput('alex@pods.example.com', { fetch: web.f })).toEqual({ issuer: 'https://login.example.com', webId: WEBID, name: 'Alex Test', via: 'handle' })
  })

  it('handle: WebFinger that only names an issuer is used after discovery answers', async () => {
    const web = fakeWeb({
      [`${POD}/.well-known/webfinger?resource=${encodeURIComponent('acct:alex@pods.example.com')}`]: json({ links: [{ rel: 'http://openid.net/specs/connect/1.0/issuer', href: 'https://login.example.com/' }] }),
      'https://login.example.com/.well-known/openid-configuration': discovery('https://login.example.com'),
    })
    expect(await resolvePodInput('alex@pods.example.com', { fetch: web.f })).toEqual({ issuer: 'https://login.example.com', via: 'handle' })
  })

  it('handle: no WebFinger, falls back to the host as the sign-in server', async () => {
    const web = fakeWeb({ [`${POD}/.well-known/openid-configuration`]: discovery(POD) })
    expect(await resolvePodInput('alex@pods.example.com', { fetch: web.f })).toEqual({ issuer: POD, via: 'handle' })
    expect(web.calls[0]).toContain('/.well-known/webfinger?resource=acct%3Aalex%40pods.example.com')
  })

  it('handle: WebFinger network error still falls back to the host', async () => {
    const f = (async (u: any) => {
      if (String(u).includes('webfinger')) throw new TypeError('Failed to fetch')
      return discovery(POD)()
    }) as typeof fetch
    expect((await resolvePodInput('alex@pods.example.com', { fetch: f })).issuer).toBe(POD)
  })

  it('bare host: normalized to https and checked with OIDC discovery', async () => {
    const web = fakeWeb({ [`${POD}/.well-known/openid-configuration`]: discovery(`${POD}/`) })
    expect(await resolvePodInput('pods.example.com', { fetch: web.f })).toEqual({ issuer: POD, via: 'server' })
    expect(web.calls).toEqual([`${POD}/.well-known/openid-configuration`])
  })

  it('http server address is upgraded to https', async () => {
    const web = fakeWeb({ [`${POD}/.well-known/openid-configuration`]: discovery(POD) })
    expect((await resolvePodInput('http://pods.example.com', { fetch: web.f })).issuer).toBe(POD)
  })

  it('a page on a pod server that is not a profile falls back to the server', async () => {
    const web = fakeWeb({ [`${POD}/apps/solid/`]: () => new Response('<html></html>'), [`${POD}/.well-known/openid-configuration`]: discovery(POD) })
    expect(await resolvePodInput(`${POD}/apps/solid/`, { fetch: web.f })).toEqual({ issuer: POD, via: 'server' })
  })

  const failsWith = async (input: string, reason: string, f = fakeWeb({}).f) => {
    const e = await resolvePodInput(input, { fetch: f }).catch((x) => x)
    expect(e).toBeInstanceOf(PodLookupError)
    expect(e.reason).toBe(reason)
    expect(e.message).toBe(LOOKUP_MESSAGES[e.reason as keyof typeof LOOKUP_MESSAGES])
    expect(e.message.toLowerCase()).not.toContain('issuer')
  }
  it('empty input asks for something', () => failsWith('   ', 'empty'))
  it('nonsense input is called out without any network call', async () => {
    const web = fakeWeb({})
    await failsWith('just some words', 'invalid', web.f)
    expect(web.calls).toEqual([])
  })
  it('unknown server: friendly not-found', () => failsWith('nothing-here.example.org', 'not-found'))
  it('unknown handle: friendly not-found', () => failsWith('alex@nothing-here.example.org', 'not-found'))
  it('WebID without an issuer on a server without discovery: not-found', async () => {
    await failsWith(WEBID, 'not-found', fakeWeb({ [WEBID.split('#')[0]]: turtle('<#me> <http://xmlns.com/foaf/0.1/name> "x" .') }).f)
  })
  it('discovery that is not an OIDC document is not accepted', () => failsWith('pods.example.com', 'not-found', fakeWeb({ [`${POD}/.well-known/openid-configuration`]: json({ hello: 1 }) }).f))
  it('network failure: not-found, never a raw error', () =>
    failsWith('pods.example.com', 'not-found', (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch))
  it('the not-found message is the plain-language one', () =>
    expect(LOOKUP_MESSAGES['not-found']).toBe("We couldn't find a pod there. Check the spelling, or sign in with skpods.id."))
})

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}
const throwing = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceeded')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

describe('remembered accounts', () => {
  it('remembers, lists newest first, keyed by WebID', () => {
    const s = new MemStorage()
    rememberAccount({ webId: 'https://a.example/p#me', issuer: 'https://a.example/', lastUsed: 1 }, s)
    rememberAccount({ webId: 'https://b.example/p#me', issuer: 'https://b.example', lastUsed: 2 }, s)
    rememberAccount({ webId: 'https://a.example/p#me', issuer: 'https://a.example', name: 'Alex', lastUsed: 3 }, s)
    const l = listAccounts(s)
    expect(l.map((a) => a.webId)).toEqual(['https://a.example/p#me', 'https://b.example/p#me'])
    expect(l[0]).toEqual({ webId: 'https://a.example/p#me', issuer: 'https://a.example', name: 'Alex', label: undefined, lastUsed: 3 })
  })

  it('keeps a stored name and label when a later sign-in has none', () => {
    const s = new MemStorage()
    rememberAccount({ webId: 'w', issuer: 'https://i.example', name: 'Alex', label: 'Work', lastUsed: 1 }, s)
    rememberAccount({ webId: 'w', issuer: 'https://i.example', lastUsed: 2 }, s)
    expect(listAccounts(s)[0]).toMatchObject({ name: 'Alex', label: 'Work', lastUsed: 2 })
  })

  it('forgets one account, and clears the key when none are left', () => {
    const s = new MemStorage()
    rememberAccount({ webId: 'a', issuer: 'https://i.example', lastUsed: 1 }, s)
    rememberAccount({ webId: 'b', issuer: 'https://i.example', lastUsed: 2 }, s)
    expect(forgetAccount('a', s).map((a) => a.webId)).toEqual(['b'])
    expect(forgetAccount('b', s)).toEqual([])
    expect(s.getItem(ACCOUNTS_KEY)).toBeNull()
  })

  it('ignores corrupt or foreign data', () => {
    const s = new MemStorage()
    s.setItem(ACCOUNTS_KEY, '{not json')
    expect(listAccounts(s)).toEqual([])
    s.setItem(ACCOUNTS_KEY, JSON.stringify({ webId: 'x' }))
    expect(listAccounts(s)).toEqual([])
    s.setItem(ACCOUNTS_KEY, JSON.stringify([{ webId: 'x' }, null, { webId: 'ok', issuer: 'https://i', lastUsed: 1 }]))
    expect(listAccounts(s).map((a) => a.webId)).toEqual(['ok'])
  })

  it('caps the list', () => {
    const s = new MemStorage()
    for (let i = 0; i < 20; i++) rememberAccount({ webId: `w${i}`, issuer: 'https://i', lastUsed: i }, s)
    const l = listAccounts(s)
    expect(l.length).toBeLessThanOrEqual(8)
    expect(l[0].webId).toBe('w19')
  })

  it('never throws when storage throws or is missing', () => {
    expect(listAccounts(throwing)).toEqual([])
    expect(() => rememberAccount({ webId: 'w', issuer: 'https://i' }, throwing)).not.toThrow()
    expect(() => forgetAccount('w', throwing)).not.toThrow()
    expect(listAccounts(undefined)).toEqual([])
    expect(rememberAccount({ webId: 'w', issuer: 'https://i' }, undefined)).toHaveLength(1)
  })

  it('display name: label, then name, then the user part of the WebID', () => {
    expect(accountDisplayName({ webId: WEBID, label: 'Work', name: 'Alex' })).toBe('Work')
    expect(accountDisplayName({ webId: WEBID, name: 'Alex' })).toBe('Alex')
    expect(accountDisplayName({ webId: WEBID })).toBe('alex')
    expect(accountDisplayName({ webId: 'https://alex.solid.example/profile/card#me' })).toBe('alex.solid.example')
  })
})
