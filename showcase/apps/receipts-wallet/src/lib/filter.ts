import { money, monthKey, monthLabel } from './format'
import type { Receipt } from './receipt'

export interface Filters {
  q: string
  /** Business key. */
  business?: string
  category?: string
  /** YYYY-MM */
  month?: string
}

export const NO_FILTERS: Filters = { q: '' }
export const isFiltered = (f: Filters) => Boolean(f.q.trim() || f.business || f.category || f.month)

function haystack(r: Receipt): string {
  return [
    r.issuerName,
    r.name,
    r.description,
    r.identifier,
    r.category,
    r.kind,
    r.paymentMethod,
    r.paymentRef,
    monthLabel(monthKey(r.date)),
    money(r.total, r.currency),
    (r.total / 100).toFixed(2),
    ...r.lines.map((l) => l.name),
  ]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase()
}

/** Every word of the query must appear somewhere in the receipt (business, item, id, month, amount...). */
export function matches(r: Receipt, f: Filters, skip: Array<keyof Filters> = []): boolean {
  if (!skip.includes('business') && f.business && r.business !== f.business) return false
  if (!skip.includes('category') && f.category && r.category !== f.category) return false
  if (!skip.includes('month') && f.month && monthKey(r.date) !== f.month) return false
  if (!skip.includes('q')) {
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length) {
      const h = haystack(r)
      if (!words.every((w) => h.includes(w))) return false
    }
  }
  return true
}

export const applyFilters = (list: Receipt[], f: Filters) => list.filter((r) => matches(r, f))

export interface MonthGroup {
  month: string
  items: Receipt[]
  total: number
}

export function groupByMonth(list: Receipt[]): MonthGroup[] {
  const m = new Map<string, Receipt[]>()
  for (const r of [...list].sort((a, b) => b.date.getTime() - a.date.getTime())) {
    const k = monthKey(r.date)
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return [...m].map(([month, items]) => ({ month, items, total: items.reduce((a, r) => a + r.total, 0) }))
}

export function totalsBy(list: Receipt[], key: (r: Receipt) => string): Array<{ key: string; total: number; count: number }> {
  const m = new Map<string, { total: number; count: number }>()
  for (const r of list) {
    const e = m.get(key(r)) ?? { total: 0, count: 0 }
    e.total += r.total
    e.count += 1
    m.set(key(r), e)
  }
  return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.total - a.total)
}
