const COLORS: Record<string, string> = {
  'Home services': '#f59e0b',
  Medical: '#14b8a6',
  'Senior care': '#818cf8',
  Pharmacy: '#f472b6',
  Groceries: '#4ade80',
  Other: '#94a3b8',
}
const EXTRA = ['#38bdf8', '#fb7185', '#a3e635', '#c084fc']

export function categoryColor(c: string): string {
  if (COLORS[c]) return COLORS[c]
  let h = 0
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) | 0
  return EXTRA[Math.abs(h) % EXTRA.length]
}
