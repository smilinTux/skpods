// Receipt model: build Turtle (business side) and parse it (wallet side). schema.org terms, plus a few skp: terms
// listed in showcase/vocab/receipts.ttl. A receipt never carries a card number, only a payment method label and an
// opaque reference the business chooses.
import { NS, iri, one, all, parseTurtle, rdfType } from '@skpods/solid-web'
import { decimal, fromCents, looksLikeCardNumber, toCents } from './format'

export type ReceiptKind = 'Invoice' | 'Order'

export const CATEGORIES = ['Home services', 'Medical', 'Senior care', 'Pharmacy', 'Groceries', 'Other'] as const
export type Category = (typeof CATEGORIES)[number] | string

export const PAYMENT_METHODS = ['Credit card', 'Debit card', 'Bank transfer', 'Cash', 'Insurance claim', 'Health savings account'] as const

export interface LineInput {
  name: string
  qty: number
  /** Unit price, major units (12.5 means 12.50). */
  unit: number
}

export interface ReceiptInput {
  kind: ReceiptKind
  identifier: string
  date: Date
  name: string
  description?: string
  category: Category
  issuer: { name: string; webId: string }
  customerWebId: string
  lines: LineInput[]
  /** 0.0825 means 8.25 percent. Applied to the subtotal. */
  taxRate: number
  paymentMethod: string
  /** Opaque reference such as "ref:pm-7q2k". Never a card number. */
  paymentRef: string
  currency?: string
}

export interface Totals {
  subtotal: number
  tax: number
  total: number
}

/** All in cents. */
export function computeTotals(lines: LineInput[], taxRate: number): Totals {
  const subtotal = lines.reduce((s, l) => s + Math.round(l.qty * toCents(l.unit)), 0)
  const tax = Math.round(subtotal * taxRate)
  return { subtotal, tax, total: subtotal + tax }
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')
const q = (s: string) => `"${esc(s)}"`
const dec = (cents: number) => `"${decimal(cents)}"^^xsd:decimal`

export class ReceiptError extends Error {}

export function validateInput(r: ReceiptInput): void {
  if (!r.issuer.name.trim()) throw new ReceiptError('The receipt needs an issuer name.')
  if (!/^https?:\/\//.test(r.customerWebId)) throw new ReceiptError('The customer WebID must be an http(s) URL.')
  if (!r.name.trim()) throw new ReceiptError('Give the receipt a short description.')
  if (!r.lines.length) throw new ReceiptError('Add at least one line item.')
  for (const l of r.lines) {
    if (!l.name.trim()) throw new ReceiptError('Every line item needs a name.')
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) throw new ReceiptError(`"${l.name}" needs a quantity above zero.`)
    if (!Number.isFinite(l.unit) || l.unit < 0) throw new ReceiptError(`"${l.name}" needs a valid unit price.`)
  }
  if (!(r.taxRate >= 0 && r.taxRate < 1)) throw new ReceiptError('Tax rate must be between 0 and 100 percent.')
  if (!/^[A-Za-z0-9:_.-]{3,48}$/.test(r.paymentRef)) throw new ReceiptError('Payment reference: 3 to 48 letters, digits or : _ . - (it is a reference, never a card number).')
  const text = [r.name, r.description ?? '', r.paymentMethod, r.paymentRef, r.identifier, ...r.lines.map((l) => l.name)].join(' ')
  if (looksLikeCardNumber(text)) throw new ReceiptError('That looks like a card number. Receipts carry a payment method label and an opaque reference only.')
}

/** The file name a business should ask for (the engine keeps the slug, so it must end in .ttl). */
export function receiptSlug(r: Pick<ReceiptInput, 'date' | 'identifier'>): string {
  const d = r.date.toISOString().slice(0, 10).replace(/-/g, '')
  return `${d}-${r.identifier.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'receipt'}.ttl`
}

export function buildReceiptTurtle(r: ReceiptInput): string {
  validateInput(r)
  const cur = r.currency ?? 'USD'
  const t = computeTotals(r.lines, r.taxRate)
  const lines = r.lines
    .map((l, i) => {
      const lineTotal = Math.round(l.qty * toCents(l.unit))
      return `<#line-${i + 1}> a schema:OrderItem ;
    schema:orderItemNumber ${q(String(i + 1))} ;
    schema:name ${q(l.name)} ;
    schema:orderQuantity "${l.qty}"^^xsd:decimal ;
    schema:price ${dec(toCents(l.unit))} ;
    schema:priceCurrency ${q(cur)} ;
    skp:lineTotal ${dec(lineTotal)} .`
    })
    .join('\n\n')
  const refs = r.lines.map((_, i) => `<#line-${i + 1}>`).join(', ')
  return `@prefix schema: <${NS.schema}> .
@prefix skp: <${NS.skp}> .
@prefix xsd: <${NS.xsd}> .

# A receipt delivered into the customer's pod. No card number, only a payment method label and an opaque reference.
<#receipt> a schema:${r.kind} ;
    schema:identifier ${q(r.identifier)} ;
    schema:name ${q(r.name)} ;${r.description ? `\n    schema:description ${q(r.description)} ;` : ''}
    schema:dateCreated "${r.date.toISOString()}"^^xsd:dateTime ;
    schema:category ${q(r.category)} ;
    schema:provider <#issuer> ;${r.kind === 'Order' ? '\n    schema:seller <#issuer> ;' : ''}
    schema:customer <${r.customerWebId}> ;
    schema:orderedItem ${refs} ;
    skp:subtotal ${dec(t.subtotal)} ;
    skp:taxRate "${r.taxRate}"^^xsd:decimal ;
    skp:taxTotal ${dec(t.tax)} ;
    schema:totalPaymentDue <#total> ;
    schema:paymentMethod ${q(r.paymentMethod)} ;
    schema:paymentMethodId ${q(r.paymentRef)} ;
    schema:paymentStatus "PaymentComplete" .

<#issuer> a schema:Organization ;
    schema:name ${q(r.issuer.name)} ;
    schema:sameAs <${r.issuer.webId}> .

<#total> a schema:MonetaryAmount ;
    schema:value ${dec(t.total)} ;
    schema:currency ${q(cur)} .

${lines}
`
}

// ---------------------------------------------------------------- parsing (wallet side)

export interface ReceiptLine {
  n: number
  name: string
  qty: number
  /** cents */
  unit: number
  /** cents */
  total: number
}

export interface Receipt {
  /** Where the resource lives now (inbox until filed, archive afterwards). */
  url: string
  /** File name, the stable id of a receipt inside one business. */
  file: string
  /** Business key = the inbox/archive sub container the receipt lives in. */
  business: string
  kind: ReceiptKind
  identifier: string
  name: string
  description?: string
  date: Date
  category: string
  issuerName: string
  issuerWebId?: string
  customerWebId?: string
  lines: ReceiptLine[]
  subtotal: number
  taxRate: number
  tax: number
  total: number
  currency: string
  paymentMethod?: string
  paymentRef?: string
  paymentStatus?: string
  raw: string
}

const S = (t: string) => NS.schema + t
const cents = (v: string | undefined) => (v === undefined ? 0 : toCents(Number(v)))

/** Parse a receipt document. Returns undefined when it holds no schema:Invoice or schema:Order. */
export function parseReceipt(raw: string, url: string, business: string): Receipt | undefined {
  const g = parseTurtle(raw, url)
  let subj: string | undefined
  let kind: ReceiptKind = 'Invoice'
  for (const k of ['Invoice', 'Order'] as const) {
    const s = g.getSubjects(iri(rdfType), iri(S(k)), null)[0]
    if (s) {
      subj = s.value
      kind = k
      break
    }
  }
  if (!subj) return undefined
  const issuer = one(g, subj, S('provider')) ?? one(g, subj, S('seller'))
  const totalNode = one(g, subj, S('totalPaymentDue'))
  const lines: ReceiptLine[] = all(g, subj, S('orderedItem'))
    .map((li, i) => ({
      n: Number(one(g, li, S('orderItemNumber')) ?? i + 1),
      name: one(g, li, S('name')) ?? 'Item',
      qty: Number(one(g, li, S('orderQuantity')) ?? 1),
      unit: cents(one(g, li, S('price'))),
      total: cents(one(g, li, NS.skp + 'lineTotal')),
    }))
    .sort((a, b) => a.n - b.n)
  const subtotal = one(g, subj, NS.skp + 'subtotal')
  const taxTotal = one(g, subj, NS.skp + 'taxTotal')
  const totalVal = totalNode ? one(g, totalNode, S('value')) : undefined
  const sub = subtotal !== undefined ? cents(subtotal) : lines.reduce((a, l) => a + l.total, 0)
  const tax = cents(taxTotal)
  const date = new Date(one(g, subj, S('dateCreated')) ?? '')
  return {
    url,
    file: decodeURIComponent(url.split('/').pop() ?? url),
    business,
    kind,
    identifier: one(g, subj, S('identifier')) ?? '',
    name: one(g, subj, S('name')) ?? 'Receipt',
    description: one(g, subj, S('description')),
    date: Number.isNaN(date.getTime()) ? new Date(0) : date,
    category: one(g, subj, S('category')) ?? 'Other',
    issuerName: (issuer && one(g, issuer, S('name'))) || business,
    issuerWebId: issuer ? one(g, issuer, S('sameAs')) : undefined,
    customerWebId: one(g, subj, S('customer')),
    lines,
    subtotal: sub,
    taxRate: Number(one(g, subj, NS.skp + 'taxRate') ?? 0),
    tax,
    total: totalVal !== undefined ? cents(totalVal) : sub + tax,
    currency: (totalNode && one(g, totalNode, S('currency'))) || 'USD',
    paymentMethod: one(g, subj, S('paymentMethod')),
    paymentRef: one(g, subj, S('paymentMethodId')),
    paymentStatus: one(g, subj, S('paymentStatus')),
    raw,
  }
}

export { fromCents }
