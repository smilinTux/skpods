// Demo driver for the receipts wallet, headless (the agent flow: client credentials, DPoP).
//
//   SKP_TEST_ENV=/path/a.env:/path/b.env npx tsx scripts/demo.ts seed [--reset] [--file]
//   SKP_TEST_ENV=... npx tsx scripts/demo.ts issue --as bayview [--to ALICE] [--preset 0] [--amount 30]
//   SKP_TEST_ENV=... npx tsx scripts/demo.ts stop bayview      # the customer removes a business's append right
//   SKP_TEST_ENV=... npx tsx scripts/demo.ts reset
//
// The env files provide SKPODS_BASE and DW_<USER>_USER plus either DW_<USER>_CLIENT_ID / _CLIENT_SECRET or _PASSWORD
// (a password is used once to mint client credentials). Nothing here prints a secret.
import fs from 'node:fs'
import { ResilientStore } from '../src/lib/resilient'
import { agentLogin, mintClientCredentials, type AgentSession } from '@skpods/solid-web/node'
import { DEMO_BUSINESSES, DEMO_RECEIPTS, PRESETS } from '../src/lib/demo-data'
import { buildReceiptTurtle, receiptSlug, type ReceiptInput } from '../src/lib/receipt'
import { addBusiness, businessKey, inboxOf, loadBusinesses, loadReceipts, pathsFor, retry, resetWallet, setupWallet, stopBusiness, type Wallet } from '../src/lib/wallet'

for (const f of (process.env.SKP_TEST_ENV ?? '').split(':').filter(Boolean)) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const BASE = (process.env.SKPODS_BASE ?? '').replace(/\/$/, '')
if (!BASE) {
  console.error('Set SKP_TEST_ENV to env file(s) that define SKPODS_BASE and the DW_* accounts.')
  process.exit(2)
}

const sessions = new Map<string, AgentSession>()
async function login(envKey: string, fallbackUser?: string): Promise<AgentSession> {
  const k = envKey.toUpperCase()
  const hit = sessions.get(k)
  if (hit) return hit
  const user = process.env[`DW_${k}_USER`] ?? fallbackUser
  let id = process.env[`DW_${k}_CLIENT_ID`]
  let secret = process.env[`DW_${k}_CLIENT_SECRET`]
  if ((!id || !secret) && user && process.env[`DW_${k}_PASSWORD`]) {
    const c = await mintClientCredentials({ base: BASE, user, secret: process.env[`DW_${k}_PASSWORD`]!, name: 'receipts-wallet demo' })
    id = c.client_id
    secret = c.client_secret
  }
  if (!id || !secret) throw new Error(`No credentials for ${k} in the environment`)
  const s = await agentLogin({ issuer: BASE, clientId: id, clientSecret: secret })
  sessions.set(k, s)
  return s
}

async function walletFor(envKey: string): Promise<{ store: ResilientStore; wallet: Wallet; webId: string }> {
  const s = await login(envKey)
  const store = new ResilientStore(s.fetch)
  const storage = await store.storageRoot(s.webId)
  if (!storage) throw new Error('No pim:storage in the customer profile')
  return { store, wallet: { owner: s.webId, paths: pathsFor(storage) }, webId: s.webId }
}

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 ? args[i + 1] : undefined
}

async function seed() {
  const customerKey = opt('to') ?? 'ALICE'
  const { store, wallet } = await walletFor(customerKey)
  if (flag('reset')) {
    if (await store.exists(wallet.paths.root)) {
      console.log('reset: removing', wallet.paths.root)
      await resetWallet(store, wallet)
    }
  }
  await setupWallet(store, wallet.owner, wallet.paths.root.replace(/skpods\/v1\/receipts\/$/, ''))
  const sessionsByBiz = new Map<string, AgentSession>()
  for (const b of DEMO_BUSINESSES) {
    const s = await login(b.envKey, b.user)
    sessionsByBiz.set(b.id, s)
    await addBusiness(store, wallet, { name: b.name, webId: s.webId, category: b.category })
    console.log(`business added: ${b.name} (inbox ${businessKey(s.webId)}, Append only)`)
  }
  let sent = 0
  await Promise.all(
    DEMO_BUSINESSES.map(async (b) => {
      const s = sessionsByBiz.get(b.id)!
      const biz = new ResilientStore(s.fetch)
      for (const r of DEMO_RECEIPTS.filter((x) => x.business === b.id)) {
        const input: ReceiptInput = {
          kind: r.kind,
          identifier: r.identifier,
          date: new Date(`${r.date}T15:00:00Z`),
          name: r.name,
          description: r.description,
          category: b.category,
          issuer: { name: b.name, webId: s.webId },
          customerWebId: wallet.owner,
          lines: r.lines,
          taxRate: r.taxRate,
          paymentMethod: r.paymentMethod,
          paymentRef: r.paymentRef,
        }
        // pods-dev now and then answers 500 (a Nextcloud error page) to writes under load: retry.
        await retry(() => biz.post(inboxOf(wallet, businessKey(s.webId)), buildReceiptTurtle(input), { slug: receiptSlug(input) }), 4)
        sent++
      }
    }),
  )
  console.log(`delivered ${sent} receipts into ${wallet.paths.inbox}`)
  if (flag('file')) {
    const businesses = await loadBusinesses(store, wallet)
    const r = await loadReceipts(store, wallet, businesses, new Map(), { file: true })
    console.log(`filed ${r.filed.length} into the archive, ${r.receipts.length} receipts total`)
  } else console.log('left in the inbox: the wallet files them when it opens (or run with --file)')
}

async function issue() {
  const as = opt('as') ?? 'bayview'
  const biz = DEMO_BUSINESSES.find((b) => b.id === as)
  if (!biz) throw new Error(`--as must be one of ${DEMO_BUSINESSES.map((b) => b.id).join(', ')}`)
  const customer = await login(opt('to') ?? 'ALICE')
  const s = await login(biz.envKey, biz.user)
  const store = new ResilientStore(s.fetch)
  const storage = await store.storageRoot(customer.webId)
  const w: Wallet = { owner: customer.webId, paths: pathsFor(storage!) }
  const preset = PRESETS[Number(opt('preset') ?? 0)] ?? PRESETS[0]
  const amount = opt('amount')
  const now = new Date()
  const input: ReceiptInput = {
    kind: 'Invoice',
    identifier: `${biz.id.toUpperCase().slice(0, 3)}-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`,
    date: now,
    name: preset.name,
    category: biz.category,
    issuer: { name: biz.name, webId: s.webId },
    customerWebId: customer.webId,
    lines: amount ? [{ name: preset.lines[0].name, qty: 1, unit: Number(amount) }] : preset.lines,
    taxRate: preset.taxRate,
    paymentMethod: preset.paymentMethod,
    paymentRef: 'ref:pm-demo-0001',
  }
  const url = await store.post(inboxOf(w, businessKey(s.webId)), buildReceiptTurtle(input), { slug: receiptSlug(input) })
  console.log('delivered', url)
  const back = await s.fetch(url)
  console.log(`business reads it back: HTTP ${back.status} (append only, expected 403)`)
}

async function stop() {
  const id = args[1]
  const biz = DEMO_BUSINESSES.find((b) => b.id === id)
  if (!biz) throw new Error(`usage: stop <${DEMO_BUSINESSES.map((b) => b.id).join('|')}>`)
  const { store, wallet } = await walletFor(opt('to') ?? 'ALICE')
  const b = (await loadBusinesses(store, wallet)).find((x) => x.name === biz.name)
  if (!b) throw new Error('That business has not been added')
  await stopBusiness(store, wallet, b)
  console.log(`${biz.name}: append right removed, receipts already delivered stay in the wallet`)
}

async function reset() {
  const { store, wallet } = await walletFor(opt('to') ?? 'ALICE')
  if (await store.exists(wallet.paths.root)) await resetWallet(store, wallet)
  console.log('removed', wallet.paths.root)
}

const cmd = args[0]
const run = { seed, issue, stop, reset }[cmd as 'seed']
if (!run) {
  console.error('usage: demo.ts seed [--reset] [--file] | issue --as <id> [--preset n] [--amount x] | stop <id> | reset')
  process.exit(2)
}
run().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
