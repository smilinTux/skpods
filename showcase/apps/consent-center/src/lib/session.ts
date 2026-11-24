import { useEffect, useMemo, useState } from 'react'
import { IndexedDbKV, PodStore, SolidSession, createDpopFetch } from '@skpods/solid-web'
import { CONSENT_URL, ISSUER } from '../config'

/**
 * One SolidSession per app entry. The cockpit and the facility view live on the same origin, so each keeps its
 * tokens in its own IndexedDB database and its own redirect URI: both can be logged in side by side in one browser
 * profile (the pod server's own login cookie is still shared, see README).
 */
// One init per page load: React StrictMode mounts effects twice and a login redirect (code in the URL) can only be consumed once.
const inits = new Map<string, Promise<SolidSession>>()

export function useSession(opts: { clientName: string; db: string }) {
  const [session, setSession] = useState<SolidSession>()
  const [, bump] = useState(0)
  useEffect(() => {
    let off = () => {}
    let live = true
    let p = inits.get(opts.db)
    if (!p) {
      p = SolidSession.init({ defaultIssuer: ISSUER, clientName: opts.clientName, kv: new IndexedDbKV(opts.db) })
      inits.set(opts.db, p)
    }
    p.then((s) => {
      if (!live) return
      setSession(s)
      off = s.onChange(() => bump((n) => n + 1))
    })
    return () => {
      live = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return session
}

export const isActive = (s?: SolidSession): boolean => Boolean(s && s.state === 'active' && s.webId)

/** PodStore over the session's DPoP fetch. */
export function usePodStore(session?: SolidSession) {
  return useMemo(() => (session ? new PodStore(session.fetch) : undefined), [session])
}

/**
 * A fetch that carries the session's DPoP-bound access token to the consent broker.
 * SolidSession.fetch only signs requests to the pod server's origin, so this builds a second fetch from the same key
 * and token. It reads two private members of SolidSession (the key and accessToken()); a public
 * `session.fetchFor(origins)` in @skpods/solid-web would remove that (proposed in the README).
 */
export function brokerFetch(session: SolidSession): typeof fetch {
  const s = session as unknown as { p: { key: any }; accessToken(): Promise<string>; refresh(): Promise<string> }
  return createDpopFetch({
    key: s.p.key,
    getAccessToken: () => s.accessToken(),
    onUnauthorized: () => s.refresh().catch(() => undefined),
    allowedOrigins: [new URL(CONSENT_URL).origin],
  })
}
