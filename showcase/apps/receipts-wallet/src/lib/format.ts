// Money is handled in integer cents so totals never drift. Dates are shown in the viewer's time zone.

export const toCents = (n: number) => Math.round(n * 100)
export const fromCents = (c: number) => c / 100

export function money(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

export const decimal = (cents: number) => (cents / 100).toFixed(2)

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: style, year: style === 'long' ? 'numeric' : undefined })
}

export const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
export const longDate = (d: Date) => d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })

/** True if the string holds something that looks like a payment card number (13 to 19 digits that pass Luhn). */
export function looksLikeCardNumber(s: string): boolean {
  for (const m of s.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) continue
    let sum = 0
    let dbl = false
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = Number(digits[i])
      if (dbl) {
        d *= 2
        if (d > 9) d -= 9
      }
      sum += d
      dbl = !dbl
    }
    if (sum % 10 === 0) return true
  }
  return false
}
