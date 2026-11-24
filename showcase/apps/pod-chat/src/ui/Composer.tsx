import { cx } from '@skpods/ui'
import { useEffect, useRef, useState } from 'react'
import { prepareImage } from '../lib/images'
import type { PreparedUpload } from '../lib/engine'
import { Clip, Close, Pencil, Send } from './icons'
import { useMedia } from './useEngine'

export interface ComposerProps {
  disabled?: boolean
  editing?: { id: string; text: string }
  onCancelEdit: () => void
  onSend: (text: string, upload?: PreparedUpload) => void
  onSaveEdit: (id: string, text: string) => void
  onError: (msg: string) => void
  draftKey: string
}

export function Composer({ disabled, editing, onCancelEdit, onSend, onSaveEdit, onError, draftKey }: ComposerProps) {
  const [text, setText] = useState(() => { try { return sessionStorage.getItem('pc-draft:' + draftKey) ?? '' } catch { return '' } })
  const [upload, setUpload] = useState<PreparedUpload>()
  const [busy, setBusy] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const coarse = useMedia('(pointer: coarse)')

  useEffect(() => {
    if (editing) {
      setText(editing.text)
      ta.current?.focus()
    }
  }, [editing?.id])
  useEffect(() => {
    if (editing) return
    try { sessionStorage.setItem('pc-draft:' + draftKey, text) } catch { /* ignore */ }
  }, [text, draftKey, editing])
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }, [text])
  useEffect(() => () => { if (upload?.previewUrl) URL.revokeObjectURL(upload.previewUrl) }, [upload])

  const canSend = !disabled && !busy && (text.trim().length > 0 || Boolean(upload))
  const submit = () => {
    if (!canSend) return
    if (editing) {
      onSaveEdit(editing.id, text)
      setText('')
      return
    }
    onSend(text, upload)
    setText('')
    setUpload(undefined)
    ta.current?.focus()
  }
  const pick = async (f?: File) => {
    if (!f) return
    setBusy(true)
    try {
      const img = await prepareImage(f)
      setUpload({ ...img, previewUrl: URL.createObjectURL(img.blob) })
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div className="border-t border-line bg-surface/90 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-warm-soft px-3 py-1.5 text-xs font-medium text-warm" role="status">
          <Pencil width={14} height={14} />
          Editing a message. The new text is written as a new file in your pod.
          <button type="button" className="ml-auto rounded-md p-1 hover:bg-black/5" onClick={() => { setText(''); onCancelEdit() }} aria-label="Cancel editing"><Close width={14} height={14} /></button>
        </div>
      )}
      {upload && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-2">
          <img src={upload.previewUrl} alt="Selected photo" className="h-14 w-14 rounded-lg object-cover" />
          <p className="min-w-0 flex-1 truncate text-xs text-muted">Photo ready. It is saved in your pod and shared with this conversation only.</p>
          <button type="button" className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-ink" onClick={() => setUpload(undefined)} aria-label="Remove photo"><Close width={16} height={16} /></button>
        </div>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input ref={file} type="file" accept="image/*" hidden data-testid="attach-input" onChange={(e) => void pick(e.target.files?.[0])} />
        {!editing && (
          <button type="button" className="skp-btn-ghost !h-11 !w-11 !rounded-full !p-0" onClick={() => file.current?.click()} disabled={disabled || busy} aria-label="Attach a photo">
            <Clip />
          </button>
        )}
        <label className="sr-only" htmlFor="composer">Message</label>
        <textarea
          id="composer"
          ref={ta}
          data-testid="composer"
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={editing ? 'Edit your message' : 'Message'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
            if (e.key === 'Escape' && editing) { setText(''); onCancelEdit() }
          }}
          className="max-h-36 min-h-[2.75rem] flex-1 resize-none rounded-3xl border border-line bg-surface-2 px-4 py-2.5 text-[15px] leading-snug outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <button type="submit" data-testid="send" disabled={!canSend} aria-label={editing ? 'Save edit' : 'Send message'} className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95', canSend ? 'bg-teal-700 text-white shadow-glow dark:bg-brand dark:text-brand-ink' : 'bg-surface-2 text-muted')}>
          <Send />
        </button>
      </form>
    </div>
  )
}
