import { useEffect, useMemo, useState } from 'react'
import { NS, PodError, PodStore, one, type SolidSession } from '@skpods/solid-web'
import { Avatar, Button, Card, EmptyState, ErrorState, cx } from '@skpods/ui'
import { PRESETS } from '../lib/demo-data'
import { money } from '../lib/format'
import { CATEGORIES, PAYMENT_METHODS, ReceiptError, buildReceiptTurtle, computeTotals, receiptSlug, type ReceiptInput } from '../lib/receipt'
import { businessKey, pathsFor } from '../lib/wallet'
import { Field, Icon, inputCls } from './bits'

interface Row {
  name: string
  qty: string
  unit: string
}

interface Sent {
  url: string
  name: string
  total: number
  currency: string
  at: Date
  readBack?: number
}

const newId = (prefix: string) => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`
const prefixOf = (name: string) => (name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'RCP')

function defaultCustomer(own: string): string {
  try {
    const saved = localStorage.getItem('receipts-wallet:customer')
    if (saved) return saved
  } catch {
    /* storage blocked */
  }
  // On the demo pod server the customer is the test user dw-alice.
  return /\/apps\/solid\/~[^/]+\/profile\/card#me$/.test(own) ? own.replace(/~[^/]+/, '~dw-alice') : ''
}

function explain(e: unknown): string {
  if (e instanceof PodError) {
    if (e.status === 403) return 'The customer\'s pod refused this delivery (403). They have not added you as a business, or they stopped accepting receipts from you.'
    if (e.status === 404) return 'That customer has no inbox for you (404). They need to add you as a business first.'
  }
  return e instanceof Error ? e.message : String(e)
}

export function Console({ session }: { session: SolidSession }) {
  const store = useMemo(() => new PodStore(session.fetch), [session])
  const own = session.webId!
  const key = businessKey(own)
  const [issuerName, setIssuerName] = useState('')
  const [customer, setCustomer] = useState(() => defaultCustomer(own))
  const [kind, setKind] = useState<'Invoice' | 'Order'>('Invoice')
  const [name, setName] = useState('Office visit, copay')
  const [memo, setMemo] = useState('')
  const [category, setCategory] = useState<string>(CATEGORIES[1])
  const [rows, setRows] = useState<Row[]>([{ name: 'Office visit copay', qty: '1', unit: '30.00' }])
  const [taxPct, setTaxPct] = useState('0')
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0])
  const [ref, setRef] = useState('ref:pm-demo-0001')
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [sent, setSent] = useState<Sent[]>([])
  const [showTtl, setShowTtl] = useState(false)

  useEffect(() => {
    let dead = false
    store.profile(own).then((p) => {
      const n = one(p, own, NS.foaf + 'name') ?? key
      if (!dead) {
        setIssuerName((cur) => cur || n)
        setIdentifier((cur) => cur || newId(prefixOf(n)))
      }
    }).catch(() => !dead && setIdentifier((cur) => cur || newId('RCP')))
    return () => {
      dead = true
    }
  }, [store, own, key])

  const lines = rows.map((r) => ({ name: r.name, qty: Number(r.qty), unit: Number(r.unit) }))
  const taxRate = Number(taxPct) / 100
  const totals = computeTotals(lines.filter((l) => Number.isFinite(l.qty) && Number.isFinite(l.unit)), Number.isFinite(taxRate) ? taxRate : 0)
  const input = (): ReceiptInput => ({
    kind,
    identifier,
    date: new Date(),
    name,
    description: memo.trim() || undefined,
    category,
    issuer: { name: issuerName, webId: own },
    customerWebId: customer.trim(),
    lines,
    taxRate,
    paymentMethod: method,
    paymentRef: ref.trim(),
  })
  const preview = (() => {
    try {
      return buildReceiptTurtle(input())
    } catch (e) {
      return e instanceof ReceiptError ? `# ${e.message}` : `# ${String(e)}`
    }
  })()

  const setRow = (i: number, p: Partial<Row>) => setRows((l) => l.map((r, k) => (k === i ? { ...r, ...p } : r)))

  const send = async () => {
    setError(undefined)
    setBusy(true)
    try {
      const inp = input()
      const turtle = buildReceiptTurtle(inp)
      const storage = await store.storageRoot(inp.customerWebId).catch(() => undefined)
      if (!storage) throw new Error('Could not find that customer\'s pod from the WebID. Check it and try again.')
      const inbox = `${pathsFor(storage).inbox}${key}/`
      const url = await store.post(inbox, turtle, { slug: receiptSlug(inp) })
      try {
        localStorage.setItem('receipts-wallet:customer', inp.customerWebId)
      } catch {
        /* storage blocked */
      }
      setSent((l) => [{ url, name: inp.name, total: totals.total, currency: 'USD', at: new Date() }, ...l])
      setIdentifier(newId(prefixOf(issuerName)))
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  const readBack = async (url: string) => {
    const r = await session.fetch(url, { headers: { Accept: 'text/turtle' } })
    setSent((l) => l.map((s) => (s.url === url ? { ...s, readBack: r.status } : s)))
  }

  const preset = (i: number) => {
    const p = PRESETS[i]
    setName(p.name)
    setCategory(p.category)
    setTaxPct(String(+(p.taxRate * 100).toFixed(3)))
    setMethod(p.paymentMethod)
    setRows(p.lines.map((l) => ({ name: l.name, qty: String(l.qty), unit: l.unit.toFixed(2) })))
    setError(undefined)
  }

  return (
    <div className="space-y-5">
      <Card glow>
        <div className="flex items-start gap-4">
          <Avatar name={issuerName || key} seed={key} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-warm">Business console</p>
            <h2 className="text-lg font-bold tracking-tight" data-testid="console-name">{issuerName || key}</h2>
            <p className="mt-1 text-sm text-muted">You are logged in as a business. You can drop a receipt into a customer's pod, but only if they allowed you, and you can never read it back. That is the point.</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted">{own}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Issue a receipt" subtitle="Appended to the customer's inbox for you" className="lg:col-span-3">
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Quick starts">
            {PRESETS.map((p, i) => (
              <button key={p.label} type="button" className="skp-btn-secondary !px-3 !py-1 text-xs" onClick={() => preset(i)} data-testid={`preset-${i}`}>{p.label}</button>
            ))}
          </div>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Customer WebID" hint="Their pod is found from this. The delivery address is your own inbox in it."><input className={cx(inputCls, 'font-mono')} value={customer} onChange={(e) => setCustomer(e.target.value)} required inputMode="url" placeholder="https://.../profile/card#me" data-testid="customer" /></Field></div>
              <Field label="Issuer name on the receipt"><input className={inputCls} value={issuerName} onChange={(e) => setIssuerName(e.target.value)} required /></Field>
              <Field label="Receipt number"><input className={cx(inputCls, 'font-mono')} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></Field>
              <div className="sm:col-span-2"><Field label="What was it for"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required data-testid="desc" /></Field></div>
              <Field label="Type">
                <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'Invoice' | 'Order')}>
                  <option value="Invoice">Invoice (service)</option>
                  <option value="Order">Order (goods)</option>
                </select>
              </Field>
              <Field label="Category">
                <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} data-testid="category">
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Line items</legend>
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_4rem_5.5rem_2rem] items-center gap-2" data-testid="row">
                  <input aria-label={`Item ${i + 1} name`} className={inputCls} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Item" required data-testid={`item-name-${i}`} />
                  <input aria-label={`Item ${i + 1} quantity`} className={cx(inputCls, 'text-right tabular-nums')} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} inputMode="decimal" required />
                  <input aria-label={`Item ${i + 1} unit price`} className={cx(inputCls, 'text-right tabular-nums')} value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} inputMode="decimal" required data-testid={`item-unit-${i}`} />
                  <button type="button" aria-label={`Remove item ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((l) => l.filter((_, k) => k !== i))} className="h-8 w-8 rounded-lg text-lg text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-30">&times;</button>
                </div>
              ))}
              <button type="button" className="text-sm font-semibold text-brand hover:underline" onClick={() => setRows((l) => [...l, { name: '', qty: '1', unit: '0.00' }])}>+ Add a line</button>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tax rate, percent"><input className={cx(inputCls, 'tabular-nums')} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" /></Field>
              <Field label="Paid with">
                <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
              </Field>
              <Field label="Payment reference" hint="Opaque id, never a card number"><input className={cx(inputCls, 'font-mono')} value={ref} onChange={(e) => setRef(e.target.value)} required data-testid="payref" /></Field>
            </div>
            <Field label="Note for the customer (optional)"><input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
              <div className="text-sm text-muted">Subtotal {money(totals.subtotal)} · Tax {money(totals.tax)}</div>
              <div className="text-xl font-bold tabular-nums" data-testid="console-total">{money(totals.total)}</div>
            </div>
            {error && <ErrorState title="Not delivered" error={error} />}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setShowTtl((v) => !v)} aria-expanded={showTtl}>{showTtl ? 'Hide' : 'Show'} the Turtle that will be sent</button>
              <Button type="submit" loading={busy} data-testid="send"><span className="mr-0.5">{Icon.send}</span> Send to the customer's pod</Button>
            </div>
            {showTtl && <pre className="max-h-72 overflow-auto rounded-xl bg-navy-950 p-4 font-mono text-xs leading-relaxed text-teal-100">{preview}</pre>}
          </form>
        </Card>

        <Card title="Delivered from this console" subtitle="This session only. Nothing is stored on our side." className="lg:col-span-2">
          {!sent.length ? (
            <EmptyState icon={Icon.send} title="Nothing sent yet" hint="Pick a quick start, adjust it, and send. The receipt lands in the customer's pod in a second." />
          ) : (
            <ul className="space-y-3" data-testid="sent-list">
              {sent.map((s) => (
                <li key={s.url} className="animate-fade-up rounded-xl border border-line p-3" data-testid="sent">
                  <div className="flex items-baseline justify-between gap-2"><p className="truncate text-sm font-semibold">{s.name}</p><p className="shrink-0 font-semibold tabular-nums">{money(s.total, s.currency)}</p></div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ok"><span aria-hidden>&#10003;</span> Delivered {s.at.toLocaleTimeString()}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted">{s.url}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => readBack(s.url)} data-testid="readback">Try to read it back</Button>
                    {s.readBack !== undefined && (
                      <span data-testid="readback-result" className={cx('text-xs font-semibold', s.readBack === 403 ? 'text-ok' : 'text-danger')}>
                        {s.readBack === 403 ? 'HTTP 403: refused. Only the customer can read it.' : `HTTP ${s.readBack}: unexpected, this business can read its own delivery.`}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
