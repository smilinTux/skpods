import type { PodStore } from '@skpods/solid-web'
import { cx } from '@skpods/ui'
import { useAuthedImage } from '../lib/images'

export function AuthedImage({ store, url, preview, alt, width, height, className, onOpen }: { store: PodStore; url?: string; preview?: string; alt: string; width?: number; height?: number; className?: string; onOpen?: (src: string) => void }) {
  const { src, error } = useAuthedImage(store, url, preview)
  const ratio = width && height ? `${width} / ${height}` : '4 / 3'
  if (error) return <div className={cx('flex items-center justify-center rounded-xl bg-surface-2 text-xs text-muted', className)} style={{ aspectRatio: ratio }}>Photo hidden or removed</div>
  if (!src) return <div className={cx('animate-pulse rounded-xl bg-surface-2', className)} style={{ aspectRatio: ratio }} role="img" aria-label="Loading photo" />
  return (
    <button type="button" onClick={() => onOpen?.(src)} className={cx('block overflow-hidden rounded-xl focus-visible:ring-2', className)} aria-label={`Open photo: ${alt}`}>
      <img src={src} alt={alt} width={width} height={height} className="h-auto w-full object-cover" style={{ aspectRatio: ratio }} draggable={false} />
    </button>
  )
}
