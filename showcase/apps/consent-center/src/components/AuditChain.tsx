import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Spinner, cx } from '@skpods/ui'
import { canonical, tamper, verifyChain, type ChainResult, type LinkCheck, type TamperMode } from '../lib/chain'
import type { VerifyReport } from '../lib/broker'
import { clock, lastSegment, shortHash, span, time } from '../lib/format'
import type { AuditEntry } from '../lib/types'
import { BrokenLinkIcon, CheckIcon, ChainIcon, ChevronIcon, XIcon } from './Icons'

type NameOf = (webId?: string) => string

function describe(e: AuditEntry, nameOf: NameOf): { title: string; text: string; tone: 'good' | 'bad' | 'warn' | 'neutral' } {
  const d = e.detail ?? {}
  const what = (e.data_class ?? '').replace(/_/g, ' ')
  switch (e.event) {
    case 'request_received':
      return { title: 'Request received', text: `${d.requester_name ?? nameOf(e.actor)} asked for ${(d.items ?? []).map((x: string) => x.replace(/_/g, ' ')).join(', ')}${d.requested_duration ? ` (${d.requested_duration})` : ''}.`, tone: 'neutral' }
    case 'decision': {
      const by = d.decided_by === 'owner' ? nameOf(e.actor) : 'Your rules'
      if (d.action === 'approve') return { title: d.decided_by === 'owner' ? 'Allowed by you' : 'Allowed by your rules', text: `${what}${d.duration_s ? ` for ${span(d.duration_s)}` : ''}, decided by ${by}.`, tone: 'good' }
      if (d.action === 'deny') return { title: d.decided_by === 'owner' ? 'Declined by you' : 'Declined by your rules', text: `${what}: ${d.reason ?? 'not shared'}`, tone: 'bad' }
      return { title: 'Waiting for you', text: `${what}: your rules ask for a person to decide.`, tone: 'warn' }
    }
    case 'grant_written':
      return { title: 'Access rule written to the pod', text: `${nameOf(e.grantee)} may read ${what} until ${d.ends ? time(d.ends) : '?'}.`, tone: 'good' }
    case 'grant_failed':
      return { title: 'Access could not be applied', text: `The pod refused the rule for ${what}. Nothing was shared.`, tone: 'bad' }
    case 'data_read':
      return { title: 'Read reported', text: `${nameOf(e.grantee)} reports reading ${what}: HTTP ${d.http_status}. Self-reported, pods do not push access logs.`, tone: Number(d.http_status) === 200 ? 'neutral' : 'warn' }
    case 'revoke':
      return { title: 'Access revoked', text: `${nameOf(e.actor)} switched off ${nameOf(e.grantee)}'s read access to ${what}.`, tone: 'warn' }
    case 'expiry':
      return { title: 'Access expired', text: `${nameOf(e.grantee)}'s read access to ${what} ended on schedule.`, tone: 'warn' }
    case 'revoke_verified':
      return { title: 'Pod checked after revoke', text: d.acl_clean ? `The ${lastSegment(e.resource ?? '')} rule no longer names the requester.` : 'The rule still names the requester, retrying.', tone: d.acl_clean ? 'good' : 'bad' }
    default:
      return { title: e.event, text: '', tone: 'neutral' }
  }
}

const TONE: Record<string, string> = { good: 'bg-ok', bad: 'bg-danger', warn: 'bg-warn', neutral: 'bg-muted' }

interface Props {
  subject: string
  entries: AuditEntry[]
  nameOf: NameOf
  verifyOnServer: () => Promise<VerifyReport>
  podCopy?: () => Promise<{ found: number; matched: number; behind: number; files: number } | { error: string }>
}

export function AuditChain({ subject, entries, nameOf, verifyOnServer, podCopy }: Props) {
  const [tamperOn, setTamperOn] = useState(false)
  const [mode, setMode] = useState<TamperMode>('edit')
  const [forged, setForged] = useState<{ entries: AuditEntry[]; index: number; mode: TamperMode }>()
  const [result, setResult] = useState<ChainResult>()
  const [revealed, setRevealed] = useState(0)
  const [running, setRunning] = useState(false)
  const [server, setServer] = useState<VerifyReport | 'loading' | { error: string }>()
  const [pod, setPod] = useState<Awaited<ReturnType<NonNullable<Props['podCopy']>>> | 'loading'>()
  const [open, setOpen] = useState<number>()
  const [limit, setLimit] = useState(14)
  const run = useRef(0)

  const view = forged?.entries ?? entries

  // New entries or another person: the last verdict no longer describes what is on screen.
  useEffect(() => {
    setResult(undefined)
    setRevealed(0)
    setServer(undefined)
    setPod(undefined)
  }, [subject, entries.length])
  useEffect(() => {
    setForged(undefined)
    setTamperOn(false)
  }, [subject])

  const verify = useCallback(
    async (list: AuditEntry[], withServer: boolean) => {
      const id = ++run.current
      setRunning(true)
      setResult(undefined)
      setRevealed(0)
      const res = await verifyChain(subject, list)
      if (id !== run.current) return
      setResult(res)
      const step = Math.max(12, Math.min(70, 1400 / Math.max(1, list.length)))
      for (let i = 1; i <= list.length; i++) {
        await new Promise((r) => setTimeout(r, step))
        if (id !== run.current) return
        setRevealed(i)
      }
      setRunning(false)
      if (withServer) {
        setServer('loading')
        verifyOnServer().then((s) => id === run.current && setServer(s)).catch((e) => setServer({ error: (e as Error).message }))
      }
    },
    [subject, verifyOnServer],
  )

  const forge = async (index: number) => {
    const list = await tamper(entries, index, mode)
    setForged({ entries: list, index, mode })
    void verify(list, true)
  }
  const restore = () => {
    run.current++
    setForged(undefined)
    setResult(undefined)
    setRevealed(0)
    setRunning(false)
    setServer(undefined)
  }

  const done = result && revealed >= view.length
  const state: 'unknown' | 'checking' | 'valid' | 'broken' = !result ? (running ? 'checking' : 'unknown') : !done ? 'checking' : result.ok ? 'valid' : 'broken'
  const bad = result?.checks.find((c) => !c.ok)

  const checkAt = (i: number): LinkCheck | undefined => (result && i < revealed ? result.checks[i] : undefined)
  const shown = useMemo(() => {
    const idx = view.map((_, i) => i).reverse()
    return idx.slice(0, Math.max(limit, forged ? view.length : 0))
  }, [view, limit, forged])

  return (
    <div className="space-y-5">
      <section
        className={cx(
          'skp-card p-5 transition-colors',
          state === 'valid' && 'border-ok/50',
          state === 'broken' && 'border-danger/60',
        )}
        aria-live="polite"
        data-testid="chain-status"
        data-state={state}
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className={cx('flex h-12 w-12 items-center justify-center rounded-2xl', state === 'valid' ? 'bg-ok/15 text-ok' : state === 'broken' ? 'bg-danger/15 text-danger' : 'bg-brand-soft text-brand')}>
            {state === 'checking' ? <Spinner size={22} label="Verifying" /> : state === 'broken' ? <BrokenLinkIcon size={24} /> : state === 'valid' ? <CheckIcon size={24} /> : <ChainIcon size={24} />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight">
              {state === 'valid' && 'The chain is intact'}
              {state === 'broken' && `The chain breaks at entry #${view[bad?.index ?? 0]?.seq ?? bad?.index}`}
              {state === 'checking' && 'Recomputing every hash in your browser'}
              {state === 'unknown' && 'Audit chain'}
            </h2>
            <p className="text-sm text-muted" data-testid="chain-summary">
              {state === 'unknown' && `${entries.length} entries. Each one carries the hash of the entry before it, so changing or removing any of them is visible.`}
              {state === 'checking' && 'SHA-256 over each entry, then a check that it links to the one before.'}
              {state === 'valid' && (
                <>
                  {view.length} entries recomputed here, head <span className="font-mono">{shortHash(result!.head ?? '', 12)}</span>. No entry was changed or removed.
                </>
              )}
              {state === 'broken' && bad && <>{bad.reason}.</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="verify" onClick={() => verify(view, true)} loading={running} disabled={view.length === 0}>
              <CheckIcon size={16} /> Verify in my browser
            </Button>
            {podCopy && (
              <Button
                variant="secondary"
                data-testid="compare-pod"
                disabled={pod === 'loading'}
                onClick={() => {
                  setPod('loading')
                  podCopy().then(setPod).catch((e) => setPod({ error: (e as Error).message }))
                }}
              >
                Compare with the pod copy
              </Button>
            )}
          </div>
        </div>

        {(server || pod) && (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
            {server && (
              <li className="flex items-start gap-2" data-testid="server-verdict">
                <span className="mt-0.5 text-muted">Service</span>
                <span>
                  {server === 'loading' ? 'checking its own copy...' : 'error' in server ? <span className="text-danger">{server.error}</span> : server.ok ? (
                    <>says its stored chain verifies{forged ? '. It does: the edit exists only in your browser copy.' : ' too.'}</>
                  ) : (
                    <span className="text-danger">says its stored chain is broken at entry {server.first_bad_index}</span>
                  )}
                </span>
              </li>
            )}
            {pod && (
              <li className="flex items-start gap-2" data-testid="pod-verdict">
                <span className="mt-0.5 text-muted">Pod copy</span>
                <span>
                  {pod === 'loading' ? 'reading audit files from your pod...' : 'error' in pod ? <span className="text-danger">{pod.error}</span> : pod.found === 0 ? (
                    <>no audit file in the pod yet</>
                  ) : pod.matched === entries.length ? (
                    <span className="text-ok">all {pod.matched} entries match the files in your pod ({pod.files} {pod.files === 1 ? 'file' : 'files'}).</span>
                  ) : (
                    <span className="text-warn">{pod.matched} of {entries.length} entries match; {pod.behind > 0 ? `${pod.behind} not mirrored yet.` : 'some differ.'}</span>
                  )}
                </span>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="skp-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={tamperOn}
            data-testid="tamper-toggle"
            onClick={() => {
              if (tamperOn) restore()
              setTamperOn((v) => !v)
            }}
            className={cx('relative h-6 w-11 shrink-0 rounded-full border transition', tamperOn ? 'border-danger/50 bg-danger/20' : 'border-line bg-surface-2')}
          >
            <span className={cx('absolute top-0.5 rounded-full transition-all', tamperOn ? 'left-[22px] bg-danger' : 'left-0.5 bg-muted')} style={{ height: 18, width: 18 }} />
            <span className="sr-only">Tamper demo</span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Tamper demo</p>
            <p className="text-xs text-muted">Play the attacker on a copy in this tab. The stored chain is never touched.</p>
          </div>
          {forged && (
            <Button variant="ghost" onClick={restore} data-testid="restore">
              Restore the real chain
            </Button>
          )}
        </div>
        {tamperOn && (
          <div className="mt-3 space-y-2 animate-fade-up">
            <div role="radiogroup" aria-label="Kind of tampering" className="flex flex-wrap gap-2">
              {([
                ['edit', 'Edit an entry'],
                ['rehash', 'Edit and recompute its hash'],
                ['delete', 'Remove an entry'],
              ] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  data-testid={`tamper-${m}`}
                  onClick={() => setMode(m)}
                  className={cx('rounded-full border px-3 py-1 text-xs font-medium transition', mode === m ? 'border-danger/60 bg-danger/10 text-danger' : 'border-line text-muted hover:border-danger/40')}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              {mode === 'edit' && 'Change who an entry names. The stored hash no longer matches the content.'}
              {mode === 'rehash' && 'A careful attacker also recomputes that entry\'s hash. The entry looks fine, but the next entry still points at the old hash.'}
              {mode === 'delete' && 'Cut an entry out. The numbering and the link of the next entry no longer fit.'}
              {' '}Pick an entry below.
            </p>
          </div>
        )}
      </section>

      {view.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Nothing recorded yet. The first request starts the chain.</p>
      ) : (
        <ol className="relative" data-testid="chain">
          {shown.map((i, n) => {
            const e = view[i]
            const c = checkAt(i)
            const d = describe(e, nameOf)
            const isForged = forged && forged.index === i && forged.mode !== 'delete'
            const expanded = open === i
            const linkBad = c && !c.linkOk
            const contentBad = c && !c.contentOk
            const lower = i > 0 ? view[i - 1] : undefined
            return (
              <li key={`${e.seq}-${e.hash}-${i}`} className="relative" data-testid="chain-entry" data-seq={e.seq} data-event={e.event} data-ok={c ? String(c.ok) : 'unchecked'}>
                <div
                  className={cx(
                    'skp-card relative p-4 transition',
                    c?.ok && 'border-ok/40',
                    c && !c.ok && 'border-danger/60 bg-danger/5',
                    isForged && 'ring-2 ring-danger/40',
                  )}
                  style={{ animationDelay: `${Math.min(n, 8) * 25}ms` }}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-lg bg-surface-2 px-1.5 font-mono text-xs font-semibold">#{e.seq}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <span aria-hidden className={cx('h-2 w-2 rounded-full', TONE[d.tone])} />
                          {d.title}
                          {isForged && <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">edited here</span>}
                        </p>
                        <time className="font-mono text-xs text-muted" dateTime={e.ts}>{clock(e.ts)}</time>
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{d.text}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                        <span className={cx('rounded px-1.5 py-0.5', linkBad ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-muted')} title={e.prev}>prev {shortHash(e.prev)}</span>
                        <span aria-hidden className="text-muted">&rarr;</span>
                        <span className={cx('rounded px-1.5 py-0.5', contentBad ? 'bg-danger/15 text-danger' : c?.ok ? 'bg-ok/15 text-ok' : 'bg-surface-2 text-muted')} title={e.hash}>hash {shortHash(e.hash)}</span>
                        {c && (
                          <span className={cx('inline-flex items-center gap-1 font-sans text-xs font-medium', c.ok ? 'text-ok' : 'text-danger')}>
                            {c.ok ? <CheckIcon size={13} /> : <XIcon size={13} />}
                            {c.ok ? 'verified' : 'fails'}
                          </span>
                        )}
                      </div>
                      {contentBad && (
                        <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-danger" data-testid="content-mismatch">
                          stored {shortHash(e.hash, 16)}<br />recomputed {shortHash(c!.recomputed, 16)}
                        </p>
                      )}
                      {tamperOn && !forged && (
                        <Button variant="danger" className="mt-3 !py-1.5 text-xs" data-testid="tamper-entry" onClick={() => forge(i)}>
                          {mode === 'delete' ? 'Remove this entry' : mode === 'rehash' ? 'Edit it and recompute its hash' : 'Edit this entry'}
                        </Button>
                      )}
                      <button type="button" className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => setOpen(expanded ? undefined : i)} aria-expanded={expanded}>
                        <ChevronIcon size={13} className={cx('transition', expanded && 'rotate-90')} /> What was hashed
                      </button>
                      {expanded && (
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">
                          {canonical((({ hash: _h, ...r }) => r)(e))}
                        </pre>
                      )}
                    </div>
                  </div>
                </div>
                {/* the link to the entry below (older) */}
                <div className="flex items-stretch gap-3 pl-6" aria-hidden={!c}>
                  <div className={cx('my-0 w-0.5 self-stretch', c ? (linkBad ? 'bg-danger' : 'bg-ok/60') : 'bg-line')} style={{ minHeight: 28 }} />
                  <div className="flex items-center py-1.5">
                    {c ? (
                      <span
                        className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium animate-pop', linkBad ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ok/40 bg-ok/10 text-ok')}
                        data-testid="link-state"
                        data-link={linkBad ? 'broken' : 'ok'}
                      >
                        {linkBad ? <BrokenLinkIcon size={13} /> : <ChainIcon size={13} />}
                        {linkBad
                          ? lower
                            ? `broken: prev is ${shortHash(e.prev)}, but #${lower.seq} hashes to ${shortHash(lower.hash)}`
                            : `broken: does not start from the chain's genesis`
                          : lower
                            ? `links to #${lower.seq}`
                            : 'starts at the genesis hash'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">{lower ? `links to #${lower.seq}` : 'starts at the genesis hash'}</span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
          {shown.length < view.length && (
            <li className="pb-4 pl-6">
              <Button variant="ghost" onClick={() => setLimit((l) => l + 20)}>Show {Math.min(20, view.length - shown.length)} older entries</Button>
            </li>
          )}
          <li className="relative">
            <div className="rounded-2xl border border-dashed border-line px-4 py-3 text-xs text-muted">
              <span className="font-semibold text-ink">Genesis.</span> The first entry links to the hash of the text <span className="break-all font-mono">sk-consent audit genesis v1:{subject}</span>, so a chain cannot be moved to another person.
            </div>
          </li>
        </ol>
      )}
    </div>
  )
}
