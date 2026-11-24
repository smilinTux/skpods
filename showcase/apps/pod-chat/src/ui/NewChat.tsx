import { Avatar, Button, cx } from '@skpods/ui'
import { useEffect, useRef, useState } from 'react'
import type { ChatEngine } from '../lib/engine'
import { Check, Close } from './icons'

export function NewChat({ engine, onClose, onCreated, onError }: { engine: ChatEngine; onClose: () => void; onCreated: (id: string) => void; onError: (m: string) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [webId, setWebId] = useState('')
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLButtonElement>(null)
  const contacts = engine.contacts.filter((c) => c.webId !== engine.me)

  useEffect(() => {
    first.current?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const toggle = (w: string) => setPicked((p) => (p.includes(w) ? p.filter((x) => x !== w) : [...p, w]))
  const add = async () => {
    setAdding(true)
    setAddErr(undefined)
    try {
      const p = await engine.addContact(webId)
      setPicked((x) => [...new Set([...x, p.webId])])
      setWebId('')
    } catch (e) {
      setAddErr((e as Error).message)
    } finally {
      setAdding(false)
    }
  }
  const start = async () => {
    setBusy(true)
    try {
      onCreated(await engine.createConversation({ title, others: picked }))
    } catch (e) {
      onError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="nc-h" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="skp-card flex max-h-[92dvh] w-full max-w-md animate-pop flex-col rounded-b-none sm:rounded-b-2xl" data-testid="new-chat-dialog">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <h2 id="nc-h" className="text-lg font-semibold">New chat</h2>
          <button type="button" className="skp-btn-ghost ml-auto !p-2" onClick={onClose} aria-label="Close"><Close /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted">Pick one person for a direct chat, or several for a group. Each of you will write into your own pod.</p>
          {contacts.length === 0 && <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">No contacts yet. Add someone by WebID below.</p>}
          <ul role="list" className="space-y-1">
            {contacts.map((c, i) => {
              const on = picked.includes(c.webId)
              return (
                <li key={c.webId}>
                  <button ref={i === 0 ? first : undefined} type="button" role="checkbox" aria-checked={on} data-testid="contact" data-name={c.name} onClick={() => toggle(c.webId)} className={cx('flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition', on ? 'border-brand bg-brand-soft/50 dark:bg-surface-2' : 'border-transparent hover:bg-surface-2')}>
                    <Avatar name={c.name} seed={c.webId} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="block truncate font-mono text-[11px] text-muted">{c.webId.replace(/^https?:\/\//, '').replace(/\/profile\/card#me$/, '')}</span></span>
                    <span className={cx('flex h-6 w-6 items-center justify-center rounded-full border', on ? 'border-teal-700 bg-teal-700 text-white dark:border-brand dark:bg-brand dark:text-brand-ink' : 'border-line')}>{on && <Check width={14} height={14} />}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="nc-webid">Add someone by WebID</label>
            <div className="mt-1 flex gap-2">
              <input id="nc-webid" value={webId} onChange={(e) => setWebId(e.target.value)} placeholder="https://pod.example/profile/card#me" inputMode="url" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 font-mono text-xs outline-none focus:border-brand" />
              <Button variant="secondary" onClick={add} loading={adding} disabled={!webId.trim()}>Add</Button>
            </div>
            {addErr && <p role="alert" className="mt-1 text-xs text-danger">{addErr}</p>}
          </div>
          {picked.length > 1 && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="nc-title">Group name</label>
              <input id="nc-title" data-testid="group-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend plans" maxLength={60} className="mt-1 h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-brand" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={start} loading={busy} disabled={picked.length === 0} data-testid="start-chat">{picked.length > 1 ? 'Start group' : 'Start chat'}</Button>
        </div>
      </div>
    </div>
  )
}
