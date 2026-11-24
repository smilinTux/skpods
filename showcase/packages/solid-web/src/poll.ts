import type { PodStore } from './store'

export interface WatchOptions {
  /** Base interval in ms while something changes. Default 3000. */
  intervalMs?: number
  /** Interval ceiling while nothing changes (backoff doubles up to this). Default 20000. */
  maxIntervalMs?: number
  onChange: (text: string | undefined) => void
  onError?: (e: unknown) => void
}

async function digest(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Change detection by polling. pods-dev sends no ETag or Last-Modified and its notification channels are not
 * reachable from a browser (ENGINE-NOTES.md), so we GET and compare a body hash. Backs off while idle, resets on
 * change, pauses while the tab is hidden. Returns a stop function. `onChange` fires once at start with the first body.
 */
export function watchResource(store: PodStore, url: string, o: WatchOptions): () => void {
  const base = o.intervalMs ?? 3000
  const max = o.maxIntervalMs ?? 20000
  let wait = base
  let last: string | undefined = '\u0000unset'
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    if (typeof document !== 'undefined' && document.hidden) {
      timer = setTimeout(tick, base)
      return
    }
    try {
      const r = await store.get(url)
      const h = r ? await digest(r.text) : undefined
      if (h !== last) {
        last = h
        wait = base
        o.onChange(r?.text)
      } else wait = Math.min(max, Math.round(wait * 1.5))
    } catch (e) {
      o.onError?.(e)
      wait = Math.min(max, wait * 2)
    }
    if (!stopped) timer = setTimeout(tick, wait)
  }
  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
