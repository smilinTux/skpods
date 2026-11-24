import { Avatar, ConsentChip, Countdown, Spinner, cx } from '@skpods/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CLASS_LABEL, CLINIC_NAME } from '../config'
import { clock, humanSeconds } from '../lib/format'
import { entriesFor, narrate, type Line } from '../lib/narrate'
import type { ConsentRequest, Item } from '../lib/types'
import { useGuardian } from '../lib/useGuardian'
import { BellIcon, CheckIcon, ClockIcon, EyeIcon, LockIcon, Pill, ShieldIcon, SparkIcon, UnlockIcon, XIcon, useNow } from '../ui'

export type PhoneTab = 'feed' | 'access'

const DURATIONS = [
  { id: '24h', label: '24 hours', s: 86400 },
  { id: 'until_booking_end', label: 'Until the visit ends', s: -1 },
  { id: '1h', label: '1 hour', s: 3600 },
]

function Bubble({ children, tone = 'agent', className }: { children: React.ReactNode; tone?: 'agent' | 'good' | 'bad'; className?: string }) {
  return (
    <div className={cx('flex items-start gap-2.5 animate-card-in', className)}>
      <span aria-hidden className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', tone === 'good' ? 'bg-ok/15 text-ok' : tone === 'bad' ? 'bg-danger/15 text-danger' : 'bg-brand/15 text-brand')}>
        <ShieldIcon size={15} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function ApprovalCard({ req, item }: { req: ConsentRequest; item: Item }) {
  const g = useGuardian()
  const [pick, setPick] = useState<string>(() => {
    const rec = item.decision.recommendation?.duration_s
    return DURATIONS.find((d) => d.s === rec)?.id ?? '24h'
  })
  const rec = item.decision.recommendation
  const busy = g.busy[`decide:${item.id}`]
  return (
    <div className="animate-card-in overflow-hidden rounded-2xl border border-warn/50 bg-surface shadow-glow ring-1 ring-warn/20" data-testid="approval-card" data-item={item.data_class}>
      <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2.5">
        <Pill tone="warn"><ClockIcon size={12} /> Needs your OK</Pill>
        <span className="ml-auto font-mono text-[11px] text-muted">{clock(req.created)}</span>
      </div>
      <div className="space-y-3 px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={req.requester.name} seed={req.requester.webid} />
          <p className="text-sm leading-snug"><span className="font-semibold">{req.requester.name}</span> wants your <span className="font-bold text-warm">{CLASS_LABEL[item.data_class] ?? item.label}</span> for your visit.</p>
        </div>
        <p className="text-xs text-muted">{item.decision.reason}</p>
        {rec && (
          <div className="rounded-xl border border-brand/30 bg-brand/5 px-3 py-2.5" data-testid="recommendation">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand"><SparkIcon size={13} /> My recommendation</p>
            <p className="mt-1 text-sm font-semibold">{rec.action === 'approve' ? `Approve${rec.duration_s ? ` for ${humanSeconds(rec.duration_s)}` : ''}` : 'Decline'}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{rec.reason}</p>
            {item.decision.explanation && <p className="mt-2 border-t border-brand/20 pt-2 text-xs italic leading-relaxed text-ink/80" data-testid="llm-explanation">{item.decision.explanation}</p>}
          </div>
        )}
        <fieldset>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">How long</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How long should access last">
            {DURATIONS.map((d) => (
              <button key={d.id} type="button" role="radio" aria-checked={pick === d.id} onClick={() => setPick(d.id)} className={cx('rounded-full border px-3 py-1.5 text-xs font-semibold transition', pick === d.id ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface-2 text-ink hover:border-brand/60')}>
                {d.label}{d.s === rec?.duration_s ? ' (recommended)' : ''}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-[1fr_1.6fr] gap-2.5 pt-0.5">
          <button type="button" data-pres="deny" data-testid="deny" disabled={busy} onClick={() => g.decide(req, item.id, 'deny')} className="skp-btn-danger !py-3">Deny</button>
          <button type="button" data-pres="approve" data-testid="approve" disabled={busy} onClick={() => g.decide(req, item.id, 'approve', pick)} className="skp-btn-primary !py-3 !text-[15px]">
            {busy ? <Spinner size={16} /> : <CheckIcon size={16} />} Approve
          </button>
        </div>
        <p className="text-center text-[11px] text-muted">Read-only. It ends by itself, and you can revoke it any time.</p>
      </div>
    </div>
  )
}

function Feed() {
  const g = useGuardian()
  const { current, audit } = g
  const lastRef = useRef<HTMLDivElement>(null)
  const scene = current
  const grantedByGuardian = scene?.items.filter((i) => i.decision.decided_by === 'guardian' && ['granted', 'revoked', 'expired'].includes(i.status)) ?? []
  const deniedByGuardian = scene?.items.filter((i) => i.status === 'denied' && i.decision.decided_by === 'guardian') ?? []
  const asked = scene?.items.filter((i) => i.decision.action === 'ask_owner' || i.decision.recommendation) ?? []
  const events = entriesFor(audit, g.sceneId)
  const revokes = events.filter((e) => e.event === 'revoke' && e.actor === g.webId)
  const revokeMsg = revokes.length > 0 && grantedOrRevoked(scene)
  const key = `${scene?.id}:${scene?.items.map((i) => i.status).join('')}:${revokes.length}`
  useEffect(() => {
    lastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [key])

  if (!scene) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand/15 text-brand"><span className="ring" /><ShieldIcon size={30} /></span>
        <p className="text-sm font-semibold">{g.filing || g.pendingRequestId ? 'A request just arrived...' : 'All quiet'}</p>
        <p className="max-w-[17rem] text-xs text-muted">{g.filing || g.pendingRequestId ? 'Your guardian is reading your rules.' : 'Your guardian is watching your pod. When someone asks for your data, you will see it here first.'}</p>
      </div>
    )
  }
  return (
    <div className="space-y-4 px-4 py-4" data-testid="feed">
      <Bubble>
        <p className="text-sm"><span className="font-semibold">{scene.requester.name}</span> asked for <b>{scene.items.length} things</b> before your visit.</p>
        <p className="mt-0.5 text-xs text-muted">{scene.purpose} · {clock(scene.created)}</p>
      </Bubble>
      {grantedByGuardian.length > 0 && (
        <Bubble tone="good">
          <p className="text-sm"><b>I approved {grantedByGuardian.length}</b> on my own{grantedByGuardian[0].decision.duration_s ? <> for <b>{humanSeconds(grantedByGuardian[0].decision.duration_s)}</b></> : null}:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">{grantedByGuardian.map((i) => <Pill key={i.id} tone="ok"><CheckIcon size={11} />{CLASS_LABEL[i.data_class] ?? i.label}</Pill>)}</div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{grantedByGuardian[0].decision.reason.replace(/ Access for .*$/, '')}</p>
          {grantedByGuardian[0].decision.explanation && <p className="mt-1.5 text-xs italic text-ink/80">{grantedByGuardian[0].decision.explanation}</p>}
        </Bubble>
      )}
      {asked.map((i) => (
        <div key={i.id}>
          {i.status === 'awaiting_owner' ? (
            <ApprovalCard req={scene} item={i} />
          ) : (
            <Bubble tone={i.status === 'denied' ? 'bad' : 'good'} className="animate-fade-up">
              <p className="text-sm">
                You {i.decision.decided_by === 'owner' && i.status === 'denied' ? <b>declined</b> : <b>approved</b>} <b>{CLASS_LABEL[i.data_class] ?? i.label}</b>
                {i.decision.duration_s ? <> for {humanSeconds(i.decision.duration_s)}</> : null}.
              </p>
              {i.status === 'granted' && i.decision.expires_at && <div className="mt-1.5"><ConsentChip state="granted" expiresAt={i.decision.expires_at} label="Allowed" /></div>}
            </Bubble>
          )}
        </div>
      ))}
      {deniedByGuardian.map((i) => (
        <Bubble key={i.id} tone="bad">
          <p className="text-sm"><b>I said no</b> to <b>{CLASS_LABEL[i.data_class] ?? i.label}</b>. You did not have to do anything.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{i.decision.reason}</p>
          {i.decision.counter_offer && <p className="mt-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-xs"><b className="text-brand">I offered instead:</b> {i.decision.counter_offer.message}</p>}
          {i.decision.explanation && <p className="mt-1.5 text-xs italic text-ink/80">{i.decision.explanation}</p>}
        </Bubble>
      ))}
      {revokeMsg && (
        <Bubble tone="bad">
          <p className="text-sm"><b>Done.</b> You ended {revokes.length} access{revokes.length === 1 ? '' : 'es'}. The clinic can no longer open those files.</p>
        </Bubble>
      )}
      <div ref={lastRef} />
    </div>
  )
}
const grantedOrRevoked = (r?: ConsentRequest) => Boolean(r?.items.some((i) => ['granted', 'revoked', 'expired'].includes(i.status)))

const ICON: Record<Line['icon'], React.ReactNode> = {
  in: <BellIcon size={14} />, check: <CheckIcon size={14} />, ask: <ClockIcon size={14} />, deny: <XIcon size={14} />, open: <UnlockIcon size={14} />,
  read: <EyeIcon size={14} />, refused: <LockIcon size={14} />, revoke: <XIcon size={14} />, expiry: <ClockIcon size={14} />, verify: <ShieldIcon size={14} />, alert: <XIcon size={14} />,
}
const TONE: Record<Line['tone'], string> = { good: 'bg-ok/15 text-ok', bad: 'bg-danger/15 text-danger', warn: 'bg-warn/15 text-warn', neutral: 'bg-surface-2 text-muted', brand: 'bg-brand/15 text-brand' }

function Access() {
  const g = useGuardian()
  const now = useNow(5000)
  const active = g.activeGrants.filter((x) => new Date(x.ends).getTime() > now)
  const who = { clinic: CLINIC_NAME, owner: g.webId }
  const lines = useMemo(() => [...g.audit].filter((e) => e.ts >= (g.baseline || '')).reverse().map((e) => narrate(e, who)), [g.audit, g.baseline]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-5 px-4 py-4" data-testid="access-tab">
      <section aria-labelledby="now-h">
        <h3 id="now-h" className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em] text-muted">Who can see what, right now <Pill tone={active.length ? 'warn' : 'ok'}>{active.length}</Pill></h3>
        {active.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/5 px-3 py-3 text-sm animate-fade-up"><LockIcon size={18} className="text-ok" /> Nothing is shared. Every door is locked.</div>
        ) : (
          <ul className="space-y-2">
            {active.map((x) => (
              <li key={x.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 animate-fade-up" data-testid="active-grant">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand"><UnlockIcon size={16} /></span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-semibold">{CLASS_LABEL[x.data_class] ?? x.data_class}</p>
                  <p className="truncate text-[11px] text-muted">{x.grantee_name} · read only</p>
                </div>
                <div className="text-right"><Countdown until={x.ends} from={x.starts} className="items-end" /></div>
                <button type="button" aria-label={`Revoke ${CLASS_LABEL[x.data_class] ?? x.data_class}`} onClick={() => g.revokeGrant(x.id)} disabled={g.busy[`revoke:${x.id}`]} className="rounded-lg border border-danger/30 px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger/10">End</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="log-h">
        <h3 id="log-h" className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em] text-muted">Live access log {g.live && <Pill tone="ok">live</Pill>}</h3>
        {lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">Nothing has happened yet. Every ask, decision and read lands here the moment it happens.</p>
        ) : (
          <ol className="space-y-1.5" data-testid="access-log">
            {lines.slice(0, 40).map((l) => (
              <li key={l.id} className="flex items-start gap-2.5 animate-fade-up rounded-lg px-1 py-1" data-event={l.icon}>
                <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', TONE[l.tone])}>{ICON[l.icon]}</span>
                <p className="min-w-0 flex-1 text-[13px] leading-snug">{l.text}</p>
                <time className="shrink-0 pt-0.5 font-mono text-[10px] text-muted">{clock(l.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

export function PhonePanel({ tab, setTab, className }: { tab: PhoneTab; setTab: (t: PhoneTab) => void; className?: string }) {
  const g = useGuardian()
  const now = useNow(1000)
  const [banner, setBanner] = useState<string>()
  const [buzz, setBuzz] = useState(false)
  const seen = useRef(new Set<string>())
  const waiting = g.current?.items.filter((i) => i.status === 'awaiting_owner') ?? []
  const activeCount = g.activeGrants.length

  useEffect(() => {
    for (const i of waiting) {
      if (seen.current.has(i.id)) continue
      seen.current.add(i.id)
      setBanner(`${g.current!.requester.name} needs your OK: ${CLASS_LABEL[i.data_class] ?? i.label}`)
      setBuzz(true)
      const a = setTimeout(() => setBuzz(false), 1100)
      const b = setTimeout(() => setBanner(undefined), 5200)
      return () => {
        clearTimeout(a)
        clearTimeout(b)
      }
    }
  }, [waiting.map((i) => i.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cx('phone min-h-0', buzz && 'phone-buzz', className)} data-testid="phone">
      <div className="hidden items-center justify-between px-8 pb-1 pt-3.5 text-[11px] font-semibold xl:flex" aria-hidden>
        <span className="tabular-nums">{new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
        <span className="flex items-center gap-1.5"><svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor"><rect x="0" y="6" width="3" height="4" rx=".6" /><rect x="4.300" y="4" width="3" height="6" rx=".6" /><rect x="8.600" y="2" width="3" height="8" rx=".6" /><rect x="13" y="0" width="3" height="10" rx=".6" /></svg><svg width="22" height="11" viewBox="0 0 22 11" fill="none" stroke="currentColor"><rect x=".5" y=".5" width="18" height="10" rx="2.500" /><rect x="2" y="2" width="12" height="7" rx="1" fill="currentColor" stroke="none" /><rect x="19.500" y="3.500" width="2" height="4" rx=".8" fill="currentColor" stroke="none" /></svg></span>
      </div>
      {banner && (
        <div role="alert" className="absolute inset-x-3 top-9 z-30 flex animate-slide-in items-center gap-3 rounded-2xl border border-line bg-surface/95 px-3.5 py-3 shadow-card backdrop-blur" data-testid="push">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-700 text-white"><ShieldIcon size={18} /></span>
          <div className="min-w-0 leading-tight"><p className="text-xs font-bold">Guardian <span className="font-normal text-muted">· now</span></p><p className="truncate text-xs">{banner}</p></div>
        </div>
      )}
      <header className="flex items-center gap-3 px-4 pb-3 pt-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-700 text-white shadow-glow"><ShieldIcon size={22} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-base font-bold tracking-tight">Guardian</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted"><span className={cx('inline-block h-1.5 w-1.5 rounded-full', g.live ? 'bg-ok' : 'bg-warn')} />{g.live ? "Watching Alice's pod" : 'Reconnecting...'}</p>
        </div>
        <Avatar name="Alice Rivera" seed="alice" size="sm" />
      </header>
      <div role="tablist" aria-label="Phone sections" className="mx-4 mb-1 grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-xs font-semibold">
        {(['feed', 'access'] as const).map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} data-pres={`tab-${t}`} data-testid={`phone-tab-${t}`} onClick={() => setTab(t)} className={cx('relative rounded-lg py-1.5 transition', tab === t ? 'bg-surface text-ink shadow' : 'text-muted')}>
            {t === 'feed' ? 'Agent feed' : 'Access'}
            {t === 'feed' && waiting.length > 0 && <span className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warm px-1 text-[10px] font-bold text-navy-950">{waiting.length}</span>}
            {t === 'access' && activeCount > 0 && <span className="ml-1.5 rounded-full bg-brand/20 px-1.5 text-[10px] font-bold text-brand">{activeCount}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto scroll-thin">{tab === 'feed' ? <Feed /> : <Access />}</div>
      <div className="border-t border-line bg-surface/90 px-4 pb-4 pt-3 backdrop-blur">
        <button type="button" data-pres="revoke-all" data-testid="revoke-all" disabled={activeCount === 0 || g.busy.revokeAll} onClick={() => g.revokeAll()} className={cx('flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-extrabold tracking-wide transition active:scale-[.98]', activeCount > 0 ? 'bg-[#e11d2e] text-white shadow-[0_10px_30px_-8px_#e11d2e] hover:bg-[#f0283a]' : 'border border-line bg-surface-2 text-muted')}>
          {g.busy.revokeAll ? <Spinner size={18} /> : <LockIcon size={18} />}
          {activeCount > 0 ? `Revoke everything (${activeCount})` : 'Nothing to revoke'}
        </button>
      </div>
    </div>
  )
}
