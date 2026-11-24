import { NS, PodStore, all, one, parseTurtle, type Store } from '@skpods/solid-web'
import type { Person } from './types'

const cleanName = (n?: string) => (n ?? '').replace(/\s*\(.*?\)\s*/g, ' ').trim()

/** Who this login acts for: yourself plus every skp:Delegation record under skpods/v1/delegations/ in your own pod. */
export async function discoverPeople(store: PodStore, webId: string): Promise<{ root?: string; people: Person[] }> {
  const root = await store.storageRoot(webId).catch(() => undefined)
  let selfName: string | undefined
  try {
    const p = await store.profile(webId)
    selfName = cleanName(one(p, webId, NS.foaf + 'name'))
  } catch {
    /* profile unreadable: fall back to "You" */
  }
  const people: Person[] = [{ webId, name: selfName || 'You', short: selfName ? `${selfName.split(' ')[0]} (you)` : 'You', relation: 'self' }]
  if (!root) return { people }
  let entries: Awaited<ReturnType<PodStore['list']>> = []
  try {
    entries = await store.list(`${root}skpods/v1/delegations/`)
  } catch {
    return { root, people }
  }
  const found = await Promise.all(
    entries
      .filter((e) => !e.isContainer && e.url.endsWith('.ttl'))
      .map(async (e): Promise<Person | undefined> => {
        try {
          const g: Store | undefined = await store.getTurtle(e.url)
          if (!g) return undefined
          const subj = g.getSubjects(NS.rdf + 'type', NS.skp + 'Delegation', null)[0]?.value
          if (!subj) return undefined
          const principal = one(g, subj, NS.skp + 'principal')
          const delegate = one(g, subj, NS.skp + 'delegate')
          if (!principal || delegate !== webId) return undefined
          const role = one(g, subj, NS.skp + 'role') ?? ''
          const name = one(g, subj, NS.schema + 'name') ?? principal
          return { webId: principal, name, short: one(g, subj, NS.schema + 'alternateName') ?? name, relation: role.endsWith('AttorneyInFact') ? 'attorney' : 'parent' }
        } catch {
          return undefined
        }
      }),
  )
  people.push(...(found.filter(Boolean) as Person[]).sort((a, b) => a.name.localeCompare(b.name)))
  return { root, people }
}

export function usePeopleKey(people: Person[]) {
  return people.map((p) => p.webId).join('|')
}

export interface CareEntry {
  id: string
  at: string
  category: string
  author: string
  text: string
}

export function parseCareLog(text: string, url: string): CareEntry[] {
  const g = parseTurtle(text, url)
  const out: CareEntry[] = []
  for (const s of g.getSubjects(NS.rdf + 'type', NS.skp + 'CareLogEntry', null)) {
    out.push({
      id: s.value,
      at: one(g, s.value, NS.schema + 'dateCreated') ?? '',
      category: one(g, s.value, NS.skp + 'category') ?? 'note',
      author: one(g, s.value, NS.schema + 'author') ?? '',
      text: one(g, s.value, NS.schema + 'text') ?? '',
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/** Predicate/object pairs of the first subject, for showing a generic record. */
export function genericRecord(text: string, url: string): Array<[string, string]> {
  const g = parseTurtle(text, url)
  const rows: Array<[string, string]> = []
  for (const q of g.getQuads(null, null, null, null)) {
    const p = q.predicate.value
    if (p === NS.rdf + 'type') continue
    rows.push([p.split(/[#/]/).pop() ?? p, q.object.value])
  }
  return rows
}

export { all }
