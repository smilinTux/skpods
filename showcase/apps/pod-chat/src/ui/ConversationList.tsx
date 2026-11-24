import { Avatar, Button, EmptyState, Skeleton, ThemeToggle, cx } from '@skpods/ui'
import { BrandMark } from '@skpods/ui'
import { useState } from 'react'
import type { ChatEngine } from '../lib/engine'
import { listStamp } from '../lib/format'
import { ConvFace } from './Faces'
import { Compose, Lock, Search } from './icons'
import { useEngine } from './useEngine'

export function ConversationList({ engine, me, name, activeId, onOpen, onNew, onLogout, busyInvite, onJoin, onDecline }: {
  engine: ChatEngine
  me: string
  name: string
  activeId?: string
  onOpen: (id: string) => void
  onNew: () => void
  onLogout: () => void
  busyInvite?: string
  onJoin: (url: string) => void
  onDecline: (url: string) => void
}) {
  useEngine(engine)
  const [q, setQ] = useState('')
  const convs = engine.list().filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()))
  const invites = engine.invitations
  const loading = engine.status === 'loading' || engine.status === 'idle'
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="conversation-list">
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <BrandMark size={30} />
        <h1 className="text-lg font-bold tracking-tight">Pod Chat</h1>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <button type="button" className="skp-btn-primary !h-10 !w-10 !rounded-full !p-0" onClick={onNew} aria-label="New chat" data-testid="new-chat"><Compose width={18} height={18} /></button>
        </div>
      </header>
      <div className="px-4 pb-2">
        <label className="relative block">
          <span className="sr-only">Search chats</span>
          <Search width={16} height={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="h-10 w-full rounded-full border border-line bg-surface-2 pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {invites.length > 0 && (
          <section aria-label="Invitations" className="mx-3 mb-2 space-y-2" data-testid="invitations">
            {invites.map((inv) => (
              <div key={inv.url} className="rounded-2xl border border-warm/40 bg-warm-soft/60 p-3 animate-pop" data-testid="invitation">
                <p className="text-sm" data-testid="invitation-text">{inv.kind === 'direct' ? <><strong>{inv.senderName}</strong> wants to chat with you</> : <><strong>{inv.senderName}</strong> invited you to <strong>{inv.title}</strong></>}</p>
                <p className="mt-0.5 text-xs text-muted">Joining lets the others read what you write, from your own pod.</p>
                <div className="mt-2 flex gap-2">
                  <Button className="!py-1.5" loading={busyInvite === inv.url} onClick={() => onJoin(inv.url)} data-testid="invite-join">Join</Button>
                  <Button variant="ghost" className="!py-1.5" onClick={() => onDecline(inv.url)}>Decline</Button>
                </div>
              </div>
            ))}
          </section>
        )}

        {loading && <div className="space-y-1 px-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[4.25rem] rounded-2xl" />)}</div>}
        {engine.status === 'error' && <p role="alert" className="m-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{engine.error}</p>}
        {!loading && engine.status !== 'error' && convs.length === 0 && (
          <EmptyState title={q ? 'No chat matches' : 'No conversations yet'} hint={q ? 'Try another name.' : 'Start one with the pencil button. Your messages will live in your own pod.'} action={!q && <Button onClick={onNew}>Start a chat</Button>} />
        )}
        <ul role="list" className="px-2">
          {convs.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                aria-current={activeId === c.id ? 'page' : undefined}
                data-testid="conv-row"
                data-title={c.title}
                className={cx('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-surface-2 active:scale-[.995]', activeId === c.id && 'bg-brand-soft/60 dark:bg-surface-2')}
              >
                <ConvFace members={c.members} me={me} kind={c.kind} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cx('min-w-0 flex-1 truncate text-[15px]', c.unread ? 'font-bold' : 'font-semibold')}>{c.title}</span>
                    {c.last && <span className={cx('shrink-0 text-xs', c.unread ? 'font-semibold text-brand' : 'text-muted')}>{listStamp(c.last.at)}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cx('min-w-0 flex-1 truncate text-sm', c.unread ? 'text-ink' : 'text-muted')}>
                      {c.loading ? <span className="inline-block h-3 w-40 max-w-full animate-pulse rounded bg-surface-2 align-middle" aria-label="Loading" /> : c.left ? <span className="inline-flex items-center gap-1"><Lock width={12} height={12} /> You left</span> : c.last ? <>{c.last.mine ? 'You: ' : c.kind === 'group' ? `${engine.person(c.last.author).name.split(' ')[0]}: ` : ''}{c.last.text || (c.last.image ? 'Photo' : '')}</> : <em>No messages yet</em>}
                    </span>
                    {c.unread > 0 && <span className="min-w-[1.4rem] shrink-0 rounded-full bg-teal-700 px-1.5 py-0.5 text-center text-[11px] font-bold text-white dark:bg-brand dark:text-brand-ink" data-testid="unread">{c.unread}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <Avatar name={name} seed={me} size="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium" data-testid="me-name">{name}</p>
          <p className="truncate text-[11px] text-muted">Your pod holds what you write</p>
        </div>
        <button type="button" className="skp-btn-ghost !px-2.5 !py-1.5 text-xs" onClick={onLogout} data-testid="logout">Log out</button>
      </footer>
    </div>
  )
}
