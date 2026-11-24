import { useEffect, useState } from 'react'
import { NS, PodStore, SolidSession, one } from '@skpods/solid-web'
import { AppShell, Button, Card, ErrorState, Skeleton, ToastProvider, cx } from '@skpods/ui'
import { Businesses } from './components/Businesses'
import { Console } from './components/Console'
import { ExportTab } from './components/ExportTab'
import { Icon } from './components/bits'
import { Receipts } from './components/Receipts'
import { NO_FILTERS, type Filters } from './lib/filter'
import { useWallet } from './lib/useWallet'

const DEFAULT_ISSUER = import.meta.env.VITE_POD_ISSUER ?? 'https://pods-dev.skstack01.douno.it'

function useSession() {
  const [session, setSession] = useState<SolidSession>()
  const [, bump] = useState(0)
  useEffect(() => {
    let off = () => {}
    SolidSession.init({ defaultIssuer: DEFAULT_ISSUER, clientName: 'Receipts Wallet (SKPods showcase)' }).then((s) => {
      setSession(s)
      off = s.onChange(() => bump((n) => n + 1))
    })
    return () => off()
  }, [])
  return session
}

function useProfileName(session: SolidSession | undefined, webId?: string) {
  const [name, setName] = useState<string>()
  useEffect(() => {
    if (!session || !webId) return setName(undefined)
    new PodStore(session.fetch).profile(webId).then((p) => setName(one(p, webId, NS.foaf + 'name'))).catch(() => {})
  }, [session, webId])
  return name
}

type Mode = 'wallet' | 'console'
type Tab = 'receipts' | 'businesses' | 'export'

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
    <div className="mx-auto mt-6 max-w-lg sm:mt-12">
      <Card glow>
        <div className="space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand" aria-hidden>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Every receipt you ever got, in one place you own.</h1>
          <p className="text-sm text-muted">Businesses drop receipts into your pod and can never read them back. You keep them forever, even after you switch provider. Search them, total them, take them with you.</p>
          {expired && <p role="status" className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Your session ended. Log in again to continue.</p>}
          {session.error && !expired && <ErrorState title="Login problem" error={session.error} />}
          <label className="block text-left text-sm font-medium">
            Identity provider
            <input value={issuer} onChange={(e) => setIssuer(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-sm" inputMode="url" autoComplete="url" data-testid="issuer" />
          </label>
          {err && <ErrorState error={err} />}
          <Button className="w-full" loading={busy} onClick={go} data-testid="login">Log in with your pod</Button>
          <p className="text-xs text-muted">Customer or business, you log in the same way. After login, switch between <strong>My wallet</strong> and <strong>Business console</strong>.</p>
        </div>
      </Card>
    </div>
  )
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="tablist" aria-label="Mode" className="mx-auto mb-5 flex w-fit rounded-xl bg-surface-2 p-1 text-sm font-semibold">
      {(['wallet', 'console'] as const).map((m) => (
        <button key={m} role="tab" aria-selected={mode === m} data-testid={`mode-${m}`} onClick={() => onChange(m)} className={cx('rounded-lg px-4 py-1.5 transition', mode === m ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>
          {m === 'wallet' ? 'My wallet' : 'Business console'}
        </button>
      ))}
    </div>
  )
}

function Wallet({ session, tab, setTab }: { session: SolidSession; tab: Tab; setTab: (t: Tab) => void }) {
  const api = useWallet(session)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)

  if (api.phase === 'loading')
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading your receipts">
        <Skeleton className="h-28" />
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        <Skeleton className="h-64" />
      </div>
    )
  if (api.phase === 'error') return <ErrorState title="Could not open your wallet" error={api.error} action={<Button variant="secondary" onClick={() => location.reload()}>Try again</Button>} />
  if (api.phase === 'setup')
    return (
      <Card glow className="mx-auto max-w-xl">
        <div className="space-y-4">
          <h2 className="text-xl font-bold tracking-tight">Set up your receipts wallet</h2>
          <p className="text-sm text-muted">This creates three private places in your pod, under <span className="font-mono">skpods/v1/receipts/</span>:</p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2"><span className="text-brand">{Icon.lock}</span><span><strong>inbox/</strong> one container per business, each allowing that business to add files and nothing else.</span></li>
            <li className="flex gap-2"><span className="text-brand">{Icon.lock}</span><span><strong>archive/</strong> where receipts are kept after arrival. Only you can read it.</span></li>
            <li className="flex gap-2"><span className="text-brand">{Icon.lock}</span><span><strong>businesses/</strong> your list of who may send you receipts.</span></li>
          </ul>
          <Button loading={api.busy} onClick={() => api.setup()} data-testid="setup">Create my wallet</Button>
        </div>
      </Card>
    )

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Wallet sections" className="hidden w-fit rounded-xl bg-surface-2 p-1 text-sm font-medium md:flex">
        {([['receipts', 'Receipts'], ['businesses', 'Businesses'], ['export', 'Export']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} data-testid={`tab-${id}`} onClick={() => setTab(id)} className={cx('rounded-lg px-4 py-1.5', tab === id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>
      {tab === 'receipts' && <Receipts receipts={api.receipts} businesses={api.businesses} filters={filters} setFilters={setFilters} loading={api.busy} />}
      {tab === 'businesses' && <Businesses api={api} />}
      {tab === 'export' && <ExportTab receipts={api.receipts} filters={filters} owner={session.webId!} />}
    </div>
  )
}

function Inner() {
  const session = useSession()
  const active = Boolean(session && session.state === 'active' && session.webId)
  const name = useProfileName(session, active ? session!.webId : undefined)
  const [mode, setModeState] = useState<Mode>(() => (location.hash === '#console' ? 'console' : 'wallet'))
  const [tab, setTab] = useState<Tab>('receipts')
  const setMode = (m: Mode) => {
    setModeState(m)
    history.replaceState(null, '', m === 'console' ? '#console' : location.pathname + location.search)
  }
  if (!session) return <div className="flex min-h-screen items-center justify-center"><Skeleton className="h-10 w-48" /></div>
  const showNav = active && mode === 'wallet'
  return (
    <AppShell
      appName="Receipts Wallet"
      tagline="Receipts from every business, kept in your own pod"
      user={active ? { name: name ?? 'You', webId: session.webId! } : undefined}
      onLogout={active ? () => session.logout() : undefined}
      widthClass="max-w-4xl"
      nav={showNav ? [{ id: 'receipts', label: 'Receipts', icon: Icon.receipt }, { id: 'businesses', label: 'Businesses', icon: Icon.store }, { id: 'export', label: 'Export', icon: Icon.export }] : undefined}
      activeNav={tab}
      onNav={(id) => setTab(id as Tab)}
    >
      {active ? (
        <>
          <ModeSwitch mode={mode} onChange={setMode} />
          <div hidden={mode !== 'wallet'}><Wallet session={session} tab={tab} setTab={setTab} /></div>
          <div hidden={mode !== 'console'}><Console session={session} /></div>
        </>
      ) : (
        <Welcome session={session} expired={session.state === 'expired'} />
      )}
    </AppShell>
  )
}

export function App() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  )
}
