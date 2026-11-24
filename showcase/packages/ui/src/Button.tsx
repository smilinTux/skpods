import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'
import { Spinner } from './States'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
}

export function Button({ variant = 'primary', loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button className={cx(`skp-btn-${variant}`, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner size={14} />}
      {children}
    </button>
  )
}
