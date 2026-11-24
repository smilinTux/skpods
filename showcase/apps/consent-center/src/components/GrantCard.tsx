import { useState } from 'react'
import { Avatar, Button, cx, useToast } from '@skpods/ui'
import type { Broker } from '../lib/broker'
import { clock, endedAt, lastSegment, reasonText, time } from '../lib/format'
import type { AuditEntry, Grant, Person } from '../lib/types'
import { ClockIcon, EyeIcon, LockIcon } from './Icons'
import { Ring } from './Ring'

interface Props {
  grant: Grant
  label: string
  person?: Person
  reads: AuditEntry[]
  broker: Broker
  onChanged: (g: Grant) => void
  onExpire: () => void
}

export function GrantCard({ grant, label, person, reads, broker, onChanged, onExpire }: Props) {
  const { toast } = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const lastRead = reads.at(-1)
  const status = lastRead?.detail?.http_status

  const revoke = async () => {
    setBusy(true)
    try {
      const g = await broker.revoke(grant.id, 'revoked-by-owner')
      onChanged(g)
      toast({ tone: 'success', title: 'Access revoked', description: `${grant.grantee_name} can no longer read your ${label.toLowerCase()}. The pod rule is gone.` })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not revoke', description: (e as Error).message })
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <article className="skp-card animate-fade-up p-5" data-testid="grant-card" data-grant={grant.id} data-grantee={grant.grantee_name}>
      <div className="flex items-center gap-4">
        <Ring from={grant.starts} until={grant.ends} onExpire={onExpire} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Avatar name={grant.grantee_name} seed={grant.grantee} size="sm" />
            <h3 className="truncate text-base font-semibold tracking-tight">{grant.grantee_name}</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
              <EyeIcon size={12} /> Read only
            </span>
          </div>
          <p className="mt-1 text-sm">
            can read {person && person.relation !== 'self' ? <>{person.short}&rsquo;s </> : <>your </>}
            <span className="font-semibold">{label.toLowerCase()}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <ClockIcon size={13} /> until {time(grant.ends)} &middot; {grant.approved_by === 'guardian' ? 'allowed by your rules' : 'allowed by you'}
          </p>
        </div>
        <div className="hidden shrink-0 sm:block">
          {confirm ? (
            <div className="flex items-center gap-2 animate-pop">
              <Button variant="danger" loading={busy} onClick={revoke} data-testid="confirm-revoke">Yes, switch off now</Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirm(true)} data-testid="revoke">
              <LockIcon size={16} /> Revoke
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 sm:hidden">
        {confirm ? (
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" loading={busy} onClick={revoke} data-testid="confirm-revoke-m">Yes, switch off now</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
          </div>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setConfirm(true)} data-testid="revoke-m">
            <LockIcon size={16} /> Revoke
          </Button>
        )}
      </div>
      <p className={cx('mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs', lastRead ? 'text-ink/80' : 'text-muted')}>
        {lastRead ? (
          <>
            Last read reported by {grant.grantee_name} at {clock(lastRead.ts)}: <span className="font-mono">HTTP {status}</span>
            {reads.length > 1 && <> ({reads.length} reports)</>}
          </>
        ) : (
          <>No read reported yet. Pods do not push access logs, so this line is what the requester says it did (<span className="font-mono">{lastSegment(grant.resource)}</span>).</>
        )}
      </p>
    </article>
  )
}

export function PastGrant({ grant, label, person }: { grant: Grant; label: string; person?: Person }) {
  return (
    <li className="flex items-center gap-3 py-3" data-testid="past-grant" data-grantee={grant.grantee_name} data-status={grant.status}>
      <Avatar name={grant.grantee_name} seed={grant.grantee} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-semibold">{grant.grantee_name}</span> <span className="text-muted">&middot; {person && person.relation !== 'self' ? `${person.short}'s ` : ''}{label.toLowerCase()}</span>
        </p>
        <p className="text-xs text-muted">{reasonText(grant.revoke_reason)} at {time(endedAt(grant))}</p>
      </div>
      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
        <LockIcon size={12} /> {grant.status === 'expired' ? 'Expired' : 'Revoked'}
      </span>
    </li>
  )
}
