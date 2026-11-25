import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_ISSUER, NS, PodStore, SolidSession, one, type ContainerEntry } from '@skpods/solid-web'
import { AppShell, Avatar, Button, Card, EmptyState, ErrorState, PodSignIn, Skeleton, ToastProvider, useRememberAccount, useToast } from '@skpods/ui'

function useSession() {
  const [session, setSession] = useState<SolidSession>()
  const [, bump] = useState(0)
  useEffect(() => {
    let off = () => {}
    SolidSession.init({ defaultIssuer: DEFAULT_ISSUER, clientName: 'Hello Pod (SKPods showcase)' }).then((s) => {
      setSession(s)
      off = s.onChange(() => bump((n) => n + 1))
    })
    return () => off()
  }, [])
  return session
}

const nameOf = (u: string) => decodeURIComponent(u.replace(/\/$/, '').split('/').pop() ?? u)

function FileRow({ e }: { e: ContainerEntry }) {
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid="file-row">
      <span aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-lg ${e.isContainer ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-muted'}`}>
        {e.isContainer ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-sm" title={e.url}>{nameOf(e.url)}{e.isContainer ? '/' : ''}</span>
    </li>
  )
}

function Files({ store, url, empty }: { store: PodStore; url: string; empty: string }) {
  const [items, setItems] = useState<ContainerEntry[] | undefined>()
  const [error, setError] = useState<unknown>()
  const load = useCallback(() => {
    setError(undefined)
    store.list(url).then((l) => setItems(l.sort((a, b) => Number(b.isContainer) - Number(a.isContainer) || a.url.localeCompare(b.url)))).catch(setError)
  }, [store, url])
  useEffect(load, [load])
  useEffect(() => {
    const h = () => load()
    window.addEventListener('hello-pod:refresh', h)
    return () => window.removeEventListener('hello-pod:refresh', h)
  }, [load])
  if (error) return <ErrorState title="Could not list this container" error={error} action={<Button variant="secondary" onClick={load}>Try again</Button>} />
  if (!items) return <div className="space-y-2"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>
  if (!items.length) return <EmptyState title="Nothing here yet" hint={empty} />
  return <ul className="divide-y divide-line">{items.map((e) => <FileRow key={e.url} e={e} />)}</ul>
}

function Signed({ session }: { session: SolidSession }) {
  const { toast } = useToast()
  const store = useMemo(() => new PodStore(session.fetch), [session])
  const webId = session.webId!
  const [root, setRoot] = useState<string>()
  const [name, setName] = useState<string>()
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    store.profile(webId).then((p) => {
      setName(one(p, webId, NS.foaf + 'name') ?? one(p, webId, NS.vcard + 'fn'))
      return store.storageRoot(webId).then(setRoot)
    }).catch(setError)
  }, [store, webId])

  const write = async () => {
    if (!root) return
    setBusy(true)
    try {
      const url = `${root}private/hello-pod/hello-${Date.now()}.ttl`
      await store.put(url, `<#hello> <${NS.schema}name> "Hello from the pod" ;\n  <${NS.schema}dateCreated> "${new Date().toISOString()}" .\n`)
      toast({ title: 'Note saved to your pod', description: nameOf(url), tone: 'success' })
      window.dispatchEvent(new Event('hello-pod:refresh'))
    } catch (e) {
      toast({ title: 'Could not write', description: (e as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="You" subtitle="Who the pod server says you are" className="md:col-span-2">
        <div className="flex items-center gap-4">
          <Avatar name={name ?? webId} seed={webId} size="lg" />
          <dl className="min-w-0 flex-1 space-y-1 text-sm">
            <div><dt className="text-xs uppercase tracking-wide text-muted">Name</dt><dd className="font-semibold" data-testid="name">{name ?? '...'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">WebID</dt><dd className="break-all font-mono text-xs" data-testid="webid">{webId}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Pod root</dt><dd className="break-all font-mono text-xs" data-testid="pod-root">{root ?? '...'}</dd></div>
          </dl>
        </div>
      </Card>
      {error ? <div className="md:col-span-2"><ErrorState error={error} /></div> : null}
      {root && (
        <>
          <Card title="Pod root" subtitle="Public listing (default root ACL)">
            <Files store={store} url={root} empty="Your pod root is empty." />
          </Card>
          <Card title="Your notes" subtitle="private/hello-pod/, only you can see this" actions={<Button onClick={write} loading={busy} data-testid="write-note">Write a note</Button>}>
            <Files store={store} url={`${root}private/hello-pod/`} empty="Press 'Write a note' to put your first resource here." />
          </Card>
        </>
      )}
      <Card title="Session" subtitle="DPoP-bound token, refreshed automatically" className="md:col-span-2">
        <p className="text-sm text-muted">Signed in through <span className="font-mono">{session.issuer}</span>. Requests carry <span className="font-mono">Authorization: DPoP</span> plus a proof per call.</p>
      </Card>
    </div>
  )
}

function Welcome({ session }: { session: SolidSession }) {
  return (
    <div className="mx-auto mt-10 max-w-md">
      <Card glow>
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Hello, pod.</h1>
          <p className="text-sm text-muted">Sign in with your pod. Your data stays there; this app only visits.</p>
          <PodSignIn session={session} />
        </div>
      </Card>
    </div>
  )
}

function useProfileName(session: SolidSession | undefined, webId?: string) {
  const [name, setName] = useState<string>()
  useEffect(() => {
    if (!session || !webId) return setName(undefined)
    new PodStore(session.fetch).profile(webId).then((p) => setName(one(p, webId, NS.foaf + 'name'))).catch(() => {})
  }, [session, webId])
  return name
}

function Inner() {
  const session = useSession()
  const active = Boolean(session && session.state === 'active' && session.webId)
  const name = useProfileName(session, active ? session!.webId : undefined)
  useRememberAccount(session)
  if (!session) return <div className="flex min-h-screen items-center justify-center text-muted"><Skeleton className="h-10 w-48" /></div>
  return (
    <AppShell
      appName="Hello Pod"
      tagline="The smallest app on the SKPods stack"
      user={active ? { name: name ?? 'You', webId: session.webId! } : undefined}
      onLogout={active ? () => session.logout() : undefined}
      widthClass="max-w-4xl"
    >
      {active ? <Signed session={session} /> : <Welcome session={session} />}
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
