import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Avatar, Button, Skeleton, cx, useToast } from '@skpods/ui'
import type { PodStore } from '@skpods/solid-web'
import { lastSegment, shortHash } from '../lib/format'
import { aclOf, parentContainer, rawGet, type RawDoc } from '../lib/pod'
import type { Grant, Person } from '../lib/types'
import { ChevronIcon, CopyIcon, ExternalIcon, FileIcon, FolderIcon, PodIcon, XIcon } from './Icons'

interface Props {
  open: boolean
  onClose: () => void
  store?: PodStore
  people: Person[]
  initial?: string
  grants: Grant[]
  /** Bumps when grants change so the files are re-read while the drawer is open. */
  tick: number
}

function DocBlock({ doc, title, hint, mark, defaultOpen = false, testid }: { doc: RawDoc; title: string; hint?: ReactNode; mark?: string[]; defaultOpen?: boolean; testid?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const { toast } = useToast()
  const lines = (doc.text ?? '').split('\n')
  const ok = doc.status >= 200 && doc.status < 300
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface" data-testid={testid} data-status={doc.status}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronIcon size={14} className={cx('shrink-0 text-muted transition', open && 'rotate-90')} />
          <FileIcon size={16} className="shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] font-medium">{title}</span>
            {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
          </span>
        </button>
        <span className={cx('rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold', ok ? 'bg-ok/10 text-ok' : doc.status === 404 ? 'bg-surface-2 text-muted' : 'bg-danger/10 text-danger')}>{doc.status || 'ERR'}</span>
        <a href={doc.url} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" title="Open the raw URL. Private files answer 403 without your token." aria-label={`Open ${title} in a new tab`}>
          <ExternalIcon size={15} />
        </a>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
          aria-label={`Copy URL of ${title}`}
          onClick={() => navigator.clipboard?.writeText(doc.url).then(() => toast({ tone: 'info', title: 'URL copied', duration: 1800 }))}
        >
          <CopyIcon size={15} />
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-surface-2/50">
          <p className="break-all px-3 pt-2 font-mono text-[11px] text-muted">{doc.url}</p>
          {doc.text !== undefined ? (
            <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed">
              {lines.map((l, i) => {
                const hit = mark?.some((m) => m && l.includes(m))
                return (
                  <span key={i} className={cx('block whitespace-pre-wrap break-all', hit && '-mx-3 bg-warm/15 px-3 font-semibold')}>
                    {l || ' '}
                  </span>
                )
              })}
            </pre>
          ) : (
            <p className="px-3 py-3 text-sm text-muted">{doc.note}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Listing({ title, url, names }: { title: string; url: string; names?: string[] | string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <FolderIcon size={16} className="text-muted" />
        <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium hover:underline">{title}</a>
      </div>
      <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted">
        {names === undefined ? 'loading...' : typeof names === 'string' ? names : names.length ? names.join('  ') : '(empty)'}
      </p>
    </div>
  )
}

interface Loaded {
  root?: string
  policy?: RawDoc
  listings: Array<{ title: string; url: string; names: string[] | string }>
  active: Array<{ grant: Grant; acl: RawDoc; file: RawDoc }>
  ended: Array<{ grant: Grant; acl: RawDoc }>
  containerAcl?: RawDoc
}

export function PodDrawer({ open, onClose, store, people, initial, grants, tick }: Props) {
  const [who, setWho] = useState(initial ?? people[0]?.webId)
  const [data, setData] = useState<Loaded>()
  const [records, setRecords] = useState<Array<{ grant: Grant; doc: RawDoc }>>([])
  const [loading, setLoading] = useState(false)
  const person = people.find((p) => p.webId === who) ?? people[0]

  useEffect(() => {
    if (initial) setWho(initial)
  }, [initial])

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  const load = useCallback(async () => {
    if (!store || !person) return
    setLoading(true)
    const root = await store.storageRoot(person.webId).catch(() => undefined)
    if (!root) {
      setData({ listings: [], active: [], ended: [] })
      setLoading(false)
      return
    }
    const mine = grants.filter((g) => g.subject === person.webId).sort((a, b) => b.starts.localeCompare(a.starts))
    const live = mine.filter((g) => g.status === 'active')
    const recent = mine.filter((g) => g.status !== 'active').slice(0, 2)
    const cons = `${root}skpods/v1/consents/`
    const names = async (u: string) => {
      try {
        return (await store.list(u)).map((e) => lastSegment(e.url) + (e.isContainer ? '/' : ''))
      } catch (e) {
        return (e as Error).message.includes('403') ? 'not readable with your token (403)' : 'unreadable'
      }
    }
    const [policy, active, ended, recs, l1, l2, l3] = await Promise.all([
      rawGet(store, `${cons}policy.jsonld`, 'application/ld+json'),
      Promise.all(live.map(async (g) => ({ grant: g, acl: await aclOf(store, g.resource), file: await rawGet(store, g.resource) }))),
      Promise.all(recent.map(async (g) => ({ grant: g, acl: await aclOf(store, g.resource) }))),
      Promise.all(mine.slice(0, 6).map(async (g) => ({ grant: g, doc: await rawGet(store, `${cons}grants/${g.id}.ttl`) }))),
      names(cons),
      names(`${cons}grants/`),
      names(`${cons}audit/`),
    ])
    const anyResource = (live[0] ?? recent[0])?.resource
    const containerAcl = live.length === 0 && anyResource ? await aclOf(store, parentContainer(anyResource)) : undefined
    setData({
      root,
      policy,
      active,
      ended,
      containerAcl,
      listings: [
        { title: 'skpods/v1/consents/', url: cons, names: l1 },
        { title: 'skpods/v1/consents/grants/', url: `${cons}grants/`, names: l2 },
        { title: 'skpods/v1/consents/audit/', url: `${cons}audit/`, names: l3 },
      ],
    })
    setRecords(recs)
    setLoading(false)
  }, [store, person, grants])

  useEffect(() => {
    if (open) void load()
    // re-read when the drawer opens, the person changes, or a grant changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, who, tick, store])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-sm animate-fade-up" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label="What's in my pod" data-testid="pod-drawer" className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-bg shadow-2xl animate-fade-up">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft text-brand"><PodIcon size={22} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">What&rsquo;s in my pod</h2>
            <p className="text-sm text-muted">The real files behind every screen. This is Solid: plain documents on a server you choose, not rows in a database.</p>
          </div>
          <Button variant="ghost" className="!px-2" onClick={onClose} aria-label="Close" data-testid="drawer-close" autoFocus>
            <XIcon />
          </Button>
        </header>
        <div className="flex gap-2 overflow-x-auto border-b border-line px-5 py-3">
          {people.map((p) => (
            <button
              key={p.webId}
              type="button"
              onClick={() => setWho(p.webId)}
              aria-pressed={p.webId === who}
              className={cx('flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition', p.webId === who ? 'border-brand bg-brand-soft font-semibold' : 'border-line hover:border-brand/50')}
            >
              <Avatar name={p.name} seed={p.webId} size="sm" />
              {p.short}
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!data || (loading && !data.root) ? (
            <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-24" /><Skeleton className="h-14" /></div>
          ) : !data.root ? (
            <p className="text-sm text-muted">Could not find this pod&rsquo;s storage root.</p>
          ) : (
            <>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Pod</h3>
                <p className="break-all rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs">{data.root}</p>
                <p className="mt-1 text-xs text-muted">{person?.webId}</p>
              </section>

              <section data-testid="acl-section">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Who can open what (.acl)</h3>
                <p className="mb-2 text-sm text-muted">Web Access Control: one small file per resource. While a grant lives, the broker adds one rule for the requester. At the end it removes it.</p>
                <div className="space-y-2">
                  {data.active.length === 0 && <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-muted" data-testid="no-active-acl">No temporary access is open on {person?.short}&rsquo;s pod right now.</p>}
                  {data.active.map(({ grant, acl }) => (
                    <DocBlock key={grant.id} testid="acl-active" doc={acl} title={`${lastSegment(grant.resource)}.acl`} hint={`rule for ${grant.grantee_name} while the grant lives`} mark={[grant.grantee]} defaultOpen />
                  ))}
                  {data.ended.map(({ grant, acl }) => (
                    <DocBlock key={grant.id} testid="acl-ended" doc={acl} title={`${lastSegment(grant.resource)}.acl`} hint={acl.status === 404 ? `${grant.grantee_name}'s rule is gone: the file was removed` : `after ${grant.grantee_name}'s access ended`} mark={[grant.grantee]} defaultOpen />
                  ))}
                  {data.containerAcl && <DocBlock doc={data.containerAcl} title={`${lastSegment(parentContainer(data.ended[0]?.grant.resource ?? ''))}/.acl`} hint="the container rules that apply now" defaultOpen={false} />}
                </div>
              </section>

              <section data-testid="records-section">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Grant records</h3>
                <p className="mb-2 text-sm text-muted">Each approval is also written as a document you own, with its start, end and a pointer to the audit entry.</p>
                <div className="space-y-2">
                  {records.filter((r) => r.grant.subject === person?.webId).length === 0 && <p className="text-sm text-muted">No grant has been written yet.</p>}
                  {records.filter((r) => r.grant.subject === person?.webId).map(({ grant, doc }) => (
                    <DocBlock key={grant.id} doc={doc} testid="grant-record" title={`grants/${grant.id}.ttl`} hint={`${grant.grantee_name}, ${grant.status}, head ${shortHash(grant.id, 6)}`} />
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Your guardian rules</h3>
                <p className="mb-2 text-sm text-muted">The policy the broker decides by. You can read and change it like any other file.</p>
                {data.policy && <DocBlock doc={data.policy} title="consents/policy.jsonld" hint="JSON-LD" />}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Folders</h3>
                <div className="space-y-2">
                  {data.listings.map((l) => <Listing key={l.url} {...l} />)}
                </div>
              </section>
            </>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
          <span>Read with your own token. {loading ? 'Refreshing...' : 'Updates when a grant changes.'}</span>
          <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => void load()}>Refresh</Button>
        </footer>
      </aside>
    </div>
  )
}
