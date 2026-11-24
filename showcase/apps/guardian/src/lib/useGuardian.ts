import { PodStore, type SolidSession } from '@skpods/solid-web'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Bridge, Broker, brokerFetchFor, type BridgeHealth, type ReadResult } from './api'
import { loadFacts, loadPolicyDoc, refreshBooking, type PodFacts } from './pod'
import { verifyAll } from './chain'
import type { AuditEntry, ConsentRequest, Grant, Health, Policy, VerifyResult } from './types'

export interface ClinicRead extends ReadResult {
  /** True once a 200 was followed by a 403: the clinic saw its access end. */
  ended?: boolean
  firstOkAt?: string
}
export interface ChainCheck {
  state: 'idle' | 'checking' | 'done'
  server?: VerifyResult
  local?: { ok: boolean; firstBad?: number; reason?: string; head?: string }
  error?: string
}

const upsertBy = <T,>(list: T[], item: T, key: (t: T) => string): T[] => {
  const k = key(item)
  const i = list.findIndex((x) => key(x) === k)
  if (i < 0) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

const BASE_KEY = 'guardian:baseline'
const readBaseline = () => {
  try {
    return sessionStorage.getItem(BASE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function useGuardianState(session: SolidSession) {
  const webId = session.webId!
  const store = useMemo(() => new PodStore(session.fetch), [session])
  const broker = useMemo(() => new Broker(brokerFetchFor(session), webId), [session, webId])

  const [root, setRoot] = useState<string>()
  const [health, setHealth] = useState<Health>()
  const [brokerError, setBrokerError] = useState<string>()
  const [bridge, setBridge] = useState<BridgeHealth>()
  const [live, setLive] = useState(false)
  const [policy, setPolicy] = useState<Policy>()
  const [facts, setFacts] = useState<PodFacts>()
  const [requests, setRequests] = useState<ConsentRequest[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [reads, setReads] = useState<Record<string, ClinicRead>>({})
  const [baseline, setBaselineState] = useState(readBaseline)
  const [filing, setFiling] = useState(false)
  const [filedAt, setFiledAt] = useState<number>()
  const [decideMs, setDecideMs] = useState<number>()
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [chain, setChain] = useState<ChainCheck>({ state: 'idle' })
  const [snapshots, setSnapshots] = useState<Record<string, Policy>>({})
  const [error, setError] = useState<string>()

  const setBaseline = (iso: string) => {
    setBaselineState(iso)
    try {
      sessionStorage.setItem(BASE_KEY, iso)
    } catch {
      /* private mode */
    }
  }

  // ---- initial load ----
  const loadAll = useCallback(async () => {
    const [h, rq, gr, au] = await Promise.all([broker.health(), broker.requests(), broker.grants(), broker.audit()])
    setHealth(h)
    setBrokerError(undefined)
    setRequests(rq)
    setGrants(gr)
    setAudit(au)
  }, [broker])

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const r = await store.storageRoot(webId)
        if (dead) return
        setRoot(r)
        if (r) setFacts(await loadFacts(store, r))
      } catch (e) {
        if (!dead) setError((e as Error).message)
      }
      try {
        await loadAll()
        const p = await broker.policy()
        if (!dead) setPolicy(p)
      } catch (e) {
        if (!dead) setBrokerError((e as Error).message === 'Failed to fetch' ? 'The guardian service is not reachable.' : (e as Error).message)
      }
      Bridge.health().then((b) => !dead && setBridge(b)).catch(() => !dead && setBridge(undefined))
    })()
    return () => {
      dead = true
    }
  }, [store, broker, webId, loadAll])

  // ---- live events, with a slow poll as a safety net ----
  useEffect(() => {
    const off = broker.events({
      audit: (e) => setAudit((l) => (l.some((x) => x.seq === e.seq) ? l : [...l, e].sort((a, b) => a.seq - b.seq))),
      request: (r) => setRequests((l) => upsertBy(l, r, (x) => x.id)),
      grant: (g) => setGrants((l) => upsertBy(l, g, (x) => x.id)),
      state: setLive,
    })
    const t = setInterval(() => {
      if (!document.hidden) loadAll().catch(() => undefined)
    }, 12_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [broker, loadAll])

  useEffect(() => {
    const t = setInterval(() => Bridge.health().then(setBridge).catch(() => setBridge(undefined)), 15_000)
    return () => clearInterval(t)
  }, [])

  // ---- the current scene: the newest request since the baseline ----
  const sorted = useMemo(() => [...requests].sort((a, b) => b.created.localeCompare(a.created)), [requests])
  const current = useMemo(() => sorted.find((r) => r.created >= baseline), [sorted, baseline])
  const currentId = current?.id
  // The audit entries of a request that is still being decided (the request object arrives last).
  const pendingRequestId = useMemo(() => {
    const last = [...audit].reverse().find((e) => e.event === 'request_received')
    return last && last.ts >= baseline && !requests.some((r) => r.id === last.request) ? last.request : undefined
  }, [audit, requests, baseline])
  const sceneId = currentId ?? pendingRequestId

  // Policy as it was when the request came in (for replaying the decision as a trace).
  useEffect(() => {
    if (!sceneId || snapshots[sceneId]) return
    broker.policy().then((p) => setSnapshots((s) => (s[sceneId] ? s : { ...s, [sceneId]: p }))).catch(() => undefined)
  }, [sceneId, broker, snapshots])

  const sceneGrants = useMemo(() => grants.filter((g) => g.request_id === sceneId), [grants, sceneId])
  const activeGrants = useMemo(() => grants.filter((g) => g.status === 'active' && new Date(g.ends).getTime() > Date.now()), [grants])

  // ---- what the clinic can read right now (really asks the pod through the bridge) ----
  const readsRef = useRef(reads)
  readsRef.current = reads
  const readOne = useCallback(async (resource: string, itemId: string, grantId?: string) => {
    try {
      const r = await Bridge.read(resource, grantId)
      setReads((m) => {
        const prev = m[itemId]
        const ended = r.status !== 200 && (prev?.status === 200 || prev?.ended)
        return { ...m, [itemId]: { ...r, ended: ended || undefined, firstOkAt: r.status === 200 ? (prev?.firstOkAt ?? r.at) : prev?.firstOkAt } }
      })
      return r
    } catch {
      return undefined
    }
  }, [])

  const itemsKey = current?.items.map((i) => `${i.id}:${i.status}`).join(',') ?? ''
  useEffect(() => {
    if (!current || !bridge) return
    let stop = false
    const tick = async () => {
      if (stop || document.hidden) return
      for (const it of current.items) {
        const known = readsRef.current[it.id]
        const wantsRead = it.status === 'granted' || ((it.status === 'revoked' || it.status === 'expired') && known?.status === 200)
        if (wantsRead) await readOne(it.resource, it.id, it.grant_id)
      }
    }
    void tick()
    const t = setInterval(tick, 3000)
    return () => {
      stop = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, itemsKey, bridge, readOne])

  // ---- actions ----
  const guard = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      return await fn()
    } catch (e) {
      setError((e as Error).message)
      return undefined
    } finally {
      setBusy((b) => ({ ...b, [key]: false }))
    }
  }

  const fileRequest = useCallback(
    async (extra: Record<string, unknown> = {}) => {
      setFiling(true)
      setFiledAt(Date.now())
      setError(undefined)
      try {
        // Anything newer than this moment is the new scene.
        setBaseline(new Date(Date.now() - 1500).toISOString())
        setReads({})
        const r = await Bridge.request(webId, extra)
        if (r.status !== 201) throw new Error((r.request as unknown as { error?: string })?.error ?? `Request rejected (HTTP ${r.status})`)
        setDecideMs(r.ms)
        setRequests((l) => upsertBy(l, r.request, (x) => x.id))
        return r.request
      } catch (e) {
        setError((e as Error).message === 'Failed to fetch' ? 'The clinic bridge is not running (npm run bridge).' : (e as Error).message)
        return undefined
      } finally {
        setFiling(false)
      }
    },
    [webId],
  )

  const decide = useCallback(
    (req: ConsentRequest, itemId: string, action: 'approve' | 'deny', duration?: string) =>
      guard(`decide:${itemId}`, async () => {
        const r = await broker.decide(req.id, [{ item_id: itemId, action, duration, reason: action === 'deny' ? 'Declined by Alice.' : undefined }])
        setRequests((l) => upsertBy(l, r, (x) => x.id))
        return r
      }),
    [broker],
  )

  const revokeGrant = useCallback(
    (id: string, reason = 'revoked-by-owner') =>
      guard(`revoke:${id}`, async () => {
        const g = await broker.revoke(id, reason)
        setGrants((l) => upsertBy(l, g, (x) => x.id))
        return g
      }),
    [broker],
  )

  const revokeAll = useCallback(
    (reason = 'revoke-everything') =>
      guard('revokeAll', async () => {
        const live = grants.filter((g) => g.status === 'active')
        const done = await Promise.all(live.map((g) => broker.revoke(g.id, reason).catch(() => undefined)))
        setGrants((l) => done.reduce<Grant[]>((acc, g) => (g ? upsertBy(acc, g, (x) => x.id) : acc), l))
        return done.filter(Boolean).length
      }),
    [broker, grants],
  )

  /** Clear the stage for a replay: end old grants, forget the old scene (the audit chain keeps everything). */
  const resetStage = useCallback(async () => {
    setBaseline(new Date().toISOString())
    setReads({})
    setChain({ state: 'idle' })
    setDecideMs(undefined)
    const live = grants.filter((g) => g.status === 'active')
    await Promise.all(live.map((g) => broker.revoke(g.id, 'scenario-reset').catch(() => undefined)))
    await loadAll().catch(() => undefined)
  }, [grants, broker, loadAll])

  const verify = useCallback(async () => {
    setChain({ state: 'checking' })
    try {
      const [server, entries] = await Promise.all([broker.verify(), broker.audit()])
      setAudit(entries)
      const local = await verifyAll(entries, webId)
      setChain({ state: 'done', server, local })
    } catch (e) {
      setChain({ state: 'done', error: (e as Error).message })
    }
  }, [broker, webId])

  const tryRead = useCallback((resource: string, itemId: string) => readOne(resource, itemId), [readOne])

  const moveBooking = useCallback(async () => {
    if (!root || !bridge) throw new Error('The clinic bridge is needed to know the clinic WebID')
    await refreshBooking(store, root, webId, bridge.webid)
    setFacts(await loadFacts(store, root))
  }, [root, bridge, store, webId])

  const reloadPolicy = useCallback(async () => {
    const p = await broker.policy()
    setPolicy(p)
    return p
  }, [broker])

  return {
    webId, store, broker, root, health, brokerError, bridge, live, policy, facts, requests: sorted, grants, audit, reads, current, sceneId, pendingRequestId,
    sceneGrants, activeGrants, filing, filedAt, decideMs, busy, chain, snapshots, error, baseline,
    setError, fileRequest, decide, revokeGrant, revokeAll, resetStage, verify, tryRead, moveBooking, reloadPolicy, setPolicy, loadAll, setFacts,
  }
}

export type Guardian = ReturnType<typeof useGuardianState>
export const GuardianContext = createContext<Guardian | null>(null)
export function useGuardian(): Guardian {
  const g = useContext(GuardianContext)
  if (!g) throw new Error('GuardianContext missing')
  return g
}
