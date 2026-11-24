import { useEffect, useState, type ReactNode } from 'react'
import { formatRemaining } from '@skpods/ui'

/** Circular countdown. Calls onExpire once when the end time passes. Amber in the last 10 percent or hour. */
export function Ring({ from, until, onExpire, size = 84, children }: { from: string; until: string; onExpire?: () => void; size?: number; children?: ReactNode }) {
  const start = new Date(from).getTime()
  const end = new Date(until).getTime()
  const [now, setNow] = useState(Date.now())
  const [fired, setFired] = useState(false)
  useEffect(() => {
    const left = end - Date.now()
    const id = setInterval(() => setNow(Date.now()), left > 3_600_000 ? 5000 : 500)
    return () => clearInterval(id)
  }, [end])
  const left = end - now
  useEffect(() => {
    if (left <= 0 && !fired) {
      setFired(true)
      onExpire?.()
    }
  }, [left, fired, onExpire])
  const frac = Math.max(0, Math.min(1, left / Math.max(1, end - start)))
  const urgent = left > 0 && (left < 3_600_000 || frac < 0.1)
  const r = size / 2 - 6
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={left <= 0 ? 'Ended' : `${formatRemaining(left)} remaining`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--skp-line))" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={urgent ? 'rgb(var(--skp-warn))' : 'rgb(var(--skp-brand))'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (left <= 0 ? 0 : frac))}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke .4s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono text-[13px] font-semibold tabular-nums ${urgent ? 'text-warn' : 'text-ink'}`}>{left <= 0 ? 'ended' : formatRemaining(left)}</span>
        {children}
      </div>
    </div>
  )
}
