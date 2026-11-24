import { useMemo, useState } from 'react'
import { Button, Card, EmptyState } from '@skpods/ui'
import { lineItemsCsv, receiptsCsv, rdfZip, download } from '../lib/export'
import { applyFilters, isFiltered, type Filters } from '../lib/filter'
import { money } from '../lib/format'
import type { Receipt } from '../lib/receipt'
import { Icon } from './bits'

export function ExportTab({ receipts, filters, owner }: { receipts: Receipt[]; filters: Filters; owner: string }) {
  const filtered = useMemo(() => applyFilters(receipts, filters), [receipts, filters])
  const [scope, setScope] = useState<'all' | 'view'>('all')
  const list = scope === 'view' && isFiltered(filters) ? filtered : receipts
  const stamp = new Date().toISOString().slice(0, 10)
  if (!receipts.length) return <Card><EmptyState icon={Icon.export} title="Nothing to export yet" hint="Once receipts arrive you can take them with you: spreadsheet or raw RDF." /></Card>
  const total = list.reduce((a, r) => a + r.total, 0)
  return (
    <div className="space-y-5">
      <Card title="Take your receipts with you" subtitle="They are already yours, in your pod. This is a copy for taxes, insurance or another tool.">
        {isFiltered(filters) && (
          <div role="radiogroup" aria-label="What to export" className="mb-4 inline-flex rounded-xl bg-surface-2 p-1 text-sm font-medium">
            {(['all', 'view'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={scope === s} onClick={() => setScope(s)} className={scope === s ? 'rounded-lg bg-surface px-3 py-1 shadow-card' : 'rounded-lg px-3 py-1 text-muted hover:text-ink'}>
                {s === 'all' ? `Everything (${receipts.length})` : `Current filter (${filtered.length})`}
              </button>
            ))}
          </div>
        )}
        <p className="mb-4 text-sm text-muted" data-testid="export-summary">{list.length} receipts, {money(total)} in total.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <h3 className="text-sm font-semibold">Receipts CSV</h3>
            <p className="flex-1 text-xs text-muted">One row per receipt: date, business, category, subtotal, tax, total, payment reference.</p>
            <Button data-testid="export-csv" onClick={() => download(`receipts-${stamp}.csv`, receiptsCsv(list), 'text/csv;charset=utf-8')}>Download CSV</Button>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <h3 className="text-sm font-semibold">Line items CSV</h3>
            <p className="flex-1 text-xs text-muted">One row per item, for expense reports and flexible spending claims.</p>
            <Button variant="secondary" data-testid="export-lines" onClick={() => download(`receipt-items-${stamp}.csv`, lineItemsCsv(list), 'text/csv;charset=utf-8')}>Download items CSV</Button>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
            <h3 className="text-sm font-semibold">Raw RDF (zip)</h3>
            <p className="flex-1 text-xs text-muted">The original Turtle files, one per receipt, grouped by business. Any RDF tool reads them.</p>
            <Button variant="secondary" data-testid="export-zip" onClick={() => download(`receipts-rdf-${stamp}.zip`, rdfZip(list, owner), 'application/zip')}>Download zip</Button>
          </div>
        </div>
      </Card>
      <p className="px-1 text-xs text-muted">Exports are built in your browser from the files in your pod. Nothing is uploaded anywhere.</p>
    </div>
  )
}
