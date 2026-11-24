import { cx } from '@skpods/ui'
import type { ChatEngine } from '../lib/engine'
import { ago } from '../lib/format'
import { useTick } from './useEngine'

/** The honest "is this live?" indicator. With the relay live we say push; otherwise we poll, so we say so: when we last looked and how often we look. */
export function LiveBadge({ engine, convId, loading }: { engine: ChatEngine; convId: string; loading?: boolean }) {
  useTick()
  const l = engine.live(convId)
  const since = l.lastOkAt ? Date.now() - l.lastOkAt : undefined
  const ok = l.kind === 'live' && !loading
  const label = loading ? 'Connecting' : ok ? (l.push ? 'Live (push)' : 'Live') : 'Offline, retrying'
  return (
    <span
      data-testid="live-badge"
      data-state={loading ? 'connecting' : l.kind}
      data-push={l.push ? 'true' : undefined}
      title={ok && l.push ? `The relay tells Pod Chat when something changes. It still checks every ${Math.round(l.everyMs / 1000)}s in case a hint is missed.` : ok ? `Pods have no push channel here, so Pod Chat checks every ${Math.round(l.everyMs / 1000)}s and speeds up when someone is typing a reply.` : 'Cannot reach one of the pods. Retrying.'}
      className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', ok ? 'border-ok/30 bg-ok/10 text-ok' : loading ? 'border-line bg-surface-2 text-muted' : 'border-danger/30 bg-danger/10 text-danger')}
    >
      <span className="relative flex h-2 w-2">
        {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />}
        <span className={cx('relative inline-flex h-2 w-2 rounded-full', ok ? 'bg-ok' : loading ? 'bg-muted' : 'bg-danger')} />
      </span>
      {label}
      {ok && since !== undefined && <span className="hidden font-normal opacity-80 sm:inline">· {ago(since)}</span>}
    </span>
  )
}
