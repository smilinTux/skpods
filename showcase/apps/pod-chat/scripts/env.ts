// Loads credentials from the files listed in SKP_TEST_ENV (colon separated). Values are never printed.
import fs from 'node:fs'
import { PodStore } from '@skpods/solid-web'
import { agentLogin, mintClientCredentials, type AgentSession } from '@skpods/solid-web/node'

for (const f of (process.env.SKP_TEST_ENV ?? '').split(':').filter(Boolean)) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

export const BASE = (process.env.SKPODS_BASE ?? '').replace(/\/$/, '')
export const haveEnv = Boolean(BASE && process.env.DW_ALICE_USER)
export const userOf = (who: string) => process.env[`DW_${who.toUpperCase().replace(/-/g, '_')}_USER`]!
export const webIdOf = (who: string) => `${BASE}/apps/solid/~${userOf(who)}/profile/card#me`
export const rootOf = (who: string) => `${BASE}/apps/solid/~${userOf(who)}/storage/`

export interface Actor {
  who: string
  webId: string
  root: string
  store: PodStore
  session: AgentSession
}
const actors = new Map<string, Promise<Actor>>()

/** A headless login (client credentials, DPoP) as one of the dw-* demo users. */
export function actor(who: string): Promise<Actor> {
  let a = actors.get(who)
  if (!a) {
    a = (async () => {
      const key = who.toUpperCase().replace(/-/g, '_')
      let id = process.env[`DW_${key}_CLIENT_ID`]
      let secret = process.env[`DW_${key}_CLIENT_SECRET`]
      if (!id || !secret) {
        const c = await mintClientCredentials({ base: BASE, user: userOf(who), secret: process.env[`DW_${key}_PASSWORD`]!, name: 'pod-chat demo seed' })
        id = c.client_id
        secret = c.client_secret
      }
      const session = await agentLogin({ issuer: BASE, clientId: id, clientSecret: secret })
      return { who, webId: webIdOf(who), root: rootOf(who), store: new PodStore(session.fetch), session }
    })()
    actors.set(who, a)
  }
  return a
}
