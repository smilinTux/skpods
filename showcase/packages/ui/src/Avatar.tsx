import { cx } from './cx'

const GRADIENTS = [
  'from-teal-400 to-cyan-600',
  'from-amber-400 to-orange-600',
  'from-indigo-400 to-violet-600',
  'from-rose-400 to-pink-600',
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-blue-600',
]

function hash(s: string) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export interface AvatarProps {
  name: string
  /** Stable seed for the color, e.g. the WebID. Defaults to the name. */
  seed?: string
  src?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Avatar({ name, seed, src, size = 'md', className }: AvatarProps) {
  const dim = size === 'sm' ? 'h-7 w-7 text-[11px]' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-sm'
  if (src) return <img src={src} alt={name} className={cx('rounded-full object-cover ring-2 ring-surface', dim, className)} />
  return (
    <span
      role="img"
      aria-label={name}
      className={cx('inline-flex select-none items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ring-2 ring-surface', GRADIENTS[hash(seed ?? name) % GRADIENTS.length], dim, className)}
    >
      {initials(name)}
    </span>
  )
}
