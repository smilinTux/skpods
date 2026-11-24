import { DataFactory, Store, Writer, type Quad } from 'n3'
import { NS, all, iri, parseTurtle, rdfType, serializeTurtle } from './turtle'

export class PodError extends Error {
  constructor(message: string, public status: number, public url: string) {
    super(message)
    this.name = 'PodError'
  }
}

export interface PodResponse {
  url: string
  status: number
  ok: boolean
  contentType?: string
  text: string
  headers: Headers
}

export interface ContainerEntry {
  url: string
  isContainer: boolean
}

export interface PatchOps {
  insert?: Quad[]
  delete?: Quad[]
}

const BASIC_CONTAINER = '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'

function n3Quads(quads: Quad[]): string {
  const w = new Writer({ format: 'N-Triples' })
  w.addQuads(quads.map((q) => DataFactory.quad(q.subject, q.predicate, q.object)))
  let out = ''
  w.end((_e, r) => (out = r ?? ""))
  return out
}

/**
 * Solid resource operations over any fetch (session.fetch or an agent's fetch).
 * Engine-specific behaviour is documented in ENGINE-NOTES.md; the defaults here follow what pods-dev accepts:
 * N3 Patch only, no ETag, deep PUT creates parents, containers are created with POST + Link.
 */
export class PodStore {
  constructor(public readonly fetch: typeof globalThis.fetch) {}

  async request(url: string, init: RequestInit = {}): Promise<PodResponse> {
    const res = await this.fetch(url, init)
    const text = init.method === 'HEAD' ? '' : await res.text()
    return { url, status: res.status, ok: res.ok, contentType: res.headers.get('content-type') ?? undefined, text, headers: res.headers }
  }

  private must(r: PodResponse, what: string): PodResponse {
    if (!r.ok) throw new PodError(`${what} failed: ${r.status} ${r.text.slice(0, 160).replace(/\s+/g, ' ')}`, r.status, r.url)
    return r
  }

  /** GET. Resolves to undefined on 404 so callers can treat "not there yet" as a normal state. */
  async get(url: string, accept = 'text/turtle'): Promise<PodResponse | undefined> {
    const r = await this.request(url, { headers: { Accept: accept } })
    if (r.status === 404) return undefined
    return this.must(r, `GET ${url}`)
  }

  async getTurtle(url: string): Promise<Store | undefined> {
    const r = await this.get(url)
    return r ? parseTurtle(r.text, url) : undefined
  }

  async getJson<T = unknown>(url: string): Promise<T | undefined> {
    const r = await this.get(url, 'application/json')
    return r ? (JSON.parse(r.text) as T) : undefined
  }

  /** Existence check by GET: the engine answers 204 to HEAD for resources that do not exist (ENGINE-NOTES.md). */
  async exists(url: string): Promise<boolean> {
    const r = await this.request(url, { headers: { Accept: 'text/turtle' } })
    if (r.status === 404) return false
    this.must(r, `GET ${url}`)
    return true
  }

  /**
   * PUT. Note the engine takes the content type from the file extension on read, so give resources an
   * extension that matches (.ttl, .json, .txt). It creates missing parent containers. A replace answers 201 too.
   */
  async put(url: string, body: string | Uint8Array, contentType = 'text/turtle'): Promise<PodResponse> {
    return this.must(await this.request(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: body as BodyInit }), `PUT ${url}`)
  }

  async putTurtle(url: string, quads: Quad[] | Store): Promise<PodResponse> {
    return this.put(url, serializeTurtle(quads), 'text/turtle')
  }

  /** POST into a container (works with Append-only access). The slug keeps its extension. Returns the new URL. */
  async post(container: string, body: string, opts: { slug?: string; contentType?: string } = {}): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': opts.contentType ?? 'text/turtle' }
    if (opts.slug) headers.Slug = opts.slug
    const r = this.must(await this.request(container, { method: 'POST', headers, body }), `POST ${container}`)
    const loc = r.headers.get('location')
    return loc ? new URL(loc, container).toString() : new URL(opts.slug ?? '', container).toString()
  }

  async postTurtle(container: string, quads: Quad[] | Store, slug?: string): Promise<string> {
    return this.post(container, serializeTurtle(quads), { slug, contentType: 'text/turtle' })
  }

  /**
   * N3 Patch (the only flavour pods-dev accepts: Accept-Patch text/n3). Triples must be concrete: no variables.
   * ENGINE BUG: when a patch clause holds several triples only the LAST one is applied (ENGINE-NOTES.md), so this
   * sends one request per triple, deletes first. Consequence: not atomic. For atomic multi-triple changes use
   * `replaceTurtle` (read, modify, PUT) and accept the lost-update window (the engine has no ETag).
   */
  async patch(url: string, ops: PatchOps): Promise<PodResponse> {
    if (!ops.delete?.length && !ops.insert?.length) throw new Error('patch needs insert or delete')
    let last!: PodResponse
    const send = async (clause: 'deletes' | 'inserts', q: Quad) => {
      const body = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:p a solid:InsertDeletePatch;\nsolid:${clause} {\n${n3Quads([q])}}.\n`
      last = this.must(await this.request(url, { method: 'PATCH', headers: { 'Content-Type': 'text/n3' }, body }), `PATCH ${url}`)
    }
    for (const q of ops.delete ?? []) await send('deletes', q)
    for (const q of ops.insert ?? []) await send('inserts', q)
    return last
  }

  /** Read-modify-write of a Turtle document (non-atomic: no ETag on this engine). */
  async replaceTurtle(url: string, change: (store: Store) => void | Promise<void>): Promise<void> {
    const s = (await this.getTurtle(url)) ?? new Store()
    await change(s)
    await this.putTurtle(url, s)
  }

  async delete(url: string): Promise<boolean> {
    const r = await this.request(url, { method: 'DELETE' })
    if (r.status === 404) return false
    this.must(r, `DELETE ${url}`)
    return true
  }

  /** Children of a container. `.acl` documents are hidden (the engine lists them as contained). */
  async list(container: string): Promise<ContainerEntry[]> {
    const store = await this.getTurtle(container)
    if (!store) return []
    const base = container.endsWith('/') ? container : container + '/'
    return all(store, container, NS.ldp + 'contains')
      .map((u) => new URL(u, base).toString())
      .filter((u) => !u.endsWith('.acl'))
      .map((u) => ({ url: u, isContainer: store.countQuads(iri(u), iri(rdfType), iri(NS.ldp + 'Container'), null) > 0 || u.endsWith('/') }))
  }

  /** Create a container (and missing parents). Existing containers are left alone (PUT on one answers 400). */
  async ensureContainer(url: string): Promise<void> {
    const u = url.endsWith('/') ? url : url + '/'
    if (await this.exists(u)) return
    const parent = new URL('..', u).toString()
    const name = u.slice(parent.length, -1)
    if (parent === u || parent.length < new URL(u).origin.length + 2) throw new PodError(`Cannot create ${u}`, 404, u)
    await this.ensureContainer(parent)
    const r = await this.request(parent, { method: 'POST', headers: { 'Content-Type': 'text/turtle', Slug: name, Link: BASIC_CONTAINER } })
    if (!r.ok && !(await this.exists(u))) this.must(r, `create container ${u}`)
  }

  /** Delete a container and everything in it (children first). Returns the number of resources removed. */
  async deleteRecursive(container: string): Promise<number> {
    let n = 0
    for (const e of await this.list(container)) {
      if (e.isContainer) n += await this.deleteRecursive(e.url)
      else {
        n += (await this.delete(e.url)) ? 1 : 0
        await this.delete(e.url + '.acl').catch(() => false) // child ACLs are not listed but block deleting the container
      }
    }
    // Remove this container's own ACL if present, the engine refuses to delete a container that still has one.
    await this.delete(container.replace(/\/?$/, '/') + '.acl').catch(() => false)
    return n + ((await this.delete(container)) ? 1 : 0)
  }

  // ---- profile and type index ----

  async profile(webId: string): Promise<Store> {
    const s = await this.getTurtle(webId.split('#')[0])
    if (!s) throw new PodError(`No profile at ${webId}`, 404, webId)
    return s
  }

  async storageRoot(webId: string): Promise<string | undefined> {
    return all(await this.profile(webId), webId, NS.pim + 'storage')[0]
  }

  async typeIndexUrls(webId: string): Promise<{ public?: string; private?: string }> {
    const p = await this.profile(webId)
    return { public: all(p, webId, NS.solid + 'publicTypeIndex')[0], private: all(p, webId, NS.solid + 'privateTypeIndex')[0] }
  }

  /** Containers registered for a class in a type index document. */
  async findType(indexUrl: string, forClass: string): Promise<string[]> {
    const s = await this.getTurtle(indexUrl)
    if (!s) return []
    const out: string[] = []
    for (const reg of s.getSubjects(iri(NS.solid + 'forClass'), iri(forClass), null)) {
      out.push(...all(s, reg.value, NS.solid + 'instanceContainer'), ...all(s, reg.value, NS.solid + 'instance'))
    }
    return out
  }

  /** Idempotently register `container` as the home of `forClass`. */
  async registerType(indexUrl: string, forClass: string, container: string): Promise<'added' | 'present'> {
    if ((await this.findType(indexUrl, forClass)).includes(container)) return 'present'
    const id = `${indexUrl}#reg-${(await hash(forClass + container)).slice(0, 10)}`
    const q = [
      { s: id, p: rdfType, o: NS.solid + 'TypeRegistration' },
      { s: id, p: NS.solid + 'forClass', o: forClass },
      { s: id, p: NS.solid + 'instanceContainer', o: container },
    ].map((t) => DataFactory.quad(iri(t.s), iri(t.p), iri(t.o)))
    if (await this.exists(indexUrl)) await this.patch(indexUrl, { insert: q })
    else await this.putTurtle(indexUrl, q)
    return 'added'
  }
}

async function hash(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
