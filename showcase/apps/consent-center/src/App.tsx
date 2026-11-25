import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SolidSession } from '@skpods/solid-web'
import { AppShell, Avatar, Button, Card, ErrorState, PodSignIn, Skeleton, ToastProvider, cx, useRememberAccount, useToast } from '@skpods/ui'
import { Broker } from './lib/broker'
import { discoverPeople } from './lib/people'
import { findBookingEnd } from './lib/pod'
import { brokerFetch, isActive, usePodStore, useSession } from './lib/session'
import { useConsent } from './lib/useConsent'
import type { Person } from './lib/types'
import { AccessPage } from './pages/AccessPage'
import { AuditPage } from './pages/AuditPage'
import { RequestsPage } from './pages/RequestsPage'
import { PodDrawer } from './components/PodDrawer'
import { ChainIcon, ExternalIcon, InboxIcon, KeyIcon, PodIcon, ShieldIcon } from './components/Icons'

type Tab = 'requests' | 'access' | 'audit'
const TABS: Tab[] = ['requests', 'access', 'audit']
const tabFromHash = (): Tab => {
  const h = location.hash.replace(/^#\/?/, '') as Tab
  return TABS.includes(h) ? h : 'requests'
}

function parseSpan(s: string): number {
  const m = /^(\d+)([smhdw])$/.exec(s)
  return m ? Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2] as 's'] : 30 * 86400
}

function Welcome({ session }: { session: SolidSession }) {
  return (
    <div className="mx-auto mt-6 max-w-2xl text-center sm:mt-12">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-navy-900 shadow-glow">
        <ShieldIcon size={32} className="text-brand" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Your data. <span className="glow-text">Your say.</span>
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-base text-muted">
        See every request for your data, and for the people you look after. Allow it for exactly as long as you choose, watch the clock run down, and verify that the record of it cannot be quietly rewritten.
      </p>
      <Card glow className="mx-auto mt-8 max-w-md text-left">
        <div className="space-y-4">
          <PodSignIn session={session} />
          <p className="text-xs text-muted">Standard Solid-OIDC with DPoP. Nothing about you is stored by this app: the files are in your pod.</p>
        </div>
      </Card>
      <ul className="mx-auto mt-10 grid max-w-3xl gap-4 text-left sm:grid-cols-3">
        {[
          [InboxIcon, 'One inbox', 'Requests for you, your parent, your child. Each says who, why and for which data.'],
          [KeyIcon, 'Allow with an end', '24 hours, until the appointment ends, or your own time. It switches itself off.'],
          [ChainIcon, 'Proof, not promises', 'A hash chain of every step that you can recompute in your own browser.'],
        ].map(([Icon, t, d]) => {
          const I = Icon as typeof InboxIcon
          return (
            <li key={t as string} className="skp-card p-4">
              <I className="text-brand" />
              <p className="mt-2 text-sm font-semibold">{t as string}</p>
              <p className="mt-1 text-sm text-muted">{d as string}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Cockpit({ session }: { session: SolidSession }) {
  const { toast } = useToast()
  const store = usePodStore(session)
  const broker = useMemo(() => new Broker(brokerFetch(session)), [session])
  const self = session.webId!
  const [people, setPeople] = useState<Person[]>([{ webId: self, name: 'You', short: 'You', relation: 'self' }])
  const [peopleReady, setPeopleReady] = useState(false)
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [filter, setFilter] = useState<string>('all')
  const [drawer, setDrawer] = useState(false)
  const [tick, setTick] = useState(0)
  const [bookingEnds, setBookingEnds] = useState<Record<string, Date | undefined>>({})
  const [ceilings, setCeilings] = useState<Record<string, number>>({})

  useEffect(() => {
    const h = () => setTab(tabFromHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const go = (t: Tab) => {
    location.hash = `/${t}`
    setTab(t)
  }

  useEffect(() => {
    if (!store) return
    discoverPeople(store, self).then((r) => {
      setPeople(r.people)
      setPeopleReady(true)
    })
  }, [store, self])

  const subjects = useMemo(() => (peopleReady ? people.map((p) => p.webId) : []), [people, peopleReady])
  const consent = useConsent(broker, subjects, () => setTick((t) => t + 1))
  const byId = useMemo(() => Object.fromEntries(people.map((p) => [p.webId, p])), [people])

  // names for audit entries: people, requesters, and the system actors
  const nameOf = useCallback(
    (webId?: string) => {
      if (!webId) return 'someone'
      if (webId === 'guardian') return 'Your rules'
      if (webId === 'system') return 'The system'
      if (byId[webId]) return byId[webId].relation === 'self' ? 'You' : byId[webId].short
      const r = consent.requests.find((x) => x.requester.webid === webId)
      return r?.requester.name ?? (webId.match(/~([^/]+)/)?.[1] ?? webId)
    },
    [byId, consent.requests],
  )

  // policy ceilings, once per person
  useEffect(() => {
    subjects.forEach((s) => {
      broker.policy(s).then((p) => setCeilings((c) => ({ ...c, [s]: parseSpan(p.ceiling) }))).catch(() => undefined)
    })
  }, [broker, subjects])

  // booking end for requests that cite a booking and wait for you
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (!store) return
    for (const r of consent.requests) {
      const ref = r.context.booking_ref
      const key = `${r.subject}|${ref}`
      if (!ref || asked.current.has(key) || !r.items.some((i) => i.status === 'awaiting_owner')) continue
      asked.current.add(key)
      store.storageRoot(r.subject).then((root) => (root ? findBookingEnd(store, root, ref) : undefined)).then((d) => d && setBookingEnds((m) => ({ ...m, [key]: d })))
    }
  }, [store, consent.requests])

  // toasts for things that happen without you clicking
  const seen = useRef<{ reqs: Set<string>; grants: Map<string, string>; first: boolean }>({ reqs: new Set(), grants: new Map(), first: true })
  useEffect(() => {
    if (!consent.loaded) return
    const s = seen.current
    for (const r of consent.requests) {
      if (!s.reqs.has(r.id)) {
        s.reqs.add(r.id)
        if (!s.first && r.items.some((i) => i.status === 'awaiting_owner')) {
          toast({ tone: 'warn', title: `${r.requester.name} is asking for access`, description: r.purpose.slice(0, 90), action: { label: 'Review', onClick: () => go('requests') } })
        }
      }
    }
    for (const g of consent.grants) {
      const was = s.grants.get(g.id)
      if (!s.first && was === 'active' && g.status === 'expired') {
        toast({ tone: 'info', title: 'Access ended by itself', description: `${g.grantee_name} can no longer read your ${g.data_class.replace(/_/g, ' ')}.` })
      }
      s.grants.set(g.id, g.status)
    }
    s.first = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consent.requests, consent.grants, consent.loaded])

  const scoped = <T extends { subject: string }>(l: T[]) => (filter === 'all' ? l : l.filter((x) => x.subject === filter))
  const requests = scoped(consent.requests)
  const grants = scoped(consent.grants)
  const pending = (list: typeof requests) => list.reduce((n, r) => n + r.items.filter((i) => i.status === 'awaiting_owner').length, 0)
  const pendingBy = (id: string) => pending(consent.requests.filter((r) => r.subject === id))
  const activeCount = grants.filter((g) => g.status === 'active').length
  const hour = new Date().getHours()
  const myName = people[0].name.split(' ')[0]

  if (consent.error && !consent.loaded) {
    return (
      <ErrorState
        title="Cannot reach the consent service"
        error={consent.error.message}
        action={<Button variant="secondary" onClick={() => void consent.reload()}>Try again</Button>}
      />
    )
  }

  return (
    <AppShell
      appName="Consent Center"
      nav={[
        { id: 'requests', label: 'Requests', icon: <InboxIcon size={16} />, badge: pending(requests) || undefined },
        { id: 'access', label: 'Open access', icon: <KeyIcon size={16} />, badge: activeCount || undefined },
        { id: 'audit', label: 'Audit', icon: <ChainIcon size={16} /> },
      ]}
      activeNav={tab}
      onNav={(id) => go(id as Tab)}
      user={{ name: people[0].name, webId: self }}
      onLogout={() => session.logout()}
      widthClass="max-w-4xl"
      actions={
        <>
          <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => setDrawer(true)} data-testid="open-pod">
            <PodIcon size={16} /> <span className="hidden lg:inline">What&rsquo;s in my pod</span>
          </Button>
          <a href="/facility/" target="_blank" rel="noreferrer" className="skp-btn-ghost !hidden !px-2.5 !py-1.5 text-xs xl:!inline-flex" title="Open the care facility's screen (log in as dw-care-facility in a private window)">
            Facility view <ExternalIcon size={13} />
          </a>
        </>
      }
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, {myName}.
          </h1>
          <p className="mt-1 text-sm text-muted" data-testid="summary">
            {!consent.loaded
              ? 'Loading your requests...'
              : pending(requests) > 0
                ? `${pending(requests)} ${pending(requests) === 1 ? 'item needs' : 'items need'} you. `
                : 'Nothing needs you right now. '}
            {activeCount > 0 ? `${activeCount} ${activeCount === 1 ? 'grant is' : 'grants are'} open and counting down.` : 'Nothing is open.'}
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted" title="Server-sent events from the consent service">
          <span className={cx('h-2 w-2 rounded-full', consent.live ? 'bg-ok animate-pulse-ring' : 'bg-warn')} />
          {consent.live ? 'Live' : 'Reconnecting...'}
        </span>
      </div>

      {people.length > 1 && (
        <div className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Whose data">
          {[{ webId: 'all', name: 'Everyone', short: 'Everyone', relation: 'self' as const }, ...people].map((p) => {
            const n = p.webId === 'all' ? pending(consent.requests) : pendingBy(p.webId)
            return (
              <button
                key={p.webId}
                type="button"
                aria-pressed={filter === p.webId}
                data-testid={`person-${p.webId === 'all' ? 'all' : p.short.split(' ')[0].toLowerCase()}`}
                onClick={() => setFilter(p.webId)}
                className={cx('relative flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 text-sm transition', filter === p.webId ? 'border-brand bg-brand-soft font-semibold shadow-glow' : 'border-line bg-surface hover:border-brand/50')}
              >
                {p.webId === 'all' ? <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs">All</span> : <Avatar name={p.name} seed={p.webId} size="sm" />}
                <span className="text-left leading-tight">
                  {p.short}
                  {p.relation !== 'self' && p.webId !== 'all' && <span className="block text-[11px] font-normal text-muted">{p.relation === 'attorney' ? 'attorney-in-fact' : 'parent'}</span>}
                </span>
                {n > 0 && <span className="ml-1 rounded-full bg-warm px-1.5 text-[11px] font-bold text-navy-950">{n}</span>}
              </button>
            )
          })}
        </div>
      )}

      {!consent.loaded ? (
        <div className="space-y-4"><Skeleton className="h-56" /><Skeleton className="h-40" /></div>
      ) : tab === 'requests' ? (
        <RequestsPage requests={requests} grants={consent.grants} people={byId} broker={broker} bookingEnds={bookingEnds} ceilings={ceilings} onChanged={consent.merge} />
      ) : tab === 'access' ? (
        <AccessPage grants={grants} requests={consent.requests} audit={consent.audit} people={byId} broker={broker} onGrant={consent.mergeGrant} onExpire={() => setTimeout(() => void consent.reload(), 2500)} />
      ) : (
        <AuditPage people={people} audit={consent.audit} broker={broker} store={store} nameOf={nameOf} initial={filter !== 'all' ? filter : undefined} />
      )}

      <PodDrawer open={drawer} onClose={() => setDrawer(false)} store={store} people={people} initial={filter !== 'all' ? filter : undefined} grants={consent.grants} tick={tick} />
    </AppShell>
  )
}

function Inner() {
  const session = useSession({ clientName: 'Consent Center (SKPods showcase)', db: 'skpods-consent-center' })
  useRememberAccount(session)
  if (!session) return <div className="flex min-h-screen items-center justify-center"><Skeleton className="h-10 w-48" /></div>
  if (isActive(session)) return <Cockpit session={session} />
  return (
    <AppShell appName="Consent Center" tagline="Every request for your data, in one calm place" widthClass="max-w-4xl">
      <Welcome session={session} />
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
