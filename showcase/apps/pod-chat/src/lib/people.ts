import { NS, PodStore, one, type KV } from '@skpods/solid-web'
import type { Person } from './model'
import { slugOf } from './paths'

/** Display names for the pods-dev demo cast (the seeded profiles carry test labels). */
const DEMO_DIRECTORY: Record<string, string> = {
  'dw-alice': 'Alice Rivera',
  'dw-bob': 'Bob Rivera',
  'dw-kid': 'Sam Rivera',
  'dw-grandma': 'Grandma Rosa',
  'dw-practitioner': 'Bayview Family Clinic',
  'dw-care-facility': 'Sunrise Care',
}

export function cleanName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

export function demoCast(issuerOrigin: string, users = (import.meta.env?.VITE_DEMO_CAST as string | undefined) ?? 'dw-alice,dw-bob,dw-kid,dw-grandma,dw-practitioner'): string[] {
  return users.split(',').map((u) => u.trim()).filter(Boolean).map((u) => `${issuerOrigin}/apps/solid/~${u}/profile/card#me`)
}

export class People {
  private cache = new Map<string, Promise<Person>>()
  constructor(private store: PodStore) {}

  resolve(webId: string): Promise<Person> {
    let p = this.cache.get(webId)
    if (!p) {
      p = this.load(webId)
      this.cache.set(webId, p)
    }
    return p
  }

  private async load(webId: string): Promise<Person> {
    const slug = slugOf(webId)
    try {
      const prof = await this.store.profile(webId)
      const raw = one(prof, webId, NS.foaf + 'name') ?? one(prof, webId, NS.vcard + 'fn') ?? slug
      return { webId, name: DEMO_DIRECTORY[slug] ?? (cleanName(raw) || slug), root: one(prof, webId, NS.pim + 'storage') }
    } catch {
      return { webId, name: DEMO_DIRECTORY[slug] ?? slug }
    }
  }

  async rootOf(webId: string): Promise<string> {
    const p = await this.resolve(webId)
    if (!p.root) {
      this.cache.delete(webId)
      const again = await this.resolve(webId)
      if (!again.root) throw new Error(`No pod storage found for ${webId}`)
      return again.root
    }
    return p.root
  }
}

export type { KV }
