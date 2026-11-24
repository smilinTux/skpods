import { useEffect, useRef, useState } from 'react'
import { cx } from './cx'

export type TimeInput = Date | number | string

const ms = (t: TimeInput) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime())

/** "2d 3h", "23h 59m", "12m 05s", "00:42" depending on the remaining time. */
export function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return 'expired'
  const s = Math.ceil(remainingMs / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

export interface CountdownProps {
  until: TimeInput
  /** When the grant started: enables the progress bar. */
  from?: TimeInput
  onExpire?: () => void
  /** Injectable clock for tests and demos. */
  now?: () => number
  className?: string
}

/** Live countdown that turns amber in the last 10 percent (or hour) and calls onExpire exactly once. */
export function Countdown({ until, from, onExpire, now = Date.now, className }: CountdownProps) {
  const end = ms(until)
  const start = from !== undefined ? ms(from) : undefined
  const [t, setT] = useState(now())
  const fired = useRef(false)

  useEffect(() => {
    fired.current = false
    setT(now())
    const remaining = end - now()
    const step = remaining > 3_600_000 ? 15_000 : 1_000
    const id = setInterval(() => setT(now()), step)
    return () => clearInterval(id)
  }, [end, now])

  const remaining = end - t
  useEffect(() => {
    if (remaining <= 0 && !fired.current) {
      fired.current = true
      onExpire?.()
    }
  }, [remaining, onExpire])

  const total = start !== undefined ? Math.max(1, end - start) : undefined
  const frac = total ? Math.min(1, Math.max(0, remaining / total)) : undefined
  const urgent = remaining > 0 && (remaining < 3_600_000 || (frac !== undefined && frac < 0.1))
  const done = remaining <= 0
  return (
    <span className={cx('inline-flex flex-col gap-1', className)}>
      <span role="timer" aria-label={done ? 'Expired' : `${formatRemaining(remaining)} remaining`} className={cx('font-mono text-sm tabular-nums', done ? 'text-muted' : urgent ? 'text-warn' : 'text-ink')}>
        {done ? 'expired' : formatRemaining(remaining)}
      </span>
      {frac !== undefined && (
        <span aria-hidden className="h-1 w-full min-w-16 overflow-hidden rounded-full bg-line">
          <span className={cx('block h-full rounded-full transition-[width] duration-1000 ease-linear', urgent ? 'bg-warn' : 'bg-brand')} style={{ width: `${(done ? 0 : frac) * 100}%` }} />
        </span>
      )}
    </span>
  )
}
