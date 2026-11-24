import { Parser } from 'n3'
import { NS } from './turtle'

/** Read solid:oidcIssuer from a WebID profile document (public read). */
export async function fetchProfileIssuer(webId: string, f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string | undefined> {
  const res = await f(webId.split('#')[0], { headers: { Accept: 'text/turtle' } })
  if (!res.ok) return undefined
  const quads = new Parser({ baseIRI: webId.split('#')[0] }).parse(await res.text())
  const q = quads.find((x) => x.subject.value === webId && x.predicate.value === NS.solid + 'oidcIssuer')
  return q?.object.value.replace(/\/$/, '')
}
