// The chat engine. No React, no DOM requirement (it runs in Node for the integration tests).
//
// Model: every participant writes ONLY into their own pod (/skpods/v1/chat/<id>/) and grants the others Read.
// The engine reads every participant's container, merges the streams by send time, and polls with backoff.
// The pod server has no ETag and no notifications, so a "change" is a different set of file names in a listing.
import { PodStore } from '@skpods/solid-web'
import {
  attachmentFile, classify, compareIds, decodeConversation, decodeEdit, decodeInvitation, decodeLeft, decodeMessages, editFile, encodeConversation,
  encodeEdit, encodeInvitation, encodeLeft, encodeMessage, encodeReceipt, encodeSegment, listChildren, messageFile, nameOf, newConversationId,
  newMessageId, newRelayRoom, receiptFile, segmentFile, type ConvMeta, type Invitation, type RawEdit, type RawMessage,
} from './codec'
import { FileCache } from './cache'
import type { Ghost, Item, Msg, PeerStatus, PeerView, Person } from './model'
import { chatRoot, convUrl, descriptorUrl, inboxUrl, leftUrl, slugOf } from './paths'
import { People } from './people'
import { ensureInbox, revokeConversationAcl, writeConversationAcl, writeLeaveNoticeAcl } from './setup'
import { RELAY_LIVE_TIMING, type PingKind, type QueuedItem, type RelayClient, type ServerPing } from './relay'
import { layout, mergeEntries, nextInterval, unreadCount } from './timeline'

export interface PreparedUpload {
  blob: Blob
  type: string
  ext: string
  width: number
  height: number
  previewUrl?: string
}

export interface Toast {
  title: string
  description?: string
  tone?: 'info' | 'success' | 'error' | 'warn'
}

export interface EngineOptions {
  store: PodStore
  me: string
  contacts?: string[]
  cache?: FileCache
  onToast?: (t: Toast) => void
  /** false: no background timers at all, the caller drives polling with refresh() (tests). Default true. */
  autoPoll?: boolean
  /** Poll timing (ms). Foreground conversation vs the rest. */
  timing?: { activeBase: number; activeMax: number; idleBase: number; idleMax: number; hiddenPeerRecheck: number; indexEvery: number }
  /** Optional push hints. A conversation whose relay room socket is live polls at RELAY_LIVE_TIMING; every other one, and every one without a relay room, keeps `timing`. */
  relay?: RelayClient
}

export const DEFAULT_TIMING = { activeBase: 2000, activeMax: 12000, idleBase: 12000, idleMax: 45000, hiddenPeerRecheck: 8000, indexEvery: 10000 }

type Parsed = { kind: 'messages'; msgs: RawMessage[] } | { kind: 'edit'; edit: RawEdit }

interface Inventory {
  loose: Map<string, string> // message id -> file url
  segmentOf: Map<string, string> // message id -> segment url
  edits: Map<string, string[]>
  attachments: Map<string, string>
  receipts: string[]
  hasLeft: boolean
}
const emptyInv = (): Inventory => ({ loose: new Map(), segmentOf: new Map(), edits: new Map(), attachments: new Map(), receipts: [], hasLeft: false })

interface Peer {
  webId: string
  status: PeerStatus
  leftAt?: number
  sig?: string
  parsed: Map<string, Parsed>
  inv: Inventory
  msgs: Msg[]
  ghosts: Ghost[]
  readUpTo?: string
  lastOk?: number
  error?: string
  nextCheck: number
  loaded: boolean
}

interface Conv {
  meta: ConvMeta
  peers: Map<string, Peer>
  pending: Msg[]
  recent: Map<string, Msg>
  editOverlay: Map<string, { text: string; at: number }>
  deleteOverlay: Set<string>
  interval: number
  timer?: ReturnType<typeof setTimeout>
  polling: boolean
  lastPollAt?: number
  lastPollOk: boolean
  localRead?: string
  receiptTimer?: ReturnType<typeof setTimeout>
  compacting: boolean
  stopped: boolean
  /** Leaves the relay room; set while joined. */
  relayOff?: () => void
  /** A relay hint arrived while a poll was in flight: poll once more when it ends, the change may be newer. */
  hinted?: boolean
}

export interface ConvSummary {
  id: string
  title: string
  kind: 'direct' | 'group'
  members: Person[]
  last?: { text: string; at: number; author: string; mine: boolean; image: boolean }
  unread: number
  left: boolean
  lastActivity: number
  loading: boolean
}

export interface ConvDetail {
  meta: ConvMeta
  title: string
  members: Person[]
  items: Item[]
  peers: (PeerView & { name: string; count: number; root?: string; error?: string })[]
  left: boolean
  leftAt?: number
  myContainer: string
  unread: number
  loading: boolean
}

export interface LiveState {
  kind: 'live' | 'offline'
  lastOkAt?: number
  everyMs: number
  /** This conversation's relay room is live: changes arrive as pings, polling is only the safety net. */
  push: boolean
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

export class ChatEngine {
  readonly store: PodStore
  readonly me: string
  readonly people: People
  private cache: FileCache
  private baseTiming: NonNullable<EngineOptions['timing']>
  private relay?: RelayClient
  private relayOffs: (() => void)[] = []
  private convs = new Map<string, Conv>()
  private invites: Invitation[] = []
  private inviteSeen = new Set<string>()
  private persons = new Map<string, Person>()
  private contactList: string[]
  private listeners = new Set<() => void>()
  private version = 0
  private activeId?: string
  private indexTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private auto: boolean
  private myRoot = ''
  private memo = new Map<string, { v: number; value: unknown }>()
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
  /** Last poll events, newest last. For debugging only (window.__podchat.debugLog in dev builds). */
  debugLog: string[] = []
  private trace(s: string) {
    this.debugLog.push(`${new Date().toISOString().slice(11, 23)} ${s}`)
    if (this.debugLog.length > 120) this.debugLog.shift()
  }
  error?: string
  onToast?: (t: Toast) => void
  /** Called for a message from someone else that arrives while its conversation is not the visible one. */
  onIncoming?: (c: { convId: string; title: string; author: string; text: string }) => void

  constructor(o: EngineOptions) {
    this.store = o.store
    this.me = o.me
    this.people = new People(o.store)
    this.cache = o.cache ?? FileCache.forUser(o.me)
    this.onToast = o.onToast
    this.contactList = [...(o.contacts ?? [])]
    this.baseTiming = o.timing ?? DEFAULT_TIMING
    this.relay = o.relay
    this.auto = o.autoPoll !== false
  }

  /** True when this conversation has a relay room and that room's socket is live. Old conversations never are. */
  private pushed(c: Conv): boolean {
    return !!this.relay && !!c.meta.relayRoom && this.relay.roomState(c.meta.relayRoom) === 'live'
  }

  /** Poll timing for one conversation right now: slower while its relay room is live, the normal timing otherwise. */
  private timingFor(c: Conv): NonNullable<EngineOptions['timing']> {
    return this.pushed(c) ? { ...this.baseTiming, ...RELAY_LIVE_TIMING } : this.baseTiming
  }

  private baseInterval(c: Conv): number {
    const t = this.timingFor(c)
    return c.meta.id === this.activeId ? t.activeBase : t.idleBase
  }

  // ---------- relay (optional) ----------
  private attachRelay() {
    const relay = this.relay
    if (!relay) return
    this.detachRelay()
    this.relayOffs.push(relay.onRoomState((room) => this.retime(room)), relay.onQueued((items) => this.onQueued(items)))
    for (const c of this.convs.values()) this.joinRoom(c)
  }

  private detachRelay() {
    for (const off of this.relayOffs.splice(0)) off()
    for (const c of this.convs.values()) this.leaveRoom(c)
  }

  /** A descriptor without relayRoom means polling only: never join for it. */
  private joinRoom(c: Conv) {
    if (!this.relay || !c.meta.relayRoom || c.relayOff || this.stopped) return
    try {
      c.relayOff = this.relay.join(c.meta.relayRoom, (p) => this.onPing(c, p))
    } catch {
      /* a malformed room id: polling only */
    }
  }

  private leaveRoom(c: Conv) {
    c.relayOff?.()
    c.relayOff = undefined
  }

  /** A ping is only a hint about which conversation to re-read, and only from someone in it. */
  private isParticipant(c: Conv, from: string) {
    return c.meta.participants.includes(from)
  }

  private onPing(c: Conv, p: ServerPing) {
    if (this.stopped || c.stopped || !this.isParticipant(c, p.from)) return
    this.trace(`ping ${c.meta.id} ${p.kind}`)
    this.hint(c)
  }

  private hint(c: Conv) {
    if (c.polling) c.hinted = true
    else this.kick(c)
  }

  private onQueued(items: QueuedItem[]) {
    if (this.stopped) return
    const hit = new Set<Conv>()
    for (const i of items) {
      const c = [...this.convs.values()].find((x) => x.meta.relayRoom === i.room)
      if (c && !c.stopped && this.isParticipant(c, i.from)) hit.add(c)
    }
    for (const c of hit) this.hint(c)
  }

  private publish(c: Conv, kind: PingKind, url: string) {
    if (this.relay && c.meta.relayRoom) this.relay.publish(c.meta.relayRoom, kind, url)
  }

  /** A room socket changed state: the conversations in that room restart their backoff from the base of the timing that now applies. */
  private retime(room: string) {
    let hit = false
    for (const c of this.convs.values()) {
      if (c.meta.relayRoom !== room) continue
      hit = true
      c.interval = this.baseInterval(c)
      if (this.auto && !c.polling) this.schedule(c)
    }
    if (hit) this.emit()
  }

  /** Throttled typing hint for a conversation (at most one per 3 s). No-op without a relay room. */
  typing(convId: string) {
    const room = this.convs.get(convId)?.meta.relayRoom
    if (room) this.relay?.typing(room)
  }

  // ---------- subscription ----------
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  getVersion = () => this.version
  private emit() {
    this.version++
    for (const l of this.listeners) l()
  }
  private memoized<T>(key: string, fn: () => T): T {
    const m = this.memo.get(key)
    if (m && m.v === this.version) return m.value as T
    const value = fn()
    this.memo.set(key, { v: this.version, value })
    return value
  }

  // ---------- people ----------
  person(webId: string): Person {
    return this.persons.get(webId) ?? { webId, name: slugOf(webId) }
  }
  private async learn(webIds: string[]) {
    const todo = webIds.filter((w) => !this.persons.has(w))
    if (!todo.length) return
    await Promise.all(todo.map(async (w) => this.persons.set(w, await this.people.resolve(w))))
    this.emit()
  }
  get contacts(): Person[] {
    return this.contactList.map((w) => this.person(w))
  }
  async addContact(webId: string): Promise<Person> {
    const id = webId.trim()
    if (!/^https?:\/\/.+#.+/.test(id)) throw new Error('A WebID looks like https://pod.example/profile/card#me')
    const p = await this.people.resolve(id)
    if (!p.root) throw new Error('That WebID has no pod storage, or its profile is not public')
    this.persons.set(id, p)
    if (!this.contactList.includes(id)) this.contactList.push(id)
    await ensureInbox(this.store, this.me, this.myRoot, this.contactList).catch(() => {})
    this.emit()
    return p
  }

  // ---------- lifecycle ----------
  async start(): Promise<void> {
    // React StrictMode (dev) runs effect, cleanup, effect: stop() followed by start() must fully revive the engine.
    this.stopped = false
    clearTimeout(this.indexTimer)
    for (const c of this.convs.values()) c.stopped = false
    this.attachRelay()
    this.status = 'loading'
    this.emit()
    try {
      const me = await this.people.resolve(this.me)
      if (!me.root) throw new Error('Your profile does not say where your pod is (pim:storage)')
      this.persons.set(this.me, me)
      this.myRoot = me.root
      await this.learn(this.contactList)
      await this.pollIndex()
      this.status = 'ready'
      this.emit()
      // pod setup (inbox so others can invite me) runs in the background, it is not needed to read
      void ensureInbox(this.store, this.me, this.myRoot, this.contactList).catch((e) => this.onToast?.({ title: 'Invitations are not set up', description: String(e.message ?? e), tone: 'warn' }))
      if (this.auto) {
        this.scheduleIndex()
        for (const c of this.convs.values()) this.schedule(c)
      }
    } catch (e) {
      this.status = 'error'
      this.error = (e as Error).message
      this.emit()
    }
  }

  stop() {
    this.stopped = true
    this.detachRelay()
    clearTimeout(this.indexTimer)
    for (const c of this.convs.values()) {
      c.stopped = true
      clearTimeout(c.timer)
      clearTimeout(c.receiptTimer)
    }
    void this.cache.flush()
  }

  /** One full refresh of the index and every conversation (tests, pull-to-refresh). */
  async refresh(): Promise<void> {
    await this.pollIndex()
    for (const c of this.convs.values()) {
      while (c.polling) await new Promise((r) => setTimeout(r, 40))
      await this.pollConv(c)
    }
  }

  setActive(id: string | undefined) {
    this.activeId = id
    const c = id ? this.convs.get(id) : undefined
    if (c) {
      c.interval = this.timingFor(c).activeBase
      this.kick(c)
    }
    for (const o of this.convs.values()) if (o !== c) o.interval = Math.max(o.interval, this.timingFor(o).idleBase)
    this.emit()
  }

  /** The tab became visible again, or the user pressed send: poll right now and reset the backoff. */
  nudge() {
    for (const c of this.convs.values()) {
      c.interval = this.baseInterval(c)
      this.kick(c)
    }
  }

  // ---------- index: my conversations and invitations ----------
  private async pollIndex(): Promise<void> {
    const root = chatRoot(this.myRoot)
    const res = await this.store.request(root, { headers: { Accept: 'text/turtle' } })
    if (res.ok) {
      const ids = listChildren(res.text, root).filter((u) => u.endsWith('/')).map((u) => nameOf(u))
      const fresh = ids.filter((id) => !this.convs.has(id))
      await pool(fresh, 3, async (id) => {
        try {
          const url = descriptorUrl(this.myRoot, id)
          let text = await this.cache.get(root, url)
          if (text === undefined) {
            const r = await this.store.get(url)
            if (!r) return
            text = r.text
            await this.cache.set(root, url, text)
          }
          const meta = decodeConversation(text, url)
          if (meta) await this.adopt(meta)
        } catch {
          /* a broken container is skipped, not fatal */
        }
      })
    } else if (res.status !== 404 && res.status !== 403) throw new Error(`Cannot list your chats: ${res.status}`)
    await this.pollInvites().catch(() => {})
  }

  private async adopt(meta: ConvMeta): Promise<Conv> {
    const existing = this.convs.get(meta.id)
    if (existing) return existing
    const c: Conv = {
      meta, peers: new Map(), pending: [], recent: new Map(), editOverlay: new Map(), deleteOverlay: new Set(),
      interval: meta.id === this.activeId ? this.baseTiming.activeBase : this.baseTiming.idleBase, polling: false, lastPollOk: true, compacting: false, stopped: false,
    }
    for (const w of meta.participants) c.peers.set(w, this.newPeer(w))
    this.convs.set(meta.id, c)
    this.joinRoom(c)
    void this.learn(meta.participants)
    this.emit()
    if (this.auto) void this.pollConv(c).then(() => this.schedule(c))
    return c
  }

  private newPeer(webId: string): Peer {
    return { webId, status: 'unknown', parsed: new Map(), inv: emptyInv(), msgs: [], ghosts: [], nextCheck: 0, loaded: false }
  }

  private scheduleIndex() {
    if (this.stopped) return
    this.indexTimer = setTimeout(async () => {
      if (!hidden()) await this.pollIndex().catch(() => {})
      this.scheduleIndex()
    }, this.baseTiming.indexEvery)
  }

  private async pollInvites(): Promise<void> {
    const box = inboxUrl(this.myRoot)
    const res = await this.store.request(box, { headers: { Accept: 'text/turtle' } })
    if (!res.ok) return
    const files = listChildren(res.text, box).filter((u) => classify(nameOf(u)).kind === 'other' && u.endsWith('.ttl'))
    const next: Invitation[] = []
    await pool(files, 3, async (u) => {
      const known = this.invites.find((i) => i.url === u)
      if (known) return void next.push(known)
      const r = await this.store.get(u).catch(() => undefined)
      const inv = r && decodeInvitation(r.text, u)
      if (inv && !this.convs.has(convIdOf(inv.descriptor))) next.push(inv)
    })
    next.sort((a, b) => b.at - a.at)
    const changed = next.map((i) => i.url).join() !== this.invites.map((i) => i.url).join()
    this.invites = next
    for (const inv of next) {
      if (!this.inviteSeen.has(inv.url)) {
        this.inviteSeen.add(inv.url)
        if (this.status === 'ready') void this.learn([inv.sender]).then(() => this.onToast?.({ title: `${this.person(inv.sender).name} invited you`, description: inv.title, tone: 'info' }))
      }
    }
    if (changed) {
      void this.learn(next.map((i) => i.sender))
      this.emit()
    }
  }

  // ---------- polling a conversation ----------
  private schedule(c: Conv) {
    if (c.stopped || this.stopped) return
    clearTimeout(c.timer)
    c.timer = setTimeout(async () => {
      if (hidden()) return this.schedule(c)
      const changed = await this.pollConv(c)
      const active = c.meta.id === this.activeId
      const t = this.timingFor(c)
      c.interval = nextInterval(c.interval, changed, active ? t.activeBase : t.idleBase, active ? t.activeMax : t.idleMax)
      this.schedule(c)
    }, c.interval)
  }

  private kick(c: Conv) {
    if (!this.auto || c.polling) return
    clearTimeout(c.timer)
    void this.pollConv(c).then(() => this.schedule(c))
  }

  async pollConv(c: Conv): Promise<boolean> {
    if (c.polling) return false
    c.polling = true
    let changed = false
    let failed = false
    const wasOk = c.lastPollOk
    try {
      const order = [this.me, ...c.meta.participants.filter((w) => w !== this.me)]
      for (const w of order) {
        const peer = c.peers.get(w)!
        if (peer.status !== 'active' && peer.status !== 'unknown' && w !== this.me && Date.now() < peer.nextCheck) continue
        try {
          if (await this.pollPeer(c, peer)) changed = true
          peer.error = undefined
        } catch (e) {
          failed = true
          peer.error = (e as Error).message
        }
      }
      c.lastPollAt = Date.now()
      c.lastPollOk = !failed
      this.trace(`poll ${c.meta.id} changed=${changed} failed=${failed} next=${c.interval}ms peers=${[...c.peers.values()].map((p) => slugOf(p.webId) + ':' + p.status).join(',')}`)
      if (changed || wasOk !== c.lastPollOk) this.emit()
      if (this.auto) void this.maybeCompact(c)
      else await this.maybeCompact(c)
    } finally {
      c.polling = false
      if (c.hinted) {
        c.hinted = false
        if (this.auto && !c.stopped && !this.stopped) queueMicrotask(() => this.kick(c))
      }
    }
    return changed
  }

  private async pollPeer(c: Conv, peer: Peer): Promise<boolean> {
    const isMe = peer.webId === this.me
    const leftBefore = peer.inv.hasLeft
    const root = await this.people.rootOf(peer.webId)
    const container = convUrl(root, c.meta.id)
    const res = await this.store.request(container, { headers: { Accept: 'text/turtle' } })
    if (res.status === 403 || res.status === 404) return this.hide(c, peer, container)
    if (!res.ok) throw new Error(`${peer.webId}: listing answered ${res.status}`)

    const children = listChildren(res.text, container).sort()
    const sig = children.join('|')
    const wasStatus = peer.status
    if (peer.status === 'active' && sig === peer.sig) {
      peer.lastOk = Date.now()
      return false
    }
    peer.status = 'active'
    peer.leftAt = undefined

    const inv = emptyInv()
    const want: string[] = []
    let readUpTo: string | undefined
    for (const u of children) {
      const k = classify(nameOf(u))
      if (k.kind === 'message' || k.kind === 'segment' || k.kind === 'edit') want.push(u)
      if (k.kind === 'message') inv.loose.set(k.id, u)
      if (k.kind === 'edit') inv.edits.set(k.id, [...(inv.edits.get(k.id) ?? []), u])
      if (k.kind === 'attachment') inv.attachments.set(k.id, u)
      if (k.kind === 'receipt') {
        inv.receipts.push(u)
        if (!readUpTo || compareIds(k.upTo, readUpTo) > 0) readUpTo = k.upTo
      }
      if (k.kind === 'left') inv.hasLeft = true
    }

    const next = new Map<string, Parsed>()
    const missing: string[] = []
    for (const u of want) {
      const old = peer.parsed.get(u)
      if (old) next.set(u, old)
      else missing.push(u)
    }
    let incomplete = false
    await pool(missing, 4, async (u) => {
      let text = await this.cache.get(container, u)
      if (text === undefined) {
        const r = await this.store.get(u)
        if (!r) return void (incomplete = true) // vanished between listing and fetch (compaction or delete): list again soon
        text = r.text
        await this.cache.set(container, u, text)
      }
      const k = classify(nameOf(u))
      next.set(u, k.kind === 'edit' ? { kind: 'edit', edit: decodeEdit(text, u) ?? { id: k.id, text: '', at: 0 } } : { kind: 'messages', msgs: decodeMessages(text, u) })
    })
    peer.parsed = next

    // build messages: loose and segment copies of one id collapse; the newest edit wins
    const raw = new Map<string, RawMessage & { file: string }>()
    for (const [u, p] of next) {
      if (p.kind !== 'messages') continue
      for (const m of p.msgs) {
        if (m.author !== peer.webId) continue // only the author's own pod may speak for the author
        if (!raw.has(m.id)) raw.set(m.id, { ...m, file: u })
        if (classify(nameOf(u)).kind === 'segment') inv.segmentOf.set(m.id, u)
      }
    }
    const edits = new Map<string, RawEdit>()
    for (const p of next.values()) if (p.kind === 'edit' && p.edit.at && (!edits.has(p.edit.id) || p.edit.at > edits.get(p.edit.id)!.at)) edits.set(p.edit.id, p.edit)
    const prev = new Map(peer.msgs.map((m) => [m.id, m]))
    const msgs: Msg[] = [...raw.values()].map((m) => {
      const e = edits.get(m.id)
      return { id: m.id, author: m.author, text: e ? e.text : m.text, createdAt: m.createdAt, editedAt: e?.at, attachment: m.attachment, status: 'sent', fileUrl: m.file }
    })
    msgs.sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id))

    let changed = wasStatus !== 'active'
    if (msgs.length !== prev.size || msgs.some((m) => prev.get(m.id)?.text !== m.text || prev.get(m.id)?.editedAt !== m.editedAt)) changed = true
    if (readUpTo !== peer.readUpTo) changed = true

    if (!incomplete) {
      for (const [id, m] of prev) if (!raw.has(id) && !isMe && peer.loaded) peer.ghosts.push({ id, author: peer.webId, at: m.createdAt, reason: 'deleted' })
      peer.ghosts = peer.ghosts.filter((g) => g.reason !== 'hidden' || !raw.has(g.id)) // rejoined: the dissolved messages are back
      void this.cache.retain(container, new Set(want))
    }
    if (!isMe && peer.loaded) {
      for (const m of msgs) if (!prev.has(m.id)) this.incoming(c, m)
    }
    peer.msgs = msgs
    peer.inv = inv
    peer.readUpTo = readUpTo
    peer.sig = incomplete ? undefined : sig
    peer.lastOk = Date.now()
    peer.loaded = true

    if (isMe) {
      // my own listing confirms optimistic writes
      for (const id of c.recent.keys()) if (raw.has(id)) c.recent.delete(id)
      for (const [id, o] of c.editOverlay) if ((edits.get(id)?.at ?? 0) >= o.at) c.editOverlay.delete(id)
      for (const id of c.deleteOverlay) if (!raw.has(id)) c.deleteOverlay.delete(id)
      if (inv.hasLeft && !peer.leftAt) {
        const r = await this.store.get(leftUrl(root, c.meta.id)).catch(() => undefined)
        peer.leftAt = r ? decodeLeft(r.text, leftUrl(root, c.meta.id)) : Date.now()
      }
      if (leftBefore !== inv.hasLeft) changed = true
    }
    return changed
  }

  private isLeft(c: Conv): boolean {
    return Boolean(c.peers.get(this.me)?.inv.hasLeft)
  }

  /** The container answered 403 or 404: this person grants me nothing. Their messages vanish from my view, and so does my cached copy. */
  private async hide(c: Conv, peer: Peer, container: string): Promise<boolean> {
    const was = peer.status
    const hadMsgs = peer.msgs.length > 0
    if (hadMsgs && peer.webId !== this.me) for (const m of peer.msgs) peer.ghosts.push({ id: m.id, author: peer.webId, at: m.createdAt, reason: 'hidden' })
    peer.msgs = []
    peer.parsed = new Map()
    peer.inv = emptyInv()
    peer.sig = undefined
    peer.readUpTo = undefined
    peer.lastOk = Date.now()
    peer.nextCheck = Date.now() + this.baseTiming.hiddenPeerRecheck
    if (was === 'active' || was === 'left') await this.cache.purge(container)
    // a leave notice is the one thing a leaver keeps readable for the others
    const left = await this.store.request(container + 'left.ttl', { headers: { Accept: 'text/turtle' } })
    if (left.ok) {
      peer.status = 'left'
      peer.leftAt = decodeLeft(left.text, container + 'left.ttl') || Date.now()
    } else {
      peer.status = 'hidden'
      peer.leftAt = undefined
    }
    peer.loaded = true
    return was !== peer.status || hadMsgs
  }

  private incoming(c: Conv, m: Msg) {
    if (c.meta.id === this.activeId && !hidden()) return
    if (Date.now() - m.createdAt > 120_000) return // a returning participant's old messages are not news
    this.onIncoming?.({ convId: c.meta.id, title: this.titleOf(c.meta), author: this.person(m.author).name, text: m.text || 'Sent a photo' })
  }

  // ---------- reading state for the UI ----------
  titleOf(meta: ConvMeta): string {
    if (meta.kind === 'direct') {
      const other = meta.participants.find((w) => w !== this.me)
      return other ? this.person(other).name : meta.title
    }
    return meta.title
  }

  private peerViews(c: Conv): PeerView[] {
    return [...c.peers.values()].map((p) => {
      let msgs = p.msgs
      if (p.webId === this.me) {
        const byId = new Map(msgs.map((m) => [m.id, m]))
        for (const m of c.recent.values()) if (!byId.has(m.id)) byId.set(m.id, m)
        msgs = [...byId.values()].filter((m) => !c.deleteOverlay.has(m.id)).map((m) => {
          const o = c.editOverlay.get(m.id)
          return o && o.at > (m.editedAt ?? 0) ? { ...m, text: o.text, editedAt: o.at } : m
        })
      }
      const readUpTo = p.webId === this.me ? maxId(p.readUpTo, c.localRead) : p.readUpTo
      return { webId: p.webId, status: p.status, leftAt: p.leftAt, msgs, ghosts: p.ghosts, readUpTo }
    })
  }

  list(): ConvSummary[] {
    return this.memoized('list', () => {
      const out: ConvSummary[] = []
      for (const c of this.convs.values()) {
        const views = this.peerViews(c)
        const all = views.flatMap((v) => v.msgs).concat(c.pending).sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id))
        const lastMsg = all[all.length - 1]
        const myRead = views.find((v) => v.webId === this.me)?.readUpTo
        out.push({
          id: c.meta.id,
          title: this.titleOf(c.meta),
          kind: c.meta.kind,
          members: c.meta.participants.map((w) => this.person(w)),
          last: lastMsg && { text: lastMsg.text, at: lastMsg.createdAt, author: lastMsg.author, mine: lastMsg.author === this.me, image: Boolean(lastMsg.attachment) },
          unread: unreadCount(all, this.me, myRead),
          left: this.isLeft(c),
          lastActivity: lastMsg?.createdAt ?? c.meta.createdAt,
          loading: !c.peers.get(this.me)!.loaded,
        })
      }
      return out.sort((a, b) => b.lastActivity - a.lastActivity)
    })
  }

  get(id: string): ConvDetail | undefined {
    const c = this.convs.get(id)
    if (!c) return undefined
    return this.memoized('conv:' + id, () => {
      const views = this.peerViews(c)
      const entries = mergeEntries(views, c.pending, c.meta)
      const items = layout(entries, this.me, views)
      const all = views.flatMap((v) => v.msgs)
      const myRead = views.find((v) => v.webId === this.me)?.readUpTo
      const mePeer = c.peers.get(this.me)!
      return {
        meta: c.meta,
        title: this.titleOf(c.meta),
        members: c.meta.participants.map((w) => this.person(w)),
        items,
        peers: views.map((v) => ({ ...v, name: this.person(v.webId).name, count: v.msgs.length, root: this.persons.get(v.webId)?.root, error: c.peers.get(v.webId)?.error })),
        left: this.isLeft(c),
        leftAt: mePeer.leftAt,
        myContainer: convUrl(this.myRoot, c.meta.id),
        unread: unreadCount(all, this.me, myRead),
        loading: !mePeer.loaded,
      }
    })
  }

  /** Not memoized: read every second by the "live" indicator. */
  live(id: string): LiveState {
    const c = this.convs.get(id)
    if (!c) return { kind: 'offline', everyMs: 0, push: false }
    const lastOkAt = Math.max(0, ...[...c.peers.values()].map((p) => p.lastOk ?? 0)) || undefined
    return { kind: c.lastPollOk ? 'live' : 'offline', lastOkAt, everyMs: c.interval, push: this.pushed(c) }
  }

  get invitations(): (Invitation & { senderName: string })[] {
    return this.memoized('inv', () => this.invites.map((i) => ({ ...i, senderName: this.person(i.sender).name })))
  }
  get myPodRoot() {
    return this.myRoot
  }

  // ---------- actions ----------
  async createConversation(opts: { title?: string; others: string[] }): Promise<string> {
    const others = [...new Set(opts.others)].filter((w) => w !== this.me)
    if (!others.length) throw new Error('Pick at least one person')
    if (others.length === 1) {
      const dup = [...this.convs.values()].find((c) => c.meta.kind === 'direct' && c.meta.participants.includes(others[0]))
      if (dup) return dup.meta.id
    }
    await this.learn(others)
    const meta: ConvMeta = {
      id: newConversationId(),
      title: (opts.title ?? '').trim() || others.map((w) => this.person(w).name.split(' ')[0]).concat('You').join(', '),
      kind: others.length === 1 ? 'direct' : 'group',
      creator: this.me,
      participants: [this.me, ...others],
      createdAt: Date.now(),
      relayRoom: newRelayRoom(),
    }
    const container = convUrl(this.myRoot, meta.id)
    // The first PUT creates the container owner-only; the ACL that lets the others read comes second, so nothing is exposed early.
    await this.store.put(container + 'conversation.ttl', encodeConversation(container + 'conversation.ttl', meta))
    await writeConversationAcl(this.store, this.me, container, others)
    const c = await this.adopt(meta)
    const failed: string[] = []
    await Promise.all(others.map(async (w) => {
      try {
        const root = await this.people.rootOf(w)
        const box = inboxUrl(root)
        const slug = `inv-${meta.id}.ttl`
        await this.store.post(box, encodeInvitation(box + slug, { descriptor: container + 'conversation.ttl', sender: this.me, title: meta.title, kind: meta.kind }), { slug })
      } catch {
        failed.push(this.person(w).name)
      }
    }))
    if (failed.length) this.onToast?.({ title: `Could not invite ${failed.join(', ')}`, description: 'They have not opened Pod Chat yet, or their pod does not accept invitations from you.', tone: 'warn', })
    void c
    return meta.id
  }

  async acceptInvite(inv: Invitation): Promise<string> {
    const senderRoot = await this.people.rootOf(inv.sender)
    if (!inv.descriptor.startsWith(chatRoot(senderRoot))) throw new Error('This invitation points outside the sender\'s chat folder, so it was ignored')
    const r = await this.store.get(inv.descriptor)
    const meta = r && decodeConversation(r.text, inv.descriptor)
    if (!meta) throw new Error('The conversation is gone: its creator removed it')
    if (meta.creator !== inv.sender || !meta.participants.includes(this.me)) throw new Error('This invitation does not match the conversation')
    await this.learn(meta.participants)
    const container = convUrl(this.myRoot, meta.id)
    await this.store.put(container + 'conversation.ttl', encodeConversation(container + 'conversation.ttl', meta))
    await writeConversationAcl(this.store, this.me, container, meta.participants)
    await this.store.delete(inv.url).catch(() => {})
    this.invites = this.invites.filter((i) => i.url !== inv.url)
    const c = await this.adopt(meta)
    this.publish(c, 'join', container + 'conversation.ttl')
    this.emit()
    return meta.id
  }

  async declineInvite(inv: Invitation): Promise<void> {
    await this.store.delete(inv.url).catch(() => {})
    this.invites = this.invites.filter((i) => i.url !== inv.url)
    this.emit()
  }

  async send(convId: string, text: string, upload?: PreparedUpload): Promise<void> {
    const c = this.mustConv(convId)
    const clean = text.trim()
    if (!clean && !upload) return
    if (this.isLeft(c)) throw new Error('You left this conversation. Rejoin to write again.')
    const createdAt = Date.now()
    const id = newMessageId(createdAt)
    const container = convUrl(this.myRoot, convId)
    const pending: Msg = { id, author: this.me, text: clean, createdAt, status: 'sending', previewUrl: upload?.previewUrl, attachment: upload && { url: container + attachmentFile(id, upload.ext), type: upload.type, width: upload.width, height: upload.height } }
    c.pending.push(pending)
    this.emit()
    await this.writeMessage(c, pending, upload)
  }

  private async writeMessage(c: Conv, m: Msg, upload?: PreparedUpload) {
    const container = convUrl(this.myRoot, c.meta.id)
    try {
      if (upload && m.attachment) await this.store.put(m.attachment.url, new Uint8Array(await upload.blob.arrayBuffer()), upload.type)
      const url = container + messageFile(m.id)
      const raw: RawMessage = { id: m.id, author: this.me, text: m.text, createdAt: m.createdAt, attachment: m.attachment }
      await this.store.put(url, encodeMessage(url, raw))
      c.pending = c.pending.filter((p) => p.id !== m.id)
      c.recent.set(m.id, { ...m, status: 'sent', fileUrl: url })
      this.publish(c, 'message', url)
      this.emit()
      c.interval = this.timingFor(c).activeBase
      this.kick(c)
    } catch (e) {
      m.status = 'failed'
      this.emit()
      this.onToast?.({ title: 'Message not sent', description: (e as Error).message, tone: 'error' })
    }
  }

  retry(convId: string, id: string, upload?: PreparedUpload) {
    const c = this.mustConv(convId)
    const m = c.pending.find((p) => p.id === id)
    if (!m) return
    m.status = 'sending'
    this.emit()
    void this.writeMessage(c, m, upload)
  }

  discard(convId: string, id: string) {
    const c = this.mustConv(convId)
    c.pending = c.pending.filter((p) => p.id !== id)
    this.emit()
  }

  async edit(convId: string, id: string, text: string): Promise<void> {
    const c = this.mustConv(convId)
    const clean = text.trim()
    if (!clean) throw new Error('A message cannot be empty. Delete it instead.')
    const at = Date.now()
    const container = convUrl(this.myRoot, convId)
    c.editOverlay.set(id, { text: clean, at })
    this.emit()
    try {
      const url = container + editFile(id, at)
      await this.store.put(url, encodeEdit(url, { id, text: clean, at }, this.me))
      this.publish(c, 'edit', url)
      this.kick(c)
    } catch (e) {
      c.editOverlay.delete(id)
      this.emit()
      throw e
    }
  }

  async remove(convId: string, id: string): Promise<void> {
    const c = this.mustConv(convId)
    const me = c.peers.get(this.me)!
    const container = convUrl(this.myRoot, convId)
    const msg = [...me.msgs, ...c.recent.values()].find((m) => m.id === id)
    c.deleteOverlay.add(id)
    c.recent.delete(id)
    this.emit()
    try {
      const seg = me.inv.segmentOf.get(id)
      if (seg) await this.removeFromSegment(me, seg, id, container)
      await this.store.delete(container + messageFile(id)).catch(() => false)
      for (const e of me.inv.edits.get(id) ?? []) await this.store.delete(e).catch(() => false)
      const att = msg?.attachment?.url ?? me.inv.attachments.get(id)
      if (att) await this.store.delete(att).catch(() => false)
      this.publish(c, 'delete', container + messageFile(id))
      this.kick(c)
    } catch (e) {
      c.deleteOverlay.delete(id)
      this.emit()
      throw e
    }
  }

  private async removeFromSegment(me: Peer, segUrl: string, id: string, container: string) {
    const parsed = me.parsed.get(segUrl)
    if (!parsed || parsed.kind !== 'messages') throw new Error('Cannot rewrite the archive of older messages right now, try again in a moment')
    const rest = parsed.msgs.filter((m) => m.id !== id)
    if (rest.length) {
      const url = container + segmentFile(rest[0].createdAt, rest[rest.length - 1].createdAt)
      await this.store.put(url, encodeSegment(url, rest))
    }
    await this.store.delete(segUrl)
  }

  /** Mark everything up to the newest message from others as read: a tiny receipt resource in MY pod. */
  markRead(convId: string) {
    const c = this.convs.get(convId)
    if (!c || hidden()) return
    const newest = [...c.peers.values()].filter((p) => p.webId !== this.me).flatMap((p) => p.msgs).map((m) => m.id).sort(compareIds).pop()
    const mine = c.peers.get(this.me)
    const known = maxId(mine?.readUpTo, c.localRead)
    if (!newest || (known && compareIds(newest, known) <= 0)) return
    c.localRead = newest
    this.emit()
    clearTimeout(c.receiptTimer)
    c.receiptTimer = setTimeout(() => void this.writeReceipt(c, newest), 700)
  }

  private async writeReceipt(c: Conv, upTo: string) {
    if (this.isLeft(c)) return
    try {
      const container = convUrl(this.myRoot, c.meta.id)
      const url = container + receiptFile(upTo)
      await this.store.put(url, encodeReceipt(url, this.me, upTo))
      this.publish(c, 'receipt', url)
      const old = (c.peers.get(this.me)?.inv.receipts ?? []).filter((u) => u !== url)
      for (const u of old) await this.store.delete(u).catch(() => false)
    } catch {
      /* receipts are best effort */
    }
  }

  /** Leaving revokes every grant on my messages. They stay in my pod, nobody else can read them. */
  async leave(convId: string): Promise<void> {
    const c = this.mustConv(convId)
    const container = convUrl(this.myRoot, convId)
    const others = c.meta.participants.filter((w) => w !== this.me)
    const url = leftUrl(this.myRoot, convId)
    await this.store.put(url, encodeLeft(url, this.me))
    await writeLeaveNoticeAcl(this.store, this.me, url, others)
    await revokeConversationAcl(this.store, this.me, container)
    const me = c.peers.get(this.me)!
    me.inv.hasLeft = true
    me.leftAt = Date.now()
    this.publish(c, 'leave', url)
    this.emit()
    this.kick(c)
  }

  async rejoin(convId: string): Promise<void> {
    const c = this.mustConv(convId)
    const container = convUrl(this.myRoot, convId)
    await writeConversationAcl(this.store, this.me, container, c.meta.participants)
    const url = leftUrl(this.myRoot, convId)
    await this.store.delete(url + '.acl').catch(() => false)
    await this.store.delete(url).catch(() => false)
    const me = c.peers.get(this.me)!
    me.inv.hasLeft = false
    me.leftAt = undefined
    me.sig = undefined
    this.publish(c, 'join', container + 'conversation.ttl')
    this.emit()
    this.kick(c)
  }

  /** After leaving: erase my copy for good (my messages, receipts and the ACLs). */
  async eraseMyCopy(convId: string): Promise<void> {
    const c = this.mustConv(convId)
    await this.store.deleteRecursive(convUrl(this.myRoot, convId))
    c.stopped = true
    clearTimeout(c.timer)
    this.leaveRoom(c)
    this.convs.delete(convId)
    await this.cache.purge(chatRoot(this.myRoot) + convId + '/')
    this.emit()
  }

  /** Re-send invitations to people who have not joined (their inbox may not have existed the first time). */
  async reinvite(convId: string, webId: string): Promise<void> {
    const c = this.mustConv(convId)
    const root = await this.people.rootOf(webId)
    const box = inboxUrl(root)
    const slug = `inv-${convId}.ttl`
    const descriptor = convUrl(this.myRoot, convId) + 'conversation.ttl'
    await this.store.post(box, encodeInvitation(box + slug, { descriptor, sender: this.me, title: c.meta.title, kind: c.meta.kind }), { slug })
  }

  // ---------- compaction ----------
  /** Roll old loose messages of mine into one archive file, so a fresh device loads history with a handful of requests. */
  private async maybeCompact(c: Conv) {
    const me = c.peers.get(this.me)!
    if (c.compacting || c.stopped || me.status !== 'active') return
    const picks = pickCompactable(me.msgs, me.inv, Date.now())
    if (!picks.length) return
    c.compacting = true
    try {
      const container = convUrl(this.myRoot, c.meta.id)
      const raws: RawMessage[] = picks.map((m) => ({ id: m.id, author: m.author, text: m.text, createdAt: m.createdAt, attachment: m.attachment }))
      const url = container + segmentFile(raws[0].createdAt, raws[raws.length - 1].createdAt)
      await this.store.put(url, encodeSegment(url, raws)) // archive first, then delete the loose files: readers never see a gap
      this.publish(c, 'archive', url)
      await pool(picks, 3, async (m) => void (await this.store.delete(container + messageFile(m.id)).catch(() => false)))
      me.sig = undefined
    } catch {
      /* compaction is an optimisation, try again next time */
    } finally {
      c.compacting = false
    }
  }

  private mustConv(id: string): Conv {
    const c = this.convs.get(id)
    if (!c) throw new Error('Unknown conversation')
    return c
  }
}

/** Old loose messages that can be archived: older than 2 hours, never edited, at least 12 of them. Pure, tested. */
export function pickCompactable(msgs: Msg[], inv: Inventory, now: number, minCount = 12, maxBatch = 40): Msg[] {
  const old = msgs.filter((m) => inv.loose.has(m.id) && !inv.segmentOf.has(m.id) && !inv.edits.has(m.id) && now - m.createdAt > 2 * 3600_000)
  return old.length >= minCount ? old.slice(0, maxBatch) : []
}
export type { Inventory }

const hidden = () => typeof document !== 'undefined' && document.hidden
const maxId = (a?: string, b?: string) => (a && b ? (compareIds(a, b) >= 0 ? a : b) : a ?? b)
/** descriptor URL ".../chat/<id>/conversation.ttl" -> id */
export const convIdOf = (descriptor: string) => descriptor.split('/').slice(-2, -1)[0] ?? ''
