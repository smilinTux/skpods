import type { ReactNode } from 'react'
import { cx } from './cx'

export function Spinner({ size = 18, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <svg role="status" aria-label={label} width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-current" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('relative overflow-hidden rounded-lg bg-surface-2 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-line/60 before:to-transparent', className)} />
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center animate-fade-up">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand" aria-hidden>
        {icon ?? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7l9-4 9 4-9 4-9-4z" />
            <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
          </svg>
        )}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', error, action }: { title?: string; error?: unknown; action?: ReactNode }) {
  const msg = error instanceof Error ? error.message : error ? String(error) : undefined
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-4 animate-fade-up">
      <p className="text-sm font-semibold text-danger">{title}</p>
      {msg && <p className="break-words font-mono text-xs text-muted">{msg}</p>}
      {action}
    </div>
  )
}
