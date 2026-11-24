import { useCallback, useEffect, useState } from 'react'
import { Avatar, cx } from '@skpods/ui'
import type { PodStore } from '@skpods/solid-web'
import { AuditChain } from '../components/AuditChain'
import type { Broker } from '../lib/broker'
import type { AuditEntry, Person } from '../lib/types'

interface Props {
  people: Person[]
  audit: Record<string, AuditEntry[]>
  broker: Broker
  store?: PodStore
  nameOf: (webId?: string) => string
  initial?: string
}

export function AuditPage({ people, audit, broker, store, nameOf, initial }: Props) {
  const [who, setWho] = useState(initial ?? people.find((p) => (audit[p.webId]?.length ?? 0) > 0)?.webId ?? people[0]?.webId)
  useEffect(() => {
    if (initial) setWho(initial)
  }, [initial])
  const person = people.find((p) => p.webId === who) ?? people[0]
  const entries = (person && audit[person.webId]) || []

  const verifyOnServer = useCallback(() => broker.verify(person!.webId), [broker, person])
  const podCopy = useCallback(async () => {
    if (!store || !person) return { error: 'Not logged in' }
    const root = await store.storageRoot(person.webId)
    if (!root) return { error: 'No pod root found' }
    let files: string[]
    try {
      files = (await store.list(`${root}skpods/v1/consents/audit/`)).filter((e) => e.url.endsWith('.jsonl')).map((e) => e.url)
    } catch (e) {
      return { error: `Could not list the audit folder in the pod: ${(e as Error).message}` }
    }
    const pod = new Map<number, string>()
    for (const f of files) {
      const r = await store.get(f, 'application/x-ndjson')
      for (const line of (r?.text ?? '').split('\n')) {
        if (!line.trim()) continue
        try {
          const e = JSON.parse(line)
          if (e.subject === person.webId) pod.set(e.seq, e.hash)
        } catch {
          /* skip a partial line */
        }
      }
    }
    const matched = entries.filter((e) => pod.get(e.seq) === e.hash).length
    const behind = entries.filter((e) => !pod.has(e.seq)).length
    return { found: pod.size, matched, behind, files: files.length }
  }, [store, person, entries])

  if (!person) return null
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Whose audit log">
        {people.map((p) => (
          <button
            key={p.webId}
            type="button"
            role="tab"
            aria-selected={p.webId === person.webId}
            onClick={() => setWho(p.webId)}
            className={cx('flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition', p.webId === person.webId ? 'border-brand bg-brand-soft font-semibold' : 'border-line hover:border-brand/50')}
          >
            <Avatar name={p.name} seed={p.webId} size="sm" />
            {p.short}
            <span className="font-mono text-[11px] text-muted">{audit[p.webId]?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <AuditChain subject={person.webId} entries={entries} nameOf={nameOf} verifyOnServer={verifyOnServer} podCopy={podCopy} />
    </div>
  )
}
