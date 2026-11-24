import { Button, Spinner, cx } from '@skpods/ui'
import type { PodStore } from '@skpods/solid-web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CLASS_LABEL } from '../config'
import { checkEntry, genesis } from '../lib/chain'
import { clock, shortHash, sleep } from '../lib/format'
import type { AuditEntry } from '../lib/types'
import { useGuardian } from '../lib/useGuardian'
import { CheckIcon, LinkIcon, Pill, ShieldIcon, XIcon } from '../ui'

export interface ChainCmd {
  id: number
  kind: 'verify' | 'tamper'
}
type Mark = 'checking' | 'ok' | 'bad' | 'skipped'

/** The copy of the audit log that sk-consent writes into Alice's own pod (consents/audit/<date>.jsonl). */
async function fetchMirror(store: PodStore, root: string): Promise<Map<number, string> | undefined> {
  try {
    const dir = `${root}skpods/v1/consents/audit/`
    const out = new Map<number, string>()
    for (const e of await store.list(dir)) {
      const r = await store.get(e.url, '*/*')
      for (const line of (r?.text ?? '').split('\n')) {
        if (!line.trim()) continue
        try {
          const j = JSON.parse(line)
          if (typeof j.seq === 'number' && j.hash) out.set(j.seq, j.hash)
        } catch {
          /* a partial line */
        }
      }
    }
    return out
  } catch {
    return undefined
  }
}

const summarize = (e: AuditEntry) => {
  const dc = e.data_class ? CLASS_LABEL[e.data_class] ?? e.data_class : ''
  const actor = e.actor ? (e.actor.includes('practitioner') ? 'clinic' : e.actor.includes('dw-alice') ? 'Alice' : e.actor === 'guardian' ? 'guardian' : e.actor === 'system' ? 'system' : 'agent') : ''
  return `${e.event.replace(/_/g, ' ')}${dc ? ` · ${dc}` : ''}${actor ? ` · ${actor}` : ''}`
}

export function ChainView({ cmd, compact }: { cmd?: ChainCmd; compact?: boolean }) {
  const g = useGuardian()
  const [marks, setMarks] = useState<Record<number, Mark>>({})
  const [shown, setShown] = useState<AuditEntry[]>([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ kind: 'verify' | 'tamper'; ok: boolean; n: number; head?: string; badAt?: number; reason?: string; server?: boolean; mirror?: { have: number; match: number; n: number } | 'unavailable' }>()
  const rows = useRef<Record<number, HTMLLIElement | null>>({})
  const runId = useRef(0)
  const entries = shown.length ? shown : g.audit

  const run = useCallback(
    async (kind: 'verify' | 'tamper') => {
      const my = ++runId.current
      setRunning(true)
      setResult(undefined)
      setMarks({})
      let list: AuditEntry[] = g.audit
      let serverOk: boolean | undefined
      const serverP = g.broker.verify().then((v) => v).catch(() => undefined)
      try {
        list = await g.broker.audit()
      } catch {
        /* use what we have */
      }
      if (kind === 'tamper') {
        // Change one recorded decision in a private copy: the SSN denial becomes an approval.
        const i = Math.max(1, list.findIndex((e) => e.event === 'decision' && e.data_class === 'ssn' && e.ts >= (g.baseline || '')) )
        const at = i > 0 ? i : Math.floor(list.length / 2)
        list = list.map((e, k) => (k === at ? { ...e, detail: { ...(typeof e.detail === 'object' ? e.detail : {}), action: 'approve', duration_s: 259200 } } : e))
      }
      setShown(list)
      const step = Math.min(140, Math.max(18, 2600 / Math.max(1, list.length)))
      let prev = await genesis(g.webId)
      let bad: { i: number; reason?: string } | undefined
      for (let i = 0; i < list.length; i++) {
        if (runId.current !== my) return
        setMarks((m) => ({ ...m, [list[i].seq]: 'checking' }))
        rows.current[list[i].seq]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        await sleep(step)
        const r = await checkEntry(list[i], i, g.webId, prev)
        if (!r.ok) {
          bad = { i, reason: r.reason }
          setMarks((m) => ({ ...m, [list[i].seq]: 'bad', ...Object.fromEntries(list.slice(i + 1).map((e) => [e.seq, 'skipped' as Mark])) }))
          break
        }
        prev = list[i].hash
        setMarks((m) => ({ ...m, [list[i].seq]: 'ok' }))
      }
      const sv = await serverP
      serverOk = sv?.ok
      let mirror: 'unavailable' | { have: number; match: number; n: number } = 'unavailable'
      if (kind === 'verify' && g.root) {
        const mm = await fetchMirror(g.store, g.root)
        if (mm) mirror = { have: mm.size, match: list.filter((e) => mm.get(e.seq) === e.hash).length, n: list.length }
      }
      if (runId.current !== my) return
      setResult({ kind, ok: !bad, n: list.length, head: bad ? undefined : list[list.length - 1]?.hash, badAt: bad?.i, reason: bad?.reason, server: serverOk, mirror })
      setRunning(false)
      if (kind === 'verify') g.verify().catch(() => undefined)
    },
    [g],
  )

  useEffect(() => {
    if (cmd) void run(cmd.kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd?.id])

  useEffect(() => {
    if (!running && !result) setShown([])
  }, [g.audit.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cx('flex min-h-0 flex-col', compact ? 'h-full' : '')} data-testid="chain-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand"><LinkIcon size={19} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-bold tracking-tight">Tamper-evident audit chain</p>
          <p className="text-[11px] text-muted">Each entry carries the hash of the one before it. Change one, and every link after it breaks.</p>
        </div>
        <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => run('tamper')} disabled={running || g.audit.length < 3} data-testid="tamper">Simulate tampering</Button>
        <Button className="!px-3 !py-1.5 text-xs" onClick={() => run('verify')} disabled={running || g.audit.length === 0} data-pres="verify" data-testid="verify">{running ? <Spinner size={13} /> : <ShieldIcon size={14} />} Verify chain</Button>
      </div>

      {result && (
        <div role="status" data-testid="chain-result" data-ok={result.ok} className={cx('mx-4 mt-3 animate-pop rounded-xl border px-3.5 py-3 text-sm', result.ok ? 'border-ok/40 bg-ok/10' : 'border-danger/40 bg-danger/10')}>
          {result.kind === 'verify' ? (
            <>
              <p className={cx('flex items-center gap-2 font-bold', result.ok ? 'text-ok' : 'text-danger')}>{result.ok ? <CheckIcon size={16} /> : <XIcon size={16} />}{result.ok ? `Chain verified: ${result.n} entries, none changed or removed` : `Chain broken at entry #${result.badAt}`}</p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                <li>Recomputed every SHA-256 in this browser, without trusting the service. Head <code className="font-mono text-ink">#{shortHash(result.head)}</code></li>
                <li>{result.server === undefined ? 'The service could not be asked.' : result.server ? 'The service agrees: its own check passes too.' : 'The service reports a broken chain.'}</li>
                <li>{result.mirror === 'unavailable' || !result.mirror ? 'The copy in your pod could not be read.' : `${result.mirror.match} of ${result.mirror.n} entries match the copy stored in your own pod${result.mirror.match < result.mirror.n ? ' (the pod copy trails by a moment)' : ''}.`}</li>
              </ul>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 font-bold text-danger"><XIcon size={16} /> Tampering found at entry #{result.badAt}</p>
              <p className="mt-1 text-xs text-muted">{result.reason}. This was a simulation on a private copy: one decision was rewritten from "deny" to "approve". Nothing in your pod or the service was touched, and the real chain still verifies.</p>
            </>
          )}
        </div>
      )}

      <ol className={cx('min-h-0 flex-1 space-y-1 overflow-y-auto scroll-thin px-4 py-3', compact ? '' : 'max-h-[60vh]')} data-testid="chain-list">
        {entries.length === 0 && <li className="py-8 text-center text-sm text-muted">The chain is empty. It starts with the first request.</li>}
        {entries.map((e) => {
          const m = marks[e.seq]
          return (
            <li key={e.seq} ref={(el) => (rows.current[e.seq] = el)} data-seq={e.seq} data-mark={m} className={cx('flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-300', m === 'ok' ? 'chain-ok border-ok/30 bg-ok/5' : m === 'bad' ? 'chain-bad border-danger/50 bg-danger/10' : m === 'checking' ? 'border-warn/50 bg-warn/10' : m === 'skipped' ? 'border-line bg-surface-2/40 opacity-50' : 'border-line bg-surface-2/60')}>
              <span className="w-7 shrink-0 text-right font-mono text-[10px] text-muted">#{e.seq}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{summarize(e)}</span>
              <span className="hidden shrink-0 font-mono text-[10px] text-muted sm:inline">{clock(e.ts)}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted"><span className="opacity-60">{shortHash(e.prev)}</span> <span aria-hidden>&rarr;</span> <span className={cx(m === 'ok' ? 'text-ok' : m === 'bad' ? 'text-danger' : 'text-ink')}>{shortHash(e.hash)}</span></span>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{m === 'ok' ? <CheckIcon size={13} className="text-ok" /> : m === 'bad' ? <XIcon size={13} className="text-danger" /> : m === 'checking' ? <Spinner size={12} /> : null}</span>
            </li>
          )
        })}
      </ol>
      {!compact && <div className="px-4 pb-3"><Pill>genesis = sha256("sk-consent audit genesis v1:" + your WebID)</Pill></div>}
    </div>
  )
}
