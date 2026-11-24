import { discoverAcl, type PodStore } from '@skpods/solid-web'

export interface RawDoc {
  url: string
  status: number
  text?: string
  note?: string
}

/** GET a pod resource as plain text with the viewer's own token. Never throws: the drawer shows what the pod said. */
export async function rawGet(store: PodStore, url: string, accept = 'text/turtle'): Promise<RawDoc> {
  try {
    const r = await store.request(url, { headers: { Accept: accept } })
    return { url, status: r.status, text: r.ok ? r.text : undefined, note: r.ok ? undefined : r.status === 404 ? 'Not there (404)' : r.status === 403 ? 'The pod answered 403: your token has no access to this file' : `HTTP ${r.status}` }
  } catch (e) {
    return { url, status: 0, note: (e as Error).message }
  }
}

/** The ACL document that applies to a resource and its content (undefined text when it has none of its own). */
export async function aclOf(store: PodStore, resource: string): Promise<RawDoc> {
  try {
    const aclUrl = await discoverAcl(store, resource)
    return rawGet(store, aclUrl)
  } catch (e) {
    return { url: resource + '.acl', status: 0, note: (e as Error).message }
  }
}

export const parentContainer = (url: string) => url.replace(/[^/]+$/, '')

import { NS, one } from '@skpods/solid-web'

/** End time of the confirmed booking with this reference in a person's bookings container, if the viewer can read it. */
export async function findBookingEnd(store: PodStore, root: string, ref: string): Promise<Date | undefined> {
  try {
    const entries = await store.list(`${root}skpods/v1/bookings/`)
    for (const e of entries.filter((x) => !x.isContainer && x.url.endsWith('.ttl'))) {
      const g = await store.getTurtle(e.url)
      if (!g) continue
      for (const s of g.getSubjects(NS.rdf + 'type', NS.schema + 'Reservation', null)) {
        if (one(g, s.value, NS.schema + 'identifier') === ref) {
          const end = one(g, s.value, NS.schema + 'endTime')
          if (end) return new Date(end)
        }
      }
    }
  } catch {
    /* no access or no bookings */
  }
  return undefined
}
