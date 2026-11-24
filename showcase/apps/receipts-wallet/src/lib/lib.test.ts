import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEMO_BUSINESSES, DEMO_RECEIPTS } from './demo-data'
import { cell, lineItemsCsv, rdfZip, receiptsCsv } from './export'
import { applyFilters, groupByMonth, totalsBy } from './filter'
import { looksLikeCardNumber } from './format'
import { ReceiptError, buildReceiptTurtle, computeTotals, parseReceipt, receiptSlug, type ReceiptInput } from './receipt'
import { businessKey } from './wallet'
import { crc32 } from './zip'

const ISSUER = 'https://pods.example/apps/solid/~dw-practitioner/profile/card#me'
const CUSTOMER = 'https://pods.example/apps/solid/~dw-alice/profile/card#me'
const base = (over: Partial<ReceiptInput> = {}): ReceiptInput => ({
  kind: 'Invoice',
  identifier: 'BFC-1',
  date: new Date('2026-09-03T15:00:00Z'),
  name: 'Specialist visit, copay',
  category: 'Medical',
  issuer: { name: 'Bayview Family Clinic', webId: ISSUER },
  customerWebId: CUSTOMER,
  lines: [{ name: 'Visit', qty: 2, unit: 12.5 }, { name: 'Lab "A"', qty: 1, unit: 10.1 }],
  taxRate: 0.0825,
  paymentMethod: 'Credit card',
  paymentRef: 'ref:pm-1234',
  ...over,
})

function all(): ReturnType<typeof parseReceipt>[] {
  return DEMO_RECEIPTS.map((d) => {
    const b = DEMO_BUSINESSES.find((x) => x.id === d.business)!
    const turtle = buildReceiptTurtle({ kind: d.kind, identifier: d.identifier, date: new Date(`${d.date}T15:00:00Z`), name: d.name, description: d.description, category: b.category, issuer: { name: b.name, webId: ISSUER.replace('dw-practitioner', b.user) }, customerWebId: CUSTOMER, lines: d.lines, taxRate: d.taxRate, paymentMethod: d.paymentMethod, paymentRef: d.paymentRef })
    return parseReceipt(turtle, `https://pods.example/archive/${b.user}/${receiptSlug({ date: new Date(`${d.date}T15:00:00Z`), identifier: d.identifier })}`, b.user)
  })
}

describe('receipt turtle', () => {
  it('round trips and totals in cents', () => {
    const t = buildReceiptTurtle(base())
    const r = parseReceipt(t, 'https://pods.example/a/r.ttl', 'dw-practitioner')!
    expect(r.kind).toBe('Invoice')
    expect(r.lines.map((l) => [l.name, l.qty, l.unit, l.total])).toEqual([['Visit', 2, 2500 / 2, 2500], ['Lab "A"', 1, 1010, 1010]])
    expect(r.subtotal).toBe(3510)
    expect(r.tax).toBe(Math.round(3510 * 0.0825))
    expect(r.total).toBe(r.subtotal + r.tax)
    expect(r.issuerName).toBe('Bayview Family Clinic')
    expect(r.issuerWebId).toBe(ISSUER)
    expect(r.paymentRef).toBe('ref:pm-1234')
    expect(r.date.toISOString()).toBe('2026-09-03T15:00:00.000Z')
    expect(computeTotals(base().lines, 0.0825).total).toBe(r.total)
  })
  it('keeps quotes and newlines safe', () => {
    const t = buildReceiptTurtle(base({ name: 'He said "hi"\nbye', description: 'a \\ b' }))
    expect(parseReceipt(t, 'https://x/r.ttl', 'k')!.name).toBe('He said "hi"\nbye')
  })
  it('refuses card numbers and bad input', () => {
    expect(looksLikeCardNumber('pay 4242 4242 4242 4242 ok')).toBe(true)
    expect(looksLikeCardNumber('order 1234567890123')).toBe(false)
    expect(() => buildReceiptTurtle(base({ paymentRef: '4242424242424242' }))).toThrow(ReceiptError)
    expect(() => buildReceiptTurtle(base({ description: 'card 4111 1111 1111 1111' }))).toThrow(/card number/)
    expect(() => buildReceiptTurtle(base({ lines: [] }))).toThrow(ReceiptError)
    expect(() => buildReceiptTurtle(base({ taxRate: 2 }))).toThrow(ReceiptError)
  })
  it('slug ends in .ttl', () => expect(receiptSlug(base())).toBe('20260903-bfc-1.ttl'))
  it('business key from a WebID', () => expect(businessKey(ISSUER)).toBe('dw-practitioner'))
})

describe('demo data', () => {
  const rs = all()
  it('has about 20 valid receipts from 4 businesses over several months, none with card numbers', () => {
    expect(rs.length).toBe(20)
    expect(rs.every(Boolean)).toBe(true)
    expect(new Set(rs.map((r) => r!.business)).size).toBe(4)
    const months = groupByMonth(rs as never)
    expect(months.length).toBeGreaterThanOrEqual(4)
    expect(rs.every((r) => !looksLikeCardNumber(r!.raw))).toBe(true)
  })
  it('filters and totals', () => {
    const list = rs as NonNullable<(typeof rs)[number]>[]
    expect(applyFilters(list, { q: 'faucet' }).map((r) => r.identifier)).toEqual(['HLP-2026-0142'])
    expect(applyFilters(list, { q: 'bayview copay' }).length).toBeGreaterThan(2)
    expect(applyFilters(list, { q: '', category: 'Pharmacy' }).length).toBe(6)
    expect(applyFilters(list, { q: '', month: '2026-11' }).every((r) => r.date.getMonth() === 10)).toBe(true)
    const t = totalsBy(list, (r) => r.category)
    expect(t.reduce((a, x) => a + x.total, 0)).toBe(list.reduce((a, r) => a + r.total, 0))
  })
  it('exports CSV with injection guard and a valid zip', () => {
    const list = rs as NonNullable<(typeof rs)[number]>[]
    expect(cell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(cell('a,"b"')).toBe('"a,""b"""')
    const csv = receiptsCsv(list).trim().split('\r\n')
    expect(csv.length).toBe(21)
    expect(lineItemsCsv(list).trim().split('\r\n').length).toBe(1 + list.reduce((a, r) => a + r.lines.length, 0))
    const zip = rdfZip(list, CUSTOMER)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rw-zip-'))
    const f = path.join(dir, 'x.zip')
    fs.writeFileSync(f, zip)
    try {
      const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(len(z.namelist()))', f]).toString().trim()
      expect(out).toBe('21')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
  it('crc32 matches the reference value', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926))
})
