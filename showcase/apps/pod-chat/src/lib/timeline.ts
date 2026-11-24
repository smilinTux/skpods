// Pure functions: merge every participant's message stream into one timeline.
import { compareIds } from './codec'
import type { Entry, Item, Msg, PeerView } from './model'

/** Merge all streams plus my optimistic (pending) messages, ordered by send time. Duplicate ids collapse (a message can briefly exist loose and inside a segment). */
export function mergeEntries(peers: PeerView[], pending: Msg[], meta: { createdAt: number; creator: string }): Entry[] {
  const byId = new Map<string, Msg>()
  for (const p of peers) for (const m of p.msgs) byId.set(m.id, m)
  for (const m of pending) if (!byId.has(m.id) || byId.get(m.id)!.status !== 'sent') byId.set(m.id, m)
  const msgs = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id))

  const entries: Entry[] = msgs.map((m) => ({ t: 'msg', msg: m }))
  const ghosts = peers.flatMap((p) => p.ghosts)
  ghosts.sort((a, b) => a.at - b.at)
  for (const g of ghosts) entries.push({ t: 'ghost', author: g.author, reason: g.reason, count: 1, at: g.at, key: `g-${g.id}` })
  for (const p of peers) if (p.status === 'left' && p.leftAt) entries.push({ t: 'system', kind: 'left', who: p.webId, at: p.leftAt, key: `left-${p.webId}` })
  entries.push({ t: 'system', kind: 'created', who: meta.creator, at: meta.createdAt, key: 'created' })
  return entries.sort((a, b) => timeOf(a) - timeOf(b) || (a.t === 'system' ? -1 : 0))
}

const timeOf = (e: Entry) => (e.t === 'msg' ? e.msg.createdAt : e.at)

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Add day separators, group runs of the same author, collapse neighbouring ghosts, attach "seen by" markers. */
export function layout(entries: Entry[], meId: string, peers: PeerView[]): Item[] {
  // 1. collapse consecutive ghosts of the same author and reason
  const collapsed: Entry[] = []
  for (const e of entries) {
    const prev = collapsed[collapsed.length - 1]
    if (e.t === 'ghost' && prev && prev.t === 'ghost' && prev.author === e.author && prev.reason === e.reason) prev.count += e.count
    else collapsed.push(e.t === 'ghost' ? { ...e } : e)
  }
  // 2. seen-by: each reader is attached to the newest of MY sent messages they have read
  const mine = collapsed.filter((e): e is Extract<Entry, { t: 'msg' }> => e.t === 'msg' && e.msg.author === meId && e.msg.status === 'sent')
  const seenBy = new Map<string, string[]>()
  for (const p of peers) {
    if (p.webId === meId || !p.readUpTo) continue
    let target: string | undefined
    for (const e of mine) if (compareIds(e.msg.id, p.readUpTo) <= 0) target = e.msg.id
    if (target) seenBy.set(target, [...(seenBy.get(target) ?? []), p.webId])
  }
  // 3. day separators and runs
  const items: Item[] = []
  let lastDay = ''
  for (let i = 0; i < collapsed.length; i++) {
    const e = collapsed[i]
    const at = timeOf(e)
    const dk = dayKey(at)
    if (dk !== lastDay) {
      items.push({ t: 'day', key: `day-${dk}`, at })
      lastDay = dk
    }
    if (e.t !== 'msg') {
      items.push(e)
      continue
    }
    const prev = collapsed[i - 1]
    const next = collapsed[i + 1]
    const sameAsPrev = prev?.t === 'msg' && prev.msg.author === e.msg.author && dayKey(timeOf(prev)) === dk && at - prev.msg.createdAt < 5 * 60_000
    const sameAsNext = next?.t === 'msg' && next.msg.author === e.msg.author && dayKey(timeOf(next)) === dk && next.msg.createdAt - at < 5 * 60_000
    items.push({ t: 'msg', key: e.msg.id, msg: e.msg, mine: e.msg.author === meId, startsRun: !sameAsPrev, endsRun: !sameAsNext, seenBy: seenBy.get(e.msg.id) ?? [] })
  }
  return items
}

/** Polling backoff: reset to the base interval on any change, otherwise grow by 1.4x up to the ceiling. */
export function nextInterval(current: number, changed: boolean, base: number, max: number): number {
  return changed ? base : Math.min(max, Math.round(current * 1.4))
}

export function unreadCount(msgs: Msg[], meId: string, readUpTo?: string): number {
  return msgs.filter((m) => m.author !== meId && (!readUpTo || compareIds(m.id, readUpTo) > 0)).length
}
