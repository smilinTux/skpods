import type { PodStore } from '@skpods/solid-web'
import { useEffect, useState } from 'react'

export interface PreparedImage {
  blob: Blob
  type: string
  ext: string
  width: number
  height: number
}

/** Downscale to at most `max` px on the long side and re-encode as JPEG. Pod storage is yours, but phones are slow. GIFs stay as they are. */
export async function prepareImage(file: File, max = 1600): Promise<PreparedImage> {
  if (!/^image\//.test(file.type)) throw new Error('Pick an image file')
  const bmp = await createImageBitmap(file)
  if (file.type === 'image/gif') return { blob: file, type: file.type, ext: 'gif', width: bmp.width, height: bmp.height }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), 'image/jpeg', 0.82))
  return { blob, type: 'image/jpeg', ext: 'jpg', width: w, height: h }
}

const blobCache = new Map<string, Promise<string>>()

/** Pod images are private: they need the DPoP token, so an <img src> cannot fetch them. Fetch with the session and show a blob URL. */
export function useAuthedImage(store: PodStore | undefined, url: string | undefined, preview?: string): { src?: string; error?: boolean } {
  const [state, setState] = useState<{ src?: string; error?: boolean }>({})
  useEffect(() => {
    if (preview) return setState({ src: preview })
    if (!store || !url) return setState({})
    let alive = true
    let p = blobCache.get(url)
    if (!p) {
      p = store.fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(String(r.status))
        return URL.createObjectURL(await r.blob())
      })
      blobCache.set(url, p)
      p.catch(() => blobCache.delete(url))
    }
    p.then((src) => alive && setState({ src })).catch(() => alive && setState({ error: true }))
    return () => {
      alive = false
    }
  }, [store, url, preview])
  return state
}

export function forgetImages(prefix: string) {
  for (const [k, v] of blobCache) if (k.startsWith(prefix)) (blobCache.delete(k), v.then((u) => URL.revokeObjectURL(u)).catch(() => {}))
}
