import { useMemo, useState } from 'react'
import { Avatar, Button, Card, EmptyState, cx } from '@skpods/ui'
import { categoryColor } from '../lib/categories'
import { applyFilters, groupByMonth, isFiltered, matches, NO_FILTERS, totalsBy, type Filters } from '../lib/filter'
import { dayLabel, money, monthKey, monthLabel } from '../lib/format'
import type { Receipt } from '../lib/receipt'
import type { Business } from '../lib/wallet'
import { Chip, Icon, Money } from './bits'
import { CategoryTag } from './bits'
import { ReceiptDetail } from './ReceiptDetail'

function Stat({ label, value, sub, testid }: { label: string; value: React.ReactNode; sub?: React.ReactNode; testid?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-3 py-2.5 sm:px-4 sm:py-3">
      <p className="truncate text-[10px] uppercase tracking-wide text-muted sm:text-xs">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold sm:text-2xl tracking-tight tabular-nums" data-testid={testid}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted sm:text-xs">{sub}</p>}
    </div>
  )
}

function Bars({ rows, total, onPick, active, label }: { rows: Array<{ key: string; total: number; count: number }>; total: number; onPick: (k: string) => void; active?: string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total))
  if (!rows.length) return <p className="text-sm text-muted">Nothing to total yet.</p>
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" onClick={() => onPick(r.key)} aria-pressed={active === r.key} className={cx('group w-full rounded-lg p-1.5 text-left transition hover:bg-surface-2', active === r.key && 'bg-brand-soft')} data-testid="category-row">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: categoryColor(r.key) }} /><span className="truncate font-medium">{r.key}</span></span>
              <span className="shrink-0 tabular-nums"><span className="text-muted">{Math.round((r.total / Math.max(1, total)) * 100)}% · </span><span className="font-semibold">{money(r.total)}</span></span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${(r.total / max) * 100}%`, background: categoryColor(r.key) }} /></div>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Months({ list, active, onPick }: { list: Receipt[]; active?: string; onPick: (m: string) => void }) {
  const rows = useMemo(() => totalsBy(list, (r) => monthKey(r.date)).sort((a, b) => a.key.localeCompare(b.key)).slice(-6), [list])
  const max = Math.max(1, ...rows.map((r) => r.total))
  if (!rows.length) return <p className="text-sm text-muted">No months yet.</p>
  return (
    <div className="flex h-36 items-end gap-2" role="list" aria-label="Spending by month">
      {rows.map((r) => (
        <button key={r.key} role="listitem" type="button" onClick={() => onPick(r.key)} aria-pressed={active === r.key} title={`${monthLabel(r.key)}: ${money(r.total)}, ${r.count} receipts`} className="group flex h-full min-w-0 flex-1 flex-col justify-end gap-1 text-center">
          <span className="text-[11px] tabular-nums text-muted group-hover:text-ink">{money(r.total).replace(/\.\d\d$/, '')}</span>
          <span className={cx('w-full rounded-t-lg transition-all duration-500', active === r.key ? 'bg-brand' : 'bg-brand/45 group-hover:bg-brand/70')} style={{ height: `${Math.max(6, (r.total / max) * 100)}%` }} />
          <span className="text-[11px] font-medium text-muted">{monthLabel(r.key, 'short')}</span>
        </button>
      ))}
    </div>
  )
}

export function Receipts({ receipts, businesses, filters, setFilters, loading }: { receipts: Receipt[]; businesses: Business[]; filters: Filters; setFilters: (f: Filters) => void; loading: boolean }) {
  const [open, setOpen] = useState<Receipt>()
  const patch = (p: Partial<Filters>) => setFilters({ ...filters, ...p })
  const toggle = <K extends 'business' | 'category' | 'month'>(k: K, v: string) => patch({ [k]: filters[k] === v ? undefined : v } as Partial<Filters>)

  const shown = useMemo(() => applyFilters(receipts, filters), [receipts, filters])
  const groups = useMemo(() => groupByMonth(shown), [shown])
  // charts ignore their own dimension so you can still see and switch the alternatives
  const forCategories = useMemo(() => receipts.filter((r) => matches(r, filters, ['category'])), [receipts, filters])
  const forMonths = useMemo(() => receipts.filter((r) => matches(r, filters, ['month'])), [receipts, filters])
  const cats = useMemo(() => totalsBy(forCategories, (r) => r.category), [forCategories])
  const total = shown.reduce((a, r) => a + r.total, 0)
  const thisMonth = receipts.filter((r) => monthKey(r.date) === monthKey(new Date())).reduce((a, r) => a + r.total, 0)
  const bizName = (k: string) => businesses.find((b) => b.key === k)?.name ?? k
  const counts = useMemo(() => new Map(totalsBy(receipts.filter((r) => matches(r, filters, ['business'])), (r) => r.business).map((t) => [t.key, t.count])), [receipts, filters])

  if (!receipts.length && !loading)
    return (
      <Card>
        <EmptyState
          icon={Icon.receipt}
          title="No receipts yet"
          hint={businesses.length ? 'Your businesses have not sent anything yet. New receipts appear here the moment they arrive.' : 'Add a business on the Businesses tab, and every receipt it issues lands here, in your pod, kept for good.'}
        />
      </Card>
    )

  return (
    <div className="space-y-5">
      <Card glow className="!overflow-visible">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label={isFiltered(filters) ? 'In this view' : 'Kept in your pod'} value={<Money cents={total} />} sub={`${shown.length} receipt${shown.length === 1 ? '' : 's'}`} testid="stat-total" />
          <Stat label="This month" value={<Money cents={thisMonth} />} sub={monthLabel(monthKey(new Date()))} />
          <Stat label="Businesses" value={businesses.filter((b) => b.status === 'active').length} sub={`${businesses.filter((b) => b.status === 'stopped').length} stopped`} />
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
        <Card title="Where it went" subtitle="Tap a category to filter">
          <Bars rows={cats} total={forCategories.reduce((a, r) => a + r.total, 0)} onPick={(k) => toggle('category', k)} active={filters.category} label="Totals per category" />
        </Card>
        <Card title="Month by month" subtitle="Tap a month to filter">
          <Months list={forMonths} active={filters.month} onPick={(m) => toggle('month', m)} />
        </Card>
      </div>

      <Card padded={false}>
        <div className="space-y-3 p-5 pb-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{Icon.search}</span>
            <input value={filters.q} onChange={(e) => patch({ q: e.target.value })} type="search" placeholder="Search business, item, amount, month, receipt number" aria-label="Search receipts" data-testid="search" className="w-full rounded-xl border border-line bg-surface-2 py-2.5 pl-9 pr-3 text-sm placeholder:text-muted/70" />
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter by business">
            {businesses.map((b) => (
              <Chip key={b.key} active={filters.business === b.key} onClick={() => toggle('business', b.key)} count={counts.get(b.key) ?? 0}>
                <Avatar name={b.name} seed={b.key} size="sm" className="!h-4 !w-4 !text-[8px]" />
                {b.name}
              </Chip>
            ))}
            {isFiltered(filters) && <Button variant="ghost" className="!px-2.5 !py-1 text-xs" onClick={() => setFilters(NO_FILTERS)} data-testid="clear">Clear filters</Button>}
          </div>
        </div>

        {!shown.length ? (
          <EmptyState title="No receipt matches" hint="Try fewer words, or clear the filters." action={<Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>} />
        ) : (
          <ol className="pb-2" data-testid="timeline">
            {groups.map((g) => (
              <li key={g.month}>
                <div className="sticky top-[57px] z-10 flex items-baseline justify-between border-y border-line bg-surface-2/90 px-5 py-2 backdrop-blur">
                  <h3 className="text-sm font-semibold">{monthLabel(g.month)}</h3>
                  <p className="text-xs text-muted"><span data-testid="month-count">{g.items.length}</span> receipt{g.items.length === 1 ? '' : 's'} · <Money cents={g.total} className="font-semibold text-ink" /></p>
                </div>
                <ul className="divide-y divide-line/70">
                  {g.items.map((r) => (
                    <li key={r.url}>
                      <button type="button" onClick={() => setOpen(r)} data-testid="receipt-row" className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-surface-2/70 focus-visible:bg-surface-2">
                        <Avatar name={r.issuerName} seed={r.business} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{r.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                            <span className="truncate">{bizName(r.business)}</span>
                            <span aria-hidden>·</span>
                            <span>{dayLabel(r.date)}</span>
                            <CategoryTag category={r.category} />
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <Money cents={r.total} currency={r.currency} className="block text-sm font-semibold" />
                          <span className="text-[11px] text-muted">{r.lines.length} item{r.lines.length === 1 ? '' : 's'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <ReceiptDetail receipt={open} onClose={() => setOpen(undefined)} />
    </div>
  )
}
