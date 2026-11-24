import { DataFactory, Parser, Store, Writer, type Quad, type Term } from 'n3'

const { namedNode, literal, quad, blankNode } = DataFactory

export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  ldp: 'http://www.w3.org/ns/ldp#',
  acl: 'http://www.w3.org/ns/auth/acl#',
  solid: 'http://www.w3.org/ns/solid/terms#',
  pim: 'http://www.w3.org/ns/pim/space#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  vcard: 'http://www.w3.org/2006/vcard/ns#',
  schema: 'http://schema.org/',
  dct: 'http://purl.org/dc/terms/',
  /** SKPods showcase vocabulary, see showcase/vocab/skpods-showcase.ttl. */
  skp: 'https://w3id.org/skpods/v1#',
} as const

export const PREFIXES: Record<string, string> = { ...NS }

export function parseTurtle(text: string, baseIRI?: string): Store {
  const store = new Store()
  store.addQuads(new Parser({ baseIRI }).parse(text))
  return store
}

export function serializeTurtle(quads: Quad[] | Store, prefixes: Record<string, string> = PREFIXES): string {
  const list = Array.isArray(quads) ? quads : quads.getQuads(null, null, null, null)
  const w = new Writer({ prefixes })
  w.addQuads(list)
  let out = ''
  w.end((_e, r) => (out = r ?? ""))
  return out
}

/** Quad builder: object as string starting with http(s) is an IRI, anything else a plain literal; pass a Term for full control. */
export function triple(s: string, p: string, o: string | number | boolean | Date | Term): Quad {
  let obj: Term
  if (typeof o === 'object' && 'termType' in o) obj = o
  else if (o instanceof Date) obj = literal(o.toISOString(), namedNode(NS.xsd + 'dateTime'))
  else if (typeof o === 'number') obj = literal(String(o), namedNode(NS.xsd + (Number.isInteger(o) ? 'integer' : 'decimal')))
  else if (typeof o === 'boolean') obj = literal(String(o), namedNode(NS.xsd + 'boolean'))
  else obj = /^https?:\/\//.test(o) ? namedNode(o) : literal(o)
  return quad(namedNode(s), namedNode(p), obj as any)
}

export const iri = (v: string) => namedNode(v)
export const lit = (v: string, datatype?: string) => (datatype ? literal(v, namedNode(datatype)) : literal(v))
export const bnode = () => blankNode()
export const rdfType = NS.rdf + 'type'

/** First object value for (s, p), or undefined. */
export function one(store: Store, s: string, p: string): string | undefined {
  return store.getObjects(namedNode(s), namedNode(p), null)[0]?.value
}
export function all(store: Store, s: string, p: string): string[] {
  return store.getObjects(namedNode(s), namedNode(p), null).map((t) => t.value)
}
