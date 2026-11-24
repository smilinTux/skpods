import type { ReactNode } from 'react'
import { cx } from './cx'
import { Spinner } from './States'

export interface AuditEvent {
  id: string
  at: string | number | Date
  actor: string
  action: string
  detail?: ReactNode
  /** Hash of this entry in a tamper-evident chain. Shown shortened. */
  hash?: string
  tone?: 'neutral' | 'good' | 'bad' | 'warn'
}

export type ChainStatus = 'unknown' | 'checking' | 'valid' | 'broken'

const DOT: Record<NonNullable<AuditEvent['tone']>, string> = {
  neutral: 'bg-muted',
  good: 'bg-ok',
  bad: 'bg-danger',
  warn: 'bg-warn',
}

const fmt = (t: AuditEvent['at']) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export interface AuditTimelineProps {
  events: AuditEvent[]
  /** Newest first when true (default). */
  newestFirst?: boolean
  chain?: ChainStatus
  /** When given, a "Verify chain" button is shown. */
  onVerify?: () => void
  empty?: ReactNode
}

export function AuditTimeline({ events, newestFirst = true, chain = 'unknown', onVerify, empty }: AuditTimelineProps) {
  const list = [...events].sort((a, b) => (new Date(a.at).getTime() - new Date(b.at).getTime()) * (newestFirst ? -1 : 1))
  return (
    <div>
      {(onVerify || chain !== 'unknown') && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
          <span className="flex items-center gap-2 text-sm" role="status">
            {chain === 'checking' && <Spinner size={14} label="Verifying" />}
            {chain === 'valid' && <span aria-hidden className="text-ok">&#10003;</span>}
            {chain === 'broken' && <span aria-hidden className="text-danger">&#9888;</span>}
            <span className={cx(chain === 'valid' && 'text-ok', chain === 'broken' && 'text-danger', chain === 'unknown' && 'text-muted')}>
              {chain === 'valid' ? 'Chain verified: no entry was changed or removed' : chain === 'broken' ? 'Chain broken: an entry was altered' : chain === 'checking' ? 'Verifying chain' : 'Not verified yet'}
            </span>
          </span>
          {onVerify && (
            <button type="button" className="skp-btn-secondary !px-3 !py-1.5 text-xs" onClick={onVerify} disabled={chain === 'checking'}>
              Verify chain
            </button>
          )}
        </div>
      )}
      {list.length === 0 ? (
        (empty ?? <p className="py-6 text-center text-sm text-muted">Nothing recorded yet.</p>)
      ) : (
        <ol className="relative ml-2 border-l border-line">
          {list.map((e, i) => (
            <li key={e.id} className="relative pb-5 pl-6 last:pb-0 animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <span aria-hidden className={cx('absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface', DOT[e.tone ?? 'neutral'])} />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm">
                  <span className="font-semibold">{e.actor}</span> <span className="text-muted">{e.action}</span>
                </p>
                <time className="font-mono text-xs text-muted" dateTime={new Date(e.at).toISOString()}>
                  {fmt(e.at)}
                </time>
              </div>
              {e.detail && <div className="mt-0.5 text-sm text-muted">{e.detail}</div>}
              {e.hash && (
                <code title={e.hash} className="mt-1 inline-block rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                  #{e.hash.slice(0, 10)}
                </code>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
