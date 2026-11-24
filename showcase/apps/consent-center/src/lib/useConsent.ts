import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { Broker, BrokerError } from './broker'
import type { AuditEntry, ConsentRequest, Grant } from './types'

interface State {
  requests: Record<string, ConsentRequest>
  grants: Record<string, Grant>
  audit: Record<string, AuditEntry[]>
  loaded: boolean
  live: boolean
  error?: BrokerError
}

type Act =
  | { t: 'reset'; requests: ConsentRequest[]; grants: Grant[]; audit: Record<string, AuditEntry[]> }
  | { t: 'request'; r: ConsentRequest }
  | { t: 'grant'; g: Grant }
  | { t: 'audit'; e: AuditEntry }
  | { t: 'live'; v: boolean }
  | { t: 'error'; e?: BrokerError }

const bySeq = (a: AuditEntry, b: AuditEntry) => a.seq - b.seq

function reduce(s: State, a: Act): State {
  switch (a.t) {
    case 'reset':
      return { ...s, requests: Object.fromEntries(a.requests.map((r) => [r.id, r])), grants: Object.fromEntries(a.grants.map((g) => [g.id, g])), audit: a.audit, loaded: true, error: undefined }
    case 'request':
      return { ...s, requests: { ...s.requests, [a.r.id]: a.r } }
    case 'grant':
      return { ...s, grants: { ...s.grants, [a.g.id]: a.g } }
    case 'audit': {
      const list = s.audit[a.e.subject] ?? []
      if (list.some((x) => x.seq === a.e.seq)) return s
      return { ...s, audit: { ...s.audit, [a.e.subject]: [...list, a.e].sort(bySeq) } }
    }
    case 'live':
      return { ...s, live: a.v }
    case 'error':
      return { ...s, error: a.e }
  }
}

/** Requests, grants and audit chains for a set of people, kept live by server-sent events. */
export function useConsent(broker: Broker | undefined, subjects: string[], onEvent?: (kind: 'request' | 'grant' | 'audit', subject: string) => void) {
  const [state, dispatch] = useReducer(reduce, { requests: {}, grants: {}, audit: {}, loaded: false, live: false })
  const key = subjects.join('|')
  const cb = useRef(onEvent)
  cb.current = onEvent

  const reload = useCallback(async () => {
    if (!broker || !subjects.length) return
    try {
      const [rs, gs, as] = await Promise.all([
        Promise.all(subjects.map((s) => broker.requests(s))),
        Promise.all(subjects.map((s) => broker.grants(s))),
        Promise.all(subjects.map((s) => broker.audit(s))),
      ])
      dispatch({ t: 'reset', requests: rs.flat(), grants: gs.flat(), audit: Object.fromEntries(subjects.map((s, i) => [s, as[i]])) })
    } catch (e) {
      dispatch({ t: 'error', e: e instanceof BrokerError ? e : new BrokerError(String(e), 0) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broker, key])

  useEffect(() => {
    if (!broker || !subjects.length) return
    void reload()
    let wasDown = false
    const closers = subjects.map((s) =>
      broker.events(s, {
        onRequest: (r) => { dispatch({ t: 'request', r }); cb.current?.('request', s) },
        onGrant: (g) => { dispatch({ t: 'grant', g }); cb.current?.('grant', s) },
        onAudit: (e) => { dispatch({ t: 'audit', e }); cb.current?.('audit', s) },
        onOpen: () => { dispatch({ t: 'live', v: true }); if (wasDown) { wasDown = false; void reload() } },
        onDown: () => { wasDown = true; dispatch({ t: 'live', v: false }) },
      }),
    )
    return () => closers.forEach((c) => c())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broker, key])

  const requests = useMemo(() => Object.values(state.requests).sort((a, b) => b.created.localeCompare(a.created)), [state.requests])
  const grants = useMemo(() => Object.values(state.grants).sort((a, b) => a.ends.localeCompare(b.ends)), [state.grants])
  const merge = useCallback((r: ConsentRequest) => dispatch({ t: 'request', r }), [])
  const mergeGrant = useCallback((g: Grant) => dispatch({ t: 'grant', g }), [])
  return { ...state, requests, grants, reload, merge, mergeGrant }
}
