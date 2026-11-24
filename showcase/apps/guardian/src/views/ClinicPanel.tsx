import { Avatar, Button, ConsentChip, Spinner, cx } from '@skpods/ui'
import { CLASSES, CLASS_HINT, CLASS_LABEL, CLINIC_NAME, PATIENT_NAME } from '../config'
import { dayTime, clock } from '../lib/format'
import { receivedValues } from '../lib/pod'
import { useGuardian } from '../lib/useGuardian'
import type { ClinicRead } from '../lib/useGuardian'
import type { Item } from '../lib/types'
import { CrossIcon, LockIcon, Scramble, XIcon } from '../ui'

type RowState = 'idle' | 'deciding' | 'waiting' | 'received' | 'fetching' | 'denied' | 'ended'

function rowState(it: Item | undefined, read: ClinicRead | undefined, scene: boolean): RowState {
  if (!it) return scene ? 'deciding' : 'idle'
  switch (it.status) {
    case 'awaiting_owner':
      return 'waiting'
    case 'granted':
      return read?.status === 200 ? 'received' : read?.ended ? 'ended' : 'fetching'
    case 'denied':
      return 'denied'
    default:
      return 'ended'
  }
}

function Row({ cls, it, read, scene, onTry }: { cls: string; it?: Item; read?: ClinicRead; scene: boolean; onTry?: () => void }) {
  const st = rowState(it, read, scene)
  const values = it && read?.status === 200 && read.text ? receivedValues(cls, read.text, it.resource) : []
  return (
    <li data-testid={`clinic-row-${cls}`} data-state={st} className={cx('relative rounded-xl border bg-white px-4 py-3 transition-colors duration-500', st === 'received' ? 'border-ok/40' : st === 'denied' ? 'border-danger/30' : st === 'waiting' ? 'border-warn/50' : 'border-line')}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', st === 'received' ? 'bg-ok/10 text-ok' : st === 'denied' ? 'bg-danger/10 text-danger' : st === 'waiting' ? 'bg-warn/10 text-warn' : 'bg-surface-2 text-muted')}>
          {st === 'denied' ? <XIcon size={16} /> : st === 'received' ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.500l4.500 4.500L19 7.500" /></svg> : <LockIcon size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{CLASS_LABEL[cls]}</p>
              <p className="text-xs text-muted">{CLASS_HINT[cls]}</p>
            </div>
            <div className="shrink-0" data-testid={`clinic-chip-${cls}`}>
              {st === 'idle' && <span className="text-xs text-muted">Not requested</span>}
              {st === 'deciding' && <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Spinner size={12} /> Guardian is deciding</span>}
              {st === 'waiting' && <ConsentChip state="pending" label="Waiting for Alice" />}
              {(st === 'received' || st === 'fetching') && it && <ConsentChip state={it.decision.decided_by === 'owner' ? 'granted' : 'auto-approved'} label={st === 'received' ? 'Received' : 'Approved'} expiresAt={it.decision.expires_at} />}
              {st === 'denied' && <ConsentChip state="auto-denied" label={it?.decision.decided_by === 'owner' ? 'Declined by Alice' : 'Declined by guardian'} />}
              {st === 'ended' && it && <ConsentChip state={it.status === 'expired' ? 'expired' : 'revoked'} label={it.status === 'expired' ? 'Access expired' : 'Access revoked'} />}
            </div>
          </div>

          {st === 'received' && (
            <dl className="mt-2.5 space-y-1 rounded-lg bg-surface-2 px-3 py-2 animate-fade-up" data-testid={`clinic-value-${cls}`}>
              {values.map((v, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="w-24 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted">{v.label}</dt>
                  <dd className="font-mono text-sm font-medium"><Scramble text={v.value} /></dd>
                </div>
              ))}
              <p className="pt-0.5 font-mono text-[10px] text-muted">pod answered HTTP 200 at {read && clock(read.at)}</p>
            </dl>
          )}
          {st === 'fetching' && <div className="mt-2.5 space-y-1.5" aria-hidden><div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" /><div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" /></div>}
          {st === 'waiting' && <p className="mt-2 text-xs text-muted">Alice's guardian asked her. Nothing is visible to us until she taps.</p>}
          {st === 'denied' && it && (
            <div className="mt-2 space-y-1.5 text-xs animate-fade-up">
              <p className="text-ink/80">{it.decision.reason}</p>
              {it.decision.counter_offer && (
                <p className="rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-ink/80"><span className="font-semibold text-brand">Counter-offer: </span>{it.decision.counter_offer.message}</p>
              )}
              {read && <p className="font-mono text-[10px] text-danger" data-testid={`clinic-direct-${cls}`}>Tried the file directly: pod answered HTTP {read.status}</p>}
              {onTry && !read && <button type="button" onClick={onTry} data-pres={`try-${cls}`} className="text-xs font-semibold text-brand hover:underline">Try fetching the file directly</button>}
            </div>
          )}
          {st === 'ended' && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs animate-fade-up">
              <LockIcon size={14} className="text-muted" />
              <span className="text-muted">Data removed from our screen.{read && read.status !== 200 ? ` The pod now answers HTTP ${read.status}.` : ''}</span>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export function ClinicPanel({ className }: { className?: string }) {
  const g = useGuardian()
  const { current, reads, facts, filing, bridge } = g
  const scene = filing || Boolean(g.sceneId)
  const byClass = new Map(current?.items.map((i) => [i.data_class, i]))
  const got = current?.items.filter((i) => i.status === 'granted' && reads[i.id]?.status === 200).length ?? 0
  const waiting = current?.items.filter((i) => i.status === 'awaiting_owner').length ?? 0
  const declined = current?.items.filter((i) => i.status === 'denied').length ?? 0
  const booking = facts?.booking

  return (
    <div className={cx('skp-light flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card', className)} data-testid="clinic-panel">
      <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden><i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-xs text-muted shadow-inner"><LockIcon size={12} /><span className="truncate font-mono">intake.bayview-family.example</span></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-[linear-gradient(180deg,#f3f8fc,#fff_160px)] px-5 pb-5 pt-5">
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1d6fb8] text-white shadow"><CrossIcon size={24} /></span>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight text-[#12395f]">{CLINIC_NAME}</p>
            <p className="text-xs font-medium text-[#4a6a87]">Patient intake portal</p>
          </div>
        </header>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-3">
          <Avatar name={PATIENT_NAME} seed="alice" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold">{PATIENT_NAME}</p>
            <p className="truncate text-xs text-muted">{booking ? `${booking.name.replace(/ at .*/, '')} · ${dayTime(booking.start)}` : 'Annual check-up'} · Ref {booking?.ref ?? 'BAY-1042'}</p>
          </div>
          <span className="rounded-full bg-[#e6f1fb] px-2.5 py-1 text-[11px] font-semibold text-[#1d6fb8]">Booked</span>
        </div>

        <h2 className="mt-5 text-sm font-bold uppercase tracking-[.1em] text-[#12395f]">Before your visit</h2>
        <p className="mt-1 text-xs text-muted">We ask Alice's privacy guardian for each item. We only see what it releases, and only until the time shown.</p>

        <ul className="mt-3 space-y-2.5">
          {CLASSES.map((c) => {
            const it = byClass.get(c)
            return <Row key={c} cls={c} it={it} read={it ? reads[it.id] : undefined} scene={scene} onTry={c === 'ssn' && it ? () => g.tryRead(it.resource, it.id) : undefined} />
          })}
        </ul>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f3f8fc] px-4 py-3">
          <div className="text-xs text-muted" data-testid="clinic-summary">
            {!current ? (filing ? 'Request sent. Waiting for the guardian...' : 'No request sent yet.') : (
              <>
                <span className="font-semibold text-ok">{got} received</span>
                {waiting > 0 && <> · <span className="font-semibold text-warn">{waiting} waiting</span></>}
                {declined > 0 && <> · <span className="font-semibold text-danger">{declined} declined</span></>}
                <span className="font-mono"> · sent {clock(current.created)}</span>
              </>
            )}
          </div>
          <Button data-pres="send" data-testid="send-request" onClick={() => g.fileRequest()} loading={filing} disabled={!bridge || Boolean(g.brokerError)} className="!rounded-lg !bg-[#1d6fb8] !text-white hover:!shadow-[0_8px_30px_-8px_#1d6fb8]">
            {current ? 'Send the request again' : 'Send intake request'}
          </Button>
        </div>
        {!bridge && <p className="mt-2 text-xs text-warn" role="status">The clinic bridge is offline, so this screen cannot act. Run <code className="font-mono">npm run bridge</code>.</p>}
      </div>
    </div>
  )
}
