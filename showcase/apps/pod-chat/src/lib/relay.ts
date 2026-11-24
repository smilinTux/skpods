// Optional push hints from the SKPods relay (docs/CHAT-PROTOCOL.md section 3). The relay only ever says "something
// changed at URL X"; the engine still reads the pod and trusts only what the pod returns. Without a relay, or with
// the relay down, nothing here is needed for correctness: the engine simply polls at its normal pace.
import type { RelayAuth } from '@skpods/solid-web'

export const PING_KINDS = ['message', 'edit', 'delete', 'receipt', 'join', 'leave', 'archive'] as const
export type PingKind = (typeof PING_KINDS)[number]

/** A ping relayed to the other members of a room. `from` is the WebID the relay verified. */
export interface ServerPing { t: 'ping'; from: string; kind: PingKind; url: string; seq: number; at: number }
/** One hint held for me by my mailbox while I was not in the room. */
export interface QueuedItem { room: string; from: string; kind: PingKind; url: string; seq: number; at: number }
export type ServerFrame =
  | { t: 'ready'; webid: string }
  | ServerPing
  | { t: 'typing'; from: string }
  | { t: 'queued'; items: QueuedItem[] }
  | { t: 'error'; code: string }

export type RelayState = 'off' | 'connecting' | 'live' | 'down'

/** Poll timing while every relay socket is live: pings do the fast path, polling is only the safety net. */
export const RELAY_LIVE_TIMING = { activeBase: 15000, activeMax: 60000, idleBase: 30000, idleMax: 120000 }

const ROOM_RE = /^[0-9a-f]{32}$/
const MAX_CLIENT_FRAME = 4096
const TYPING_EVERY = 3000
const OUTBOX_MAX = 20
const DOWN_AFTER = 3

const str = (v: unknown): v is string => typeof v === 'string'
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isKind = (v: unknown): v is PingKind => (PING_KINDS as readonly unknown[]).includes(v)

/** Parse a relay-to-client frame. Anything malformed or unknown is undefined (and ignored by the client). */
export function parseServerFrame(text: unknown): ServerFrame | undefined {
  if (!str(text)) return undefined
  let f: Record<string, unknown>
  try {
    f = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!f || typeof f !== 'object' || Array.isArray(f)) return undefined
  switch (f.t) {
    case 'ready':
      return str(f.webid) ? { t: 'ready', webid: f.webid } : undefined
    case 'ping':
      return str(f.from) && isKind(f.kind) && str(f.url) && int(f.seq) && int(f.at) ? { t: 'ping', from: f.from, kind: f.kind, url: f.url, seq: f.seq, at: f.at } : undefined
    case 'typing':
      return str(f.from) ? { t: 'typing', from: f.from } : undefined
    case 'queued': {
      if (!Array.isArray(f.items)) return undefined
      const items: QueuedItem[] = []
      for (const i of f.items as Record<string, unknown>[]) {
        if (i && str(i.room) && str(i.from) && isKind(i.kind) && str(i.url) && int(i.seq) && int(i.at)) items.push({ room: i.room, from: i.from, kind: i.kind, url: i.url, seq: i.seq, at: i.at })
      }
      return { t: 'queued', items }
    }
    case 'error':
      return str(f.code) ? { t: 'error', code: f.code } : undefined
    default:
      return undefined
  }
}

/** The DPoP `htu` for a dialled relay URL: https plus host[:port] plus path, no query, no fragment (ruling R7). */
export function relayHtu(dialled: string): string {
  const u = new URL(dialled)
  return `https://${u.host}${u.pathname}`
}

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface RelayOptions {
  /** Relay base URL, `wss://relay.example` (ws:// for local development). */
  url: string
  auth: RelayAuth
  /** My WebID: the mailbox socket is /v1/me?w=<sha256 hex of it>. */
  me: string
  WebSocketImpl?: typeof WebSocket
  /** Jitter source, 0..1 (tests pin it). */
  random?: () => number
}

/** One socket with its own auth, ready gate and backoff. */
class Link {
  ws?: WebSocket
  ready = false
  failures = 0
  state: RelayState = 'connecting'
  private timer?: ReturnType<typeof setTimeout>
  private closed = false
  private outbox: string[] = []
  private lastTyping = 0

  constructor(
    private url: string | Promise<string>,
    private o: { auth: RelayAuth; WS: typeof WebSocket; random: () => number; onFrame: (f: ServerFrame) => void; onState: () => void },
  ) {
    this.open()
  }

  /** Room URLs are known up front and dial at once; the mailbox URL waits for the WebID hash. */
  private open() {
    if (typeof this.url === 'string') return this.dial(this.url)
    this.url.then((u) => this.dial(u), () => this.fail())
  }

  private dial(url: string) {
    if (this.closed) return
    let ws: WebSocket
    try {
      ws = new this.o.WS(url)
    } catch {
      return this.fail()
    }
    this.ws = ws
    this.ready = false
    ws.onopen = async () => {
      try {
        const { token, proof } = await this.o.auth(relayHtu(url))
        if (this.ws === ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'auth', v: 1, token, proof }))
      } catch {
        if (this.ws === ws) ws.close()
        this.lost(ws)
      }
    }
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws) return
      const f = parseServerFrame(e.data)
      if (!f) return
      if (!this.ready) {
        if (f.t !== 'ready') return // nothing counts before ready
        this.ready = true
        this.failures = 0
        this.setState('live')
        for (const s of this.outbox.splice(0)) ws.send(s)
        return
      }
      this.o.onFrame(f)
    }
    ws.onclose = () => this.lost(ws)
    ws.onerror = () => {} // a close always follows
  }

  private lost(ws: WebSocket) {
    if (this.ws !== ws || this.closed) return
    this.ws = undefined
    this.ready = false
    this.fail()
  }

  private fail() {
    if (this.closed) return
    this.failures++
    this.setState(this.failures >= DOWN_AFTER ? 'down' : 'connecting')
    const base = Math.min(60_000, 1000 * 2 ** (this.failures - 1))
    const delay = Math.min(60_000, Math.round(base * (0.8 + 0.4 * this.o.random())))
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.open(), delay)
  }

  private setState(s: RelayState) {
    if (this.state === s) return
    this.state = s
    this.o.onState()
  }

  /** Send now when ready, otherwise hold a few frames until the socket is ready (hints are best effort). */
  send(frame: object) {
    const s = JSON.stringify(frame)
    if (new TextEncoder().encode(s).length > MAX_CLIENT_FRAME) return
    if (this.ready && this.ws?.readyState === 1) return this.ws.send(s)
    this.outbox.push(s)
    if (this.outbox.length > OUTBOX_MAX) this.outbox.shift()
  }

  typing() {
    const now = Date.now()
    if (!this.ready || now - this.lastTyping < TYPING_EVERY) return
    this.lastTyping = now
    this.send({ t: 'typing' })
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    const ws = this.ws
    this.ws = undefined
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      try {
        ws.close()
      } catch {
        /* already gone */
      }
    }
  }
}

const RANK: Record<RelayState, number> = { off: 0, live: 1, connecting: 2, down: 3 }

/**
 * Relay connections: one socket per joined room plus my mailbox socket, each opened on first use and closed when
 * nothing listens any more. `state` is the worst socket state: `live` only when every socket is ready.
 */
export class RelayClient {
  private base: string
  private WS: typeof WebSocket
  private random: () => number
  private mailboxUrl: Promise<string>
  private rooms = new Map<string, { link: Link; listeners: Set<(p: ServerPing) => void> }>()
  private mailbox?: Link
  private queuedListeners = new Set<(items: QueuedItem[]) => void>()
  private stateListeners = new Set<(s: RelayState) => void>()
  private current: RelayState = 'off'

  constructor(private opts: RelayOptions) {
    this.base = opts.url.replace(/\/+$/, '')
    const WS = opts.WebSocketImpl ?? globalThis.WebSocket
    if (!WS) throw new Error('No WebSocket implementation available')
    this.WS = WS
    this.random = opts.random ?? Math.random
    this.mailboxUrl = sha256Hex(opts.me).then((w) => `${this.base}/v1/me?w=${w}`)
    this.mailboxUrl.catch(() => {})
  }

  get state(): RelayState {
    return this.current
  }

  private link(url: string | Promise<string>, onFrame: (f: ServerFrame) => void): Link {
    return new Link(url, { auth: this.opts.auth, WS: this.WS, random: this.random, onFrame, onState: () => this.recompute() })
  }

  private recompute() {
    const links = [...[...this.rooms.values()].map((r) => r.link), ...(this.mailbox ? [this.mailbox] : [])]
    let s: RelayState = 'off'
    for (const l of links) if (RANK[l.state] > RANK[s]) s = l.state
    if (s === this.current) return
    this.current = s
    for (const cb of [...this.stateListeners]) cb(s)
  }

  /** Join a room. Pings from it go to onPing (typing frames are dropped here). Returns leave. */
  join(room: string, onPing: (p: ServerPing) => void): () => void {
    if (!ROOM_RE.test(room)) throw new Error('A relay room id is 32 lowercase hex characters')
    let r = this.rooms.get(room)
    if (!r) {
      const listeners = new Set<(p: ServerPing) => void>()
      const link = this.link(`${this.base}/v1/room/${room}`, (f) => {
        if (f.t === 'ping') for (const l of [...listeners]) l(f)
      })
      r = { link, listeners }
      this.rooms.set(room, r)
    }
    const entry = r
    entry.listeners.add(onPing)
    this.recompute()
    return () => {
      entry.listeners.delete(onPing)
      if (entry.listeners.size || this.rooms.get(room) !== entry) return
      entry.link.close()
      this.rooms.delete(room)
      this.recompute()
    }
  }

  /** Tell the room something changed at `url`. Dropped when not https or not joined: the others still poll. */
  publish(room: string, kind: PingKind, url: string): void {
    if (!isKind(kind) || !/^https:\/\//.test(url)) return
    this.rooms.get(room)?.link.send({ t: 'ping', kind, url })
  }

  /** At most one typing frame per room every 3 s (ruling R11). */
  typing(room: string): void {
    this.rooms.get(room)?.link.typing()
  }

  /** Hints held by my mailbox. Every `queued` frame is delivered, a drain may span several. */
  onQueued(cb: (items: QueuedItem[]) => void): () => void {
    this.queuedListeners.add(cb)
    if (!this.mailbox) {
      this.mailbox = this.link(this.mailboxUrl, (f) => {
        if (f.t === 'queued') for (const l of [...this.queuedListeners]) l(f.items)
      })
      this.recompute()
    }
    return () => {
      this.queuedListeners.delete(cb)
      if (this.queuedListeners.size || !this.mailbox) return
      this.mailbox.close()
      this.mailbox = undefined
      this.recompute()
    }
  }

  onState(cb: (s: RelayState) => void): () => void {
    this.stateListeners.add(cb)
    return () => void this.stateListeners.delete(cb)
  }

  close(): void {
    for (const r of this.rooms.values()) r.link.close()
    this.rooms.clear()
    this.mailbox?.close()
    this.mailbox = undefined
    this.queuedListeners.clear()
    this.recompute()
  }
}
