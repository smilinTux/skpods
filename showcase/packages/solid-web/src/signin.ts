// Sign-in helpers shared by every showcase app: the default pod provider, working out where someone signs in
// from whatever they know (WebID, handle, server address), and the list of accounts remembered on this device.
// Everything here is a pure function over an injectable fetch and storage, so it is unit tested without a browser.
import { fetchProfile } from './profile'
import { safeLocal } from './storage'

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env

/**
 * The pod provider behind the "Sign in with skpods.id" button. One constant for all apps: set VITE_POD_ISSUER at
 * build time to point it elsewhere. Today it is the dev server; it moves to the production skpods.id server later.
 */
export const DEFAULT_ISSUER: string = (viteEnv?.VITE_POD_ISSUER ?? 'https://pods-dev.skstack01.douno.it').replace(/\/$/, '')

/** The name people see on the big button. */
export const DEFAULT_PROVIDER_NAME = 'skpods.id'

// ---------------------------------------------------------------------------------------------------------------
// Resolving what the person typed
// ---------------------------------------------------------------------------------------------------------------

export type PodInputKind = 'webid' | 'handle' | 'server'

export interface ResolvedPod {
  /** Where to send the browser to sign in (an OIDC issuer). */
  issuer: string
  /** The WebID, when the input named one (directly or through WebFinger). */
  webId?: string
  /** Display name from the profile, when one was read. */
  name?: string
  /** How the input was understood. */
  via: PodInputKind
}

export type PodLookupReason = 'empty' | 'invalid' | 'not-found'

/** A lookup failure. `message` is plain language, safe to show as is. */
export class PodLookupError extends Error {
  constructor(public reason: PodLookupReason, message: string) {
    super(message)
    this.name = 'PodLookupError'
  }
}

export const LOOKUP_MESSAGES: Record<PodLookupReason, string> = {
  empty: 'Type your pod address, your handle or your WebID, or sign in with skpods.id.',
  invalid: "That doesn't look like a pod address. Try something like alex@pods.example.com or pods.example.com.",
  'not-found': "We couldn't find a pod there. Check the spelling, or sign in with skpods.id.",
}

const fail = (reason: PodLookupReason) => new PodLookupError(reason, LOOKUP_MESSAGES[reason])

const HANDLE = /^@?([^@\s/:]+)@([a-z0-9.-]+(?::\d+)?)$/i
const HOSTISH = /^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/i
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Turn a typed address into an https URL. A bare host gets https; http is upgraded to https except for localhost,
 * which dev setups serve over plain http. Returns undefined when it is not a usable web address.
 */
export function normalizePodUrl(input: string): URL | undefined {
  const s = input.trim()
  if (!s || /\s/.test(s)) return undefined
  let url: URL
  try {
    if (/^https?:\/\//i.test(s)) url = new URL(s)
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return undefined
    else {
      if (!HOSTISH.test(s.split(/[/?#]/)[0])) return undefined
      url = new URL(`https://${s}`)
    }
  } catch {
    return undefined
  }
  if (url.protocol === 'http:' && !LOCAL.has(url.hostname)) url.protocol = 'https:'
  if (!url.hostname.includes('.') && !LOCAL.has(url.hostname)) return undefined
  return url
}

/** How an input will be treated, without any network access. */
export function classifyPodInput(input: string): { kind: PodInputKind; user?: string; host?: string; url?: URL } | undefined {
  const s = input.trim().replace(/^acct:/i, '')
  const h = HANDLE.exec(s)
  if (h && !/^https?:/i.test(s)) return { kind: 'handle', user: h[1], host: h[2].toLowerCase() }
  const url = normalizePodUrl(s)
  if (!url) return undefined
  if (url.hash || url.pathname.length > 1) return { kind: 'webid', url }
  return { kind: 'server', url }
}

const SOLID_WEBID_REL = 'http://www.w3.org/ns/solid/terms#webid'
const OIDC_ISSUER_REL = 'http://openid.net/specs/connect/1.0/issuer'
const PROFILE_REL = 'http://webfinger.net/rel/profile-page'

const stripSlash = (u: string) => u.replace(/\/$/, '')

/** True if `base` answers OIDC discovery. Returns the issuer it declares (or `base`). */
export async function checkIssuer(base: string, f: typeof fetch): Promise<string | undefined> {
  try {
    const res = await f(stripSlash(base) + '/.well-known/openid-configuration', { headers: { Accept: 'application/json' } })
    if (!res.ok) return undefined
    const conf = (await res.json()) as { issuer?: unknown; authorization_endpoint?: unknown }
    if (typeof conf?.authorization_endpoint !== 'string') return undefined
    return typeof conf.issuer === 'string' && conf.issuer ? stripSlash(conf.issuer) : stripSlash(base)
  } catch {
    return undefined
  }
}

interface Jrd {
  subject?: string
  aliases?: string[]
  links?: { rel?: string; href?: string }[]
}

/** WebFinger lookup for `acct:user@host`. Returns a WebID and/or issuer it advertises. */
export async function webfinger(user: string, host: string, f: typeof fetch): Promise<{ webId?: string; issuer?: string } | undefined> {
  const resource = `acct:${user}@${host}`
  const scheme = LOCAL.has(host.split(':')[0]) ? 'http' : 'https'
  try {
    const res = await f(`${scheme}://${host}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`, { headers: { Accept: 'application/jrd+json, application/json' } })
    if (!res.ok) return undefined
    const jrd = (await res.json()) as Jrd
    const links = Array.isArray(jrd?.links) ? jrd.links : []
    const href = (rel: string) => links.find((l) => l?.rel === rel && typeof l.href === 'string')?.href
    const webId = href(SOLID_WEBID_REL) ?? href(PROFILE_REL) ?? (jrd.aliases ?? []).find((a) => typeof a === 'string' && /^https?:\/\/[^#]+#/.test(a))
    const issuer = href(OIDC_ISSUER_REL)
    if (!webId && !issuer) return undefined
    return { webId, issuer: issuer ? stripSlash(issuer) : undefined }
  } catch {
    return undefined
  }
}

/**
 * Work out where someone signs in from whatever they typed:
 * - a WebID or profile URL: read solid:oidcIssuer from the profile;
 * - a handle (`alex@pods.example.com`): WebFinger, then the WebID's profile; if that fails, the host itself;
 * - a server address (`pods.example.com`, `https://pods.example.com`): used if its OIDC discovery answers.
 * Throws PodLookupError with a message fit to show.
 */
export async function resolvePodInput(input: string, opts: { fetch?: typeof fetch } = {}): Promise<ResolvedPod> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis)
  if (!input.trim()) throw fail('empty')
  const c = classifyPodInput(input)
  if (!c) throw fail('invalid')

  if (c.kind === 'handle') {
    const wf = await webfinger(c.user!, c.host!, f)
    if (wf?.webId) {
      const p = await fetchProfile(wf.webId, f)
      const issuer = p?.issuer ?? wf.issuer
      if (issuer) return { issuer, webId: p?.webId ?? wf.webId, name: p?.name, via: 'handle' }
    } else if (wf?.issuer) {
      const ok = await checkIssuer(wf.issuer, f)
      if (ok) return { issuer: ok, via: 'handle' }
    }
    const base = normalizePodUrl(c.host!)
    const ok = base && (await checkIssuer(base.origin, f))
    if (ok) return { issuer: ok, via: 'handle' }
    throw fail('not-found')
  }

  const url = c.url!
  if (c.kind === 'webid') {
    const p = await fetchProfile(url.toString(), f)
    if (p?.issuer) return { issuer: p.issuer, webId: p.webId, name: p.name, via: 'webid' }
    // Not a profile: maybe a page on the pod server. Try the server itself.
    const ok = await checkIssuer(url.origin, f)
    if (ok) return { issuer: ok, via: 'server' }
    throw fail('not-found')
  }

  const ok = await checkIssuer(url.origin, f)
  if (ok) return { issuer: ok, via: 'server' }
  throw fail('not-found')
}

// ---------------------------------------------------------------------------------------------------------------
// Remembered accounts (the seed of a multi-account pod picker; one active session at a time for now)
// ---------------------------------------------------------------------------------------------------------------

export interface RememberedAccount {
  webId: string
  issuer: string
  /** Display name from the profile, if it has one. */
  name?: string
  /** A label the person chose ("Work", "Family"). */
  label?: string
  /** Epoch ms of the last sign-in, newest first. */
  lastUsed: number
}

export const ACCOUNTS_KEY = 'skpods:accounts:v1'
export const MAX_REMEMBERED = 8

type KVStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const isAccount = (a: unknown): a is RememberedAccount => {
  const x = a as RememberedAccount
  return Boolean(x) && typeof x.webId === 'string' && typeof x.issuer === 'string' && typeof x.lastUsed === 'number'
}

/** Remembered accounts, newest first. Never throws: unreadable or blocked storage gives an empty list. */
export function listAccounts(storage: KVStorage | undefined = safeLocal()): RememberedAccount[] {
  try {
    const raw = storage?.getItem(ACCOUNTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    return parsed
      .filter(isAccount)
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .filter((a) => !seen.has(a.webId) && seen.add(a.webId))
  } catch {
    return []
  }
}

function save(list: RememberedAccount[], storage: KVStorage | undefined): boolean {
  try {
    if (!storage) return false
    if (list.length) storage.setItem(ACCOUNTS_KEY, JSON.stringify(list))
    else storage.removeItem(ACCOUNTS_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Add or update an account (keyed by WebID). Fields left undefined keep their stored value, so a later sign-in
 * without a profile name does not erase one. Returns the new list; on storage failure the list is not saved.
 */
export function rememberAccount(
  account: Omit<RememberedAccount, 'lastUsed'> & { lastUsed?: number },
  storage: KVStorage | undefined = safeLocal(),
): RememberedAccount[] {
  const list = listAccounts(storage)
  const prev = list.find((a) => a.webId === account.webId)
  const next: RememberedAccount = {
    webId: account.webId,
    issuer: stripSlash(account.issuer),
    name: account.name ?? prev?.name,
    label: account.label ?? prev?.label,
    lastUsed: account.lastUsed ?? Date.now(),
  }
  const out = [next, ...list.filter((a) => a.webId !== account.webId)].slice(0, MAX_REMEMBERED)
  save(out, storage)
  return out
}

/** Forget one account on this device. Returns the remaining list. */
export function forgetAccount(webId: string, storage: KVStorage | undefined = safeLocal()): RememberedAccount[] {
  const out = listAccounts(storage).filter((a) => a.webId !== webId)
  save(out, storage)
  return out
}

/** What to call an account on a button: label, then name, then the user part of the WebID. */
export function accountDisplayName(a: Pick<RememberedAccount, 'webId' | 'name' | 'label'>): string {
  if (a.label?.trim()) return a.label.trim()
  if (a.name?.trim()) return a.name.trim()
  try {
    const u = new URL(a.webId)
    const seg = u.pathname.split('/').filter(Boolean)
    const tilde = seg.find((s) => s.startsWith('~'))
    if (tilde) return decodeURIComponent(tilde.slice(1))
    if (seg[0] && seg[0] !== 'profile') return decodeURIComponent(seg[0])
    return u.hostname
  } catch {
    return a.webId
  }
}
