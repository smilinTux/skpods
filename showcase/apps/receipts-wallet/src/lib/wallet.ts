// The wallet's pod layout and operations. Isomorphic: used by the browser app and by the demo scripts.
//
//   <storage>/skpods/v1/receipts/            owner only (explicit .acl, inherited by everything below)
//     inbox/<business>/                      Append-only for that one business (acl:agent), owner full control
//     archive/<business>/<file>.ttl          where receipts are kept after the wallet files them
//     businesses/<business>.ttl              the owner's own record of who may deliver
//
// One inbox container per business means a receipt's provenance is the container it was found in: only that
// business could have written there. No database, no index file: the pod is the source of truth.
import { NS, PodStore, discoverAcl, grantAccess, lit, one, ownerRule, parseAcl, parseTurtle, revokeAccess, serializeTurtle, triple, writeAcl, rdfType, type AclRule } from '@skpods/solid-web'
import { parseReceipt, type Receipt } from './receipt'

export const ROOT_PATH = 'skpods/v1/receipts/'

export interface WalletPaths {
  root: string
  inbox: string
  archive: string
  businesses: string
}

export const pathsFor = (storage: string): WalletPaths => {
  const root = `${storage.replace(/\/?$/, '/')}${ROOT_PATH}`
  return { root, inbox: `${root}inbox/`, archive: `${root}archive/`, businesses: `${root}businesses/` }
}

/** Container name for a business, derived from its WebID (`.../~dw-practitioner/profile/card#me` gives `dw-practitioner`). */
export function businessKey(webId: string): string {
  const u = new URL(webId)
  const m = decodeURIComponent(u.pathname).match(/~([^/]+)/)
  const base = (m ? m[1] : u.hostname).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base || 'business'
}

export type BusinessStatus = 'active' | 'stopped'

export interface Business {
  key: string
  name: string
  webId: string
  category?: string
  status: BusinessStatus
  addedAt?: string
  stoppedAt?: string
}

const SCHEMA = NS.schema
export function businessTurtle(b: Business, docUrl: string): string {
  const s = `${docUrl}#business`
  const q = [
    triple(s, rdfType, NS.skp + 'ReceiptIssuer'),
    triple(s, SCHEMA + 'name', lit(b.name)),
    triple(s, SCHEMA + 'sameAs', b.webId),
    triple(s, NS.skp + 'inboxKey', lit(b.key)),
    triple(s, NS.skp + 'status', lit(b.status)),
  ]
  if (b.category) q.push(triple(s, SCHEMA + 'category', lit(b.category)))
  if (b.addedAt) q.push(triple(s, NS.dct + 'created', lit(b.addedAt, NS.xsd + 'dateTime')))
  if (b.stoppedAt) q.push(triple(s, NS.skp + 'stoppedAt', lit(b.stoppedAt, NS.xsd + 'dateTime')))
  return serializeTurtle(q)
}

export function parseBusiness(text: string, url: string): Business | undefined {
  const g = parseTurtle(text, url)
  const s = `${url}#business`
  const webId = one(g, s, SCHEMA + 'sameAs')
  if (!webId) return undefined
  return {
    key: one(g, s, NS.skp + 'inboxKey') ?? businessKey(webId),
    name: one(g, s, SCHEMA + 'name') ?? businessKey(webId),
    webId,
    category: one(g, s, SCHEMA + 'category'),
    status: one(g, s, NS.skp + 'status') === 'stopped' ? 'stopped' : 'active',
    addedAt: one(g, s, NS.dct + 'created'),
    stoppedAt: one(g, s, NS.skp + 'stoppedAt'),
  }
}

export interface Wallet {
  owner: string
  paths: WalletPaths
}

export const inboxOf = (w: Wallet, key: string) => `${w.paths.inbox}${key}/`
export const archiveOf = (w: Wallet, key: string) => `${w.paths.archive}${key}/`

/** Is the wallet set up in this pod? (the root container exists) */
export const walletExists = (store: PodStore, paths: WalletPaths) => store.exists(paths.root)

/**
 * Create the wallet containers. The root gets an explicit owner-only ACL with acl:default so nothing below it can
 * be read by anyone else, whatever the pod's default rules are. Only `writeAcl` is used: a bad ACL bricks a container.
 */
export async function setupWallet(store: PodStore, owner: string, storage: string): Promise<Wallet> {
  const paths = pathsFor(storage)
  await store.ensureContainer(paths.root)
  const acl = await discoverAcl(store, paths.root)
  await writeAcl(store, acl, [ownerRule(owner, paths.root, true)], owner)
  for (const c of [paths.inbox, paths.archive, paths.businesses]) await store.ensureContainer(c)
  // Make the archive discoverable for Solid apps that look things up by type. Best effort: never blocks setup.
  try {
    const idx = (await store.typeIndexUrls(owner)).private
    if (idx) {
      await store.registerType(idx, SCHEMA + 'Invoice', paths.archive)
      await store.registerType(idx, SCHEMA + 'Order', paths.archive)
    }
  } catch {
    /* type index missing or not writable: fine */
  }
  return { owner, paths }
}

export async function loadBusinesses(store: PodStore, w: Wallet): Promise<Business[]> {
  const entries = (await store.list(w.paths.businesses)).filter((e) => !e.isContainer)
  const out = await Promise.all(
    entries.map(async (e) => {
      const r = await store.get(e.url)
      return r ? parseBusiness(r.text, e.url) : undefined
    }),
  )
  return out.filter((b): b is Business => Boolean(b)).sort((a, b) => a.name.localeCompare(b.name))
}

const businessDoc = (w: Wallet, key: string) => `${w.paths.businesses}${key}.ttl`

/** Let a business deliver receipts: create its inbox container and grant it Append (and nothing else). */
export async function addBusiness(store: PodStore, w: Wallet, input: { name: string; webId: string; category?: string }): Promise<Business> {
  if (!/^https?:\/\//.test(input.webId)) throw new Error('A business is identified by its WebID, an http(s) URL.')
  if (input.webId === w.owner) throw new Error('That is your own WebID.')
  const key = businessKey(input.webId)
  await store.ensureContainer(inboxOf(w, key))
  await store.ensureContainer(archiveOf(w, key))
  await grantAccess(store, { resource: inboxOf(w, key), agent: input.webId, modes: ['Append'], owner: w.owner, inherit: true })
  const b: Business = { key, name: input.name.trim() || key, webId: input.webId, category: input.category, status: 'active', addedAt: new Date().toISOString() }
  await store.put(businessDoc(w, key), businessTurtle(b, businessDoc(w, key)))
  return b
}

/** Remove the business's append right. Receipts already delivered stay in the wallet. */
export async function stopBusiness(store: PodStore, w: Wallet, b: Business): Promise<Business> {
  await revokeAccess(store, { resource: inboxOf(w, b.key), agent: b.webId, owner: w.owner })
  const next: Business = { ...b, status: 'stopped', stoppedAt: new Date().toISOString() }
  await store.put(businessDoc(w, b.key), businessTurtle(next, businessDoc(w, b.key)))
  return next
}

export async function resumeBusiness(store: PodStore, w: Wallet, b: Business): Promise<Business> {
  await grantAccess(store, { resource: inboxOf(w, b.key), agent: b.webId, modes: ['Append'], owner: w.owner, inherit: true })
  const next: Business = { ...b, status: 'active', stoppedAt: undefined }
  await store.put(businessDoc(w, b.key), businessTurtle(next, businessDoc(w, b.key)))
  return next
}

/** What the inbox ACL actually says about this business (read from the pod, not from our own bookkeeping). */
export async function inboxRights(store: PodStore, w: Wallet, b: Business): Promise<string[]> {
  const acl = await discoverAcl(store, inboxOf(w, b.key))
  const r = await store.get(acl)
  if (!r) return []
  const rules: AclRule[] = parseAcl(r.text, acl)
  return [...new Set(rules.filter((x) => x.agents.includes(b.webId)).flatMap((x) => x.modes))]
}

// ---------------------------------------------------------------- reading receipts

export type ReceiptCache = Map<string, Receipt>

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k])
      }
    }),
  )
  return out
}

/** Retry transient failures (the engine now and then answers 5xx or resets under parallel load). */
export async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const status = (e as { status?: number }).status
      if (status && status < 500 && status !== 429 && status !== 409) throw e
      await new Promise((r) => setTimeout(r, 250 * (i + 1)))
    }
  }
  throw last
}

const fileOf = (url: string) => decodeURIComponent(url.split('/').pop() ?? url)

export interface LoadResult {
  receipts: Receipt[]
  /** Receipts moved from an inbox to the archive during this load. */
  filed: Receipt[]
  /** Documents that could not be read or are not receipts. */
  skipped: string[]
}

/**
 * Read every receipt of every business. New deliveries in an inbox are filed: copied to the archive, then removed
 * from the inbox (the archive copy is the keeper). The cache is keyed by URL, receipts are immutable once delivered.
 */
export async function loadReceipts(store: PodStore, w: Wallet, businesses: Business[], cache: ReceiptCache, opts: { file?: boolean } = {}): Promise<LoadResult> {
  const filed: Receipt[] = []
  const skipped: string[] = []
  const found = new Map<string, Receipt>() // business/file -> receipt (archive wins)

  await pool(businesses, 4, async (b) => {
    const [inboxItems, archiveItems] = await Promise.all([store.list(inboxOf(w, b.key)), store.list(archiveOf(w, b.key))])
    const archived = new Set(archiveItems.filter((e) => !e.isContainer).map((e) => fileOf(e.url)))
    const readOne = async (url: string): Promise<Receipt | undefined> => {
      const hit = cache.get(url)
      if (hit) return hit
      const r = await retry(() => store.get(url))
      const rec = r ? parseReceipt(r.text, url, b.key) : undefined
      if (!rec) {
        skipped.push(url)
        return undefined
      }
      cache.set(url, rec)
      return rec
    }
    const archivedRecs = await pool(archiveItems.filter((e) => !e.isContainer), 6, (e) => readOne(e.url).catch((err) => (skipped.push(`${e.url}: ${(err as Error).message}`), undefined)))
    for (const r of archivedRecs) if (r) found.set(`${b.key}/${r.file}`, r)

    await pool(inboxItems.filter((e) => !e.isContainer), 6, async (e) => {
      const file = fileOf(e.url)
      try {
        const rec = await readOne(e.url)
        if (!rec) return
        if (archived.has(file)) {
          // Already filed on an earlier run whose delete failed: just clean the inbox.
          if (opts.file) await store.delete(e.url).catch(() => false)
          return
        }
        if (opts.file) {
          const dest = `${archiveOf(w, b.key)}${encodeURIComponent(file).replace(/%2E/g, '.')}`
          await retry(() => store.put(dest, rec.raw))
          const moved: Receipt = { ...rec, url: dest }
          cache.set(dest, moved)
          await store.delete(e.url).catch(() => false)
          filed.push(moved)
          found.set(`${b.key}/${file}`, moved)
        } else found.set(`${b.key}/${file}`, rec)
      } catch (err) {
        skipped.push(`${e.url}: ${(err as Error).message}`)
      }
    })
  })
  const receipts = [...found.values()].sort((a, b) => b.date.getTime() - a.date.getTime())
  return { receipts, filed, skipped }
}

/** Cheap check used by the poller: how many documents wait in the inboxes of these businesses. */
export async function pendingInbox(store: PodStore, w: Wallet, businesses: Business[]): Promise<number> {
  const counts = await pool(businesses, 4, async (b) => (await store.list(inboxOf(w, b.key))).filter((e) => !e.isContainer).length)
  return counts.reduce((a, b) => a + b, 0)
}

export async function resetWallet(store: PodStore, w: Wallet): Promise<void> {
  await store.deleteRecursive(w.paths.root)
}
