import { Avatar, cx } from '@skpods/ui'
import type { Person } from '../lib/model'

const AUTHOR_COLORS = ['text-teal-700 dark:text-teal-300', 'text-amber-700 dark:text-amber-300', 'text-indigo-600 dark:text-indigo-300', 'text-rose-600 dark:text-rose-300', 'text-emerald-700 dark:text-emerald-300', 'text-sky-700 dark:text-sky-300']
export function authorColor(webId: string): string {
  let h = 0
  for (const c of webId) h = (h * 31 + c.charCodeAt(0)) | 0
  return AUTHOR_COLORS[Math.abs(h) % AUTHOR_COLORS.length]
}

/** One avatar for a person, two overlapping for a group. */
export function ConvFace({ members, me, kind, size = 'md' }: { members: Person[]; me: string; kind: 'direct' | 'group'; size?: 'sm' | 'md' | 'lg' }) {
  const others = members.filter((m) => m.webId !== me)
  if (kind === 'direct' || others.length <= 1) {
    const p = others[0] ?? members[0]
    return (
      <span className={cx('inline-flex shrink-0 items-center justify-center', size === 'lg' ? 'h-14 w-14' : 'h-11 w-11')}>
        <Avatar name={p?.name ?? '?'} seed={p?.webId} size={size === 'lg' ? 'lg' : 'md'} className={size === 'lg' ? '' : '!h-11 !w-11 !text-base'} />
      </span>
    )
  }
  const [a, b] = others
  return (
    <span className={cx('relative inline-block shrink-0', size === 'lg' ? 'h-14 w-14' : 'h-11 w-11')} aria-hidden>
      <Avatar name={a.name} seed={a.webId} size="sm" className="absolute left-0 top-0 !h-8 !w-8" />
      <Avatar name={b.name} seed={b.webId} size="sm" className="absolute bottom-0 right-0 !h-8 !w-8" />
    </span>
  )
}
