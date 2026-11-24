/** "72h", "1d 12h", "45m" from seconds. */
export function humanSeconds(s: number): string {
  if (s % 86400 === 0 && s >= 86400 * 2) return `${s / 86400} days`
  if (s >= 3600) {
    const h = Math.round(s / 360) / 10
    return `${h % 1 === 0 ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`
  }
  if (s >= 60) return `${Math.round(s / 60)} minutes`
  return `${s} seconds`
}
export const shortHash = (h?: string) => (h ?? '').replace(/^sha256:/, '').slice(0, 8)
export const clock = (t: string | number | Date) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const dayTime = (t: string | number | Date) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
export const pad2 = (n: number) => String(n).padStart(2, '0')
