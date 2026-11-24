import { cx } from '@skpods/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CLASS_LABEL, CLINIC_NAME, KIND_ONE, SENSITIVITY } from '../config'
import { clock, humanSeconds, shortHash } from '../lib/format'
import { entriesFor, narrate, outcomeOf, type Tone } from '../lib/narrate'
import { parseDuration, trace, type Facts, type Trace } from '../lib/policy'
import type { AuditEntry, ConsentRequest, Item, Policy } from '../lib/types'
import { useGuardian } from '../lib/useGuardian'
import { BoltIcon, CheckIcon, ClockIcon, FileIcon, LockIcon, Pill, ShieldIcon, SparkIcon, XIcon, useNow } from '../ui'

const TONE_PILL: Record<Tone, 'neutral' | 'ok' | 'warn' | 'danger' | 'brand'> = { good: 'ok', bad: 'danger', warn: 'warn', neutral: 'neutral', brand: 'brand' }

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]', ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-danger/30 bg-danger/10 text-danger')}>
      {ok ? <CheckIcon size={11} /> : <XIcon size={11} />}
      {children}
    </span>
  )
}

function Step({ icon, title, i, children, tone = 'neutral' }: { icon: React.ReactNode; title: string; i: number; children?: React.ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'brand' }) {
  const c = { neutral: 'bg-surface-2 text-muted', ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', danger: 'bg-danger/15 text-danger', brand: 'bg-brand/15 text-brand' }[tone]
  return (
    <li className="step-in relative flex gap-3" style={{ animationDelay: `${i * 170}ms` }}>
      <span className={cx('z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', c)}>{icon}</span>
      <div className="min-w-0 flex-1 pb-3.5">
        <p className="text-[13px] font-semibold leading-6">{title}</p>
        {children && <div className="text-[13px] text-muted">{children}</div>}
      </div>
    </li>
  )
}

function factsFor(req: ConsentRequest, g: ReturnType<typeof useGuardian>): { facts: Facts; providerName?: string; booking?: { ref: string; name: string; start: string; end: string } } {
  const p = g.facts?.providers.find((x) => x.webid === req.requester.webid && x.active)
  const b = g.facts?.booking
  const created = new Date(req.created).getTime()
  const bookingOk = Boolean(b && b.confirmed && b.provider === req.requester.webid && new Date(b.end).getTime() > created && (!req.context.booking_ref || b.ref === req.context.booking_ref))
  return { facts: { requesterInProviders: Boolean(p), hasBooking: bookingOk }, providerName: p?.name, booking: bookingOk ? b : undefined }
}

function ItemCard({ req, item, policy, open, onToggle, events, focused }: { req: ConsentRequest; item: Item; policy?: Policy; open: boolean; onToggle: () => void; events: AuditEntry[]; focused: boolean }) {
  const g = useGuardian()
  const { facts, providerName, booking } = factsFor(req, g)
  const requestedS = parseDuration(req.requested_duration)
  const tr: Trace | undefined = useMemo(() => (policy ? trace(policy, item.data_class, req.requester.kind, facts, requestedS) : undefined), [policy, item.data_class, req.requester.kind, facts.requesterInProviders, facts.hasBooking, requestedS]) // eslint-disable-line react-hooks/exhaustive-deps
  const agrees = !tr || (tr.decision.ruleId ?? undefined) === (item.decision.rule_id ?? undefined)
  const out = outcomeOf(item)
  const who = { clinic: req.requester.name, owner: g.webId }
  const follow = events.filter((e) => ['grant_written', 'data_read', 'revoke', 'expiry', 'revoke_verified', 'grant_failed'].includes(e.event) || (e.event === 'decision' && (e.detail as { decided_by?: string } | undefined)?.decided_by === 'owner'))
  let n = 0
  const sens = SENSITIVITY[item.data_class]
  const dec = item.decision
  // The guardian's own decision, as recorded when it was made (an owner decision later overwrites the item's decision).
  const gd = events.find((e) => e.event === 'decision' && (e.detail as { decided_by?: string } | undefined)?.decided_by === 'guardian')?.detail as { action?: string; reason?: string } | undefined
  const base = (gd?.action ?? dec.action) as 'approve' | 'ask_owner' | 'deny'
  const baseReason = gd?.reason ?? dec.reason
  return (
    <section data-testid={`think-${item.data_class}`} data-focused={focused || undefined} className={cx('rounded-2xl border bg-surface transition-all duration-500', focused ? 'border-brand/50 shadow-glow' : 'border-line')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', out.tone === 'good' || out.tone === 'brand' ? 'bg-ok/15 text-ok' : out.tone === 'bad' ? 'bg-danger/15 text-danger' : out.tone === 'warn' ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted')}>
          {out.tone === 'bad' ? <XIcon size={16} /> : out.tone === 'warn' ? <ClockIcon size={16} /> : <CheckIcon size={16} />}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{CLASS_LABEL[item.data_class] ?? item.label}</p>
          <p className="truncate font-mono text-[11px] text-muted">{item.decision.rule_id ?? 'no rule matched'}</p>
        </div>
        <Pill tone={TONE_PILL[out.tone]} className="shrink-0" >{out.label}</Pill>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cx('shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ol className="rail space-y-0 px-4 pb-1 pt-1">
          <Step i={n++} icon={<BoltIcon size={13} />} title={`${req.requester.name} asks for ${CLASS_LABEL[item.data_class] ?? item.label}`} tone="brand">
            <p>Requester kind <b className="text-ink">{KIND_ONE[req.requester.kind] ?? req.requester.kind}</b>{req.requested_duration ? <> · asked for <b className="text-ink">{req.requested_duration}</b></> : null}. Purpose: {req.purpose}.</p>
          </Step>
          <Step i={n++} icon={<FileIcon size={13} />} title="Checks the context in Alice's pod">
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Check ok={facts.requesterInProviders}>{facts.requesterInProviders ? `on the providers list (${providerName})` : 'not on the providers list'}</Check>
              <Check ok={facts.hasBooking}>{booking ? `confirmed booking ${booking.ref}` : 'no confirmed booking'}</Check>
              <Check ok>{`inside the area the guardian may manage`}</Check>
              <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px]"><LockIcon size={11} />{sens === 'locked' ? 'owner-only file' : `${sens} sensitivity`}</span>
            </div>
          </Step>
          <Step i={n++} icon={<ShieldIcon size={13} />} title={tr ? `Walks Alice's rules, top to bottom (${policy!.rules.length})` : 'Reads her rules'}>
            {tr ? (
              <ul className="mt-1 space-y-1" data-testid={`rules-${item.data_class}`}>
                {tr.steps.filter((s) => s.state !== 'unreached' || false).map((s) => (
                  <li key={s.rule.id} className={cx('rounded-lg border px-2 py-1.5', s.state === 'matched' ? 'border-brand/50 bg-brand/10' : 'border-line bg-surface-2/60 opacity-80')}>
                    <div className="flex items-center gap-2">
                      <span className={cx('font-mono text-[11px] font-semibold', s.state === 'matched' ? 'text-brand' : 'text-muted')}>{s.rule.id}</span>
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wide">{s.state === 'matched' ? <span className="text-brand">match</span> : <span className="text-muted">skip</span>}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">{s.checks.map((c, i) => <Check key={i} ok={c.ok}>{c.label}</Check>)}</div>
                  </li>
                ))}
                {tr.steps.some((s) => s.state === 'unreached') && <li className="px-1 text-[11px] text-muted">{tr.steps.filter((s) => s.state === 'unreached').length} more rule(s) not reached: the first match wins.</li>}
                {!tr.matched && <li className="px-1 text-[11px] text-muted">No rule covers this, so the safe default applies: ask Alice.</li>}
                {!agrees && <li className="rounded-lg border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn">This replay uses today's rules and differs from the rule the service applied ({item.decision.rule_id ?? 'none'}). The rules were probably edited since.</li>}
              </ul>
            ) : <p>Loading the rules...</p>}
          </Step>
          <Step i={n++} icon={base === 'approve' ? <CheckIcon size={13} /> : base === 'deny' ? <XIcon size={13} /> : <ClockIcon size={13} />} title={base === 'approve' ? `Decision: approve${dec.duration_s && dec.decided_by === 'guardian' ? ` for ${humanSeconds(dec.duration_s)}` : ''}` : base === 'deny' ? 'Decision: deny' : 'Decision: ask Alice'} tone={base === 'approve' ? 'ok' : base === 'deny' ? 'danger' : 'warn'}>
            <p className="text-ink/90" data-testid={`reason-${item.data_class}`}>{baseReason}</p>
            {dec.counter_offer && <p className="mt-1 text-brand">Counter-offer: {dec.counter_offer.message}</p>}
            {base === 'ask_owner' && dec.recommendation && <p className="mt-1">Recommendation to Alice: <b className="text-ink">{dec.recommendation.action === 'approve' ? `approve${dec.recommendation.duration_s ? ` for ${humanSeconds(dec.recommendation.duration_s)}` : ''}` : 'decline'}</b>.</p>}
          </Step>
          {dec.explanation && (
            <Step i={n++} icon={<SparkIcon size={13} />} title="In plain words" tone="brand">
              <p className="italic text-ink/90" data-testid={`llm-${item.data_class}`}>{dec.explanation}</p>
              <p className="mt-0.5 text-[11px]">Worded by an LLM. It did not decide anything: the rule above did.</p>
            </Step>
          )}
          {follow.map((e) => {
            const l = narrate(e, who)
            return (
              <Step key={e.seq} i={n++} icon={l.tone === 'bad' ? <XIcon size={13} /> : <CheckIcon size={13} />} title={l.text} tone={l.tone === 'good' ? 'ok' : l.tone === 'bad' ? 'danger' : l.tone === 'warn' ? 'warn' : 'neutral'}>
                <p className="font-mono text-[11px]">{clock(e.ts)} · audit #{e.seq} · {shortHash(e.hash)}</p>
              </Step>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export function ThinkingPanel({ className }: { className?: string }) {
  const g = useGuardian()
  const { current, audit, snapshots, filing, pendingRequestId } = g
  const sceneId = g.sceneId
  const events = useMemo(() => entriesFor(audit, sceneId), [audit, sceneId])
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  useEffect(() => setToggled({}), [sceneId])

  // While the request is still being decided the request object does not exist yet: show items from audit entries.
  const items: Item[] = useMemo(() => {
    if (current) return current.items
    return events
      .filter((e) => e.event === 'decision')
      .map((e) => {
        const d = e.detail as Record<string, any>
        return {
          id: String(e.item), data_class: String(e.data_class), label: CLASS_LABEL[String(e.data_class)] ?? String(e.data_class), resource: String(e.resource ?? ''),
          status: d.action === 'approve' ? 'granted' : d.action === 'deny' ? 'denied' : 'awaiting_owner',
          decision: { action: d.action, duration_s: d.duration_s ?? undefined, reason: String(d.reason ?? ''), decided_by: String(d.decided_by ?? 'guardian'), rule_id: d.rule_id },
        } as Item
      })
  }, [current, events])
  const reqView: ConsentRequest | undefined = current ?? (pendingRequestId ? ({ id: pendingRequestId, requester: { webid: g.bridge?.webid ?? '', name: CLINIC_NAME, kind: 'clinic' }, subject: g.webId, purpose: 'Pre-visit intake', context: {}, created: events[0]?.ts ?? new Date().toISOString(), status: 'awaiting_owner', items } as ConsentRequest) : undefined)

  const now = useNow(2000)
  const lastWithItem = [...events].reverse().find((e) => e.item)
  const focusId = lastWithItem?.item as string | undefined
  const fresh = Boolean(lastWithItem && now - new Date(lastWithItem.ts).getTime() < 7000)
  const policy = sceneId ? snapshots[sceneId] : undefined
  useEffect(() => {
    if (focusId) refs.current[focusId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusId, items.length])

  const thinking = filing || (Boolean(pendingRequestId) && !current)
  const waiting = items.some((i) => i.status === 'awaiting_owner')
  const state = thinking ? 'thinking' : waiting ? 'waiting' : reqView ? 'done' : 'idle'

  return (
    <div className={cx('flex min-h-0 flex-col', className)} data-testid="thinking-panel" data-state={state}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className={cx('flex h-9 w-9 items-center justify-center rounded-xl', state === 'thinking' ? 'bg-brand/20 text-brand animate-glow-pulse' : 'bg-brand/15 text-brand')}><ShieldIcon size={20} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-bold tracking-tight">The guardian's thinking</p>
          <p className="text-[11px] text-muted" data-testid="think-status">
            {state === 'idle' && 'Waiting for a request'}
            {state === 'thinking' && 'Reading the rules from Alice\'s pod...'}
            {state === 'waiting' && 'Decided what it could. Waiting for Alice on the rest.'}
            {state === 'done' && `All items decided${g.decideMs ? ` · request answered in ${(g.decideMs / 1000).toFixed(1)} s (includes writing the pod rules)` : ''}`}
          </p>
        </div>
        {g.health?.llm_explanations ? <Pill tone="brand" className="shrink-0"><SparkIcon size={11} /> LLM wording on</Pill> : <Pill className="shrink-0">Rules only</Pill>}
      </div>
      {thinking && <div className="thinking-bar mx-4 mt-3" aria-hidden />}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scroll-thin px-4 py-4">
        {!reqView && !thinking && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-brand/10 text-brand"><span className="ring" /><span className="ring" style={{ animationDelay: '1.2s' }} /><ShieldIcon size={34} /></span>
            <p className="text-sm font-semibold">Nothing to decide yet</p>
            <p className="max-w-xs text-xs text-muted">Press <b>Send intake request</b> on the clinic's screen, or start presenter mode. Every rule the guardian checks will appear here, in order.</p>
          </div>
        )}
        {thinking && items.length === 0 && (
          <div className="space-y-2" aria-hidden>
            {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-surface-2" style={{ animationDelay: `${i * 200}ms` }} />)}
          </div>
        )}
        {reqView && items.map((it) => {
          const itEvents = events.filter((e) => e.item === it.id)
          const isFocus = it.id === focusId
          const open = toggled[it.id] ?? (isFocus || it.status === 'awaiting_owner')
          return (
            <div key={it.id} ref={(el) => (refs.current[it.id] = el)}>
              <ItemCard req={reqView} item={it} policy={policy} open={open} focused={isFocus && fresh} events={itEvents} onToggle={() => setToggled((t) => ({ ...t, [it.id]: !open }))} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
