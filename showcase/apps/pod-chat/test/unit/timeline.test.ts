import { describe, expect, it } from 'vitest'
import { newMessageId } from '../../src/lib/codec'
import { pickCompactable } from '../../src/lib/engine'
import type { Msg, PeerView } from '../../src/lib/model'
import { layout, mergeEntries, nextInterval, unreadCount } from '../../src/lib/timeline'

const A = 'https://p/~a/profile/card#me'
const B = 'https://p/~b/profile/card#me'
const T0 = new Date(2026, 10, 20, 10, 0, 0).getTime()
const msg = (author: string, at: number, text = 't', extra: Partial<Msg> = {}): Msg => ({ id: newMessageId(at), author, text, createdAt: at, status: 'sent', ...extra })
const peer = (webId: string, msgs: Msg[], extra: Partial<PeerView> = {}): PeerView => ({ webId, status: 'active', msgs, ghosts: [], ...extra })
const meta = { createdAt: T0 - 1000, creator: A }

describe('merging streams', () => {
  it('interleaves two authors by send time', () => {
    const a1 = msg(A, T0 + 1000, 'a1'), b1 = msg(B, T0 + 2000, 'b1'), a2 = msg(A, T0 + 3000, 'a2')
    const e = mergeEntries([peer(A, [a1, a2]), peer(B, [b1])], [], meta)
    expect(e.flatMap((x) => (x.t === 'msg' ? [x.msg.text] : []))).toEqual(['a1', 'b1', 'a2'])
  })
  it('collapses the same id seen twice and prefers the confirmed copy', () => {
    const m = msg(A, T0 + 1000, 'dup')
    const e = mergeEntries([peer(A, [m])], [{ ...m, status: 'sending' }], meta)
    const got = e.flatMap((x) => (x.t === 'msg' ? [x.msg] : []))
    expect(got).toHaveLength(1)
    expect(got[0].status).toBe('sent')
  })
  it('keeps optimistic messages until confirmed', () => {
    const e = mergeEntries([peer(A, [])], [msg(A, T0 + 5, 'typing', { status: 'sending' })], meta)
    expect(e.some((x) => x.t === 'msg' && x.msg.status === 'sending')).toBe(true)
  })
})

describe('layout', () => {
  it('adds day separators and groups runs of one author', () => {
    const ms = [msg(A, T0), msg(A, T0 + 60_000), msg(B, T0 + 120_000), msg(A, T0 + 86_400_000 + 5)]
    const items = layout(mergeEntries([peer(A, [ms[0], ms[1], ms[3]]), peer(B, [ms[2]])], [], meta), A, [])
    expect(items.filter((i) => i.t === 'day')).toHaveLength(2)
    const m = items.filter((i) => i.t === 'msg') as any[]
    expect(m.map((x) => [x.startsRun, x.endsRun])).toEqual([[true, false], [false, true], [true, true], [true, true]])
  })
  it('attaches "seen by" to the newest of my messages a reader has read', () => {
    const m1 = msg(A, T0), m2 = msg(A, T0 + 1000), m3 = msg(A, T0 + 2000)
    const peers = [peer(A, [m1, m2, m3]), peer(B, [], { readUpTo: m2.id })]
    const items = layout(mergeEntries(peers, [], meta), A, peers)
    const seen = items.filter((i) => i.t === 'msg' && i.seenBy.length) as any[]
    expect(seen).toHaveLength(1)
    expect(seen[0].msg.id).toBe(m2.id)
    expect(seen[0].seenBy).toEqual([B])
  })
  it('turns a leaver into a system line and dissolved ghosts, collapsed per author', () => {
    const g = (i: number) => ({ id: `g${i}`, author: B, at: T0 + i * 1000, reason: 'hidden' as const })
    const peers = [peer(A, [msg(A, T0 + 10_000)]), peer(B, [], { status: 'left', leftAt: T0 + 5000, ghosts: [g(1), g(2), g(3)] })]
    const items = layout(mergeEntries(peers, [], meta), A, peers)
    const ghosts = items.filter((i) => i.t === 'ghost') as any[]
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].count).toBe(3)
    expect(items.some((i) => i.t === 'system' && i.kind === 'left' && i.who === B)).toBe(true)
  })
})

describe('polling and unread', () => {
  it('backs off while idle and snaps back on change', () => {
    let i = 2000
    const seen: number[] = []
    for (let n = 0; n < 8; n++) seen.push((i = nextInterval(i, false, 2000, 12000)))
    expect(seen[0]).toBe(2800)
    expect(Math.max(...seen)).toBe(12000)
    expect(nextInterval(12000, true, 2000, 12000)).toBe(2000)
  })
  it('counts only other people\'s messages after my read marker', () => {
    const m1 = msg(B, T0), m2 = msg(A, T0 + 1), m3 = msg(B, T0 + 2), m4 = msg(B, T0 + 3)
    expect(unreadCount([m1, m2, m3, m4], A, undefined)).toBe(3)
    expect(unreadCount([m1, m2, m3, m4], A, m3.id)).toBe(1)
    expect(unreadCount([m1, m2, m3, m4], A, m4.id)).toBe(0)
  })
})

describe('compaction picks', () => {
  const inv = (ids: string[]) => ({ loose: new Map(ids.map((i) => [i, 'u' + i])), segmentOf: new Map(), edits: new Map(), attachments: new Map(), receipts: [], hasLeft: false })
  const now = T0 + 10 * 3600_000
  it('needs at least 12 old, unedited loose messages', () => {
    const old = Array.from({ length: 12 }, (_, i) => msg(A, T0 + i))
    expect(pickCompactable(old, inv(old.map((m) => m.id)), now)).toHaveLength(12)
    expect(pickCompactable(old.slice(1), inv(old.slice(1).map((m) => m.id)), now)).toHaveLength(0)
  })
  it('leaves recent and edited messages alone', () => {
    const old = Array.from({ length: 13 }, (_, i) => msg(A, T0 + i))
    const i = inv(old.map((m) => m.id))
    i.edits.set(old[0].id, ['e'])
    expect(pickCompactable(old, i, now)).toHaveLength(12)
    expect(pickCompactable(old, inv(old.map((m) => m.id)), T0 + 3600_000)).toHaveLength(0)
  })
})
