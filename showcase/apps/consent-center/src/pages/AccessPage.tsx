import { useState } from 'react'
import { Button, EmptyState } from '@skpods/ui'
import type { Broker } from '../lib/broker'
import type { AuditEntry, ConsentRequest, Grant, Person } from '../lib/types'
import { GrantCard, PastGrant } from '../components/GrantCard'
import { LockIcon } from '../components/Icons'
import { endedAt } from '../lib/format'

interface Props {
  grants: Grant[]
  requests: ConsentRequest[]
  audit: Record<string, AuditEntry[]>
  people: Record<string, Person>
  broker: Broker
  onGrant: (g: Grant) => void
  onExpire: () => void
}

export function AccessPage({ grants, requests, audit, people, broker, onGrant, onExpire }: Props) {
  const [more, setMore] = useState(false)
  const labels = new Map<string, string>()
  for (const r of requests) for (const i of r.items) if (i.grant_id) labels.set(i.grant_id, i.label)
  const label = (g: Grant) => labels.get(g.id) ?? g.data_class.replace(/_/g, ' ')
  const live = grants.filter((g) => g.status === 'active').sort((a, b) => a.ends.localeCompare(b.ends))
  const past = grants.filter((g) => g.status !== 'active' && g.status !== 'failed').sort((a, b) => endedAt(b).localeCompare(endedAt(a)))
  const reads = (g: Grant) => (audit[g.subject] ?? []).filter((e) => e.event === 'data_read' && e.grant === g.id)
  return (
    <div className="space-y-8">
      <section aria-labelledby="live-h" data-testid="live-section">
        <h2 id="live-h" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          Open right now
          {live.length > 0 && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold normal-case text-brand">{live.length}</span>}
        </h2>
        {live.length === 0 ? (
          <div className="skp-card">
            <EmptyState icon={<LockIcon size={22} />} title="Everything is closed" hint="No business can read anything right now. Each approval you give shows up here with a clock, and switches itself off." />
          </div>
        ) : (
          <div className="space-y-4">
            {live.map((g) => (
              <GrantCard key={g.id} grant={g} label={label(g)} person={people[g.subject]} reads={reads(g)} broker={broker} onChanged={onGrant} onExpire={onExpire} />
            ))}
          </div>
        )}
      </section>
      {past.length > 0 && (
        <section aria-labelledby="past-h">
          <h2 id="past-h" className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Ended</h2>
          <div className="skp-card px-5">
            <ul className="divide-y divide-line">
              {past.slice(0, more ? 50 : 5).map((g) => <PastGrant key={g.id} grant={g} label={label(g)} person={people[g.subject]} />)}
            </ul>
            {past.length > 5 && !more && <Button variant="ghost" className="mb-2 w-full" onClick={() => setMore(true)}>Show {past.length - 5} more</Button>}
          </div>
        </section>
      )}
    </div>
  )
}
