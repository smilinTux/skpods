const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
export const clock = (t: number) => timeFmt.format(t)

export function dayLabel(t: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return dayFmt.format(t)
}

/** Conversation list timestamp: time today, "Yesterday", weekday this week, otherwise a date. */
export function listStamp(t: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000)
  if (diff === 0) return clock(t)
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return weekday.format(t)
  return dateFmt.format(t)
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.round(s / 60)} min ago`
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g
/** Split text into plain and link parts. Only http(s) links are ever made clickable. */
export function linkify(text: string): { text: string; href?: string }[] {
  return text.split(URL_RE).filter(Boolean).map((part, i) => (i % 2 === 1 ? { text: part, href: part } : { text: part }))
}
