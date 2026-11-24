import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ChatEngine } from '../lib/engine'

/** Re-render whenever the engine's state changes. */
export function useEngine(engine: ChatEngine): number {
  return useSyncExternalStore(engine.subscribe, engine.getVersion)
}

export function useHashRoute(): [string | undefined, (id: string | undefined) => void] {
  const read = () => decodeURIComponent(location.hash.match(/^#\/c\/([^/]+)/)?.[1] ?? '') || undefined
  const [id, setId] = useState(read)
  useEffect(() => {
    const h = () => setId(read())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return [id, (next) => { location.hash = next ? `#/c/${encodeURIComponent(next)}` : '#/' }]
}

/** Tick once a second (for "checked 3s ago"). */
export function useTick(ms = 1000) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}
