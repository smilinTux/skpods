import { decimal } from './format'
import type { Receipt } from './receipt'
import { makeZip } from './zip'

/** CSV cell: RFC 4180 quoting, and a leading quote against spreadsheet formula injection (=, +, -, @). */
export function cell(v: string | number | undefined): string {
  if (v === undefined) return ''
  let s = String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (cols: Array<string | number | undefined>) => cols.map(cell).join(',')

export function receiptsCsv(list: Receipt[]): string {
  const head = ['date', 'business', 'category', 'type', 'receipt_id', 'description', 'subtotal', 'tax', 'total', 'currency', 'payment_method', 'payment_reference', 'pod_url']
  const body = [...list]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((r) => row([r.date.toISOString().slice(0, 10), r.issuerName, r.category, r.kind, r.identifier, r.name, decimal(r.subtotal), decimal(r.tax), decimal(r.total), r.currency, r.paymentMethod, r.paymentRef, r.url]))
  return [row(head), ...body].join('\r\n') + '\r\n'
}

export function lineItemsCsv(list: Receipt[]): string {
  const head = ['date', 'business', 'receipt_id', 'line', 'item', 'quantity', 'unit_price', 'line_total', 'currency']
  const body = [...list]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .flatMap((r) => r.lines.map((l) => row([r.date.toISOString().slice(0, 10), r.issuerName, r.identifier, l.n, l.name, l.qty, decimal(l.unit), decimal(l.total), r.currency])))
  return [row(head), ...body].join('\r\n') + '\r\n'
}

/** The raw Turtle exactly as delivered, one file per receipt, grouped by business, plus a short README. */
export function rdfZip(list: Receipt[], owner: string): Uint8Array {
  const readme = `Receipts export from your Solid pod
Owner: ${owner}
Receipts: ${list.length}
Exported: ${new Date().toISOString()}

Each .ttl file is the receipt exactly as the business delivered it (RDF, Turtle, schema.org terms).
Folders are the business inbox names. Any RDF tool can read these files, no account needed.
`
  return makeZip([
    { path: 'README.txt', data: readme },
    ...list.map((r) => ({ path: `${r.business}/${r.file}`, data: r.raw, date: r.date })),
  ])
}

export function download(name: string, data: string | Uint8Array, type: string) {
  const blob = new Blob([data as BlobPart], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
