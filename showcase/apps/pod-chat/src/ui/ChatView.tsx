import { Button, cx, useToast } from '@skpods/ui'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatEngine, PreparedUpload } from '../lib/engine'
import { dayLabel } from '../lib/format'
import type { Item, Msg } from '../lib/model'
import { Bubble } from './Bubble'
import { Composer } from './Composer'
import { ConvFace } from './Faces'
import { Back, Copy, Down, Info, Lock, Pencil, Trash, Users } from './icons'
import { InfoPanel } from './InfoPanel'
import { LeaveDialog } from './LeaveDialog'
import { LiveBadge } from './LiveBadge'
import { useEngine } from './useEngine'

function SystemLine({ item, who }: { item: Extract<Item, { t: 'system' }>; who: (w: string) => string }) {
  return (
    <div className="my-3 flex justify-center px-4 animate-fade-up" data-testid={item.kind === 'left' ? 'system-left' : 'system-created'}>
      <p className="max-w-md rounded-2xl bg-surface-2 px-3 py-1.5 text-center text-xs text-muted">
        {item.kind === 'left' ? (
          <><strong className="text-ink">{who(item.who)} left.</strong> Their messages are no longer shared with you. They are still in their own pod.</>
        ) : (
          <span className="inline-flex items-center gap-1.5"><Lock width={12} height={12} /> {who(item.who)} started this chat. Every message lives in its author's pod.</span>
        )}
      </p>
    </div>
  )
}

function GhostLine({ item, who }: { item: Extract<Item, { t: 'ghost' }>; who: (w: string) => string }) {
  const n = item.count
  return (
    <div className="my-1.5 flex justify-center px-4" data-testid={item.reason === 'hidden' ? 'ghost-hidden' : 'ghost-deleted'}>
      <p className="animate-dissolve rounded-2xl border border-dashed border-line px-3 py-1.5 text-center text-xs italic text-muted">
        {item.reason === 'hidden' ? `${n} message${n === 1 ? '' : 's'} from ${who(item.author)} dissolved: they took back access` : `${who(item.author)} deleted a message`}
      </p>
    </div>
  )
}

export function ChatView({ engine, convId, me, onBack }: { engine: ChatEngine; convId: string; me: string; onBack: () => void }) {
  useEngine(engine)
  const { toast } = useToast()
  const d = engine.get(convId)
  const [info, setInfo] = useState(false)
  const [podView, setPodView] = useState(() => { try { return localStorage.getItem('pod-chat:podview') === '1' } catch { return false } })
  const [selected, setSelected] = useState<string>()
  const [confirmDel, setConfirmDel] = useState<string>()
  const [editing, setEditing] = useState<{ id: string; text: string }>()
  const [leaving, setLeaving] = useState(false)
  const [lightbox, setLightbox] = useState<string>()
  const [showJump, setShowJump] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const uploads = useRef(new Map<string, PreparedUpload>())

  useEffect(() => {
    engine.setActive(convId)
    return () => engine.setActive(undefined)
  }, [engine, convId])
  useEffect(() => { try { localStorage.setItem('pod-chat:podview', podView ? '1' : '0') } catch { /* ignore */ } }, [podView])

  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])
  const onScroll = () => {
    const el = scroller.current!
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    setShowJump(!stick.current)
  }
  // keep pinned to the bottom while new items or images change the height
  useEffect(() => {
    const el = inner.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => stick.current && toBottom())
    ro.observe(el)
    return () => ro.disconnect()
  }, [toBottom, d?.loading])
  const lastKey = d?.items[d.items.length - 1]?.key
  useLayoutEffect(() => { if (stick.current) toBottom() }, [lastKey, d?.items.length, toBottom])

  // read receipts: only while the newest messages are on screen and the tab is visible
  const unread = d?.unread ?? 0
  useEffect(() => {
    const mark = () => { if (stick.current && !document.hidden) engine.markRead(convId) }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [engine, convId, unread, lastKey, showJump])

  if (!d) return <div className="flex flex-1 items-center justify-center p-8 text-center text-muted"><p>This conversation is not in your pod. It may have been erased.</p></div>

  const who = (w: string) => engine.person(w)
  const group = d.meta.kind === 'group'
  const others = d.peers.filter((p) => p.webId !== me)
  const active = others.filter((p) => p.status === 'active').length
  const subtitle = group
    ? `${d.members.map((m) => (m.webId === me ? 'You' : m.name.split(' ')[0])).join(', ')}`
    : others[0]?.status === 'active' ? 'Messages stored in each of your pods' : others[0]?.status === 'left' ? 'Left the chat' : 'Not sharing with you'
  const selMsg = selected ? d.items.find((i): i is Extract<Item, { t: 'msg' }> => i.t === 'msg' && i.msg.id === selected) : undefined

  const send = (text: string, upload?: PreparedUpload) => {
    stick.current = true
    void engine.send(convId, text, upload).then(() => undefined, (e) => toast({ title: 'Could not send', description: (e as Error).message, tone: 'error' }))
    requestAnimationFrame(() => toBottom(true))
  }

  return (
    <div className="flex min-h-0 flex-1" data-testid="chat-view" data-conv={convId}>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line bg-surface/90 px-2 py-2 pl-1 backdrop-blur sm:px-3">
          <button type="button" className="skp-btn-ghost !p-2 md:hidden" onClick={onBack} aria-label="Back to chats" data-testid="back"><Back /></button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left hover:bg-surface-2" onClick={() => setInfo(true)} aria-label="Conversation info">
            <ConvFace members={d.members} me={me} kind={d.meta.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold leading-tight" data-testid="chat-title">{d.title}</span>
              <span className="block truncate text-xs text-muted">{subtitle}</span>
            </span>
          </button>
          <LiveBadge engine={engine} convId={convId} loading={d.loading} />
          <button type="button" className={cx('skp-btn-ghost !p-2', info && 'bg-surface-2 text-ink')} onClick={() => setInfo((v) => !v)} aria-label="Where this chat lives" aria-pressed={info} data-testid="info-toggle"><Info /></button>
        </header>

        <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 sm:px-5" role="log" aria-live="polite" aria-label={`Messages in ${d.title}`} data-testid="timeline">
          <div ref={inner} className="mx-auto max-w-3xl pb-2">
            {d.loading && <div className="space-y-3 pt-4" aria-busy><div className="h-10 w-2/3 animate-pulse rounded-2xl bg-surface-2" /><div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-surface-2" /><div className="h-16 w-3/5 animate-pulse rounded-2xl bg-surface-2" /></div>}
            {!d.loading && d.items.filter((i) => i.t === 'msg').length === 0 && (
              <div className="mx-auto mt-10 max-w-xs rounded-2xl border border-dashed border-line p-5 text-center" data-testid="empty-chat">
                <Users className="mx-auto mb-2 text-brand" />
                <p className="text-sm font-semibold">No messages yet</p>
                <p className="mt-1 text-sm text-muted">Say hello. It will be written to your pod and show up for {others.map((o) => o.name.split(' ')[0]).join(', ') || 'them'} once they join.</p>
              </div>
            )}
            {d.items.map((it) => {
              if (it.t === 'day') return <div key={it.key} className="my-3 flex justify-center"><span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-muted shadow-sm ring-1 ring-line">{dayLabel(it.at)}</span></div>
              if (it.t === 'system') return <SystemLine key={it.key} item={it} who={(w) => (w === me ? 'You' : who(w).name)} />
              if (it.t === 'ghost') return <GhostLine key={it.key} item={it} who={(w) => who(w).name} />
              const isSel = selected === it.msg.id
              return (
                <div key={it.key}>
                  <Bubble
                    item={it}
                    store={engine.store}
                    group={group}
                    podView={podView}
                    who={who}
                    selected={isSel}
                    meLeft={d.left}
                    onSelect={() => { setSelected(isSel ? undefined : it.msg.id); setConfirmDel(undefined) }}
                    onOpenImage={setLightbox}
                    onRetry={() => engine.retry(convId, it.msg.id, uploads.current.get(it.msg.id))}
                    onDiscard={() => engine.discard(convId, it.msg.id)}
                  />
                  {isSel && selMsg && it.msg.status !== 'sending' && (
                    <MessageActions
                      mine={it.mine}
                      canEdit={Boolean(it.msg.text) && !d.left && it.msg.status === 'sent'}
                      canDelete={!d.left && it.msg.status === 'sent'}
                      confirming={confirmDel === it.msg.id}
                      onEdit={() => { setEditing({ id: it.msg.id, text: it.msg.text }); setSelected(undefined) }}
                      onCopy={() => { void navigator.clipboard?.writeText(it.msg.text); toast({ title: 'Copied', tone: 'info', duration: 1500 }); setSelected(undefined) }}
                      onAskDelete={() => setConfirmDel(it.msg.id)}
                      onDelete={() => { setSelected(undefined); setConfirmDel(undefined); void engine.remove(convId, it.msg.id).catch((e) => toast({ title: 'Could not delete', description: (e as Error).message, tone: 'error' })) }}
                    />
                  )}
                </div>
              )
            })}
          </div>
          {showJump && (
            <button type="button" onClick={() => { stick.current = true; toBottom(true); setShowJump(false) }} className="sticky bottom-2 left-full z-10 ml-auto flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-xs font-semibold shadow-card ring-1 ring-line" aria-label="Jump to latest">
              <Down width={16} height={16} /> {unread > 0 ? `${unread} new` : 'Latest'}
            </button>
          )}
        </div>

        {d.left ? (
          <div className="border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-testid="left-banner">
            <p className="flex items-center gap-2 text-sm font-semibold"><Lock width={16} height={16} /> You left. Your messages are hidden from everyone.</p>
            <p className="mb-2 text-xs text-muted">They are still in your pod. Rejoin to share them again.</p>
            <Button onClick={() => void engine.rejoin(convId).catch((e) => toast({ title: 'Could not rejoin', description: (e as Error).message, tone: 'error' }))} data-testid="rejoin-banner">Rejoin conversation</Button>
          </div>
        ) : (
          <Composer
            draftKey={convId}
            editing={editing}
            onCancelEdit={() => setEditing(undefined)}
            onSend={send}
            onSaveEdit={(id, text) => { setEditing(undefined); void engine.edit(convId, id, text).catch((e) => toast({ title: 'Could not save the edit', description: (e as Error).message, tone: 'error' })) }}
            onError={(m) => toast({ title: 'Photo problem', description: m, tone: 'error' })}
          />
        )}
        {!d.left && active === 0 && others.length > 0 && !d.loading && (
          <p className="bg-surface px-4 pb-2 text-center text-xs text-muted" data-testid="nobody-here">Nobody else is sharing right now. What you write stays in your pod, and they can read it only while they have access.</p>
        )}
      </section>

      {info && <InfoPanel engine={engine} d={d} me={me} podView={podView} setPodView={setPodView} onClose={() => setInfo(false)} onLeave={() => setLeaving(true)} onToast={(t) => toast(t)} />}
      {leaving && (
        <LeaveDialog
          title={d.title}
          others={others.map((o) => o.name.split(' ')[0])}
          onCancel={() => setLeaving(false)}
          onConfirm={async () => {
            try {
              await engine.leave(convId)
              toast({ title: 'You left the conversation', description: 'Everyone else lost access to your messages.', tone: 'success' })
            } catch (e) {
              toast({ title: 'Could not leave', description: (e as Error).message, tone: 'error' })
            }
            setLeaving(false)
          }}
        />
      )}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setLightbox(undefined)} data-testid="lightbox">
          <img src={lightbox} alt="Full size" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </div>
  )
}

function MessageActions({ mine, canEdit, canDelete, confirming, onEdit, onCopy, onAskDelete, onDelete }: { mine: boolean; canEdit: boolean; canDelete: boolean; confirming: boolean; onEdit: () => void; onCopy: () => void; onAskDelete: () => void; onDelete: () => void }) {
  return (
    <div className={cx('mt-1 flex animate-pop gap-1.5', mine ? 'justify-end' : 'justify-start pl-9')} data-testid="msg-actions">
      {confirming ? (
        <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-1.5 text-xs">
          <span>Delete from your pod? Others lose it too.</span>
          <button className="font-semibold text-danger" onClick={onDelete} data-testid="delete-confirm">Delete</button>
        </div>
      ) : (
        <>
          <button className="skp-btn-secondary !px-3 !py-1.5 text-xs" onClick={onCopy}><Copy width={14} height={14} /> Copy</button>
          {mine && canEdit && <button className="skp-btn-secondary !px-3 !py-1.5 text-xs" onClick={onEdit} data-testid="edit"><Pencil width={14} height={14} /> Edit</button>}
          {mine && canDelete && <button className="skp-btn-danger !px-3 !py-1.5 text-xs" onClick={onAskDelete} data-testid="delete"><Trash width={14} height={14} /> Delete</button>}
        </>
      )}
    </div>
  )
}

export type { Msg }
