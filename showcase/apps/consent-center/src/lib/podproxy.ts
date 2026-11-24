import { ISSUER } from '../config'

/**
 * Why this exists (see README, "Engine limits"): pods-dev answers 403 to any non-owner request that carries an
 * `Origin` header unless the ACL rule names that origin with `acl:origin`. A browser always sends Origin on
 * cross-origin requests, and sk-consent does not write `acl:origin` yet, so the facility (and Alice, reading
 * Grandma's pod as attorney-in-fact) would be refused even while a grant is valid.
 *
 * Until sk-consent can add `acl:origin` for trusted app origins, requests to the pod's resources go through a
 * same-origin proxy (`/pod`, configured in vite.config.ts) that drops the Origin header. The URL the DPoP proof is
 * signed for stays the pod's real URL, so authorization is unchanged. Login and token endpoints are not proxied.
 * Set VITE_POD_PROXY=off to send requests straight to the pod.
 */
const PREFIX = (import.meta.env.VITE_POD_PROXY ?? '/pod') as string

export function installPodProxy() {
  if (PREFIX === 'off' || (window as any).__skpPodProxy) return
  ;(window as any).__skpPodProxy = true
  const orig = window.fetch.bind(window)
  const scope = `${ISSUER}/apps/solid/~`
  const rewrite = (u: string) => (u.startsWith(scope) ? PREFIX + u.slice(ISSUER.length) : u)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return orig(rewrite(input), init)
    if (input instanceof URL) return orig(rewrite(input.href), init)
    const u = rewrite(input.url)
    return orig(u === input.url ? input : new Request(u, input), init)
  }
}
