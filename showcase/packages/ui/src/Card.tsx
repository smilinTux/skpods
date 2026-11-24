import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  /** Right-aligned header content (buttons, chips). */
  actions?: ReactNode
  padded?: boolean
  glow?: boolean
}

export function Card({ title, subtitle, actions, padded = true, glow, className, children, ...rest }: CardProps) {
  return (
    <section className={cx('skp-card animate-fade-up', glow && 'shadow-glow', className)} {...rest}>
      {(title || actions) && (
        <header className={cx('flex items-start justify-between gap-3', padded ? 'px-5 pt-5' : 'px-5 pt-5 pb-3')}>
          <div className="min-w-0">
            {title && <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && 'p-5', title && padded && 'pt-4')}>{children}</div>
    </section>
  )
}
