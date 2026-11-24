import { createDpopProof, type DpopKey } from './crypto'

/** Produces the credentials for a relay auth frame: the access token plus a fresh DPoP proof (GET, `htu`, ath). */
export type RelayAuth = (htu: string) => Promise<{ token: string; proof: string }>

/** Builds a RelayAuth from a key and a token source. `htu` is used exactly as given. */
export function makeRelayAuth(key: DpopKey, getToken: () => string | Promise<string>): RelayAuth {
  return async (htu) => {
    const token = await getToken()
    const proof = await createDpopProof(key, 'GET', htu, { accessToken: token })
    return { token, proof }
  }
}
