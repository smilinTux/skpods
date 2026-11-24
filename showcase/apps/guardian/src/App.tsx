import { SolidSession } from '@skpods/solid-web'
import { AppShell, Button, Card, Skeleton, ToastProvider, useToast, type NavItem } from '@skpods/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { POD_ISSUER } from './config'
import { usePresenter, type StageControls } from './lib/presenter'
import { GuardianContext, useGuardian, useGuardianState } from './lib/useGuardian'
import { ChainView, type ChainCmd } from './views/ChainView'
import { PolicyEditor } from './views/PolicyEditor'
import { PresenterOverlay } from './views/PresenterOverlay'
import { Theatre, type Panel } from './views/Theatre'
import type { PhoneTab } from './views/PhonePanel'
import { Welcome } from './views/Welcome'
import { Led, ListIcon, PlayIcon, ReplayIcon, SlidersIcon, TheatreIcon } from './ui'

type Route = 'live' | 'policy' | 'audit'
const ROUTES: Route[] = ['live', 'policy', 'audit']
const routeFromHash = (): Route => {
  const r = location.hash.replace(/^#\/?/, '').split(/[?&]/)[0] as Route
  return ROUTES.includes(r) ? r : 'live'
}

function useSession() {
  const [session, setSession] = useState<SolidSession>()
  const [, bump] = useState(0)
  useEffect(() => {
    let off = () => {}
    SolidSession.init({ defaultIssuer: POD_ISSUER, clientName: 'Guardian (SKPods showcase)' }).then((s) => {
      setSession(s)
      off = s.onChange(() => bump((n) => n + 1))
    })
    return () => off()
  }, [])
  return session
}

function Signed({ session }: { session: SolidSession }) {
  const g = useGuardianState(session)
  const { toast } = useToast()
  const [route, setRouteState] = useState<Route>(routeFromHash)
  const [panel, setPanel] = useState<Panel>('clinic')
  const [centerTab, setCenterTab] = useState<'think' | 'chain'>('think')
  const [phoneTab, setPhoneTab] = useState<PhoneTab>('feed')
  const [chainCmd, setChainCmd] = useState<ChainCmd>()

  const setRoute = useCallback((r: Route) => {
    setRouteState(r)
    history.replaceState(null, '', `#/${r}`)
  }, [])
  useEffect(() => {
    const h = () => setRouteState(routeFromHash())
    addEventListener('hashchange', h)
    return () => removeEventListener('hashchange', h)
  }, [])

  const stage: StageControls = useMemo(
    () => ({ setRoute, setPhoneTab, setCenterTab, runChain: (kind) => setChainCmd((c) => ({ id: (c?.id ?? 0) + 1, kind })) }),
    [setRoute],
  )
  const presenter = usePresenter(g, stage)
  // On a phone only one panel fits: follow the spotlight.
  useEffect(() => {
    const s = presenter.state.spot
    if (s) setPanel(s === 'chain' ? 'agent' : s)
  }, [presenter.state.spot])

  const present = useCallback(() => {
    if (!g.bridge || g.brokerError) {
      toast({ title: 'Presenter mode needs the services', description: 'Start the guardian service and the clinic bridge first (see the README).', tone: 'warn' })
      return
    }
    setRoute('live')
    void presenter.start()
  }, [g.bridge, g.brokerError, presenter, setRoute, toast])

  const replay = useCallback(async () => {
    presenter.stop()
    setRoute('live')
    setCenterTab('think')
    setPhoneTab('feed')
    await g.resetStage()
    await g.fileRequest()
  }, [g, presenter, setRoute])

  // ?present=1 starts the captioned story as soon as the services answer.
  const wantAuto = useMemo(() => new URLSearchParams(location.search).has('present'), [])
  const [autoDone, setAutoDone] = useState(false)
  useEffect(() => {
    if (wantAuto && !autoDone && g.bridge && g.health && g.facts) {
      setAutoDone(true)
      history.replaceState(null, '', location.pathname + '#/live')
      void presenter.start()
    }
  }, [wantAuto, autoDone, g.bridge, g.health, g.facts, presenter])

  const waiting = g.current?.items.filter((i) => i.status === 'awaiting_owner').length ?? 0
  const nav: NavItem[] = [
    { id: 'live', label: 'Live', icon: <TheatreIcon size={16} />, badge: waiting || undefined },
    { id: 'policy', label: 'Rules', icon: <SlidersIcon size={16} /> },
    { id: 'audit', label: 'Audit', icon: <ListIcon size={16} /> },
  ]

  return (
    <GuardianContext.Provider value={g}>
      <AppShell
        appName="Guardian"
        tagline="An AI agent with a leash"
        nav={nav}
        activeNav={route}
        onNav={(id) => setRoute(id as Route)}
        user={{ name: 'Alice Rivera', webId: g.webId }}
        onLogout={() => session.logout()}
        widthClass="max-w-[1640px]"
        actions={
          <>
            <span className="mr-1 hidden items-center gap-3 text-[11px] text-muted lg:flex" aria-label="Service status">
              <span className="flex items-center gap-1.5" title="sk-consent, the guardian service"><Led on={Boolean(g.health) && !g.brokerError} /> guardian</span>
              <span className="flex items-center gap-1.5" title="The clinic bridge plays Bayview Family Clinic"><Led on={Boolean(g.bridge)} /> clinic</span>
              <span className="flex items-center gap-1.5" title="Live events from the service"><Led on={g.live} /> live</span>
            </span>
            <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={replay} data-testid="replay" title="Clear the stage and run the scenario again"><ReplayIcon size={14} /><span className="hidden sm:inline">Replay</span></Button>
            <Button className="!px-3 !py-1.5 text-xs" onClick={present} data-testid="present"><PlayIcon size={13} /><span className="hidden sm:inline">Presenter mode</span></Button>
          </>
        }
      >
        {route === 'live' && <Theatre spot={presenter.state.spot} panel={panel} setPanel={setPanel} centerTab={centerTab} setCenterTab={setCenterTab} phoneTab={phoneTab} setPhoneTab={setPhoneTab} chainCmd={chainCmd} presenting={presenter.state.running} />}
        {route === 'policy' && <PolicyEditor onReplay={replay} />}
        {route === 'audit' && <AuditPage />}
      </AppShell>
      <PresenterOverlay p={presenter.state} onPause={presenter.togglePause} onSkip={presenter.skip} onStop={presenter.stop} onReplay={() => void presenter.start()} />
    </GuardianContext.Provider>
  )
}

function AuditPage() {
  const g = useGuardian()
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit chain</h1>
        <p className="mt-1 text-sm text-muted">Everything the guardian did for you, in order. The service keeps the chain and mirrors it into your pod, so you can check one against the other, and check the hashes yourself.</p>
      </div>
      <Card padded={false} className="overflow-hidden"><ChainView /></Card>
      <p className="text-xs text-muted">{g.audit.length} entries. Tamper-evident, not tamper-proof: someone who controls the service database and recomputes every later hash would only be caught by comparing the head hash with a copy stored elsewhere, which is what the copy in your pod is for.</p>
    </div>
  )
}

function Inner() {
  const session = useSession()
  if (!session) return <div className="flex min-h-screen items-center justify-center"><Skeleton className="h-10 w-48" /></div>
  const active = session.state === 'active' && Boolean(session.webId)
  return active ? <Signed session={session} /> : <Welcome session={session} expired={session.state === 'expired'} />
}

export function App() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  )
}
