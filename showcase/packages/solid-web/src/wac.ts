import { DataFactory, Store, type Quad } from 'n3'
import { NS, all, iri, parseTurtle, rdfType, serializeTurtle } from './turtle'
import type { PodStore } from './store'

export type AccessMode = 'Read' | 'Write' | 'Append' | 'Control'

export interface AclRule {
  /** Fragment id, e.g. "owner" or "grant-bob". */
  id: string
  agents: string[]
  agentClasses: string[]
  /** acl:agentGroup. NOT enforced by pods-dev (see ENGINE-NOTES.md): do not rely on it. */
  agentGroups: string[]
  modes: AccessMode[]
  accessTo: string[]
  /** acl:default: inherited by children of this container. */
  defaultFor: string[]
}

export const PUBLIC_CLASS = 'http://xmlns.com/foaf/0.1/Agent'
export const AUTHENTICATED_CLASS = NS.acl + 'AuthenticatedAgent'

const ALL_MODES: AccessMode[] = ['Read', 'Write', 'Append', 'Control']

/** The effective ACL document URL of a resource, from `Link: <...>; rel="acl"`. */
export async function discoverAcl(store: PodStore, resource: string): Promise<string> {
  const r = await store.request(resource, { method: 'HEAD' })
  if (r.status >= 400 && r.status !== 403) throw new Error(`Cannot discover ACL for ${resource}: ${r.status}`)
  const link = r.headers.get('link') ?? ''
  for (const part of splitLinks(link)) {
    const m = part.match(/^<([^>]*)>(.*)$/)
    if (m && /rel="?([^";]*\s)?acl(\s[^";]*)?"?/.test(m[2])) return new URL(m[1], resource).toString()
  }
  // Convention fallback (Solid WAC): resource + ".acl"
  return resource + '.acl'
}

function splitLinks(h: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of h) {
    if (ch === '<') depth++
    if (ch === '>') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function parseAcl(text: string, aclUrl: string): AclRule[] {
  const s = parseTurtle(text, aclUrl)
  const rules: AclRule[] = []
  for (const sub of s.getSubjects(iri(rdfType), iri(NS.acl + 'Authorization'), null)) {
    const id = sub.value.includes('#') ? sub.value.split('#')[1] : sub.value
    rules.push({
      id,
      agents: all(s, sub.value, NS.acl + 'agent'),
      agentClasses: all(s, sub.value, NS.acl + 'agentClass'),
      agentGroups: all(s, sub.value, NS.acl + 'agentGroup'),
      modes: all(s, sub.value, NS.acl + 'mode').map((m) => m.replace(NS.acl, '') as AccessMode),
      accessTo: all(s, sub.value, NS.acl + 'accessTo'),
      defaultFor: all(s, sub.value, NS.acl + 'default'),
    })
  }
  return rules
}

/** Serialize with absolute IRIs only (the engine resolves relative ones too, but absolute is unambiguous). */
export function serializeAcl(rules: AclRule[], aclUrl: string): string {
  const { namedNode, quad } = DataFactory
  const qs: Quad[] = []
  for (const r of rules) {
    const s = namedNode(`${aclUrl}#${r.id}`)
    const add = (p: string, o: string) => qs.push(quad(s, namedNode(p), namedNode(o)))
    add(rdfType, NS.acl + 'Authorization')
    r.agents.forEach((a) => add(NS.acl + 'agent', a))
    r.agentClasses.forEach((a) => add(NS.acl + 'agentClass', a))
    r.agentGroups.forEach((a) => add(NS.acl + 'agentGroup', a))
    r.accessTo.forEach((a) => add(NS.acl + 'accessTo', a))
    r.defaultFor.forEach((a) => add(NS.acl + 'default', a))
    r.modes.forEach((m) => add(NS.acl + 'mode', NS.acl + m))
  }
  return serializeTurtle(qs)
}

/** The rules of a resource's OWN acl document, or undefined if it has none (404). */
export async function readAcl(store: PodStore, aclUrl: string): Promise<AclRule[] | undefined> {
  const r = await store.get(aclUrl)
  return r ? parseAcl(r.text, aclUrl) : undefined
}

export function ownerRule(owner: string, resource: string, isContainer: boolean): AclRule {
  return { id: 'owner', agents: [owner], agentClasses: [], agentGroups: [], modes: [...ALL_MODES].filter((m) => m !== 'Append'), accessTo: [resource], defaultFor: isContainer ? [resource] : [] }
}

/**
 * Write an ACL document. Guards against two engine traps (ENGINE-NOTES.md):
 * - a document that is not valid Turtle answers 500 and bricks the container, so we parse before sending;
 * - a document without a Control rule for the owner locks the owner out (403 forever), so we refuse it.
 */
export async function writeAcl(store: PodStore, aclUrl: string, rules: AclRule[], owner: string): Promise<void> {
  const text = serializeAcl(rules, aclUrl)
  parseAcl(text, aclUrl) // throws on invalid turtle
  const ownerHasControl = rules.some((r) => r.agents.includes(owner) && r.modes.includes('Control'))
  if (!ownerHasControl) throw new Error('Refusing to write an ACL that gives the owner no Control: it would lock the owner out')
  await store.put(aclUrl, text, 'text/turtle')
}

export interface GrantOptions {
  resource: string
  agent: string
  modes: AccessMode[]
  owner: string
  /** Also set acl:default so children inherit (containers). */
  inherit?: boolean
}

const grantId = (agent: string) => 'grant-' + Array.from(agent).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 7).toString(36).replace('-', 'n')

/** Give `agent` the modes on `resource` (merging with an existing grant for the same agent). */
export async function grantAccess(store: PodStore, o: GrantOptions): Promise<string> {
  const isContainer = o.resource.endsWith('/')
  const aclUrl = await discoverAcl(store, o.resource)
  const existing = (await readAcl(store, aclUrl)) ?? [ownerRule(o.owner, o.resource, isContainer)]
  const id = grantId(o.agent)
  const rule = existing.find((r) => r.id === id) ?? { id, agents: [o.agent], agentClasses: [], agentGroups: [], modes: [], accessTo: [o.resource], defaultFor: [] }
  rule.modes = [...new Set([...rule.modes, ...o.modes])]
  if (o.inherit && isContainer && !rule.defaultFor.includes(o.resource)) rule.defaultFor.push(o.resource)
  await writeAcl(store, aclUrl, [...existing.filter((r) => r.id !== id), rule], o.owner)
  return aclUrl
}

/** Remove every rule that names `agent` (the owner's own rule is never touched). */
export async function revokeAccess(store: PodStore, o: { resource: string; agent: string; owner: string }): Promise<boolean> {
  if (o.agent === o.owner) throw new Error('Cannot revoke the owner')
  const aclUrl = await discoverAcl(store, o.resource)
  const existing = await readAcl(store, aclUrl)
  if (!existing) return false
  const next = existing
    .map((r) => ({ ...r, agents: r.agents.filter((a) => a !== o.agent) }))
    .filter((r) => r.agents.length || r.agentClasses.length || r.agentGroups.length)
  if (next.length === existing.length && next.every((r, i) => r.agents.length === existing[i].agents.length)) return false
  await writeAcl(store, aclUrl, next, o.owner)
  return true
}

/** Parse a WAC-Allow header: `user="read write",public="read"` into mode lists. */
export function parseWacAllow(h: string | null | undefined): { user: string[]; public: string[] } {
  const out = { user: [] as string[], public: [] as string[] }
  for (const m of (h ?? '').matchAll(/(user|public)="([^"]*)"/g)) out[m[1] as 'user' | 'public'] = m[2].split(/\s+/).filter(Boolean)
  return out
}
export type { Store }
