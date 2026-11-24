import { MemoryKV } from '@skpods/solid-web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../../protocol/relay-v1.fixtures.json'
import { FileCache } from '../../src/lib/cache'
import { encodeConversation, type ConvMeta } from '../../src/lib/codec'
import { ChatEngine, DEFAULT_TIMING } from '../../src/lib/engine'
import { parseServerFrame, RelayClient, relayHtu, RELAY_LIVE_TIMING, type ServerPing } from '../../src/lib/relay'

// ---------- a fake WebSocket the tests drive by hand ----------
class FakeWS {
  static all: FakeWS[] = []
  readyState = 0
  sent: string[] = []
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeWS.all.push(this)
  }
  send(s: string) {
    this.sent.push(s)
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  // test side
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  recv(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  frames() {
    return this.sent.map((s) => JSON.parse(s))
  }
}
const WS = FakeWS as unknown as typeof WebSocket
const last = () => FakeWS.all[FakeWS.all.length - 1]
const flush = () => new Promise((r) => setTimeout(r, 0))

const ROOM = '0123456789abcdef0123456789abcdef'
const ROOM2 = 'fedcba9876543210fedcba9876543210'
const ALICE = 'https://pod.test/alice/profile/card#me'
const BOB = 'https://pod.test/bob/profile/card#me'
const CAROL = 'https://pod.test/carol/profile/card#me'

const auth = vi.fn(async (htu: string) => ({ token: 'tok', proof: 'proof:' + htu }))
const client = (extra: Partial<ConstructorParameters<typeof RelayClient>[0]> = {}) =>
  new RelayClient({ url: 'wss://relay.example', auth, me: ALICE, WebSocketImpl: WS, random: () => 0.5, ...extra })

/** Open a socket, let the async auth frame go out, then answer ready. */
async function goLive(ws: FakeWS) {
  ws.open()
  await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0))
  ws.recv({ t: 'ready', webid: ALICE })
}

beforeEach(() => {
  FakeWS.all = []
  auth.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('relayHtu', () => {
  it('maps ws and wss to https and drops query and fragment', () => {
    expect(relayHtu(`wss://relay.example/v1/room/${ROOM}`)).toBe(`https://relay.example/v1/room/${ROOM}`)
    expect(relayHtu('ws://127.0.0.1:8787/v1/me?w=abc')).toBe('https://127.0.0.1:8787/v1/me')
    expect(relayHtu('wss://relay.example/v1/me?w=abc#x')).toBe('https://relay.example/v1/me')
  })
})

describe('RelayClient', () => {
  it('sends auth first and goes live on ready', async () => {
    const r = client()
    expect(r.state).toBe('off')
    r.join(ROOM, () => {})
    const ws = last()
    expect(ws.url).toBe(`wss://relay.example/v1/room/${ROOM}`)
    expect(r.state).toBe('connecting')
    ws.open()
    await vi.waitFor(() => expect(ws.sent.length).toBe(1))
    expect(auth).toHaveBeenCalledWith(`https://relay.example/v1/room/${ROOM}`)
    expect(ws.frames()[0]).toEqual({ t: 'auth', v: 1, token: 'tok', proof: `proof:https://relay.example/v1/room/${ROOM}` })
    ws.recv({ t: 'ready', webid: ALICE })
    expect(r.state).toBe('live')
    r.close()
    expect(r.state).toBe('off')
    expect(ws.closed).toBe(true)
  })

  it('ignores frames before ready', async () => {
    const r = client()
    const got: ServerPing[] = []
    r.join(ROOM, (p) => got.push(p))
    const ws = last()
    ws.open()
    await vi.waitFor(() => expect(ws.sent.length).toBe(1))
    const ping = { t: 'ping', from: BOB, kind: 'message', url: 'https://pod.test/bob/m-1.ttl', seq: 1, at: 1 }
    ws.recv(ping)
    expect(got).toEqual([])
    expect(r.state).toBe('connecting')
    ws.recv({ t: 'ready', webid: ALICE })
    ws.recv(ping)
    ws.recv({ t: 'typing', from: BOB })
    ws.recv('garbage')
    expect(got).toEqual([ping])
    r.close()
  })

  it('every fixture server frame parses', () => {
    const server = (fixtures as { direction: string; valid: boolean; frame: { t: string } }[]).filter((f) => f.direction === 'server' && f.valid)
    expect(server.length).toBeGreaterThan(5)
    for (const f of server) expect(parseServerFrame(JSON.stringify(f.frame))?.t, f.frame.t).toBe(f.frame.t)
    expect(parseServerFrame('{"t":"ping","kind":"message","url":"https://x/y"}')).toBeUndefined() // no from
    expect(parseServerFrame('{"t":"ping","from":"a","kind":"reaction","url":"https://x/y","seq":1,"at":1}')).toBeUndefined()
    expect(parseServerFrame('not json')).toBeUndefined()
  })

  it('accepts any number of queued frames on the mailbox, opened at /v1/me?w=sha256(webid)', async () => {
    const r = client()
    const batches: number[] = []
    r.onQueued((items) => batches.push(items.length))
    await vi.waitFor(() => expect(FakeWS.all.length).toBe(1))
    const ws = last()
    expect(ws.url).toMatch(/^wss:\/\/relay\.example\/v1\/me\?w=[0-9a-f]{64}$/)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ALICE)))
    expect(ws.url.split('w=')[1]).toBe([...digest].map((b) => b.toString(16).padStart(2, '0')).join(''))
    await goLive(ws)
    expect(auth).toHaveBeenCalledWith('https://relay.example/v1/me')
    const item = { room: ROOM, from: BOB, kind: 'message', url: 'https://pod.test/bob/m-1.ttl', seq: 1, at: 1 }
    ws.recv({ t: 'queued', items: [item, item] })
    ws.recv({ t: 'queued', items: [item] })
    ws.recv({ t: 'queued', items: [] })
    expect(batches).toEqual([2, 1, 0])
    r.close()
  })

  it('reconnects with backoff and reports down after 3 failures', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const r = client()
    const states: string[] = []
    r.onState((s) => states.push(s))
    r.join(ROOM, () => {})
    expect(FakeWS.all.length).toBe(1)
    last().drop() // failure 1, retry in 1 s
    expect(r.state).toBe('connecting')
    vi.advanceTimersByTime(999)
    expect(FakeWS.all.length).toBe(1)
    vi.advanceTimersByTime(1)
    expect(FakeWS.all.length).toBe(2)
    last().drop() // failure 2, retry in 2 s
    expect(r.state).toBe('connecting')
    vi.advanceTimersByTime(1999)
    expect(FakeWS.all.length).toBe(2)
    vi.advanceTimersByTime(1)
    expect(FakeWS.all.length).toBe(3)
    last().drop() // failure 3: down, retry in 4 s
    expect(r.state).toBe('down')
    vi.advanceTimersByTime(4000)
    expect(FakeWS.all.length).toBe(4)
    for (let i = 0; i < 8; i++) {
      last().drop()
      vi.advanceTimersByTime(60_000)
    }
    expect(FakeWS.all.length).toBe(12) // the cap holds at 60 s
    vi.useRealTimers()
    await goLive(last())
    expect(r.state).toBe('live')
    expect(states).toEqual(['connecting', 'down', 'live'])
    last().drop() // a live socket that drops starts again at 1 s and is "connecting", not down
    expect(r.state).toBe('connecting')
    r.close()
  })

  it('reports the worst socket state, live only when every socket is ready', async () => {
    const r = client()
    r.join(ROOM, () => {})
    r.join(ROOM2, () => {})
    const [a, b] = FakeWS.all
    await goLive(a)
    expect(r.state).toBe('connecting')
    await goLive(b)
    expect(r.state).toBe('live')
    r.close()
  })

  it('publishes pings once ready, never a non-https url, and throttles typing to one per 3 s', async () => {
    const r = client()
    r.join(ROOM, () => {})
    const ws = last()
    r.publish(ROOM, 'join', 'https://pod.test/alice/c/conversation.ttl') // held until ready
    r.publish(ROOM, 'message', 'http://pod.test/alice/c/m-1.ttl') // the relay would close us for this
    await goLive(ws)
    r.publish(ROOM, 'message', 'https://pod.test/alice/c/m-2.ttl')
    r.typing(ROOM)
    r.typing(ROOM)
    expect(ws.frames().slice(1)).toEqual([
      { t: 'ping', kind: 'join', url: 'https://pod.test/alice/c/conversation.ttl' },
      { t: 'ping', kind: 'message', url: 'https://pod.test/alice/c/m-2.ttl' },
      { t: 'typing' },
    ])
    r.close()
  })

  it('closes a room socket when its last listener leaves', () => {
    const r = client()
    const off1 = r.join(ROOM, () => {})
    const off2 = r.join(ROOM, () => {})
    expect(FakeWS.all.length).toBe(1)
    off1()
    expect(last().closed).toBe(false)
    off2()
    expect(last().closed).toBe(true)
    expect(r.state).toBe('off')
  })
})

// ---------- engine wiring against a fake pod ----------
const root = (who: string) => `https://pod.test/${who}/`
function fakePod(convs: ConvMeta[]) {
  const reads: string[] = []
  const ttl = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/turtle' } })
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') return new Response('', { status: 201 })
    for (const who of ['alice', 'bob', 'carol']) {
      if (url === `${root(who)}profile/card`) return ttl(`<#me> <http://www.w3.org/ns/pim/space#storage> <${root(who)}>.`)
    }
    const chat = `${root('alice')}skpods/v1/chat/`
    if (url === chat) return ttl(`<> <http://www.w3.org/ns/ldp#contains> ${convs.map((c) => `<${c.id}/>`).join(', ')}.`)
    for (const c of convs) {
      if (url === `${chat}${c.id}/conversation.ttl`) return ttl(encodeConversation(url, c))
      for (const who of ['alice', 'bob', 'carol']) {
        if (url === `${root(who)}skpods/v1/chat/${c.id}/`) {
          reads.push(url)
          return ttl(`<> <http://www.w3.org/ns/ldp#contains> <conversation.ttl>.`)
        }
      }
    }
    return new Response('', { status: 404 })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, reads }
}
const conv = (id: string, relayRoom?: string): ConvMeta => ({ id, title: id, kind: 'direct', creator: ALICE, participants: [ALICE, BOB], createdAt: 1, relayRoom })

async function engineWith(convs: ConvMeta[], autoPoll: boolean) {
  const { PodStore } = await import('@skpods/solid-web')
  const pod = fakePod(convs)
  const relay = client()
  const timing = { ...DEFAULT_TIMING, indexEvery: 3_600_000 }
  const engine = new ChatEngine({ store: new PodStore(pod.fetch), me: ALICE, cache: new FileCache(new MemoryKV()), relay, autoPoll, timing })
  await engine.start()
  return { engine, relay, pod }
}
const roomSockets = () => FakeWS.all.filter((w) => w.url.includes('/v1/room/'))
const mailbox = () => FakeWS.all.find((w) => w.url.includes('/v1/me'))

describe('engine with a relay', () => {
  it('never joins a conversation without relayRoom', async () => {
    const { engine, relay } = await engineWith([conv('c-legacy'), conv('c-new', ROOM)], false)
    expect(engine.list().map((c) => c.id).sort()).toEqual(['c-legacy', 'c-new'])
    expect(roomSockets().map((w) => w.url)).toEqual([`wss://relay.example/v1/room/${ROOM}`])
    engine.stop()
    relay.close()
  })

  it('falls back to polling when relay closes', async () => {
    const { engine, relay } = await engineWith([conv('c-new', ROOM)], false)
    await vi.waitFor(() => expect(mailbox()).toBeDefined())
    engine.setActive('c-new')
    expect(engine.live('c-new').everyMs).toBe(DEFAULT_TIMING.activeBase)
    await goLive(roomSockets()[0])
    await goLive(mailbox()!)
    expect(relay.state).toBe('live')
    expect(engine.live('c-new')).toMatchObject({ push: true, everyMs: RELAY_LIVE_TIMING.activeBase })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    for (let i = 0; i < 3; i++) {
      roomSockets()[roomSockets().length - 1].drop()
      vi.advanceTimersByTime(60_000)
    }
    roomSockets()[roomSockets().length - 1].drop()
    expect(relay.state).toBe('down')
    expect(engine.live('c-new')).toMatchObject({ push: false, everyMs: DEFAULT_TIMING.activeBase })
    engine.stop()
    relay.close()
  })

  it('kicks only for pings from participants', async () => {
    const { engine, relay, pod } = await engineWith([conv('c-new', ROOM)], true)
    await vi.waitFor(() => expect(pod.reads.length).toBeGreaterThanOrEqual(2)) // the first poll read alice and bob
    const ws = roomSockets()[0]
    await goLive(ws)
    await new Promise((r) => setTimeout(r, 30))
    const before = pod.reads.length
    ws.recv({ t: 'ping', from: CAROL, kind: 'message', url: 'https://pod.test/carol/x.ttl', seq: 1, at: 1 })
    await new Promise((r) => setTimeout(r, 30))
    expect(pod.reads.length).toBe(before)
    ws.recv({ t: 'ping', from: BOB, kind: 'message', url: `${root('bob')}skpods/v1/chat/c-new/m-1.ttl`, seq: 2, at: 2 })
    await vi.waitFor(() => expect(pod.reads.length).toBeGreaterThan(before))
    engine.stop()
    relay.close()
  })

  it('a ping that lands during a poll gets one more poll afterwards', async () => {
    const { engine, relay, pod } = await engineWith([conv('c-new', ROOM)], true)
    await vi.waitFor(() => expect(pod.reads.length).toBeGreaterThanOrEqual(2))
    const ws = roomSockets()[0]
    await goLive(ws)
    await new Promise((r) => setTimeout(r, 30))
    const before = pod.reads.length
    const ping = { t: 'ping', from: BOB, kind: 'message', url: `${root('bob')}skpods/v1/chat/c-new/m-1.ttl`, seq: 1, at: 1 }
    ws.recv(ping) // starts a poll
    ws.recv({ ...ping, seq: 2 }) // arrives while it runs
    ws.recv({ ...ping, seq: 3 }) // still one extra poll, not two
    await vi.waitFor(() => expect(pod.reads.length).toBe(before + 4))
    await new Promise((r) => setTimeout(r, 30))
    expect(pod.reads.length).toBe(before + 4)
    engine.stop()
    relay.close()
  })

  it('kicks each conversation named in queued items once, only for participants', async () => {
    const { engine, relay, pod } = await engineWith([conv('c-new', ROOM)], true)
    await vi.waitFor(() => expect(pod.reads.length).toBeGreaterThanOrEqual(2))
    await vi.waitFor(() => expect(mailbox()).toBeDefined())
    await goLive(mailbox()!)
    await new Promise((r) => setTimeout(r, 30))
    const before = pod.reads.length
    const item = { room: ROOM, from: CAROL, kind: 'message', url: 'https://pod.test/carol/x.ttl', seq: 1, at: 1 }
    mailbox()!.recv({ t: 'queued', items: [item] })
    await new Promise((r) => setTimeout(r, 30))
    expect(pod.reads.length).toBe(before)
    mailbox()!.recv({ t: 'queued', items: [{ ...item, from: BOB }, { ...item, from: BOB, seq: 2 }] })
    await vi.waitFor(() => expect(pod.reads.length).toBe(before + 2)) // one poll: alice and bob, once
    await new Promise((r) => setTimeout(r, 30))
    expect(pod.reads.length).toBe(before + 2)
    engine.stop()
    relay.close()
  })

  it('publishes a message ping after writing a message', async () => {
    const { engine, relay } = await engineWith([conv('c-new', ROOM)], false)
    const ws = roomSockets()[0]
    await goLive(ws)
    await engine.send('c-new', 'hi')
    const pings = ws.frames().filter((f) => f.t === 'ping')
    expect(pings).toHaveLength(1)
    expect(pings[0]).toMatchObject({ kind: 'message', url: expect.stringMatching(/^https:\/\/pod\.test\/alice\/skpods\/v1\/chat\/c-new\/m-.+\.ttl$/) })
    engine.stop()
    relay.close()
  })
})
