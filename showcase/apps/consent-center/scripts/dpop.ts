// A DPoP-signed fetch for the broker origin, built from an agent session (Node side of the tests and the seed).
import { createDpopFetch } from '@skpods/solid-web'
import type { Actor } from './seed'

/** Needs the agent session internals; the Actor carries them as `session`. */
export function dpopFetchFor(a: Actor, broker: string): typeof fetch {
  const s = a.session
  return createDpopFetch({ key: s.key, getAccessToken: async () => s.accessToken(), allowedOrigins: [new URL(broker).origin] })
}
