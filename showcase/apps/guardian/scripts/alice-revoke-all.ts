// Dev helper: end every active grant for Alice using her client credentials (the same call the red button makes).
// Useful to reset the demo between runs without a browser. Env: SKPODS_BASE, DW_ALICE_CLIENT_ID/_SECRET.
import { createDpopFetch } from '@skpods/solid-web'
import { agentLogin } from '@skpods/solid-web/node'

const BASE = process.env.SKPODS_BASE!
const BROKER = (process.env.SKCONSENT_URL ?? 'http://127.0.0.1:8782').replace(/\/$/, '')
const s = await agentLogin({ issuer: BASE, clientId: process.env.DW_ALICE_CLIENT_ID!, clientSecret: process.env.DW_ALICE_CLIENT_SECRET! })
const f = createDpopFetch({ key: s.key, allowedOrigins: [new URL(BASE).origin, new URL(BROKER).origin], getAccessToken: async () => s.accessToken() })
const grants: { id: string; data_class: string }[] = await (await fetch(`${BROKER}/grants?subject=${encodeURIComponent(s.webId)}&status=active`)).json()
for (const g of grants) {
  const r = await f(`${BROKER}/grants/${g.id}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'dev-reset' }) })
  console.log(g.data_class, r.status)
}
console.log(`${grants.length} grant(s) processed`)
