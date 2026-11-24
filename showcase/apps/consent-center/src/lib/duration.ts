export type Unit = 's' | 'm' | 'h' | 'd'
export type Choice = { kind: 'preset'; secs: number } | { kind: 'booking' } | { kind: 'custom'; n: number; unit: Unit }

export const UNIT_SECS: Record<Unit, number> = { s: 1, m: 60, h: 3600, d: 86400 }
export const UNIT_LABEL: Record<Unit, string> = { s: 'seconds (demo)', m: 'minutes', h: 'hours', d: 'days' }

/** The `duration` string sk-consent understands: "24h", "30s", "until_booking_end". */
export function toWire(c: Choice): string {
  if (c.kind === 'booking') return 'until_booking_end'
  if (c.kind === 'preset') return `${c.secs}`
  return `${Math.max(1, Math.floor(c.n))}${c.unit}`
}

export function secsOf(c: Choice, bookingSecs?: number): number | undefined {
  if (c.kind === 'booking') return bookingSecs
  if (c.kind === 'preset') return c.secs
  return Math.max(1, Math.floor(c.n)) * UNIT_SECS[c.unit]
}

/** Pick the starting choice from the guardian's recommendation. */
export function initialChoice(recommendedSecs?: number): Choice {
  return { kind: 'preset', secs: recommendedSecs ?? 86400 }
}
