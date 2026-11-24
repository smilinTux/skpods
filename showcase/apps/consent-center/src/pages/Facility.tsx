import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SolidSession } from '@skpods/solid-web'
import { AppShell, Avatar, Button, Card, ConsentChip, Countdown, EmptyState, ErrorState, Skeleton, ToastProvider, cx, useToast } from '@skpods/ui'
import { CheckIcon, ExternalIcon, LockIcon, UnlockIcon } from '../components/Icons'
import { ISSUER, RESIDENT_WEBID } from '../config'
import { Broker } from '../lib/broker'
import { ago, clock, itemState, lastSegment, time } from '../lib/format'
import { genericRecord, parseCareLog } from '../lib/people'
import { brokerFetch, isActive, useSession } from '../lib/session'
import { useConsent } from '../lib/useConsent'
import type { ConsentRequest, Grant, Item } from '../lib/types'

const ME_NAME = 'Sunrise Care'
const BOOKING = 'SUN-2207'
const CLASSES: Array<[string, string, string]> = [
  ['care_log', 'Care log', 'Daily notes from staff'],
  ['medication_schedule', 'Medication schedule', 'What is given and when'],
  ['family_contacts', 'Family contacts', 'Who to call'],
  ['financial_summary', 'Finances', 'Pension and accounts'],
]

interface Probe {
  status: number
  text?: string
  at: number
}

/** Reads each resource with the facility's own token, every 3 seconds and whenever a grant changes. This is the proof. */
function useProbes(session: SolidSession, resources: string[], nudge: number) {
  const [probes, setProbes] = useState<Record<string, Probe>>({})
  const key = resources.join('|')
  const run = useCallback(async () => {
    const out = await Promise.all(
      resources.map(async (u): Promise<[string, Probe]> => {
        try {
          const r = await session.fetch(u, { headers: { Accept: 'text/turtle' } })
          return [u, { status: r.status, text: r.ok ? await r.text() : undefined, at: Date.now() }]
        } catch {
          return [u, { status: 0, at: Date.now() }]
        }
      }),
    )
    setProbes((p) => ({ ...p, ...Object.fromEntries(out) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, key])
  useEffect(() => {
    if (!resources.length) return
    void run()
    const id = setInterval(() => !document.hidden && void run(), 3000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, nudge])
  return probes
}

function StatusLine({ url, probe }: { url: string; probe?: Probe }) {
  const ok = probe?.status === 200
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted" data-testid="probe-line" data-status={probe?.status ?? ''}>
      <span>GET {lastSegment(url)}</span>
      <span aria-hidden>&rarr;</span>
      <span className={cx('rounded px-1.5 py-0.5 font-semibold', !probe ? 'bg-surface-2' : ok ? 'bg-ok/15 text-ok' : 'bg-danger/10 text-danger')}>
        {!probe ? '...' : `${probe.status} ${ok ? 'OK' : probe.status === 403 ? 'Forbidden' : probe.status === 404 ? 'Not found' : ''}`}
      </span>
      {probe && <span>at {clock(probe.at)}</span>}
    </p>
  )
}

function Record({ item, grant, probe, request, onRelease, onAsk }: { item: Item; grant?: Grant; probe?: Probe; request: ConsentRequest; onRelease: (g: Grant) => void; onAsk: () => void }) {
  const open = probe?.status === 200
  const live = grant?.status === 'active'
  const entries = open && item.data_class === 'care_log' ? parseCareLog(probe!.text ?? '', item.resource) : undefined
  const rows = open && !entries ? genericRecord(probe!.text ?? '', item.resource) : undefined
  return (
    <Card
      data-testid="record"
      data-class={item.data_class}
      data-open={open}
      title={
        <span className="flex items-center gap-2">
          {open ? <UnlockIcon size={18} className="text-ok" /> : <LockIcon size={18} className="text-muted" />}
          {item.label}
        </span>
      }
      subtitle={<StatusLine url={item.resource} probe={probe} />}
      actions={
        live ? (
          <Button variant="ghost" className="!py-1.5 text-xs" onClick={() => onRelease(grant!)} data-testid="release">
            Release early
          </Button>
        ) : undefined
      }
      className={cx(open && 'border-ok/40')}
    >
      {live && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-ok/10 px-3 py-2 text-sm">
          <span className="font-medium text-ok">Read access until {time(grant!.ends)}</span>
          <Countdown until={grant!.ends} from={grant!.starts} className="min-w-24 items-end" />
        </div>
      )}
      {open && entries && (
        <ol className="space-y-3" data-testid="care-entries">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-line bg-surface-2/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">{e.category}</span>
                <span>{e.author} &middot; {time(e.at)}</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">{e.text}</p>
            </li>
          ))}
        </ol>
      )}
      {open && rows && (
        <dl className="divide-y divide-line text-sm">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-4 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
      )}
      {!open && (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" data-testid="locked">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted"><LockIcon size={22} /></span>
          <p className="text-sm font-semibold">
            {item.status === 'awaiting_owner' && 'Waiting for the family to decide'}
            {item.status === 'denied' && 'The family\'s rules said no'}
            {(item.status === 'expired' || item.status === 'revoked') && (item.status === 'expired' ? 'The 24 hour window closed' : 'Access was switched off')}
            {item.status === 'granted' && 'Checking the pod...'}
            {item.status === 'error' && 'The pod refused the access rule'}
          </p>
          <p className="max-w-sm text-sm text-muted">
            {item.status === 'awaiting_owner' && 'Nothing is readable yet. The pod answers 403 until Alice or Rosa decides.'}
            {item.status === 'denied' && item.decision.reason}
            {(item.status === 'expired' || item.status === 'revoked') && `${grant ? `Ended at ${time(grant.revoked_at ?? grant.ends)}. ` : ''}Your token is unchanged. The pod simply stopped saying yes.`}
          </p>
          {item.status === 'denied' && item.decision.counter_offer && (
            <p className="max-w-sm rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm"><span className="font-semibold">Suggested instead: </span>{item.decision.counter_offer.message}</p>
          )}
          {(item.status === 'expired' || item.status === 'revoked') && (
            <Button variant="secondary" onClick={onAsk} data-testid="ask-again">Ask again</Button>
          )}
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">Request {request.id}, asked {ago(request.created)}.</p>
    </Card>
  )
}

function RequestForm({ broker, self, onSent }: { broker: Broker; self: string; onSent: (r: ConsentRequest) => void }) {
  const { toast } = useToast()
  const [picked, setPicked] = useState<Record<string, boolean>>({ care_log: true })
  const [dur, setDur] = useState('24h')
  const [purpose, setPurpose] = useState("Shift handover and today's care plan for Rosa Rivera, who joined our day programme this morning.")
  const [busy, setBusy] = useState(false)
  const items = CLASSES.filter(([c]) => picked[c])
  const send = async () => {
    setBusy(true)
    try {
      const r = await broker.submit({
        requester: { webid: self, name: ME_NAME, kind: 'care_facility' },
        subject: RESIDENT_WEBID,
        purpose,
        items: items.map(([c]) => ({ data_class: c })),
        requested_duration: dur,
        context: { booking_ref: BOOKING },
      })
      onSent(r)
      toast({ tone: 'success', title: 'Request sent to the family', description: 'Alice is asked now. Nothing opens until she decides.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send the request', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Ask the family for access" subtitle="You see only what the family allows, for as long as they allow it." data-testid="request-form">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
          <Avatar name="Rosa Rivera" seed={RESIDENT_WEBID} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Rosa Rivera</p>
            <p className="truncate font-mono text-[11px] text-muted">{RESIDENT_WEBID}</p>
          </div>
          <span className="ml-auto rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-muted">booking {BOOKING}</span>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What do you need?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLASSES.map(([c, label, hint]) => (
              <label key={c} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition', picked[c] ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/50')}>
                <input type="checkbox" className="mt-1 accent-[rgb(var(--skp-brand))]" checked={Boolean(picked[c])} onChange={(e) => setPicked((p) => ({ ...p, [c]: e.target.checked }))} data-testid={`want-${c}`} />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Tip: ticking Finances shows the family&rsquo;s rules saying no by themselves, with a counter-offer.</p>
        </fieldset>
        <label className="block text-sm font-medium">
          How long?
          <select value={dur} onChange={(e) => setDur(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm sm:w-64" data-testid="want-duration">
            <option value="1h">1 hour</option>
            <option value="24h">24 hours</option>
            <option value="72h">72 hours</option>
            <option value="7d">7 days</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          Why? <span className="font-normal text-muted">(shown to the family)</span>
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} maxLength={500} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm" data-testid="want-purpose" />
        </label>
        <Button onClick={send} loading={busy} disabled={!items.length || !purpose.trim()} data-testid="send-request">
          <CheckIcon size={16} /> Send request
        </Button>
      </div>
    </Card>
  )
}

function Signed({ session }: { session: SolidSession }) {
  const { toast } = useToast()
  const self = session.webId!
  const broker = useMemo(() => new Broker(brokerFetch(session)), [session])
  const [nudge, setNudge] = useState(0)
  const consent = useConsent(broker, [RESIDENT_WEBID], () => setNudge((n) => n + 1))
  const mine = consent.requests.filter((r) => r.requester.webid === self)
  const latest = new Map<string, { item: Item; req: ConsentRequest }>()
  for (const r of [...mine].reverse()) for (const i of r.items) latest.set(i.data_class, { item: i, req: r })
  const resources = [...latest.values()].map((x) => x.item.resource)
  const probes = useProbes(session, resources, nudge)
  const formRef = useRef<HTMLDivElement>(null)

  // Tell the broker what this client observed, on changes only (pods do not push access logs).
  const prev = useRef<Record<string, number>>({})
  useEffect(() => {
    for (const { item } of latest.values()) {
      const p = probes[item.resource]
      if (!p || !item.grant_id) continue
      const before = prev.current[item.resource]
      prev.current[item.resource] = p.status
      if (before === undefined || before === p.status) continue
      if (p.status === 200 || (p.status === 403 && before === 200)) void broker.reportAccess(item.grant_id, p.status).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probes])

  const grants = Object.fromEntries(consent.grants.filter((g) => g.grantee === self).map((g) => [g.id, g]))
  const release = async (g: Grant) => {
    try {
      consent.mergeGrant(await broker.revoke(g.id, 'released-by-grantee'))
      toast({ tone: 'info', title: 'Access released', description: 'You gave the access back. The pod now answers 403.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not release', description: (e as Error).message })
    }
  }

  if (consent.error && !consent.loaded) return <ErrorState title="Cannot reach the consent service" error={consent.error.message} action={<Button variant="secondary" onClick={() => void consent.reload()}>Try again</Button>} />
  const records = [...latest.values()]
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-warm/40 bg-warm-soft/60 px-4 py-3 text-sm">
        <p className="font-semibold">This is the facility&rsquo;s screen.</p>
        <p className="text-muted">Everything below is what {ME_NAME} can really read from Rosa&rsquo;s pod with its own token. When the family&rsquo;s grant ends, the pod answers 403 and the data disappears from this screen.</p>
      </div>
      {!consent.loaded ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {records.length === 0 ? (
            <Card>
              <EmptyState icon={<LockIcon size={22} />} title="You have no access yet" hint="Ask the family below. Until they say yes, the pod answers 403 to everything." />
            </Card>
          ) : (
            <section className="space-y-4" aria-label="Records you asked for">
              {records.map(({ item, req }) => (
                <Record key={item.id} item={item} request={req} grant={item.grant_id ? grants[item.grant_id] : undefined} probe={probes[item.resource]} onRelease={release} onAsk={() => formRef.current?.scrollIntoView({ behavior: 'smooth' })} />
              ))}
            </section>
          )}
          {mine.length > 0 && (
            <Card title="Your requests" subtitle="What you asked for and what the family's rules and the family decided">
              <ul className="divide-y divide-line">
                {mine.map((r) => (
                  <li key={r.id} className="py-3" data-testid="my-request">
                    <p className="text-xs text-muted">{ago(r.created)} &middot; {r.requested_duration ?? 'no duration'} &middot; <span className="font-mono">{r.id}</span></p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.items.map((i) => (
                        <span key={i.id} className="inline-flex items-center gap-2 text-sm"><span className="font-medium">{i.label}</span><ConsentChip state={itemState(i)} expiresAt={i.status === 'granted' ? i.decision.expires_at : undefined} /></span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div ref={formRef}>
            <RequestForm broker={broker} self={self} onSent={consent.merge} />
          </div>
        </>
      )}
    </div>
  )
}

function Welcome({ session, expired }: { session: SolidSession; expired: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const go = async () => {
    setBusy(true)
    try {
      await session.login(ISSUER)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto mt-10 max-w-md">
      <Card glow>
        <div className="space-y-4 text-center">
          <Avatar name="Sunrise Care" seed="sunrise" size="lg" className="mx-auto" />
          <h1 className="text-2xl font-bold tracking-tight">Sunrise Care, staff view</h1>
          <p className="text-sm text-muted">The other side of the Consent Center story. Log in as the care facility (<span className="font-mono">dw-care-facility</span>) to ask for access and see what the pod lets you read.</p>
          {expired && <p role="status" className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Your session ended. Log in again to continue.</p>}
          {session.error && !expired && <ErrorState title="Login problem" error={session.error} />}
          {err && <ErrorState error={err} />}
          <Button className="w-full" loading={busy} onClick={go} data-testid="login">Log in as the facility</Button>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-left text-xs text-muted">
            The pod server keeps one login per browser. If you are already logged in to the family cockpit here, open this page in a private window, or log out of the pod server first.
          </p>
        </div>
      </Card>
    </div>
  )
}

function Inner() {
  const session = useSession({ clientName: 'Sunrise Care staff view (SKPods showcase)', db: 'skpods-consent-facility' })
  if (!session) return <div className="flex min-h-screen items-center justify-center"><Skeleton className="h-10 w-48" /></div>
  const active = isActive(session)
  return (
    <AppShell
      appName="Sunrise Care"
      tagline="Staff view, what the facility can read"
      user={active ? { name: ME_NAME, webId: session.webId } : undefined}
      onLogout={active ? () => session.logout() : undefined}
      widthClass="max-w-3xl"
      actions={<a href="/" className="skp-btn-ghost !hidden !px-2.5 !py-1.5 text-xs sm:!inline-flex">Family cockpit <ExternalIcon size={13} /></a>}
    >
      {active ? <Signed session={session} /> : <Welcome session={session} expired={session.state === 'expired'} />}
    </AppShell>
  )
}

export function Facility() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  )
}
