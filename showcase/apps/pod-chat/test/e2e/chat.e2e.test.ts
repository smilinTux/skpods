// The Pod Chat story in real browsers against pods-dev: Alice and Bob each log in through the Nextcloud form,
// chat in each other's pods, and Alice leaves and rejoins. Screenshots land in docs/screenshots.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureAuthorised, launch, loginAs as login } from '../../scripts/browser'
import { actor, haveEnv, type Actor } from '../../scripts/env'
import { drawingPng } from '../../scripts/png'
import { cleanTestChats, seedDemo } from '../../scripts/seed'
import { classify, nameOf } from '../../src/lib/codec'
import { convUrl, inboxUrl } from '../../src/lib/paths'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '../..')
const APP = 'http://localhost:5176/'
const shots = process.env.SKP_SHOT_DIR ?? path.join(appDir, 'docs/screenshots')
const run = Math.random().toString(36).slice(2, 7)
const WAIT = { timeout: 60_000 }
const POLL = WAIT

async function waitFor(url: string, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`dev server did not start at ${url}`)
}

const loginAs = (page: Page, who: string) => login(page, who)

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(900) // let entry animations settle
  fs.mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, `${name}.png`) })
}
/** On a timeout, print what the app thinks of each participant's pod: far more useful than "locator not found". */
async function dump(page: Page, id: string) {
  const state = await page.evaluate((cid) => {
    const e = (window as unknown as { __podchat?: { get(id: string): { peers: { name: string; status: string; count: number; error?: string }[] } | undefined; live(id: string): unknown } }).__podchat
    return JSON.stringify({ peers: e?.get(cid)?.peers.map((p) => [p.name, p.status, p.count, p.error]), live: e?.live(cid), hidden: document.hidden })
  }, id)
  console.log('STATE', state)
}
const bubbles = (page: Page) => page.getByTestId('message')
const bubble = (page: Page, text: string) => page.getByTestId('message').filter({ hasText: text })
/** The clickable bubble itself: the message row spans the whole width, its centre is empty space. */
const bubbleBtn = (page: Page, text: string) => bubble(page, text).locator('button').first()

describe.skipIf(!haveEnv)('Pod Chat in the browser', () => {
  let server: ChildProcess | undefined
  let browser: Browser
  let ctxA: BrowserContext, ctxB: BrowserContext
  let pa: Page, pb: Page
  let A: Actor, B: Actor
  let convId = ''
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'podchat-e2e-'))

  beforeAll(async () => {
    ;[A, B] = await Promise.all([actor('alice'), actor('bob')])
    await seedDemo()
    let reuse = false
    try { reuse = (await fetch(APP)).ok } catch { /* start our own */ }
    if (!reuse) {
      server = spawn(path.join(appDir, '../../node_modules/.bin/vite'), ['--port', '5176', '--strictPort'], { cwd: appDir, stdio: 'ignore' })
      await waitFor(APP)
    }
    await ensureAuthorised(['alice', 'bob', 'kid', 'practitioner', 'grandma']) // each pod must have trusted the app origin once, see scripts/browser.ts
    browser = await launch()
    ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    pa = await ctxA.newPage()
    pb = await ctxB.newPage()
  })

  afterAll(async () => {
    await browser?.close()
    server?.kill()
    fs.rmSync(tmp, { recursive: true, force: true })
    for (const a of [A, B]) {
      for (const e of await a.store.list(`${a.root}skpods/v1/chat/`).catch(() => [])) {
        const id = nameOf(e.url)
        if (convId && id === convId) await a.store.deleteRecursive(e.url).catch(() => {})
      }
      for (const e of await a.store.list(inboxUrl(a.root)).catch(() => [])) if (convId && e.url.includes(convId)) await a.store.delete(e.url).catch(() => {})
    }
  })

  it('Alice logs in with the Nextcloud form and sees the seeded family chat with history', async () => {
    await loginAs(pa, 'alice')
    const row = pa.getByTestId('conv-row').filter({ hasText: 'Rivera family' })
    await row.waitFor(WAIT)
    await expect.poll(() => row.getByTestId('unread').innerText(), WAIT).toBe('1') // Sam's newest message
    await shot(pa, 'desktop-list')
    await row.click()
    await bubble(pa, 'Seventy five').waitFor(WAIT)
    await bubble(pa, 'Yesss pizza').waitFor(WAIT)
    expect(await bubbles(pa).count()).toBeGreaterThanOrEqual(26)
    await pa.getByTestId('live-badge').filter({ hasText: 'Live' }).waitFor(WAIT)
    await pa.getByTestId('timeline').locator('img').first().waitFor(WAIT) // Sam's drawing, fetched with the DPoP token
    await expect.poll(() => (pa.getByTestId('unread')).count(), WAIT).toBe(0) // opening the chat read it
    await pa.waitForTimeout(800)
    await shot(pa, 'desktop-family')
  })

  it('shows where every message lives: the pod view and the people panel', async () => {
    await pa.getByTestId('info-toggle').click()
    const rows = pa.getByTestId('peer-row')
    await rows.first().waitFor(WAIT)
    await expect.poll(() => (rows).count(), WAIT).toBe(3)
    await pa.getByTestId('pod-view').click()
    await pa.getByTestId('pod-tag').filter({ hasText: '~dw-bob' }).first().waitFor(WAIT)
    await pa.getByTestId('pod-tag').filter({ hasText: '~dw-alice' }).first().waitFor(WAIT)
    await shot(pa, 'desktop-pod-view')
    await pa.getByTestId('pod-view').click()
    await pa.getByTestId('info-toggle').click()
  })

  it('phone layout: list, chat and info are single screens', async () => {
    await pa.setViewportSize({ width: 390, height: 844 })
    await pa.getByTestId('back').click()
    await pa.getByTestId('conversation-list').waitFor()
    await shot(pa, 'phone-list')
    await pa.getByTestId('conv-row').filter({ hasText: 'Rivera family' }).click()
    await bubble(pa, 'Yesss pizza').waitFor(WAIT)
    await shot(pa, 'phone-chat')
    await pa.getByTestId('info-toggle').click()
    await pa.getByTestId('peer-row').first().waitFor()
    await shot(pa, 'phone-info')
    await pa.getByRole('button', { name: 'Close info' }).click()
    await pa.getByTestId('back').click()
    await pa.setViewportSize({ width: 1280, height: 800 })
  })

  it('Alice starts a chat with Bob; the message is a file in Alice\'s pod', async () => {
    await pa.getByTestId('new-chat').click()
    await pa.getByTestId('contact').filter({ hasText: 'Bob Rivera' }).click()
    await pa.getByTestId('start-chat').click()
    await pa.getByTestId('chat-title').filter({ hasText: 'Bob Rivera' }).waitFor(WAIT)
    convId = decodeURIComponent(new URL(pa.url()).hash.replace('#/c/', ''))
    expect(convId).toMatch(/^c-/)
    await pa.getByTestId('empty-chat').waitFor()
    await pa.getByTestId('composer').fill(`Hello Bob ${run}`)
    await pa.getByTestId('composer').press('Enter')
    await bubble(pa, `Hello Bob ${run}`).waitFor(WAIT)
    await expect.poll(async () => (await A.store.list(convUrl(A.root, convId))).filter((e) => classify(nameOf(e.url)).kind === 'message').length, { timeout: 30_000 }).toBe(1)
    expect((await B.store.list(convUrl(B.root, convId))).length).toBe(0) // nothing of it in Bob's pod
  })

  it('Bob sees the invitation, joins, and receives the message from Alice\'s pod', async () => {
    await loginAs(pb, 'bob')
    const inv = pb.getByTestId('invitation').filter({ hasText: 'wants to chat with you' })
    await inv.waitFor(WAIT)
    await shot(pb, 'desktop-invitation')
    await inv.getByTestId('invite-join').click()
    await pb.getByTestId('chat-title').filter({ hasText: 'Alice Rivera' }).waitFor(WAIT)
    await bubble(pb, `Hello Bob ${run}`).waitFor(WAIT)
    // Bob's side now has his own container, mirror and ACL
    expect((await B.store.list(convUrl(B.root, convId))).map((e) => nameOf(e.url))).toContain('conversation.ttl')
  })

  it('live updates both ways, read receipts, edit and delete', async () => {
    await pb.getByTestId('composer').fill(`Hi Alice ${run}, got it`)
    await pb.getByTestId('composer').press('Enter')
    await bubble(pa, `Hi Alice ${run}`).waitFor(WAIT).catch(async (e) => { await dump(pa, convId); throw e }) // Alice's polling picks it up from Bob's pod
    await pa.getByTestId('seen-by').waitFor(WAIT) // Bob's tiny read receipt, from Bob's pod
    // photo from Alice
    const png = path.join(tmp, 'pic.png')
    fs.writeFileSync(png, drawingPng(320, 210))
    await pa.getByTestId('attach-input').setInputFiles(png)
    await pa.getByTestId('composer').fill(`Our house ${run}`)
    await pa.getByTestId('send').click()
    await bubble(pa, `Our house ${run}`).waitFor(WAIT)
    const bobPhoto = bubble(pb, `Our house ${run}`).locator('img')
    await bobPhoto.waitFor(WAIT)
    await expect.poll(() => bobPhoto.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 30_000 }).toBe(true)
    await shot(pb, 'desktop-photo')
    // edit
    await bubbleBtn(pa, `Hello Bob ${run}`).click()
    await pa.getByTestId('edit').click()
    await pa.getByTestId('composer').fill(`Hello Bob ${run}, are you free tonight?`)
    await pa.getByTestId('composer').press('Enter')
    await bubble(pb, `are you free tonight?`).waitFor(WAIT)
    await pb.getByTestId('edited').first().waitFor(WAIT)
    // delete
    await bubbleBtn(pa, `Hello Bob ${run}`).click()
    await pa.getByTestId('delete').click()
    await pa.getByTestId('delete-confirm').click()
    await pb.getByTestId('ghost-deleted').waitFor(WAIT)
    await expect.poll(() => (bubble(pb, `Hello Bob ${run}`)).count(), WAIT).toBe(0)
  })

  it('Alice leaves: access is revoked and her messages dissolve on Bob\'s screen; rejoin brings them back', async () => {
    await pa.getByTestId('info-toggle').click()
    await pa.getByTestId('leave').click()
    await pa.getByTestId('leave-dialog').waitFor()
    await shot(pa, 'desktop-leave-dialog')
    await pa.getByTestId('leave-confirm').click()
    await pa.getByTestId('left-banner').waitFor(WAIT)
    // the pod itself now refuses Bob
    expect((await B.store.request(convUrl(A.root, convId))).status).toBe(403)
    await pb.getByTestId('system-left').waitFor(WAIT).catch(async (e) => { await dump(pb, convId); throw e })
    await pb.getByTestId('ghost-hidden').first().waitFor(WAIT)
    await expect.poll(() => (bubble(pb, `Our house ${run}`)).count(), WAIT).toBe(0)
    await expect.poll(() => (bubble(pb, `Hi Alice ${run}`)).count(), WAIT).toBe(1) // Bob's own words stay
    await shot(pb, 'desktop-after-leave')
    await shot(pa, 'desktop-left')
    // rejoin
    await pa.getByTestId('rejoin-banner').click()
    await pa.getByTestId('left-banner').waitFor({ state: 'detached', ...WAIT })
    await bubble(pb, `Our house ${run}`).waitFor(WAIT)
    await expect.poll(() => (pb.getByTestId('ghost-hidden')).count(), WAIT).toBe(0)
    expect((await B.store.request(convUrl(A.root, convId))).status).toBe(200)
    await shot(pb, 'desktop-rejoined')
  })

  it('dark theme and phone width of Bob\'s chat', async () => {
    await pb.setViewportSize({ width: 390, height: 844 })
    await pb.evaluate(() => { document.documentElement.dataset.theme = 'dark' }) // the theme toggle lives in the chat list header
    await shot(pb, 'phone-chat-dark')
  })
})
