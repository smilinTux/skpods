import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'

export interface ToastInput {
  title: string
  description?: ReactNode
  tone?: 'info' | 'success' | 'error' | 'warn'
  /** ms, 0 keeps it until dismissed. Default 5000. */
  duration?: number
  action?: { label: string; onClick: () => void }
}
interface ToastItem extends ToastInput {
  id: number
}

const Ctx = createContext<{ toast: (t: ToastInput) => number; dismiss: (id: number) => void } | null>(null)

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast needs <ToastProvider>')
  return c
}

const BAR: Record<NonNullable<ToastInput['tone']>, string> = { info: 'bg-brand', success: 'bg-ok', error: 'bg-danger', warn: 'bg-warn' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current
      setItems((l) => [...l.slice(-3), { ...t, id }])
      if (t.duration !== 0) setTimeout(() => dismiss(id), t.duration ?? 5000)
      return id
    },
    [dismiss],
  )
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 mx-auto flex w-full max-w-sm flex-col gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="skp-card pointer-events-auto relative flex animate-toast-in gap-3 overflow-hidden py-3 pl-5 pr-3">
            <span aria-hidden className={cx('absolute inset-y-0 left-0 w-1', BAR[t.tone ?? 'info'])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description && <p className="mt-0.5 break-words text-sm text-muted">{t.description}</p>}
              {t.action && (
                <button type="button" className="mt-1 text-sm font-semibold text-brand hover:underline" onClick={() => { t.action!.onClick(); dismiss(t.id) }}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss" className="h-6 w-6 shrink-0 rounded-md text-muted hover:bg-surface-2 hover:text-ink" onClick={() => dismiss(t.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
