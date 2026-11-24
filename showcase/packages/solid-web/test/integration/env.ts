// Loads test credentials from the files named in SKP_TEST_ENV (colon separated). Never logs values.
import fs from 'node:fs'
import { agentLogin, mintClientCredentials, type AgentSession } from '../../src/node'
import { PodStore } from '../../src/store'

for (const f of (process.env.SKP_TEST_ENV ?? '').split(':').filter(Boolean)) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

export const BASE = (process.env.SKPODS_BASE ?? '').replace(/\/$/, '')
export const haveEnv = Boolean(BASE && process.env.DW_ALICE_USER)

export const userOf = (who: string) => process.env[`DW_${who.toUpperCase()}_USER`]!
export const webIdOf = (who: string) => `${BASE}/apps/solid/~${userOf(who)}/profile/card#me`
export const storageOf = (who: string) => `${BASE}/apps/solid/~${userOf(who)}/storage/`

const sessions = new Map<string, AgentSession>()
/** Client-credentials session for a test user. Uses stored client ids if present, else mints from the password. */
export async function agentFor(who: string): Promise<AgentSession> {
  const key = who.toUpperCase()
  const cached = sessions.get(key)
  if (cached) return cached
  let id = process.env[`DW_${key}_CLIENT_ID`]
  let secret = process.env[`DW_${key}_CLIENT_SECRET`]
  if (!id || !secret) {
    const c = await mintClientCredentials({ base: BASE, user: userOf(who), secret: process.env[`DW_${key}_PASSWORD`]!, name: 'showcase integration test' })
    id = c.client_id
    secret = c.client_secret
  }
  const s = await agentLogin({ issuer: BASE, clientId: id, clientSecret: secret })
  sessions.set(key, s)
  return s
}
export const storeFor = async (who: string) => new PodStore((await agentFor(who)).fetch)
export const run = () => `showcase-test-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`
