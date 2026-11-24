import { useState } from 'react'
import { Avatar, Button, cx } from '@skpods/ui'
import { download } from '../lib/export'
import { longDate } from '../lib/format'
import type { Receipt } from '../lib/receipt'
import { CategoryTag, CopyButton, Icon, Modal, Money } from './bits'

export function ReceiptDetail({ receipt, onClose }: { receipt?: Receipt; onClose: () => void }) {
  const [tab, setTab] = useState<'receipt' | 'turtle'>('receipt')
  const r = receipt
  return (
    <Modal open={Boolean(r)} onClose={onClose} wide title={r ? <span data-testid="detail-title">{r.name}</span> : ''}>
      {r && (
        <div data-testid="detail">
          <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
            <Avatar name={r.issuerName} seed={r.business} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.issuerName}</p>
              <p className="text-xs text-muted">{longDate(r.date)} · {r.kind} {r.identifier}</p>
            </div>
            <CategoryTag category={r.category} />
          </div>
          <div role="tablist" aria-label="View" className="mx-5 mt-4 inline-flex rounded-xl bg-surface-2 p-1 text-sm font-medium">
            {(['receipt', 'turtle'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`tab-${t}`} className={cx('rounded-lg px-3 py-1', tab === t ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>
                {t === 'receipt' ? 'Receipt' : 'Raw Turtle'}
              </button>
            ))}
          </div>
          {tab === 'receipt' ? (
            <div className="space-y-5 p-5">
              {r.description && <p className="text-sm text-muted">{r.description}</p>}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                      <th className="pb-2 font-medium">Item</th>
                      <th className="pb-2 text-right font-medium">Qty</th>
                      <th className="pb-2 text-right font-medium">Unit</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={l.n} className="border-b border-line/60" data-testid="line">
                        <td className="py-2 pr-3">{l.name}</td>
                        <td className="py-2 text-right tabular-nums">{l.qty}</td>
                        <td className="py-2 text-right"><Money cents={l.unit} currency={r.currency} /></td>
                        <td className="py-2 text-right font-medium"><Money cents={l.total} currency={r.currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="text-sm">
                    <tr><td colSpan={3} className="pt-3 text-right text-muted">Subtotal</td><td className="pt-3 text-right"><Money cents={r.subtotal} currency={r.currency} /></td></tr>
                    <tr><td colSpan={3} className="text-right text-muted">Tax{r.taxRate ? ` (${+(r.taxRate * 100).toFixed(3)}%)` : ''}</td><td className="text-right"><Money cents={r.tax} currency={r.currency} /></td></tr>
                    <tr><td colSpan={3} className="pt-1 text-right font-semibold">Total</td><td className="pt-1 text-right text-lg font-bold" data-testid="detail-total"><Money cents={r.total} currency={r.currency} /></td></tr>
                  </tfoot>
                </table>
              </div>
              <dl className="grid gap-3 rounded-xl bg-surface-2 p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wide text-muted">Payment</dt><dd>{r.paymentMethod ?? 'Not stated'}{r.paymentStatus ? ` · ${r.paymentStatus.replace('Payment', '').toLowerCase()}` : ''}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-muted">Reference (never a card number)</dt><dd className="font-mono text-xs">{r.paymentRef ?? 'none'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-muted">Issued by (WebID)</dt><dd className="break-all font-mono text-xs">{r.issuerWebId ?? 'unknown'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-muted">Kept in your pod at</dt><dd className="break-all font-mono text-xs" data-testid="detail-url">{r.url}</dd></div>
              </dl>
              <p className="flex items-start gap-2 text-xs text-muted">
                <span className="mt-0.5 text-brand">{Icon.lock}</span>
                {r.issuerName} delivered this through an append-only inbox: they can add receipts, but never read, change or delete them. It stays yours, whatever you decide about them later.
              </p>
            </div>
          ) : (
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={r.raw} label="Copy Turtle" />
                <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => download(r.file, r.raw, 'text/turtle')}>Download .ttl</Button>
                <span className="text-xs text-muted">Exactly the bytes {r.issuerName} sent.</span>
              </div>
              <pre data-testid="raw-turtle" className="max-h-[50vh] overflow-auto rounded-xl bg-navy-950 p-4 font-mono text-xs leading-relaxed text-teal-100">{r.raw}</pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
