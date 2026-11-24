// End to end against pods-dev: the whole receipts story through a real browser.
//   SKP_TEST_ENV=<env files> npm run test:e2e -w @skpods/receipts-wallet
// Seeds 20 receipts from 4 businesses into dw-alice's pod, drives the Nextcloud login form for dw-alice and for
// dw-practitioner (separate browser contexts), and checks the Append-only behaviour with real status codes.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PodStore } from '@skpods/solid-web'
import { agentLogin, mintClientCredentials } from '@skpods/solid-web/node'

for (const f of (process.env.SKP_TEST_ENV ?? '').split(':').filter(Boolean)) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const BASE = (process.env.SKPODS_BASE ?? '').replace(/\/$/, '')
const have = Boolean(BASE && process.env.DW_ALICE_USER && process.env.DW_PRACTITIONER_USER)

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const APP = 'http://localhost:5175/'
const shots = process.env.SKP_SHOT_DIR ?? path.join(appDir, 'docs/screenshots')

const aliceStorage = `${BASE}/apps/solid/~${process.env.DW_ALICE_USER}/storage/`
const inboxOf = (key: string) => `${aliceStorage}skpods/v1/receipts/inbox/${key}/`
const archiveOf = (key: string) => `${aliceStorage}skpods/v1/receipts/archive/${key}/`

async function agent(key: string) {
  let id = process.env[`DW_${key}_CLIENT_ID`]
  let secret = process.env[`DW_${key}_CLIENT_SECRET`]
  if (!id || !secret) {
    const c = await mintClientCredentials({ base: BASE, user: process.env[`DW_${key}_USER`]!, secret: process.env[`DW_${key}_PASSWORD`]!, name: 'receipts e2e' })
    id = c.client_id
    secret = c.client_secret
  }
  const s = await agentLogin({ issuer: BASE, clientId: id, clientSecret: secret })
  return { s, store: new PodStore(s.fetch) }
}

async function waitFor(url: string, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`dev server did not start at ${url}`)
}

async function logIn(page: Page, who: 'ALICE' | 'PRACTITIONER') {
  await page.getByTestId('login').click()
  await page.waitForURL(/\/login/, { timeout: 30_000 })
  await page.fill('input[name=user]', process.env[`DW_${who}_USER`]!)
  await page.fill('input[name=password]', process.env[`DW_${who}_PASSWORD`]!)
  await page.click('button[type=submit]')
  await page.getByRole('button', { name: 'Allow' }).click({ timeout: 30_000 })
}

async function snap(page: Page, name: string) {
  await page.waitForTimeout(450) // let entrance animations finish
  fs.mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, `${name}.png`) })
}

describe.skipIf(!have)('receipts wallet story on pods-dev', () => {
  let server: ChildProcess | undefined
  let browser: Browser
  let aliceCtx: BrowserContext
  let bizCtx: BrowserContext
  let alice: Page
  let biz: Page
  const env = { ...process.env }

  beforeAll(async () => {
    const seed = spawnSync(path.join(appDir, '../../node_modules/.bin/tsx'), ['scripts/demo.ts', 'seed', '--reset'], { cwd: appDir, env, encoding: 'utf8' })
    expect(seed.status, seed.stderr).toBe(0)
    let reuse = false
    try {
      reuse = (await fetch(APP)).ok
    } catch {
      /* start our own */
    }
    if (!reuse) {
      server = spawn(path.join(appDir, '../../node_modules/.bin/vite'), ['--port', '5175', '--strictPort'], { cwd: appDir, stdio: 'ignore' })
      await waitFor(APP)
    }
    browser = await chromium.launch({ executablePath: process.env.SKP_CHROME ?? (fs.existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : undefined), headless: true })
    aliceCtx = await browser.newContext({ viewport: { width: 1180, height: 900 }, acceptDownloads: true })
    bizCtx = await browser.newContext({ viewport: { width: 1180, height: 900 } })
    alice = await aliceCtx.newPage()
    biz = await bizCtx.newPage()
  })

  afterAll(async () => {
    await browser?.close()
    server?.kill()
  })

  it('alice logs in and sees 20 receipts from 4 businesses, filed into her private archive', async () => {
    await alice.goto(APP)
    await alice.getByTestId('login').waitFor()
    await snap(alice, '01-welcome')
    await logIn(alice, 'ALICE')
    await alice.getByTestId('receipt-row').first().waitFor({ timeout: 60_000 })
    expect(await alice.getByTestId('receipt-row').count()).toBe(20)
    await alice.waitForTimeout(600)
    await snap(alice, '02-timeline')

    // the wallet moved them from the inbox to the archive
    const { store: aliceStore } = await agent('ALICE')
    for (const key of ['dw-practitioner', 'dw-care-facility', 'dw-bob', 'dw-agent']) {
      // the delete after filing can lag a poll behind on this engine: allow the wallet a moment to finish
      await expect.poll(async () => (await aliceStore.list(inboxOf(key))).length, { timeout: 30_000, interval: 2_000, message: `inbox ${key}` }).toBe(0)
      expect((await aliceStore.list(archiveOf(key))).length, `archive ${key}`).toBeGreaterThan(3)
    }
  })

  it('search, category and month filters, receipt detail with raw Turtle', async () => {
    await alice.getByTestId('search').fill('faucet')
    await alice.waitForFunction(() => document.querySelectorAll('[data-testid=receipt-row]').length === 1)
    await alice.getByTestId('receipt-row').click()
    await alice.getByTestId('detail').waitFor()
    expect(await alice.getByTestId('line').count()).toBe(3)
    expect(await alice.getByTestId('detail-total').innerText()).toMatch(/\$\d/)
    await snap(alice, '03-receipt-detail')
    await alice.getByTestId('tab-turtle').click()
    const ttl = await alice.getByTestId('raw-turtle').innerText()
    expect(ttl).toContain('a schema:Invoice')
    expect(ttl).toContain('Kitchen faucet replacement')
    expect(ttl).not.toMatch(/\d{13,}/) // no card number anywhere
    await snap(alice, '04-raw-turtle')
    await alice.keyboard.press('Escape')
    await alice.getByTestId('clear').click()
    await alice.waitForFunction(() => document.querySelectorAll('[data-testid=receipt-row]').length === 20)

    await alice.getByTestId('category-row').filter({ hasText: 'Pharmacy' }).click()
    await alice.waitForFunction(() => document.querySelectorAll('[data-testid=receipt-row]').length === 6)
    await snap(alice, '05-filtered-pharmacy')
    await alice.getByTestId('clear').click()
    await alice.waitForFunction(() => document.querySelectorAll('[data-testid=receipt-row]').length === 20)
  })

  it('exports CSV and the raw RDF zip', async () => {
    await alice.getByTestId('tab-export').click()
    await alice.getByTestId('export-summary').waitFor()
    await snap(alice, '06-export')
    const [csv] = await Promise.all([alice.waitForEvent('download'), alice.getByTestId('export-csv').click()])
    const csvText = fs.readFileSync((await csv.path())!, 'utf8')
    expect(csvText.trim().split('\r\n').length).toBe(21)
    expect(csvText).toContain('Bayview Family Clinic')
    const [zip] = await Promise.all([alice.waitForEvent('download'), alice.getByTestId('export-zip').click()])
    const bytes = fs.readFileSync((await zip.path())!)
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
    expect(bytes.readUInt16LE(bytes.length - 22 + 10)).toBe(21) // README plus 20 receipts
    await alice.getByTestId('tab-receipts').click()
  })

  it('a business issues a receipt from the console, cannot read it back, and it lands in alice\'s wallet live', async () => {
    await biz.goto(APP)
    await biz.getByTestId('login').waitFor()
    await logIn(biz, 'PRACTITIONER')
    await biz.getByTestId('mode-console').click({ timeout: 60_000 })
    await biz.getByTestId('console-name').waitFor({ timeout: 60_000 })
    expect(await biz.getByTestId('customer').inputValue()).toContain(`~${process.env.DW_ALICE_USER}/`)
    await biz.getByTestId('preset-1').click()
    await snap(biz, '07-console')
    await biz.getByTestId('send').click()
    await biz.getByTestId('sent').waitFor({ timeout: 60_000 })
    await biz.getByTestId('readback').click()
    await biz.getByTestId('readback-result').filter({ hasText: '403' }).waitFor()
    await snap(biz, '08-console-delivered')

    // alice's open wallet polls the inbox, files the receipt and tells her
    await alice.bringToFront() // a backgrounded tab pauses polling, as a real one does
    await alice.getByText(/New receipt from/).waitFor({ timeout: 45_000 })
    await alice.waitForFunction(() => document.querySelectorAll('[data-testid=receipt-row]').length === 21)
    await snap(alice, '09-new-receipt-toast')

    // the protocol level facts, as the business
    const { s, store } = await agent('PRACTITIONER')
    const probe = await store.post(inboxOf('dw-practitioner'), '<#a> a <http://schema.org/Thing> .', { slug: 'e2e-probe.ttl' })
    expect((await s.fetch(probe)).status).toBe(403) // cannot read
    expect((await s.fetch(inboxOf('dw-practitioner'))).status).toBe(403) // cannot list
    expect((await s.fetch(probe, { method: 'DELETE' })).status).toBe(403) // cannot delete
    expect((await s.fetch(probe, { method: 'PUT', headers: { 'Content-Type': 'text/turtle' }, body: '<#a> a <http://schema.org/Thing> .' })).status).toBe(403) // cannot overwrite
    expect((await s.fetch(inboxOf('dw-bob'), { method: 'POST', headers: { 'Content-Type': 'text/turtle', Slug: 'x.ttl' }, body: '<#a> a <http://schema.org/Thing> .' })).status).toBe(403) // not another business's inbox
    expect((await s.fetch(`${aliceStorage}skpods/v1/receipts/archive/`)).status).toBe(403)
    // alice cleans the probe up (and the wallet ignores non-receipts meanwhile)
    const a = await agent('ALICE')
    await a.store.delete(probe)
  })

  it('switch provider: alice stops the clinic, it is refused, her old receipts stay', async () => {
    await alice.getByTestId('tab-businesses').click()
    const card = alice.locator('[data-testid=business-card][data-business=dw-practitioner]')
    await card.waitFor()
    await card.getByTestId('rights').filter({ hasText: 'append (POST) only' }).waitFor({ timeout: 30_000 })
    const kept = Number(await card.getByTestId('biz-count').innerText())
    expect(kept).toBe(6)
    await snap(alice, '10-businesses')
    await card.getByTestId('stop').click()
    await alice.getByTestId('keep-count').waitFor()
    await snap(alice, '11-switch-provider')
    await alice.getByTestId('confirm-stop').click()
    await card.getByTestId('status').filter({ hasText: 'Stopped' }).waitFor({ timeout: 30_000 })
    expect(Number(await card.getByTestId('biz-count').innerText())).toBe(kept)

    // the business now gets 403 on delivery, through the console
    await biz.getByTestId('send').click()
    await biz.getByText(/refused this delivery \(403\)/).waitFor({ timeout: 30_000 })
    await snap(biz, '12-console-refused')

    // the old receipts are still there
    const { store } = await agent('ALICE')
    expect((await store.list(archiveOf('dw-practitioner'))).length).toBe(6)
    await alice.getByTestId('tab-receipts').click()
    expect(await alice.getByTestId('receipt-row').count()).toBe(21)

    // and she can allow them again
    await alice.getByTestId('tab-businesses').click()
    await card.getByTestId('resume').click()
    await card.getByTestId('status').filter({ hasText: 'Can deliver receipts' }).waitFor({ timeout: 30_000 })
  })

  it('phone width works', async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })
    const p = await phone.newPage()
    await p.goto(APP)
    await logIn(p, 'ALICE')
    await p.getByTestId('receipt-row').first().waitFor({ timeout: 60_000 })
    await snap(p, '13-phone-timeline')
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await p.getByTestId('receipt-row').first().click()
    await p.getByTestId('detail').waitFor()
    await snap(p, '14-phone-detail')
    await phone.close()
  })
})
