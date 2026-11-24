// Turtle encoding of chat resources, and the file naming scheme.
//
// Why files are named like this: the engine has no ETag and no notifications, so the ONLY cheap change signal is
// a container listing. Every state change is therefore a new or a removed file name:
//   m-<id>.ttl            one message                      (id = 13 digit epoch ms, dash, 6 chars)
//   s-<first>-<last>-<t>  a segment: many old messages of one author rolled into one file (fast first load)
//   e-<id>-<epochms>.ttl  an edit of message <id>; the newest edit wins
//   a-<id>.<ext>          an image attachment of message <id>
//   r-<id>.ttl            read receipt: the author has seen everything up to message <id>
//   conversation.ttl      this participant's mirror of the conversation descriptor
//   left.ttl              present once the participant has left (their only resource others can still read)
// Every file is immutable once written, so a fetched body can be cached forever by its URL.
import { DataFactory, Store, type Quad, type Term } from 'n3'
import { NS, iri, lit, one, all, parseTurtle, rdfType, serializeTurtle } from '@skpods/solid-web'

const { quad } = DataFactory
const S = NS.schema
const XSD = NS.xsd
const dt = (iso: string) => lit(iso, XSD + 'dateTime')
const int = (n: number) => lit(String(Math.round(n)), XSD + 'integer')
const q = (s: string, p: string, o: Term): Quad => quad(iri(s), iri(p), o as any) as Quad

export interface Attachment {
  url: string
  type: string
  width?: number
  height?: number
}
export interface RawMessage {
  id: string
  author: string
  text: string
  createdAt: number
  attachment?: Attachment
}
export interface RawEdit {
  id: string
  text: string
  at: number
}
export interface ConvMeta {
  id: string
  title: string
  kind: 'direct' | 'group'
  creator: string
  participants: string[]
  createdAt: number
  /** 32 lowercase hex, absent on conversations made before the relay existed (they poll only). */
  relayRoom?: string
}

/** A fresh 128-bit relay room id. It is a capability: it lives only in the descriptor. */
export function newRelayRoom(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const IDRE = '(\\d{13}-[a-z0-9]{6})'
const RX = {
  message: new RegExp(`^m-${IDRE}\\.ttl$`),
  edit: new RegExp(`^e-${IDRE}-(\\d{13})\\.ttl$`),
  segment: /^s-(\d{13})-(\d{13})-[a-z0-9]{4}\.ttl$/,
  receipt: new RegExp(`^r-${IDRE}\\.ttl$`),
  attachment: new RegExp(`^a-${IDRE}\\.([a-z0-9]{2,5})$`),
}

export type FileKind =
  | { kind: 'message'; id: string }
  | { kind: 'edit'; id: string; at: number }
  | { kind: 'segment'; first: number; last: number }
  | { kind: 'receipt'; upTo: string }
  | { kind: 'attachment'; id: string; ext: string }
  | { kind: 'left' }
  | { kind: 'descriptor' }
  | { kind: 'other' }

export function classify(name: string): FileKind {
  let m: RegExpMatchArray | null
  if ((m = name.match(RX.message))) return { kind: 'message', id: m[1] }
  if ((m = name.match(RX.edit))) return { kind: 'edit', id: m[1], at: Number(m[2]) }
  if ((m = name.match(RX.segment))) return { kind: 'segment', first: Number(m[1]), last: Number(m[2]) }
  if ((m = name.match(RX.receipt))) return { kind: 'receipt', upTo: m[1] }
  if ((m = name.match(RX.attachment))) return { kind: 'attachment', id: m[1], ext: m[2] }
  if (name === 'left.ttl') return { kind: 'left' }
  if (name === 'conversation.ttl') return { kind: 'descriptor' }
  return { kind: 'other' }
}

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join('')
export const newMessageId = (at = Date.now()) => `${String(at).padStart(13, '0')}-${rand(6)}`
export const idTime = (id: string) => Number(id.slice(0, 13))
/** Total order of messages: by send time, ties by the random part. */
export const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
export const messageFile = (id: string) => `m-${id}.ttl`
export const editFile = (id: string, at: number) => `e-${id}-${String(at).padStart(13, '0')}.ttl`
export const receiptFile = (id: string) => `r-${id}.ttl`
export const attachmentFile = (id: string, ext: string) => `a-${id}.${ext}`
export const segmentFile = (first: number, last: number) => `s-${String(first).padStart(13, '0')}-${String(last).padStart(13, '0')}-${rand(4)}.ttl`
export const newConversationId = () => `c-${rand(10)}`

function messageQuads(fileUrl: string, m: RawMessage): Quad[] {
  const s = `${fileUrl}#${m.id}`
  const out = [
    q(s, rdfType, iri(S + 'Message')),
    q(s, S + 'identifier', lit(m.id)),
    q(s, S + 'author', iri(m.author)),
    q(s, S + 'text', lit(m.text)),
    q(s, S + 'dateCreated', dt(new Date(m.createdAt).toISOString())),
  ]
  if (m.attachment) {
    const a = m.attachment
    out.push(q(s, S + 'image', iri(a.url)), q(a.url, rdfType, iri(S + 'ImageObject')), q(a.url, S + 'encodingFormat', lit(a.type)))
    if (a.width) out.push(q(a.url, S + 'width', int(a.width)))
    if (a.height) out.push(q(a.url, S + 'height', int(a.height)))
  }
  return out
}

export const encodeMessage = (fileUrl: string, m: RawMessage) => serializeTurtle(messageQuads(fileUrl, m))
export const encodeSegment = (fileUrl: string, ms: RawMessage[]) => serializeTurtle(ms.flatMap((m) => messageQuads(fileUrl, m)))

export function decodeMessages(text: string, fileUrl: string): RawMessage[] {
  const st = parseTurtle(text, fileUrl)
  const out: RawMessage[] = []
  for (const sub of st.getSubjects(iri(rdfType), iri(S + 'Message'), null)) {
    const id = one(st, sub.value, S + 'identifier')
    const author = one(st, sub.value, S + 'author')
    if (!id || !author) continue
    const img = one(st, sub.value, S + 'image')
    const created = Date.parse(one(st, sub.value, S + 'dateCreated') ?? '') || idTime(id)
    const msg: RawMessage = { id, author, text: one(st, sub.value, S + 'text') ?? '', createdAt: created }
    if (img) {
      const w = Number(one(st, img, S + 'width'))
      const h = Number(one(st, img, S + 'height'))
      msg.attachment = { url: img, type: one(st, img, S + 'encodingFormat') ?? 'image/jpeg', width: w || undefined, height: h || undefined }
    }
    out.push(msg)
  }
  return out
}

export function encodeEdit(fileUrl: string, e: RawEdit, author: string): string {
  const s = fileUrl + '#edit'
  return serializeTurtle([q(s, rdfType, iri(NS.skp + 'MessageEdit')), q(s, NS.skp + 'edits', lit(e.id)), q(s, S + 'author', iri(author)), q(s, S + 'text', lit(e.text)), q(s, S + 'dateModified', dt(new Date(e.at).toISOString()))])
}
export function decodeEdit(text: string, fileUrl: string): RawEdit | undefined {
  const st = parseTurtle(text, fileUrl)
  const s = fileUrl + '#edit'
  const id = one(st, s, NS.skp + 'edits')
  if (!id) return undefined
  return { id, text: one(st, s, S + 'text') ?? '', at: Date.parse(one(st, s, S + 'dateModified') ?? '') || 0 }
}

export function encodeReceipt(fileUrl: string, reader: string, upTo: string, at = Date.now()): string {
  const s = fileUrl + '#receipt'
  return serializeTurtle([q(s, rdfType, iri(NS.skp + 'ReadReceipt')), q(s, S + 'agent', iri(reader)), q(s, NS.skp + 'readUpTo', lit(upTo)), q(s, S + 'dateRead', dt(new Date(at).toISOString()))])
}

export function encodeLeft(fileUrl: string, who: string, at = Date.now()): string {
  const s = fileUrl + '#left'
  return serializeTurtle([q(s, rdfType, iri(NS.skp + 'LeaveNotice')), q(s, S + 'agent', iri(who)), q(s, S + 'dateCreated', dt(new Date(at).toISOString()))])
}
export function decodeLeft(text: string, fileUrl: string): number {
  return Date.parse(one(parseTurtle(text, fileUrl), fileUrl + '#left', S + 'dateCreated') ?? '') || 0
}

export function encodeConversation(fileUrl: string, c: ConvMeta): string {
  const s = fileUrl + '#conversation'
  const dc = 'http://purl.org/dc/terms/'
  return serializeTurtle([
    q(s, rdfType, iri(NS.skp + 'Conversation')),
    q(s, S + 'identifier', lit(c.id)),
    q(s, S + 'name', lit(c.title)),
    q(s, NS.skp + 'kind', lit(c.kind)),
    q(s, dc + 'creator', iri(c.creator)),
    q(s, dc + 'created', dt(new Date(c.createdAt).toISOString())),
    ...c.participants.map((p) => q(s, NS.skp + 'participant', iri(p))),
    ...(c.relayRoom ? [q(s, NS.skp + 'relayRoom', lit(c.relayRoom))] : []),
  ])
}
export function decodeConversation(text: string, fileUrl: string): ConvMeta | undefined {
  const st = parseTurtle(text, fileUrl)
  const s = fileUrl + '#conversation'
  const id = one(st, s, S + 'identifier')
  const creator = one(st, s, 'http://purl.org/dc/terms/creator')
  if (!id || !creator) return undefined
  const participants = all(st, s, NS.skp + 'participant')
  const room = one(st, s, NS.skp + 'relayRoom')
  return {
    id,
    title: one(st, s, S + 'name') ?? '',
    kind: one(st, s, NS.skp + 'kind') === 'direct' ? 'direct' : 'group',
    creator,
    participants: participants.includes(creator) ? participants : [creator, ...participants],
    createdAt: Date.parse(one(st, s, 'http://purl.org/dc/terms/created') ?? '') || 0,
    relayRoom: room && /^[0-9a-f]{32}$/.test(room) ? room : undefined,
  }
}

export interface Invitation {
  /** URL of the invitation file in my inbox. */
  url: string
  descriptor: string
  sender: string
  title: string
  kind: 'direct' | 'group'
  at: number
}
export function encodeInvitation(fileUrl: string, d: { descriptor: string; sender: string; title: string; kind: 'direct' | 'group'; at?: number }): string {
  const s = fileUrl + '#invite'
  return serializeTurtle([
    q(s, rdfType, iri(NS.skp + 'ChatInvitation')),
    q(s, NS.skp + 'conversation', iri(d.descriptor)),
    q(s, S + 'sender', iri(d.sender)),
    q(s, S + 'name', lit(d.title)),
    q(s, NS.skp + 'kind', lit(d.kind)),
    q(s, S + 'dateCreated', dt(new Date(d.at ?? Date.now()).toISOString())),
  ])
}
export function decodeInvitation(text: string, fileUrl: string): Invitation | undefined {
  const st = parseTurtle(text, fileUrl)
  const s = fileUrl + '#invite'
  const descriptor = one(st, s, NS.skp + 'conversation')
  const sender = one(st, s, S + 'sender')
  if (!descriptor || !sender) return undefined
  return { url: fileUrl, descriptor, sender, title: one(st, s, S + 'name') ?? 'Conversation', kind: one(st, s, NS.skp + 'kind') === 'direct' ? 'direct' : 'group', at: Date.parse(one(st, s, S + 'dateCreated') ?? '') || 0 }
}

/** Children URLs of a container listing (`.acl` hidden). */
export function listChildren(text: string, containerUrl: string): string[] {
  const st: Store = parseTurtle(text, containerUrl)
  const base = containerUrl.endsWith('/') ? containerUrl : containerUrl + '/'
  return all(st, containerUrl, NS.ldp + 'contains')
    .map((u) => new URL(u, base).toString())
    .filter((u) => !u.endsWith('.acl'))
}

export const nameOf = (url: string) => decodeURIComponent(url.replace(/\/$/, '').split('/').pop() ?? url)
