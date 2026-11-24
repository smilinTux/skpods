// The chat engine against pods-dev, headless (agent logins, no browser). Two or three real pods, real ACLs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actor, haveEnv, type Actor } from '../../scripts/env'
import { seedDemo } from '../../scripts/seed'
import { ChatEngine } from '../../src/lib/engine'
import { demoCast } from '../../src/lib/people'
import { convUrl, inboxUrl } from '../../src/lib/paths'
import { classify, encodeMessage, messageFile, nameOf, newMessageId } from '../../src/lib/codec'
import { drawingPng } from '../../scripts/png'

const run = `t${Date.now().toString(36)}`
let A: Actor, B: Actor, K: Actor
const engines: ChatEngine[] = []

async function engineFor(a: Actor): Promise<ChatEngine> {
  const e = new ChatEngine({ store: a.store, me: a.webId, contacts: demoCast(new URL(a.webId).origin).filter((w) => w !== a.webId), autoPoll: false })
  await e.start()
  engines.push(e)
  return e
}
const texts = (e: ChatEngine, id: string) => e.get(id)!.items.flatMap((i) => (i.t === 'msg' ? [i.msg.text] : []))
const list = async (a: Actor, id: string) => (await a.store.list(convUrl(a.root, id))).map((e) => nameOf(e.url))

describe.skipIf(!haveEnv)('pod chat engine on pods-dev', () => {
  beforeAll(async () => {
    ;[A, B, K] = await Promise.all([actor('alice'), actor('bob'), actor('kid')])
    await seedDemo()
  })
  afterAll(async () => {
    engines.forEach((e) => e.stop())
    for (const a of [A, B, K]) {
      for (const id of (await a.store.list(`${a.root}skpods/v1/chat/`)).map((e) => nameOf(e.url)).filter((n) => n.startsWith(`c-${run}`) || n === 'demo-picnic-test')) await a.store.deleteRecursive(convUrl(a.root, id)).catch(() => {})
      for (const e of await a.store.list(inboxUrl(a.root)).catch(() => [])) if (e.url.includes(`c-${run}`)) await a.store.delete(e.url).catch(() => {})
    }
  })

  it('loads the seeded family chat from three pods: archives plus loose files, merged by time', async () => {
    const alice = await engineFor(A)
    await alice.refresh()
    const rows = alice.list()
    expect(rows.map((r) => r.title)).toEqual(expect.arrayContaining(['Rivera family', 'Bayview Family Clinic', 'Sunday picnic']))
    const fam = alice.get('demo-family')!
    const msgs = fam.items.flatMap((i) => (i.t === 'msg' ? [i.msg] : []))
    expect(msgs).toHaveLength(26)
    expect(msgs.map((m) => m.createdAt)).toEqual([...msgs.map((m) => m.createdAt)].sort((a, b) => a - b))
    expect(new Set(msgs.map((m) => m.author)).size).toBe(3)
    expect(msgs.some((m) => m.attachment?.type === 'image/png')).toBe(true)
    expect(rows.find((r) => r.id === 'demo-family')!.unread).toBe(1) // Sam's last message
    expect(fam.peers.every((p) => p.status === 'active')).toBe(true)
    // the picnic: bob and grandma were invited but have not joined, the pod answers 403
    const picnic = alice.get('demo-picnic')!
    expect(picnic.peers.filter((p) => p.status === 'hidden')).toHaveLength(2)
  })

  it('shows an invitation, joins, and the first message flows between two pods', async () => {
    const bob = await engineFor(B)
    await bob.refresh()
    const inv = bob.invitations.find((i) => i.title === 'Sunday picnic')
    expect(inv).toBeTruthy()
    expect(bob.list().some((r) => r.id === 'demo-picnic')).toBe(false)
    await bob.acceptInvite(inv!)
    await bob.refresh()
    expect(bob.invitations.find((i) => i.title === 'Sunday picnic')).toBeUndefined()
    expect(texts(bob, 'demo-picnic')).toContain('Sunday picnic at the lake? I can bring sandwiches.')
    await bob.send('demo-picnic', 'Yes! I will bring lemonade.')
    // the message is a file in BOB's pod and nowhere in alice's
    expect((await list(B, 'demo-picnic')).some((n) => classify(n).kind === 'message')).toBe(true)
    expect((await list(A, 'demo-picnic')).filter((n) => classify(n).kind === 'message')).toHaveLength(2)
    const alice = await engineFor(A)
    await alice.refresh()
    expect(texts(alice, 'demo-picnic')).toContain('Yes! I will bring lemonade.')
    expect(alice.get('demo-picnic')!.peers.find((p) => p.webId === B.webId)!.status).toBe('active')
    // put the demo back the way the seed leaves it
    await bob.leave('demo-picnic')
    await bob.eraseMyCopy('demo-picnic')
  })

  it('full life of a conversation: send, photo, receipt, edit, delete, leave, rejoin', async () => {
    const alice = await engineFor(A)
    const bob = await engineFor(B)
    await alice.start()
    const id = await alice.createConversation({ others: [B.webId] })
    expect(id).toMatch(/^c-/)
    expect(alice.get(id)!.meta.kind).toBe('direct')
    await bob.refresh()
    const inv = bob.invitations.find((i) => i.descriptor.includes(id))!
    expect(inv.senderName).toContain('Alice')
    // Rename so cleanup can find it
    await bob.acceptInvite(inv)

    await alice.send(id, 'Hello Bob, are you there?')
    const upload = { blob: new Blob([new Uint8Array(drawingPng(64, 42))], { type: 'image/png' }), type: 'image/png', ext: 'png', width: 64, height: 42 }
    await alice.send(id, 'Photo for you', upload)
    await bob.refresh()
    await alice.refresh()
    expect(texts(bob, id)).toEqual(['Hello Bob, are you there?', 'Photo for you'])
    const photo = bob.get(id)!.items.flatMap((i) => (i.t === 'msg' ? [i.msg] : [])).find((m) => m.attachment)!
    expect(photo.attachment!.url.startsWith(convUrl(A.root, id))).toBe(true) // the image lives in ALICE's pod
    const img = await B.store.fetch(photo.attachment!.url) // bob can fetch it through the ACL
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toContain('image/png')

    // read receipt: a tiny resource in BOB's pod
    bob.markRead(id)
    await new Promise((r) => setTimeout(r, 1500))
    await alice.refresh()
    expect((await list(B, id)).some((n) => classify(n).kind === 'receipt')).toBe(true)
    const seen = alice.get(id)!.items.filter((i) => i.t === 'msg' && i.seenBy.length > 0)
    expect(seen).toHaveLength(1)
    expect((seen[0] as any).msg.text).toBe('Photo for you')

    // bob replies, alice sees it; unread logic
    await bob.send(id, 'Here! Lovely picture.')
    await alice.refresh()
    expect(texts(alice, id).at(-1)).toBe('Here! Lovely picture.')
    expect(alice.list().find((r) => r.id === id)!.unread).toBe(1)

    // edit: a new file, newest wins, others see "edited"
    const first = alice.get(id)!.items.find((i) => i.t === 'msg')! as any
    await alice.edit(id, first.msg.id, 'Hello Bob, are you free tonight?')
    await bob.refresh()
    const edited = bob.get(id)!.items.find((i) => i.t === 'msg') as any
    expect(edited.msg.text).toBe('Hello Bob, are you free tonight?')
    expect(edited.msg.editedAt).toBeGreaterThan(0)
    expect((await list(A, id)).some((n) => classify(n).kind === 'edit')).toBe(true)

    // delete: the file is gone from alice's pod and bob sees a deleted marker
    await alice.remove(id, first.msg.id)
    await bob.refresh()
    expect(texts(bob, id)).not.toContain('Hello Bob, are you free tonight?')
    expect(bob.get(id)!.items.some((i) => i.t === 'ghost' && i.reason === 'deleted')).toBe(true)
    expect((await list(A, id)).filter((n) => classify(n).kind === 'message')).toHaveLength(1)

    // leave: alice revokes. Bob's request for her container is now 403, her messages dissolve
    await alice.leave(id)
    expect((await B.store.request(convUrl(A.root, id))).status).toBe(403)
    expect((await B.store.request(convUrl(A.root, id) + 'left.ttl')).status).toBe(200) // the notice stays readable
    await bob.refresh()
    const v = bob.get(id)!
    expect(v.peers.find((p) => p.webId === A.webId)!.status).toBe('left')
    expect(texts(bob, id)).toEqual(['Here! Lovely picture.'])
    expect(v.items.some((i) => i.t === 'ghost' && i.reason === 'hidden')).toBe(true)
    expect(v.items.some((i) => i.t === 'system' && i.kind === 'left')).toBe(true)
    // alice kept her data, and cannot write while away
    await alice.refresh()
    expect(alice.get(id)!.left).toBe(true)
    expect((await list(A, id)).filter((n) => classify(n).kind === 'message').length).toBeGreaterThan(0)
    await expect(alice.send(id, 'should fail')).rejects.toThrow(/left/)

    // rejoin: access returns, messages reappear
    await alice.rejoin(id)
    expect((await B.store.request(convUrl(A.root, id))).status).toBe(200)
    await bob.refresh()
    for (const p of [1, 2]) { void p; await bob.refresh() }
    expect(bob.get(id)!.peers.find((p) => p.webId === A.webId)!.status).toBe('active')
    expect(texts(bob, id)).toContain('Photo for you')
    expect(bob.get(id)!.items.some((i) => i.t === 'ghost' && i.reason === 'hidden')).toBe(false)
  })

  it('archives old loose messages into one segment without readers noticing, and deleting inside it works', async () => {
    const alice = await engineFor(A)
    const bob = await engineFor(B)
    await alice.refresh()
    const id = await alice.createConversation({ others: [B.webId] })
    await bob.refresh()
    await bob.acceptInvite(bob.invitations.find((i) => i.descriptor.includes(id))!)
    const container = convUrl(A.root, id)
    const base = Date.now() - 5 * 3600_000
    const ids: string[] = []
    for (let i = 0; i < 13; i++) {
      const mid = newMessageId(base + i * 60_000)
      ids.push(mid)
      const m = { id: mid, author: A.webId, text: `old message ${i}`, createdAt: base + i * 60_000 }
      await A.store.put(container + messageFile(mid), encodeMessage(container + messageFile(mid), m))
    }
    await bob.refresh()
    expect(texts(bob, id)).toHaveLength(13)
    await alice.refresh() // sees 13 loose, old enough: compacts
    const names = await list(A, id)
    expect(names.filter((n) => classify(n).kind === 'message')).toHaveLength(0)
    expect(names.filter((n) => classify(n).kind === 'segment')).toHaveLength(1)
    await bob.refresh()
    expect(texts(bob, id)).toHaveLength(13) // nothing lost, nothing duplicated
    expect(bob.get(id)!.items.some((i) => i.t === 'ghost')).toBe(false)
    // delete one message that now lives inside the archive
    await alice.refresh()
    await alice.remove(id, ids[3])
    await bob.refresh()
    expect(texts(bob, id)).toHaveLength(12)
    expect(texts(bob, id)).not.toContain('old message 3')
    expect(bob.get(id)!.items.some((i) => i.t === 'ghost' && i.reason === 'deleted')).toBe(true)
  })

  it('a stranger cannot read a conversation they are not part of', async () => {
    const alice = await engineFor(A)
    await alice.refresh()
    const id = await alice.createConversation({ others: [B.webId] })
    await alice.send(id, 'private between us')
    const r = await K.store.request(convUrl(A.root, id))
    expect(r.status).toBe(403)
    expect((await K.store.request(convUrl(A.root, id) + 'conversation.ttl')).status).toBe(403)
  })
})
