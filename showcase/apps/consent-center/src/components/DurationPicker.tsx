import { useId } from 'react'
import { cx } from '@skpods/ui'
import { UNIT_LABEL, type Choice, type Unit } from '../lib/duration'
import { span, time } from '../lib/format'

interface Props {
  value: Choice
  onChange: (c: Choice) => void
  /** Present only when the request cites a booking. `end` is shown when the viewer could read it. */
  booking?: { end?: Date }
  recommendedSecs?: number
  maxSecs?: number
}

/** "How long?" Three honest choices: a standard span, until the appointment ends, or custom. */
export function DurationPicker({ value, onChange, booking, recommendedSecs, maxSecs }: Props) {
  const id = useId()
  const std = 86400
  const opt = (active: boolean, label: React.ReactNode, onClick: () => void, testid: string, hint?: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-testid={testid}
      onClick={onClick}
      className={cx(
        'rounded-xl border px-3 py-2 text-left text-sm transition',
        active ? 'border-brand bg-brand-soft text-ink shadow-glow' : 'border-line bg-surface hover:border-brand/50',
      )}
    >
      <span className="block font-semibold">{label}</span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </button>
  )
  const custom = value.kind === 'custom' ? value : { kind: 'custom' as const, n: 1, unit: 'h' as Unit }
  return (
    <div role="radiogroup" aria-label="How long should access last?" className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {opt(value.kind === 'preset' && value.secs === std, '24 hours', () => onChange({ kind: 'preset', secs: std }), 'dur-24h', recommendedSecs === std ? 'Suggested' : 'A day, then it switches off')}
        {booking
          ? opt(value.kind === 'booking', 'Until the appointment ends', () => onChange({ kind: 'booking' }), 'dur-booking', booking.end ? `Ends ${time(booking.end)}` : 'Ends with the booking')
          : opt(value.kind === 'preset' && value.secs === 3600, '1 hour', () => onChange({ kind: 'preset', secs: 3600 }), 'dur-1h', 'A short look')}
        {opt(value.kind === 'custom', 'Custom', () => onChange(custom), 'dur-custom', 'You pick the time')}
      </div>
      {value.kind === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 animate-fade-up">
          <label htmlFor={`${id}-n`} className="text-sm text-muted">Allow for</label>
          <input
            id={`${id}-n`}
            data-testid="custom-n"
            type="number"
            min={1}
            max={999}
            value={custom.n}
            onChange={(e) => onChange({ ...custom, n: Number(e.target.value) || 1 })}
            className="w-20 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-center font-mono text-sm"
          />
          <select
            aria-label="Unit"
            data-testid="custom-unit"
            value={custom.unit}
            onChange={(e) => onChange({ ...custom, unit: e.target.value as Unit })}
            className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm"
          >
            {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
              <option key={u} value={u}>{UNIT_LABEL[u]}</option>
            ))}
          </select>
          {maxSecs && <span className="text-xs text-muted">Longest your rules allow: {span(maxSecs)}</span>}
        </div>
      )}
    </div>
  )
}
