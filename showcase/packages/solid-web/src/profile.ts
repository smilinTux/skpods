import { Parser, type Quad } from 'n3'
import { NS } from './turtle'

export interface ProfileInfo {
  /** The WebID the document describes (the input, or the `#me` subject when a bare profile URL was given). */
  webId: string
  /** solid:oidcIssuer without a trailing slash, if the profile names one. */
  issuer?: string
  /** foaf:name or vcard:fn, if the profile has one. */
  name?: string
}

const strip = (u: string) => u.replace(/\/$/, '')

/**
 * Fetch a WebID profile (public read) and read who it is, where they sign in and their display name.
 * Accepts a full WebID (`.../card#me`) or the profile document URL (`.../card`): then the subject that carries
 * solid:oidcIssuer is used. Returns undefined when the document cannot be read or parsed.
 */
export async function fetchProfile(webIdOrDoc: string, f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<ProfileInfo | undefined> {
  const doc = webIdOrDoc.split('#')[0]
  let quads: Quad[]
  try {
    const res = await f(doc, { headers: { Accept: 'text/turtle' } })
    if (!res.ok) return undefined
    quads = new Parser({ baseIRI: doc }).parse(await res.text())
  } catch {
    return undefined
  }
  const issuerOf = (s: string) => quads.find((x) => x.subject.value === s && x.predicate.value === NS.solid + 'oidcIssuer')?.object.value
  const nameOf = (s: string) =>
    quads.find((x) => x.subject.value === s && (x.predicate.value === NS.foaf + 'name' || x.predicate.value === NS.vcard + 'fn'))?.object.value
  let webId = webIdOrDoc
  if (!webIdOrDoc.includes('#')) {
    // A profile document URL: prefer <#me>, then whichever subject names an issuer.
    const me = `${doc}#me`
    webId = issuerOf(me) ? me : quads.find((x) => x.predicate.value === NS.solid + 'oidcIssuer')?.subject.value ?? webIdOrDoc
  }
  const issuer = issuerOf(webId)
  return { webId, issuer: issuer ? strip(issuer) : undefined, name: nameOf(webId) }
}

/** Read solid:oidcIssuer from a WebID profile document (public read). */
export async function fetchProfileIssuer(webId: string, f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string | undefined> {
  return (await fetchProfile(webId, f))?.issuer
}
