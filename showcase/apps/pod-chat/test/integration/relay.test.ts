// Push hints end to end: real pods on pods-dev, a local relay (`wrangler dev`), real DPoP-bound tokens.
// Skipped unless SKP_TEST_ENV and SKP_RELAY_URL (ws://127.0.0.1:8787 for wrangler dev) are both set.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { relayAuthFromAgent } from '@skpods/solid-web/node'
import { actor, haveEnv, type Actor } from '../../scripts/env'
import { cleanTestChats, seedDemo } from '../../scripts/seed'
import { ChatEngine, DEFAULT_TIMING } from '../../src/lib/engine'
import { RELAY_LIVE_TIMING, RelayClient, relayHtu, type QueuedItem } from '../../src/lib/relay'
import { demoCast } from '../../src/lib/people'
import { convUrl, inboxUrl } from '../../src/lib/paths'
import { nameOf } from '../../src/lib/codec'

const RELAY = (process.env.SKP_RELAY_URL ?? '').replace(/\/+$/, '')

let A: Actor, B: Actor
const engines: ChatEngine[] = []
const relays: RelayClient[] = []
let convId = ''
let room = ''

const relayFor = (a: Actor) => {
  const r = new RelayClient({ url: RELAY, auth: relayAuthFromAgent(a.session), me: a.webId })
  relays.push(r)
  return r
}
async function engineFor(a: Actor, relay: RelayClient, timing = DEFAULT_TIMING): Promise<ChatEngine> {
  const e = new ChatEngine({ store: a.store, me: a.webId, contacts: demoCast(new URL(a.webId).origin).filter((w) => w !== a.webId), autoPoll: true, relay, timing })
  await e.start()
  engines.push(e)
  return e
}
const texts = (e: ChatEngine, id: string) => e.get(id)?.items.flatMap((i) => (i.t === 'msg' ? [i.msg.text] : [])) ?? []
async function until(what: string, ok: () => boolean, ms: number, every = 50) {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`)
    await new Promise((r) => setTimeout(r, every))
  }
}
async function inviteFor(e: ChatEngine, a: Actor, id: string) {
  for (let i = 0; i < 6; i++) {
    await e.refresh()
    const inv = e.invitations.find((x) => x.descriptor.includes(id))
    if (inv) return inv
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`no invitation for ${id}; inbox held ${(await a.store.list(inboxUrl(a.root))).map((x) => nameOf(x.url)).join(', ')}`)
}

describe.skipIf(!haveEnv || !RELAY)('pod chat with the relay on pods-dev', () => {
  beforeAll(async () => {
    ;[A, B] = await Promise.all([actor('alice'), actor('bob')])
    await seedDemo()
  })
  afterAll(async () => {
    engines.forEach((e) => e.stop())
    relays.forEach((r) => r.close())
    await cleanTestChats()
  })

  it("alice's message reaches bob's engine within 3 s by push", async () => {
    const aliceRelay = relayFor(A)
    const bobRelay = relayFor(B)
    const alice = await engineFor(A, aliceRelay)
    // bob polls at the relay-live pace from the start (15 s active, 30 s idle): polling alone cannot beat 3 s
    const bob = await engineFor(B, bobRelay, { ...DEFAULT_TIMING, ...RELAY_LIVE_TIMING })
    convId = await alice.createConversation({ others: [B.webId] })
    room = alice.get(convId)!.meta.relayRoom!
    expect(room).toMatch(/^[0-9a-f]{32}$/)
    await bob.acceptInvite(await inviteFor(bob, B, convId))
    expect(bob.get(convId)!.meta.relayRoom).toBe(room)
    await until('both relays live', () => aliceRelay.state === 'live' && bobRelay.state === 'live', 20_000)
    // let bob's first poll of the new conversation finish so it cannot be the one that finds the message
    await new Promise((r) => setTimeout(r, 2000))
    const text = `pushed at ${Date.now()}`
    const sendStart = Date.now()
    await alice.send(convId, text)
    const sent = Date.now()
    // both within the bound: the ping arrived (push), and the message is in bob's detail. A scheduled poll that
    // happens to land in the window may deliver the text first, but the ping must still arrive in time.
    const pinged = () => bob.debugLog.some((l) => l.includes(`ping ${convId} message`))
    await until('the ping and the message at bob', () => pinged() && texts(bob, convId).includes(text), 3000)
    const took = Date.now() - sent
    console.log(`relay push: send took ${sent - sendStart} ms, bob had the message ${took} ms after the send resolved`)
    expect(took).toBeLessThan(3000)
    expect(pinged()).toBe(true)
  })

  it('bob offline gets the ping from his mailbox on reconnect', async () => {
    expect(convId).toBeTruthy()
    const [alice, bob] = engines
    bob.stop() // leaves the room and closes the mailbox socket
    relays[1].close()
    await new Promise((r) => setTimeout(r, 1500)) // the room sees bob's socket close
    const text = `queued at ${Date.now()}`
    await alice.send(convId, text)
    await new Promise((r) => setTimeout(r, 1500)) // the room forwards to bob's mailbox
    const again = relayFor(B)
    const got: QueuedItem[] = []
    again.onQueued((items) => got.push(...items))
    const container = convUrl(A.root, convId)
    await until('a queued item for the conversation', () => got.some((i) => i.room === room && i.url.startsWith(container)), 15_000)
    const item = got.find((i) => i.room === room && i.url.startsWith(container))!
    expect(item.from).toBe(A.webId)
    expect(item.kind).toBe('message')
  })

  it('a token for a different htu is refused', async () => {
    const auth = relayAuthFromAgent(B.session)
    const roomUrl = `${RELAY}/v1/room/${room || '0'.repeat(32)}`
    /** Dial the room, send an auth frame whose proof was made for `htu`, report the frames and how it ended. */
    const attempt = async (htu: string) => {
      const { token, proof } = await auth(relayHtu(htu))
      const ws = new WebSocket(roomUrl)
      const frames: string[] = []
      const end = await new Promise<{ code?: number; ready: boolean }>((resolve, reject) => {
        const t = setTimeout(() => {
          ws.close()
          reject(new Error('neither ready nor close within 15 s'))
        }, 15_000)
        ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', v: 1, token, proof }))
        ws.onmessage = (e) => {
          frames.push(String(e.data))
          if (String(e.data).includes('"ready"')) {
            clearTimeout(t)
            resolve({ ready: true })
          }
        }
        ws.onclose = (e) => {
          clearTimeout(t)
          resolve({ code: e.code, ready: false })
        }
      })
      ws.onclose = null
      ws.close()
      return { ...end, frames }
    }
    const wrong = await attempt(`${RELAY}/v1/me`)
    expect(wrong.code).toBe(4401)
    expect(wrong.frames.some((f) => f.includes('"ready"'))).toBe(false)
    // control: the same identity with a proof for the room's own htu is admitted, so the refusal was the htu
    const right = await attempt(roomUrl)
    expect(right.ready).toBe(true)
  })
})
