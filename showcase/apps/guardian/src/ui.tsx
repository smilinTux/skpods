import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@skpods/ui'

type IconProps = { size?: number; className?: string }
const I = (d: ReactNode, fill = false) =>
  function Icon({ size = 18, className }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
        {d}
      </svg>
    )
  }

export const ShieldIcon = I(<><path d="M12 3l8 3v6c0 4.500-3.400 7.800-8 9-4.600-1.200-8-4.500-8-9V6z" /><path d="M9 12l2 2 4-4" /></>)
export const LockIcon = I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>)
export const UnlockIcon = I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.500-2" /></>)
export const CheckIcon = I(<path d="M5 12.500l4.500 4.500L19 7.500" />)
export const XIcon = I(<path d="M6 6l12 12M18 6L6 18" />)
export const ClockIcon = I(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const PlayIcon = I(<path d="M7 5l12 7-12 7z" />, true)
export const PauseIcon = I(<><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>, true)
export const SkipIcon = I(<><path d="M5 5l9 7-9 7z" /><path d="M18 5v14" /></>)
export const ReplayIcon = I(<><path d="M4 12a8 8 0 1 0 3-6.200" /><path d="M4 4v4h4" /></>)
export const BoltIcon = I(<path d="M13 3L5 13h6l-1 8 8-10h-6z" />)
export const EyeIcon = I(<><path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>)
export const LinkIcon = I(<><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" /><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></>)
export const SparkIcon = I(<path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800z" />)
export const BellIcon = I(<><path d="M6 17V11a6 6 0 0 1 12 0v6l1.500 2h-15z" /><path d="M10 21a2 2 0 0 0 4 0" /></>)
export const PlusIcon = I(<path d="M12 5v14M5 12h14" />)
export const FileIcon = I(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>)
export const SlidersIcon = I(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>)
export const ListIcon = I(<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r=".8" /><circle cx="4" cy="12" r=".8" /><circle cx="4" cy="18" r=".8" /></>)
export const TheatreIcon = I(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>)
export const CrossIcon = I(<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" />, true)
export const CursorIcon = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M5 3l14 8-6.200 1.600L10 19z" fill="#fff" stroke="#0b1530" strokeWidth="1.400" strokeLinejoin="round" />
  </svg>
)

export function Led({ on, tone = 'ok', pulse = true, className }: { on: boolean; tone?: 'ok' | 'warn' | 'danger'; pulse?: boolean; className?: string }) {
  const c = !on ? 'bg-muted/60' : tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-danger'
  return <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', c, on && pulse && 'animate-pulse-ring', className)} />
}

/** A value that "decrypts" into place: random glyphs resolving left to right. */
export function Scramble({ text, run = true, ms = 650, className }: { text: string; run?: boolean; ms?: number; className?: string }) {
  const [out, setOut] = useState(run ? '' : text)
  useEffect(() => {
    if (!run || matchMedia('(prefers-reduced-motion: reduce)').matches) return setOut(text)
    const glyphs = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&'
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const fixed = Math.floor(p * text.length)
      setOut(text.slice(0, fixed) + Array.from(text.slice(fixed), (ch) => (ch === ' ' || ch === '-' ? ch : glyphs[Math.floor(Math.random() * glyphs.length)])).join(''))
      if (p < 1) raf = requestAnimationFrame(tick)
      else setOut(text)
    }
    raf = requestAnimationFrame(tick)
    // A background tab pauses animation frames: still end on the real value.
    const done = setTimeout(() => setOut(text), ms + 150)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(done)
    }
  }, [text, run, ms])
  return <span className={className}>{out}</span>
}

export function useNow(intervalMs = 1000): number {
  const [n, setN] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return n
}

/** Run `fn` when `key` changes (not on first render). */
export function useChanged<T>(key: T, fn: (prev: T) => void) {
  const prev = useRef(key)
  useEffect(() => {
    if (prev.current !== key) {
      fn(prev.current)
      prev.current = key
    }
  })
}

export function Pill({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'brand'; children: ReactNode; className?: string }) {
  const t = {
    neutral: 'border-line bg-surface-2 text-muted',
    ok: 'border-ok/40 bg-ok/10 text-ok',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    danger: 'border-danger/40 bg-danger/10 text-danger',
    brand: 'border-brand/40 bg-brand/10 text-brand',
  }[tone]
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', t, className)}>{children}</span>
}
