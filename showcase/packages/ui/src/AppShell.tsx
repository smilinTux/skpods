import type { ReactNode } from 'react'
import { Avatar } from './Avatar'
import { ThemeToggle } from './theme'
import { cx } from './cx'

export interface NavItem {
  id: string
  label: string
  icon?: ReactNode
  badge?: number | string
}

export interface AppShellProps {
  appName: string
  tagline?: string
  nav?: NavItem[]
  activeNav?: string
  onNav?: (id: string) => void
  user?: { name: string; webId?: string; avatarUrl?: string }
  onLogout?: () => void
  /** Extra header controls (left of the theme toggle). */
  actions?: ReactNode
  children: ReactNode
  /** Page max width class, default max-w-5xl. */
  widthClass?: string
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="SKPods">
      <defs>
        <linearGradient id="skp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0b1530" />
      <path d="M16 6c5.5 0 9 3.6 9 8.4 0 5.4-4 9.6-9 11.6-5-2-9-6.2-9-11.6C7 9.6 10.5 6 16 6z" fill="url(#skp-g)" />
      <circle cx="16" cy="14" r="3.2" fill="#fbb040" />
    </svg>
  )
}

export function AppShell({ appName, tagline, nav, activeNav, onNav, user, onLogout, actions, children, widthClass = 'max-w-5xl' }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className={cx('mx-auto flex items-center gap-3 px-4 py-3', widthClass)}>
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold tracking-tight">{appName}</p>
            {tagline && <p className="hidden truncate text-xs text-muted sm:block">{tagline}</p>}
          </div>
          {nav && (
            <nav aria-label="Primary" className="ml-4 hidden gap-1 md:flex">
              {nav.map((n) => (
                <button key={n.id} type="button" aria-current={activeNav === n.id ? 'page' : undefined} onClick={() => onNav?.(n.id)} className={cx('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition', activeNav === n.id ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
                  {n.icon}
                  {n.label}
                  {n.badge !== undefined && <span className="rounded-full bg-warm px-1.5 text-[11px] font-bold text-navy-950">{n.badge}</span>}
                </button>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {actions}
            <ThemeToggle />
            {user && (
              <div className="ml-1 flex items-center gap-2">
                <Avatar name={user.name} seed={user.webId} src={user.avatarUrl} size="sm" />
                <span className="hidden max-w-40 truncate text-sm font-medium sm:block" title={user.webId}>{user.name}</span>
                {onLogout && (
                  <button type="button" className="skp-btn-ghost !px-2.5 !py-1.5 text-xs" onClick={onLogout}>
                    Log out
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <main id="main" className={cx('mx-auto w-full flex-1 px-4 py-6 pb-28 md:pb-10', widthClass)}>
        {children}
      </main>
      {nav && (
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {nav.map((n) => (
            <button key={n.id} type="button" aria-current={activeNav === n.id ? 'page' : undefined} onClick={() => onNav?.(n.id)} className={cx('relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', activeNav === n.id ? 'text-brand' : 'text-muted')}>
              {n.icon}
              {n.label}
              {n.badge !== undefined && <span className="absolute right-[28%] top-1.5 rounded-full bg-warm px-1.5 text-[10px] font-bold text-navy-950">{n.badge}</span>}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
