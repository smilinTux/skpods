import { useState } from 'react'
import { Avatar, Button, ConsentChip, cx, useToast } from '@skpods/ui'
import type { Broker } from '../lib/broker'
import { initialChoice, secsOf, toWire, type Choice } from '../lib/duration'
import { ago, endedAt, KIND_LABEL, itemState, span, time } from '../lib/format'
import type { ConsentRequest, Grant, Item, Person } from '../lib/types'
import { DurationPicker } from './DurationPicker'
import { CheckIcon, ClockIcon, SparkIcon, XIcon } from './Icons'

interface Props {
  req: ConsentRequest
  person?: Person
  grants: Record<string, Grant>
  broker: Broker
  bookingEnd?: Date
  maxSecs?: number
  onChanged: (r: ConsentRequest) => void
}

const wire = (c: Choice) => toWire(c)

export function RequestCard({ req, person, grants, broker, bookingEnd, maxSecs, onChanged }: Props) {
  const { toast } = useToast()
  const waiting = req.items.filter((i) => i.status === 'awaiting_owner')
  const [choice, setChoice] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState<string>()
  const pick = (i: Item): Choice => choice[i.id] ?? initialChoice(i.decision.recommendation?.duration_s)
  const hasBooking = Boolean(req.context.booking_ref)

  const send = async (key: string, decisions: Array<{ item: Item; action: 'approve' | 'deny'; choice?: Choice }>) => {
    setBusy(key)
    try {
      const r = await broker.decide(
        req.id,
        decisions.map((d) => ({ item_id: d.item.id, action: d.action, duration: d.choice ? wire(d.choice) : undefined })),
      )
      onChanged(r)
      const ok = decisions.filter((d) => d.action === 'approve')
      if (ok.length) {
        const first = r.items.find((i) => i.id === ok[0].item.id)
        toast({
          tone: 'success',
          title: ok.length === 1 ? `${req.requester.name} can read your ${ok[0].item.label.toLowerCase()}` : `${req.requester.name} can read ${ok.length} items`,
          description: first?.decision.expires_at ? `Access switches off by itself at ${time(first.decision.expires_at)}.` : undefined,
        })
      } else toast({ tone: 'info', title: 'Declined', description: `${req.requester.name} gets nothing from this request.` })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save your decision', description: (e as Error).message })
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <article className={cx('skp-card animate-fade-up overflow-hidden', waiting.length > 0 && 'shadow-glow')} data-testid="request-card" data-request={req.id} data-requester={req.requester.name}>
      <header className="flex items-start gap-3 px-5 pt-5">
        <Avatar name={req.requester.name} seed={req.requester.webid} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-base font-semibold tracking-tight">{req.requester.name}</h3>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">{KIND_LABEL[req.requester.kind]}</span>
            {person && person.relation !== 'self' && (
              <span className="rounded-full bg-warm-soft px-2 py-0.5 text-[11px] font-semibold text-warm">for {person.short}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            asked {ago(req.created)}
            {hasBooking && <> &middot; booking <span className="font-mono">{req.context.booking_ref}</span></>}
            {req.requested_duration && <> &middot; wants {req.requested_duration}</>}
          </p>
        </div>
      </header>
      <p className="mx-5 mt-3 rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink/90">&ldquo;{req.purpose}&rdquo;</p>

      <ul className="mt-2 divide-y divide-line px-5 pb-1">
        {req.items.map((it) => {
          const g = it.grant_id ? grants[it.grant_id] : undefined
          const state = itemState(it)
          return (
            <li key={it.id} className="py-4" data-testid="request-item" data-class={it.data_class} data-status={it.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{it.label}</p>
                <ConsentChip state={state} expiresAt={it.status === 'granted' ? (g?.ends ?? it.decision.expires_at) : undefined} label={it.status === 'granted' && it.decision.decided_by === 'guardian' ? 'Auto-approved' : undefined} />
              </div>

              {it.status === 'awaiting_owner' && (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-muted">{it.decision.reason}</p>
                  {it.decision.recommendation && (
                    <div className="flex gap-3 rounded-xl border border-brand/30 bg-brand-soft/60 p-3 text-sm">
                      <SparkIcon className="mt-0.5 shrink-0 text-brand" />
                      <div>
                        <p className="font-semibold">
                          Your rules suggest: {it.decision.recommendation.action === 'approve' ? 'allow' : 'decline'}
                          {it.decision.recommendation.duration_s ? ` for ${span(it.decision.recommendation.duration_s)}` : ''}
                        </p>
                        <p className="text-muted">{it.decision.recommendation.reason}</p>
                      </div>
                    </div>
                  )}
                  {it.decision.explanation && <p className="text-sm italic text-muted">{it.decision.explanation}</p>}
                  <DurationPicker
                    value={pick(it)}
                    onChange={(c) => setChoice((m) => ({ ...m, [it.id]: c }))}
                    booking={hasBooking ? { end: bookingEnd } : undefined}
                    recommendedSecs={it.decision.recommendation?.duration_s}
                    maxSecs={maxSecs}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      data-testid="approve"
                      loading={busy === it.id}
                      disabled={Boolean(busy) && busy !== it.id}
                      onClick={() => send(it.id, [{ item: it, action: 'approve', choice: pick(it) }])}
                    >
                      <CheckIcon size={16} />
                      Allow read access{(() => { const s = secsOf(pick(it), bookingEnd ? (bookingEnd.getTime() - Date.now()) / 1000 : undefined); return s ? ` for ${span(Math.round(s))}` : '' })()}
                    </Button>
                    <Button variant="ghost" data-testid="decline" disabled={Boolean(busy)} onClick={() => send(it.id + ':deny', [{ item: it, action: 'deny' }])}>
                      <XIcon size={16} />
                      Decline
                    </Button>
                  </div>
                </div>
              )}

              {it.status === 'granted' && (
                <p className="mt-2 text-sm text-muted">
                  <ClockIcon size={15} className="mr-1.5 inline align-[-2px]" />
                  Read-only until {time(g?.ends ?? it.decision.expires_at ?? Date.now())}. {it.decision.decided_by === 'guardian' ? `Allowed by your rules: ${it.decision.reason}` : 'You allowed this.'}
                </p>
              )}

              {it.status === 'denied' && (
                <div className="mt-2 space-y-2 text-sm">
                  <p className="text-muted">{it.decision.reason}</p>
                  {it.decision.counter_offer && (
                    <p className="rounded-xl border border-line bg-surface-2 px-3 py-2">
                      <span className="font-semibold">Counter-offer sent: </span>
                      <span className="text-muted">{it.decision.counter_offer.message}</span>
                    </p>
                  )}
                </div>
              )}

              {(it.status === 'revoked' || it.status === 'expired') && (
                <p className="mt-2 text-sm text-muted">
                  {it.status === 'expired' ? 'Expired by itself' : 'Revoked'}
                  {g ? ` at ${time(endedAt(g))}` : ''}. The pod no longer lets {req.requester.name} read this.
                </p>
              )}

              {it.status === 'error' && <p className="mt-2 text-sm text-danger">The pod refused the access rule, so nothing was shared. Nothing is open.</p>}
            </li>
          )
        })}
      </ul>

      {waiting.length > 1 && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
          <Button
            variant="secondary"
            data-testid="approve-all"
            loading={busy === 'all'}
            disabled={Boolean(busy) && busy !== 'all'}
            onClick={() => send('all', waiting.map((i) => ({ item: i, action: 'approve', choice: pick(i) })))}
          >
            <CheckIcon size={16} />
            Allow all {waiting.length} as chosen
          </Button>
          <span className="text-xs text-muted">Each item gets its own end time and its own switch-off.</span>
        </footer>
      )}
    </article>
  )
}
