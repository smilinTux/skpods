import { useEffect, useState } from 'react'
import { Avatar, Button, Card, EmptyState, cx } from '@skpods/ui'
import { DEMO_BUSINESSES } from '../lib/demo-data'
import { money } from '../lib/format'
import { CATEGORIES, type Receipt } from '../lib/receipt'
import { businessKey, inboxOf, inboxRights, type Business } from '../lib/wallet'
import type { WalletApi } from '../lib/useWallet'
import { CopyButton, Field, Icon, Modal, inputCls } from './bits'

const ALL_RIGHTS = ['Read', 'Write', 'Append', 'Control']

function Rights({ api, b }: { api: WalletApi; b: Business }) {
  const [rights, setRights] = useState<string[]>()
  useEffect(() => {
    let dead = false
    setRights(undefined)
    inboxRights(api.store, api.wallet!, b).then((r) => !dead && setRights(r)).catch(() => !dead && setRights([]))
    return () => {
      dead = true
    }
  }, [api.store, api.wallet, b.key, b.status])
  if (!rights) return <p className="text-xs text-muted">Reading the access rules from your pod...</p>
  const can = ALL_RIGHTS.filter((m) => rights.includes(m))
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="rights" aria-label="Access rules read from your pod">
      <span className="text-muted">Your pod says this business may:</span>
      {can.length ? can.map((m) => <span key={m} className={cx('rounded-full px-2 py-0.5 font-semibold', m === 'Append' ? 'bg-brand-soft text-brand' : 'bg-danger/10 text-danger')}>{m === 'Append' ? 'append (POST) only' : m}</span>) : <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-muted">nothing</span>}
    </div>
  )
}

function BusinessCard({ api, b, mine }: { api: WalletApi; b: Business; mine: Receipt[] }) {
  const [confirm, setConfirm] = useState(false)
  const total = mine.reduce((a, r) => a + r.total, 0)
  const active = b.status === 'active'
  return (
    <Card className={cx(!active && 'opacity-90')} data-testid="business-card" data-business={b.key}>
      <div className="flex items-start gap-3">
        <Avatar name={b.name} seed={b.key} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{b.name}</h3>
            <span data-testid="status" className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', active ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn')}>{active ? 'Can deliver receipts' : 'Stopped'}</span>
          </div>
          <p className="text-sm text-muted">{b.category ?? 'Business'} · <span data-testid="biz-count">{mine.length}</span> receipt{mine.length === 1 ? '' : 's'} kept · {money(total)}</p>
          <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{b.webId}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Rights api={api} b={b} />
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
          <span className="text-xs text-muted">Delivery address</span>
          <code className="min-w-0 flex-1 truncate text-[11px]" title={inboxOf(api.wallet!, b.key)}>{inboxOf(api.wallet!, b.key)}</code>
          <CopyButton text={inboxOf(api.wallet!, b.key)} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {active ? (
            <Button variant="danger" onClick={() => setConfirm(true)} data-testid="stop">Switch provider: stop receipts</Button>
          ) : (
            <Button variant="secondary" loading={api.busy} onClick={() => api.resume(b)} data-testid="resume">Allow receipts again</Button>
          )}
        </div>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Stop receipts from ${b.name}?`}>
        <div className="space-y-4 p-5 text-sm">
          <p>This removes the append right {b.name} holds on its inbox in your pod. From then on, anything it tries to deliver is refused (HTTP 403).</p>
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-brand"><strong data-testid="keep-count">{mine.length} receipt{mine.length === 1 ? '' : 's'}</strong> already in your wallet stay exactly where they are. They were always yours.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep as is</Button>
            <Button variant="danger" loading={api.busy} data-testid="confirm-stop" onClick={async () => { await api.stop(b); setConfirm(false) }}>Remove their append right</Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}

function AddBusiness({ api }: { api: WalletApi }) {
  const [name, setName] = useState('')
  const [webId, setWebId] = useState('')
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const owner = api.wallet!.owner
  const demoShape = /\/apps\/solid\/~[^/]+\/profile\/card#me$/.test(owner)
  const origin = new URL(owner).origin
  const known = new Set(api.businesses.map((b) => b.key))
  const suggestions = demoShape ? DEMO_BUSINESSES.filter((d) => !known.has(d.user)) : []
  const key = /^https?:\/\//.test(webId) ? (() => { try { return businessKey(webId) } catch { return '' } })() : ''
  const submit = async (n: string, w: string, c: string) => {
    const b = await api.add({ name: n, webId: w, category: c })
    if (b) {
      setName('')
      setWebId('')
    }
  }
  return (
    <Card title="Let a business send you receipts" subtitle="It gets its own inbox in your pod, with one right: add a file.">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(name, webId.trim(), category)
        }}
      >
        <Field label="Business name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bayview Family Clinic" required data-testid="biz-name" /></Field>
        <Field label="Category">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Business WebID" hint={key ? <>Its inbox will be <span className="font-mono">inbox/{key}/</span></> : 'The WebID the business logs in with, for example https://pod.example/profile/card#me'}>
            <input className={cx(inputCls, 'font-mono')} value={webId} onChange={(e) => setWebId(e.target.value)} placeholder="https://..." required inputMode="url" data-testid="biz-webid" />
          </Field>
        </div>
        <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={api.busy} data-testid="add-business">Allow this business</Button></div>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Demo businesses on this pod server</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((d) => (
              <button key={d.id} type="button" disabled={api.busy} className="skp-btn-secondary !px-3 !py-1.5 text-xs" onClick={() => submit(d.name, `${origin}/apps/solid/~${d.user}/profile/card#me`, d.category)}>
                + {d.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

export function Businesses({ api }: { api: WalletApi }) {
  return (
    <div className="space-y-5">
      {api.businesses.length === 0 ? (
        <Card><EmptyState icon={Icon.store} title="No business can send you receipts yet" hint="Allow a business below. It will get an inbox that only accepts new files, nothing more." /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {api.businesses.map((b) => <BusinessCard key={b.key} api={api} b={b} mine={api.receipts.filter((r) => r.business === b.key)} />)}
        </div>
      )}
      <AddBusiness api={api} />
      <Card title="How this works" subtitle="Plain Solid, no database">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Each business gets a container <span className="font-mono">skpods/v1/receipts/inbox/&lt;business&gt;/</span> whose ACL names that one WebID with <strong className="text-ink">Append</strong> and nothing else.</li>
          <li>It delivers with <span className="font-mono">POST</span>. Reading, listing, replacing and deleting all answer 403 for it, including its own receipts.</li>
          <li>When you open the wallet, new receipts are copied into your private archive and removed from the inbox.</li>
          <li>Stopping a business only removes its append right. The archive is yours and untouched.</li>
        </ul>
      </Card>
    </div>
  )
}
