// Tiny key-value persistence for the browser session. IndexedDB holds CryptoKey objects (non-extractable
// private keys survive structured clone); the memory store is used in Node and when IndexedDB is blocked.
export interface KV {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  del(key: string): Promise<void>
}

export class MemoryKV implements KV {
  private m = new Map<string, unknown>()
  async get<T>(k: string) {
    return this.m.get(k) as T | undefined
  }
  async set<T>(k: string, v: T) {
    this.m.set(k, v)
  }
  async del(k: string) {
    this.m.delete(k)
  }
}

export class IndexedDbKV implements KV {
  private dbp?: Promise<IDBDatabase>
  constructor(private name = 'skpods-solid-web') {}
  private db() {
    this.dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('kv')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.dbp
  }
  private async tx<R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction('kv', mode).objectStore('kv'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  get<T>(key: string) {
    return this.tx('readonly', (s) => s.get(key)) as Promise<T | undefined>
  }
  async set<T>(key: string, value: T) {
    await this.tx('readwrite', (s) => s.put(value, key))
  }
  async del(key: string) {
    await this.tx('readwrite', (s) => s.delete(key))
  }
}

export function defaultKV(): KV {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbKV()
  } catch {
    /* fall through */
  }
  return new MemoryKV()
}

export function safeLocal(): Storage | undefined {
  try {
    const s = globalThis.localStorage
    s.getItem('x')
    return s
  } catch {
    return undefined
  }
}
export function safeSession(): Storage | undefined {
  try {
    const s = globalThis.sessionStorage
    s.getItem('x')
    return s
  } catch {
    return undefined
  }
}
