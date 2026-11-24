import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cx } from '@skpods/ui'
import { categoryColor } from '../lib/categories'
import { money } from '../lib/format'

export function Money({ cents, currency = 'USD', className }: { cents: number; currency?: string; className?: string }) {
  return <span className={cx('tabular-nums', className)}>{money(cents, currency)}</span>
}

export function CategoryTag({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: categoryColor(category) }} />
      {category}
    </span>
  )
}

export function Chip({ active, onClick, children, count, title }: { active?: boolean; onClick?: () => void; children: ReactNode; count?: number; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
        active ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-muted hover:border-brand/50 hover:text-ink',
      )}
    >
      {children}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </button>
  )
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 animate-fade-up bg-navy-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cx('skp-card relative flex max-h-[92vh] w-full animate-pop flex-col overflow-hidden rounded-b-none outline-none sm:rounded-b-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <h2 id={id} className="min-w-0 flex-1 text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="h-8 w-8 shrink-0 rounded-lg text-xl leading-none text-muted hover:bg-surface-2 hover:text-ink">
            &times;
          </button>
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs font-normal text-muted">{hint}</p>}
    </label>
  )
}

export const inputCls = 'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm placeholder:text-muted/70 focus:border-brand'

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className="skp-btn-secondary !px-3 !py-1.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          if (ref.current) {
            ref.current.textContent = 'Copied'
            setTimeout(() => ref.current && (ref.current.textContent = label), 1400)
          }
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {label}
    </button>
  )
}

export const Icon = {
  receipt: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
  ),
  store: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9l1.5-5h13L20 9" /><path d="M4 9a3 3 0 0 0 5.3 2 3 3 0 0 0 5.4 0A3 3 0 0 0 20 9" /><path d="M5 13v7h14v-7" /></svg>
  ),
  export: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  ),
  lock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></svg>
  ),
}
