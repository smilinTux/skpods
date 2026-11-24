// The clinic bridge: a small localhost-only Node service that plays "Bayview Family Clinic" for the Guardian demo.
//
// The Guardian app is a static browser app, and a browser tab cannot be logged in as two people at once. So the
// clinic's side (filing a consent request, reading the data it was given, releasing access) runs here, with the
// practitioner account's own client credentials. Everything it does is a real, authenticated call:
//   POST sk-consent /requests, GET <pod resource> (HTTP 200 or 403 from the pod), POST sk-consent /grants/{id}/access.
//
// Env (never printed, never committed):
//   SKPODS_BASE                         pod server and OIDC issuer
//   DW_PRACTITIONER_CLIENT_ID/_SECRET   the clinic's client credentials (or DW_PRACTITIONER_USER/_PASSWORD to mint them)
//   SKCONSENT_URL                       default http://127.0.0.1:8782
//   BRIDGE_PORT                         default 8790
import http from 'node:http'
import { createDpopFetch } from '@skpods/solid-web'
import { agentLogin, mintClientCredentials, type AgentSession } from '@skpods/solid-web/node'

const BASE = (process.env.SKPODS_BASE ?? '').replace(/\/$/, '')
const BROKER = (process.env.SKCONSENT_URL ?? 'http://127.0.0.1:8782').replace(/\/$/, '')
const PORT = Number(process.env.BRIDGE_PORT ?? 8790)
const CLINIC_NAME = 'Bayview Family Clinic'
if (!BASE) {
  console.error('SKPODS_BASE is not set')
  process.exit(1)
}

let session: AgentSession | undefined
let issuedAt = 0
let fetchAs: typeof fetch | undefined

async function login(): Promise<AgentSession> {
  let id = process.env.DW_PRACTITIONER_CLIENT_ID
  let secret = process.env.DW_PRACTITIONER_CLIENT_SECRET
  if (!id || !secret) {
    const user = process.env.DW_PRACTITIONER_USER
    const pw = process.env.DW_PRACTITIONER_PASSWORD
    if (!user || !pw) throw new Error('set DW_PRACTITIONER_CLIENT_ID/_SECRET (or DW_PRACTITIONER_USER/_PASSWORD)')
    const c = await mintClientCredentials({ base: BASE, user, secret: pw, name: 'guardian-demo clinic bridge' })
    id = c.client_id
    secret = c.client_secret
  }
  const s = await agentLogin({ issuer: BASE, clientId: id, clientSecret: secret })
  issuedAt = Date.now()
  return s
}

async function clinic(): Promise<{ s: AgentSession; f: typeof fetch }> {
  if (!session) {
    session = await login()
    const s = session
    // The agent helper only attaches DPoP to the pod origin, the broker needs it too.
    fetchAs = createDpopFetch({
      key: s.key,
      allowedOrigins: [new URL(BASE).origin, new URL(BROKER).origin],
      getAccessToken: async () => {
        if (Date.now() - issuedAt > 40 * 60_000) {
          await s.refresh()
          issuedAt = Date.now()
        }
        return s.accessToken()
      },
      onUnauthorized: async () => {
        await s.refresh()
        issuedAt = Date.now()
        return s.accessToken()
      },
    })
  }
  return { s: session, f: fetchAs! }
}

const lastReported = new Map<string, number>()

async function json(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const t = Buffer.concat(chunks).toString()
  return t ? JSON.parse(t) : {}
}

function send(res: http.ServerResponse, status: number, body: unknown, origin?: string) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  })
  res.end(JSON.stringify(body))
}

const okOrigin = (o?: string) => Boolean(o && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))

const server = http.createServer(async (req, res) => {
  const origin = okOrigin(req.headers.origin) ? req.headers.origin : undefined
  if (req.method === 'OPTIONS') return send(res, 204, {}, origin)
  const url = new URL(req.url ?? '/', 'http://x')
  try {
    if (url.pathname === '/health') {
      const { s } = await clinic()
      return send(res, 200, { ok: true, webid: s.webId, name: CLINIC_NAME, broker: BROKER }, origin)
    }
    if (url.pathname === '/request' && req.method === 'POST') {
      const b = await json(req)
      const { s, f } = await clinic()
      const t0 = Date.now()
      const r = await f(`${BROKER}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester: { webid: s.webId, name: CLINIC_NAME, kind: 'clinic' },
          subject: b.subject,
          purpose: b.purpose ?? 'Pre-visit intake for your annual check-up',
          items: (b.items ?? ['dob', 'allergies', 'medications', 'insurance_member_id', 'ssn']).map((data_class: string) => ({ data_class })),
          requested_duration: b.requested_duration ?? '72h',
          context: { booking_ref: b.booking_ref ?? 'BAY-1042' },
        }),
      })
      const body = await r.json().catch(() => ({}))
      return send(res, r.status, { status: r.status, ms: Date.now() - t0, request: body }, origin)
    }
    if (url.pathname === '/read' && req.method === 'POST') {
      const b = await json(req)
      const { f } = await clinic()
      const r = await f(b.resource, { headers: { Accept: 'text/turtle' } })
      const text = r.ok ? (await r.text()).slice(0, 4000) : (await r.text().catch(() => '')).slice(0, 120)
      // Pods do not push access logs, so the clinic reports reads itself. Only report a change, not every poll.
      if (b.grant_id && lastReported.get(b.grant_id) !== r.status) {
        lastReported.set(b.grant_id, r.status)
        await f(`${BROKER}/grants/${b.grant_id}/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ http_status: r.status }) }).catch(() => undefined)
      }
      return send(res, 200, { status: r.status, text: r.ok ? text : undefined, at: new Date().toISOString() }, origin)
    }
    if (url.pathname === '/release' && req.method === 'POST') {
      const b = await json(req)
      const { f } = await clinic()
      const r = await f(`${BROKER}/grants/${b.grant_id}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'released-by-grantee' }) })
      return send(res, r.status, await r.json().catch(() => ({})), origin)
    }
    return send(res, 404, { error: 'not found' }, origin)
  } catch (e) {
    console.error('bridge error:', (e as Error).message)
    return send(res, 502, { error: (e as Error).message }, origin)
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`clinic bridge for ${CLINIC_NAME} on http://127.0.0.1:${PORT} (broker ${BROKER})`))
