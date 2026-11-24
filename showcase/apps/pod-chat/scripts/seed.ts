// Seeds the demo conversations with the agent flow (client credentials), writing each message into its AUTHOR's pod.
//   npm run demo -w @skpods/pod-chat          (needs SKP_TEST_ENV=<creds files>)
//   npm run demo:clean -w @skpods/pod-chat    removes the demo conversations again
import { fileURLToPath } from 'node:url'
import { PodStore } from '@skpods/solid-web'
import {
  attachmentFile, encodeConversation, encodeInvitation, encodeMessage, encodeReceipt, encodeSegment, messageFile, newMessageId, receiptFile, segmentFile,
  type ConvMeta, type RawMessage,
} from '../src/lib/codec'
import { convUrl, inboxUrl } from '../src/lib/paths'
import { ensureInbox, writeConversationAcl } from '../src/lib/setup'
import { actor, haveEnv, type Actor } from './env'
import { drawingPng } from './png'

const H = 3600_000
const MIN = 60_000
export const DEMO_IDS = ['demo-family', 'demo-clinic', 'demo-picnic']
const CAST = ['alice', 'bob', 'kid', 'grandma', 'practitioner']

interface Script {
  at: number // ms before now
  who: string
  text: string
  image?: boolean
}

const FAMILY: Script[] = [
  { at: 96 * H, who: 'alice', text: 'Grandma\'s birthday dinner is Saturday at 6. Is everyone free?' },
  { at: 95.8 * H, who: 'bob', text: 'Free! I will pick up the cake from Maple Street Bakery.' },
  { at: 95.5 * H, who: 'kid', text: 'Can I help carry it?' },
  { at: 95.4 * H, who: 'bob', text: 'You are in charge of the candles.' },
  { at: 95.3 * H, who: 'kid', text: 'Deal. How many candles is it?' },
  { at: 95.1 * H, who: 'alice', text: 'Seventy five. Maybe we skip the real fire and use the sparkly ones.' },
  { at: 95 * H, who: 'kid', text: 'Sparkly ones!!' },
  { at: 72 * H, who: 'alice', text: 'Reminder: school forms are due Friday. They are in the blue folder by the door.' },
  { at: 71.7 * H, who: 'kid', text: 'Already signed my part' },
  { at: 71.5 * H, who: 'bob', text: 'I will sign mine tonight.' },
  { at: 49 * H, who: 'bob', text: 'Running late, the bakery had a queue. Cake is chocolate with berries.' },
  { at: 48.8 * H, who: 'alice', text: 'Perfect. Grandma will love it. Leave the berries off one corner for Sam.' },
  { at: 48.7 * H, who: 'kid', text: 'Thanks mom!' },
  { at: 27 * H, who: 'alice', text: 'Dinner was lovely. Thank you both for making it special.' },
  { at: 26.9 * H, who: 'bob', text: 'Best birthday so far. Grandma kept the sparkler.' },
  { at: 26.5 * H, who: 'kid', text: 'She said it was the best day this year' },
  { at: 9 * H, who: 'alice', text: 'Who is walking Biscuit this morning?' },
  { at: 8.9 * H, who: 'bob', text: 'On it, back in 30.' },
  { at: 5 * H, who: 'kid', text: 'Can I have a friend over after school?' },
  { at: 4.9 * H, who: 'alice', text: 'Yes, if homework is done first.' },
  { at: 4.8 * H, who: 'kid', text: 'Homework is done. Promise.' },
  { at: 40 * MIN, who: 'kid', text: 'Look what I drew at school today!', image: true },
  { at: 33 * MIN, who: 'alice', text: 'That is wonderful, Sam! Is that our house?' },
  { at: 28 * MIN, who: 'kid', text: 'Yes! With the sun and everything' },
  { at: 14 * MIN, who: 'bob', text: 'I am putting that on the fridge. Pizza for dinner?' },
  { at: 6 * MIN, who: 'kid', text: 'Yesss pizza' },
]

const CLINIC: Script[] = [
  { at: 72 * H, who: 'practitioner', text: 'Hello Alice, this is Bayview Family Clinic. Your annual check-up is booked for Thursday at 9:30 AM.' },
  { at: 71 * H, who: 'alice', text: 'Thank you! Do I need to fast?' },
  { at: 70.5 * H, who: 'practitioner', text: 'No fasting needed. Please bring your insurance card and a list of current medications.' },
  { at: 70 * H, who: 'alice', text: 'Will do. Can the pre-visit form be sent ahead?' },
  { at: 69 * H, who: 'practitioner', text: 'Yes, you will get a secure request first. You decide what to share and for how long.' },
  { at: 3 * H, who: 'practitioner', text: 'Reminder: your visit is tomorrow at 9:30 AM. Reply here if you need to reschedule.' },
  { at: 2 * H, who: 'alice', text: 'See you then.' },
]

const PICNIC: Script[] = [
  { at: 25 * MIN, who: 'alice', text: 'Sunday picnic at the lake? I can bring sandwiches.' },
  { at: 24 * MIN, who: 'alice', text: 'Bob, Grandma: say yes and you can read the rest of the plan.' },
]

interface Plan {
  meta: ConvMeta
  script: Script[]
  /** Newest message id each person has read, by script index. */
  readUpTo: Record<string, number>
}

export async function cleanDemo(log: (s: string) => void = () => {}) {
  for (const who of CAST) {
    const a = await actor(who)
    for (const id of DEMO_IDS) {
      const url = convUrl(a.root, id)
      if (await a.store.exists(url)) {
        await a.store.deleteRecursive(url)
        log(`removed ${who}/${id}`)
      }
    }
    const box = inboxUrl(a.root)
    for (const id of DEMO_IDS) await a.store.delete(`${box}inv-${id}.ttl`).catch(() => false)
  }
}

export async function seedDemo(log: (s: string) => void = () => {}, now = Date.now()): Promise<void> {
  const A = Object.fromEntries(await Promise.all(CAST.map(async (w) => [w, await actor(w)] as const))) as Record<string, Actor>
  const all = CAST.map((w) => A[w].webId)
  await cleanDemo(log)
  for (const who of CAST) {
    const changed = await ensureInbox(A[who].store, A[who].webId, A[who].root, all)
    log(`${who}: invitation inbox ${changed ? 'configured' : 'already fine'}`)
  }

  const plans: Plan[] = [
    { meta: { id: 'demo-family', title: 'Rivera family', kind: 'group', creator: A.alice.webId, participants: [A.alice.webId, A.bob.webId, A.kid.webId], createdAt: now - 97 * H }, script: FAMILY, readUpTo: { alice: 24, bob: 25, kid: 25 } },
    { meta: { id: 'demo-clinic', title: 'Bayview Family Clinic', kind: 'direct', creator: A.practitioner.webId, participants: [A.practitioner.webId, A.alice.webId], createdAt: now - 73 * H }, script: CLINIC, readUpTo: { alice: 6, practitioner: 6 } },
    { meta: { id: 'demo-picnic', title: 'Sunday picnic', kind: 'group', creator: A.alice.webId, participants: [A.alice.webId, A.bob.webId, A.grandma.webId], createdAt: now - 26 * MIN }, script: PICNIC, readUpTo: { alice: 1 } },
  ]
  const png = drawingPng()

  for (const plan of plans) {
    const { meta } = plan
    const members = meta.participants
    const byWho = (webId: string) => Object.values(A).find((a) => a.webId === webId)!
    // joined participants: everyone except the invitees of the picnic
    const joined = meta.id === 'demo-picnic' ? [A.alice.webId] : members
    for (const w of joined) {
      const a = byWho(w)
      const container = convUrl(a.root, meta.id)
      await a.store.put(container + 'conversation.ttl', encodeConversation(container + 'conversation.ttl', meta))
      await writeConversationAcl(a.store, a.webId, container, members)
    }
    // messages: old ones as one archive file per author, recent ones as single files
    const raws = plan.script.map((s, i) => {
      const a = A[s.who]
      const createdAt = Math.round(now - s.at)
      const id = newMessageId(createdAt)
      const m: RawMessage = { id, author: a.webId, text: s.text, createdAt }
      if (s.image) m.attachment = { url: convUrl(a.root, meta.id) + attachmentFile(id, 'png'), type: 'image/png', width: 640, height: 420 }
      return { s, m, i }
    })
    for (const w of joined) {
      const a = byWho(w)
      const container = convUrl(a.root, meta.id)
      const mine = raws.filter((r) => r.m.author === a.webId)
      const old = mine.filter((r) => now - r.m.createdAt > 3 * H)
      const recent = mine.filter((r) => now - r.m.createdAt <= 3 * H)
      if (old.length) {
        const seg = container + segmentFile(old[0].m.createdAt, old[old.length - 1].m.createdAt)
        await a.store.put(seg, encodeSegment(seg, old.map((r) => r.m)))
      }
      for (const r of recent) {
        if (r.m.attachment) await a.store.put(r.m.attachment.url, png, 'image/png')
        const url = container + messageFile(r.m.id)
        await a.store.put(url, encodeMessage(url, r.m))
      }
      const who = Object.keys(A).find((k) => A[k].webId === w)!
      const upTo = plan.readUpTo[who]
      if (upTo !== undefined) {
        const id = raws[Math.min(upTo, raws.length - 1)].m.id
        const url = container + receiptFile(id)
        await a.store.put(url, encodeReceipt(url, a.webId, id, now - 60_000))
      }
      log(`${who}/${meta.id}: ${old.length} archived + ${recent.length} loose messages`)
    }
    // the picnic is still an invitation for the others
    if (meta.id === 'demo-picnic') {
      for (const w of [A.bob, A.grandma]) {
        const box = inboxUrl(w.root)
        const slug = `inv-${meta.id}.ttl`
        await A.alice.store.post(box, encodeInvitation(box + slug, { descriptor: convUrl(A.alice.root, meta.id) + 'conversation.ttl', sender: A.alice.webId, title: meta.title, at: now - 24 * MIN }), { slug })
        log(`invited ${w.who} to ${meta.id}`)
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!haveEnv) {
    console.error('Set SKP_TEST_ENV to the colon separated credential files (see README).')
    process.exit(2)
  }
  const log = (s: string) => console.log(s)
  void (process.argv.includes('--clean') ? cleanDemo(log) : seedDemo(log)).then(() => console.log('done'), (e) => { console.error(e); process.exit(1) })
}
export type { PodStore }
