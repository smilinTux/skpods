import { PodStore, SolidSession, safeLocal, NS, one } from '@skpods/solid-web'
import { Button, Card, ErrorState, Skeleton, ToastProvider, useToast } from '@skpods/ui'
import { useEffect, useMemo, useState } from 'react'
import { ChatEngine } from './lib/engine'
import { demoCast } from './lib/people'
import { ChatView } from './ui/ChatView'
import { ConversationList } from './ui/ConversationList'
import { Chat, Lock } from './ui/icons'
import { NewChat } from './ui/NewChat'
import { useEngine, useHashRoute } from './ui/useEngine'

const DEFAULT_ISSUER = import.meta.env.VITE_POD_ISSUER ?? 'https://pods-dev.skstack01.douno.it'

function useSession() {
  const [session, setSession] = useState<SolidSession>()
  const [, bump] = useState(0)
  useEffect(() => {
    let off = () => {}
    SolidSession.init({ defaultIssuer: DEFAULT_ISSUER, clientName: 'Pod Chat (SKPods showcase)' }).then((s) => {
      setSession(s)
      off = s.onChange(() => bump((n) => n + 1))
    })
    return () => off()
  }, [])
  return session
}

function Welcome({ session, expired }: { session: SolidSession; expired: boolean }) {
  const [issuer, setIssuer] = useState(DEFAULT_ISSUER)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const go = async () => {
    setBusy(true)
    setErr(undefined)
    try {
      await session.login(issuer)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md">
        <Card glow>
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Chat width={28} height={28} /></div>
            <h1 className="text-2xl font-bold tracking-tight">Pod Chat</h1>
            <p className="text-sm text-muted">A messenger where <strong className="text-ink">every message lives in its author's own pod</strong>. Nobody hosts the conversation. Leave, and your words leave with you.</p>
            <ul className="space-y-1.5 text-left text-sm text-muted">
              <li className="flex gap-2"><Lock width={16} height={16} className="mt-0.5 shrink-0 text-brand" /> Your messages are files in your pod, shared by ACL with the people in the chat.</li>
              <li className="flex gap-2"><Lock width={16} height={16} className="mt-0.5 shrink-0 text-brand" /> Photos are stored in your pod too, and shared the same way.</li>
              <li className="flex gap-2"><Lock width={16} height={16} className="mt-0.5 shrink-0 text-brand" /> Leaving revokes access. Your messages vanish for everyone else.</li>
            </ul>
            {expired && <p role="status" className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Your session ended. Log in again to continue.</p>}
            {session.error && !expired && <ErrorState title="Login problem" error={session.error} />}
            <label className="block text-left text-sm font-medium">
              Identity provider
              <input value={issuer} onChange={(e) => setIssuer(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-sm" inputMode="url" autoComplete="url" data-testid="issuer" />
            </label>
            {err && <ErrorState error={err} />}
            <Button className="w-full" loading={busy} onClick={go} data-testid="login">Log in with your pod</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function savedContacts(me: string): string[] {
  try {
    return JSON.parse(safeLocal()?.getItem('pod-chat:contacts:' + me) ?? '[]')
  } catch {
    return []
  }
}

function Signed({ session }: { session: SolidSession }) {
  const { toast } = useToast()
  const me = session.webId!
  const [route, setRoute] = useHashRoute()
  const [newChat, setNewChat] = useState(false)
  const [busyInvite, setBusyInvite] = useState<string>()
  const [myName, setMyName] = useState('You')

  const engine = useMemo(() => {
    const cast = demoCast(new URL(me).origin).filter((w) => w !== me)
    return new ChatEngine({ store: new PodStore(session.fetch), me, contacts: [...new Set([...cast, ...savedContacts(me)])] })
  }, [session, me])

  useEffect(() => {
    engine.onToast = (t) => toast(t)
    engine.onIncoming = (c) => toast({ title: c.title, description: `${c.author}: ${c.text}`, tone: 'info', action: { label: 'Open', onClick: () => setRoute(c.convId) } })
    void engine.start()
    const vis = () => !document.hidden && engine.nudge()
    document.addEventListener('visibilitychange', vis)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      engine.stop()
    }
  }, [engine, toast, setRoute])

  useEffect(() => {
    new PodStore(session.fetch).profile(me).then((p) => setMyName(engine.person(me).name !== me ? engine.person(me).name : one(p, me, NS.foaf + 'name') ?? 'You')).catch(() => {})
  }, [session, me, engine])

  const v = useEngine(engine)
  const myNameNow = engine.person(me).name
  useEffect(() => {
    const total = engine.list().reduce((n, c) => n + c.unread, 0)
    document.title = total ? `(${total}) Pod Chat` : 'Pod Chat'
  }, [engine, v])
  useEffect(() => {
    try {
      safeLocal()?.setItem('pod-chat:contacts:' + me, JSON.stringify(engine.contacts.map((c) => c.webId)))
    } catch { /* ignore */ }
  }, [engine, me, v])

  const join = async (url: string) => {
    const inv = engine.invitations.find((i) => i.url === url)
    if (!inv) return
    setBusyInvite(url)
    try {
      const id = await engine.acceptInvite(inv)
      setRoute(id)
    } catch (e) {
      toast({ title: 'Could not join', description: (e as Error).message, tone: 'error' })
    } finally {
      setBusyInvite(undefined)
    }
  }

  const logout = async () => {
    engine.stop()
    try { indexedDB.deleteDatabase('pod-chat-cache') } catch { /* ignore */ }
    await session.logout()
  }

  const known = route && engine.get(route)
  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden">
      <aside className={`${route ? 'hidden md:flex' : 'flex'} w-full min-h-0 shrink-0 flex-col border-r border-line bg-bg md:w-[22rem] lg:w-[24rem]`}>
        <ConversationList
          engine={engine}
          me={me}
          name={myNameNow !== me && myNameNow ? myNameNow : myName}
          activeId={route}
          onOpen={setRoute}
          onNew={() => setNewChat(true)}
          onLogout={logout}
          busyInvite={busyInvite}
          onJoin={join}
          onDecline={(url) => { const i = engine.invitations.find((x) => x.url === url); if (i) void engine.declineInvite(i) }}
        />
      </aside>
      <main className={`${route ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-bg`}>
        {route && (known || engine.status !== 'ready') ? (
          engine.status !== 'ready' ? <div className="flex flex-1 items-center justify-center"><Skeleton className="h-10 w-48" /></div> : <ChatView key={route} engine={engine} convId={route} me={me} onBack={() => setRoute(undefined)} />
        ) : (
          <div className="m-auto max-w-sm px-6 text-center" data-testid="no-chat-selected">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Chat width={28} height={28} /></div>
            <h2 className="text-lg font-semibold">{route ? 'That chat is not in your pod' : 'Pick a conversation'}</h2>
            <p className="mt-1 text-sm text-muted">Everything you write here is saved as small files in your own pod. The people you chat with read them from there, and only while you allow it.</p>
            {route && <Button className="mt-3" variant="secondary" onClick={() => setRoute(undefined)}>Back to chats</Button>}
          </div>
        )}
      </main>
      {newChat && (
        <NewChat
          engine={engine}
          onClose={() => setNewChat(false)}
          onError={(m) => toast({ title: 'Could not start the chat', description: m, tone: 'error' })}
          onCreated={(id) => { setNewChat(false); setRoute(id) }}
        />
      )}
    </div>
  )
}

function Inner() {
  const session = useSession()
  if (!session) return <div className="flex h-full items-center justify-center"><Skeleton className="h-10 w-48" /></div>
  const active = session.state === 'active' && session.webId
  return active ? <Signed session={session} /> : <Welcome session={session} expired={session.state === 'expired'} />
}

export function App() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  )
}
