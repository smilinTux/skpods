// Persistent cache of fetched chat files. Safe because every chat file is immutable once written (see codec.ts):
// a URL never changes meaning, it can only disappear. One KV entry per author container, written back lazily.
import { IndexedDbKV, MemoryKV, type KV } from '@skpods/solid-web'

type Bucket = Record<string, string>

export class FileCache {
  private buckets = new Map<string, Bucket>()
  private dirty = new Set<string>()
  private timer?: ReturnType<typeof setTimeout>

  constructor(private kv: KV) {}

  static forUser(webId: string): FileCache {
    let kv: KV
    try {
      kv = typeof indexedDB !== 'undefined' ? new IndexedDbKV('pod-chat-cache') : new MemoryKV()
    } catch {
      kv = new MemoryKV()
    }
    return new FileCache(kv)
  }

  private key(container: string) {
    return 'c:' + container
  }

  private async bucket(container: string): Promise<Bucket> {
    let b = this.buckets.get(container)
    if (!b) {
      b = (await this.kv.get<Bucket>(this.key(container)).catch(() => undefined)) ?? {}
      this.buckets.set(container, b)
    }
    return b
  }

  async get(container: string, url: string): Promise<string | undefined> {
    return (await this.bucket(container))[url]
  }

  async set(container: string, url: string, text: string): Promise<void> {
    ;(await this.bucket(container))[url] = text
    this.touch(container)
  }

  /** Forget files that are no longer in the listing (deleted or compacted away). */
  async retain(container: string, keep: Set<string>): Promise<void> {
    const b = await this.bucket(container)
    let changed = false
    for (const u of Object.keys(b)) if (!keep.has(u)) (delete b[u], (changed = true))
    if (changed) this.touch(container)
  }

  /** Wipe everything cached for an author, used when they revoke access: their data must not linger here. */
  async purge(container: string): Promise<void> {
    this.buckets.set(container, {})
    this.dirty.delete(container)
    await this.kv.del(this.key(container)).catch(() => {})
  }

  private touch(container: string) {
    this.dirty.add(container)
    this.timer ??= setTimeout(() => void this.flush(), 1200)
  }

  async flush(): Promise<void> {
    this.timer = undefined
    for (const c of [...this.dirty]) {
      this.dirty.delete(c)
      await this.kv.set(this.key(c), this.buckets.get(c) ?? {}).catch(() => {})
    }
  }
}
