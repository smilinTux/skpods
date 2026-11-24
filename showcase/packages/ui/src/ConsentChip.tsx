import { cx } from './cx'
import { Countdown, type TimeInput } from './Countdown'

export type ConsentState = 'pending' | 'granted' | 'expired' | 'revoked' | 'denied' | 'auto-approved' | 'auto-denied'

const META: Record<ConsentState, { label: string; tone: string; dot: string }> = {
  pending: { label: 'Waiting for you', tone: 'border-warn/40 bg-warn/10 text-warn', dot: 'bg-warn' },
  granted: { label: 'Allowed', tone: 'border-ok/40 bg-ok/10 text-ok', dot: 'bg-ok' },
  'auto-approved': { label: 'Auto-approved', tone: 'border-brand/40 bg-brand/10 text-brand', dot: 'bg-brand' },
  'auto-denied': { label: 'Auto-denied', tone: 'border-danger/40 bg-danger/10 text-danger', dot: 'bg-danger' },
  denied: { label: 'Denied', tone: 'border-danger/40 bg-danger/10 text-danger', dot: 'bg-danger' },
  expired: { label: 'Expired', tone: 'border-line bg-surface-2 text-muted', dot: 'bg-muted' },
  revoked: { label: 'Revoked', tone: 'border-line bg-surface-2 text-muted', dot: 'bg-muted' },
}

export interface ConsentChipProps {
  state: ConsentState
  /** Overrides the default label. */
  label?: string
  /** With a live state, shows the countdown inside the chip. */
  expiresAt?: TimeInput
  onExpire?: () => void
  className?: string
}

export function ConsentChip({ state, label, expiresAt, onExpire, className }: ConsentChipProps) {
  const m = META[state]
  const live = state === 'granted' || state === 'auto-approved'
  return (
    <span className={cx('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium', m.tone, className)}>
      <span aria-hidden className={cx('h-2 w-2 rounded-full', m.dot, live && 'animate-pulse-ring')} />
      <span>{label ?? m.label}</span>
      {live && expiresAt !== undefined && (
        <>
          <span aria-hidden className="opacity-40">|</span>
          <Countdown until={expiresAt} onExpire={onExpire} className="[&_span]:!text-current [&_[role=timer]]:text-xs" />
        </>
      )}
    </span>
  )
}
