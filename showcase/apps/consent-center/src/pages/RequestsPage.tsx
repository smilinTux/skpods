import { EmptyState } from '@skpods/ui'
import type { Broker } from '../lib/broker'
import type { ConsentRequest, Grant, Person } from '../lib/types'
import { RequestCard } from '../components/RequestCard'
import { ShieldIcon } from '../components/Icons'

interface Props {
  requests: ConsentRequest[]
  grants: Grant[]
  people: Record<string, Person>
  broker: Broker
  bookingEnds: Record<string, Date | undefined>
  ceilings: Record<string, number>
  onChanged: (r: ConsentRequest) => void
}

export function RequestsPage({ requests, grants, people, broker, bookingEnds, ceilings, onChanged }: Props) {
  const gmap = Object.fromEntries(grants.map((g) => [g.id, g]))
  const waiting = requests.filter((r) => r.items.some((i) => i.status === 'awaiting_owner'))
  const rest = requests.filter((r) => !waiting.includes(r))
  const card = (r: ConsentRequest) => (
    <RequestCard
      key={r.id}
      req={r}
      person={people[r.subject]}
      grants={gmap}
      broker={broker}
      bookingEnd={r.context.booking_ref ? bookingEnds[`${r.subject}|${r.context.booking_ref}`] : undefined}
      maxSecs={ceilings[r.subject]}
      onChanged={onChanged}
    />
  )
  return (
    <div className="space-y-8">
      <section aria-labelledby="waiting-h" data-testid="waiting-section">
        <h2 id="waiting-h" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          Waiting for you
          {waiting.length > 0 && <span className="rounded-full bg-warm px-2 py-0.5 text-xs font-bold normal-case text-navy-950">{waiting.length}</span>}
        </h2>
        {waiting.length === 0 ? (
          <div className="skp-card">
            <EmptyState
              icon={<ShieldIcon size={22} />}
              title="Nothing is waiting for you"
              hint="No one is asking for your data, or for the data of the people you look after. When a business asks, it lands here first, and nothing opens until you say so."
            />
          </div>
        ) : (
          <div className="space-y-4">{waiting.map(card)}</div>
        )}
      </section>
      {rest.length > 0 && (
        <section aria-labelledby="decided-h">
          <h2 id="decided-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Already decided</h2>
          <div className="space-y-4">{rest.map(card)}</div>
        </section>
      )}
    </div>
  )
}
