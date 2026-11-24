import { PodStore, type PodResponse } from '@skpods/solid-web'

/**
 * PodStore that retries idempotent requests (everything except POST) when the server answers 5xx or 429.
 * pods-dev now and then answers 500 (a Nextcloud error page) when several requests arrive at once; a retry after a
 * short pause nearly always succeeds. POST is never retried here: a repeat could create a second receipt.
 */
export class ResilientStore extends PodStore {
  constructor(fetchImpl: typeof globalThis.fetch, private readonly tries = 4) {
    super(fetchImpl)
  }
  async request(url: string, init: RequestInit = {}): Promise<PodResponse> {
    const idempotent = (init.method ?? 'GET') !== 'POST'
    let r = await super.request(url, init)
    for (let i = 1; idempotent && i < this.tries && (r.status >= 500 || r.status === 429); i++) {
      await new Promise((res) => setTimeout(res, 300 * i))
      r = await super.request(url, init)
    }
    return r
  }
}
