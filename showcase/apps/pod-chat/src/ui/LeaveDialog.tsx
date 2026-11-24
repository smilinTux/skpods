import { Button } from '@skpods/ui'
import { useEffect, useRef, useState } from 'react'
import { Exit } from './icons'

export function LeaveDialog({ title, others, onCancel, onConfirm }: { title: string; others: string[]; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="leave-h" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} className="skp-card w-full max-w-md animate-pop p-5" data-testid="leave-dialog">
        <h2 id="leave-h" className="flex items-center gap-2 text-lg font-semibold"><Exit className="text-danger" /> Leave "{title}"?</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li><strong className="text-ink">Your messages stay in your pod.</strong> Nothing is deleted.</li>
          <li><strong className="text-ink">{others.join(', ')}</strong> lose access to them immediately. Their screens will show the messages dissolving.</li>
          <li>You keep what they wrote while they let you. Rejoin any time to share again.</li>
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Stay</Button>
          <Button variant="danger" loading={busy} data-testid="leave-confirm" onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }}>Leave and revoke access</Button>
        </div>
      </div>
    </div>
  )
}
