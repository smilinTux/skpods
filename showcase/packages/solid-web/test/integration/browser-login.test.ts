// Real browser login: drives the hello-pod app (Vite dev server) through the Nextcloud login form and consent screen.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE, haveEnv, storeFor, storageOf, webIdOf } from './env'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '../../../../apps/hello-pod')
const APP = 'http://localhost:5173/'
const shots = process.env.SKP_SHOT_DIR

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

async function snap(page: Page, name: string) {
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: path.join(shots, `${name}.png`) })
  }
}

describe.skipIf(!haveEnv)('browser login for dw-alice through the Nextcloud forms', () => {
  let server: ChildProcess | undefined
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    let reuse = false
    try {
      reuse = (await fetch(APP)).ok
    } catch {
      /* start our own */
    }
    if (!reuse) {
      server = spawn(path.join(appDir, '../../node_modules/.bin/vite'), ['--port', '5173', '--strictPort'], { cwd: appDir, stdio: 'ignore' })
      await waitFor(APP)
    }
    browser = await chromium.launch({ executablePath: process.env.SKP_CHROME ?? (fs.existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : undefined), headless: true })
    page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage()
  })
  afterAll(async () => {
    await browser?.close()
    server?.kill()
    // remove what the app wrote
    try {
      await (await storeFor('alice')).deleteRecursive(`${storageOf('alice')}private/hello-pod/`)
    } catch {
      /* nothing written */
    }
  })

  it('logs in (code + PKCE + DPoP), shows WebID and pod root, lists and writes in the private container', async () => {
    await page.goto(APP)
    await page.getByTestId('login').waitFor()
    await snap(page, '01-welcome')
    await page.getByTestId('login').click()

    // Nextcloud login form
    await page.waitForURL(/\/login/, { timeout: 30_000 })
    await page.fill('input[name=user]', process.env.DW_ALICE_USER!)
    await page.fill('input[name=password]', process.env.DW_ALICE_PASSWORD!)
    await snap(page, '02-nextcloud-login')
    await page.click('button[type=submit]')

    // consent screen
    await page.getByRole('button', { name: 'Allow' }).click({ timeout: 30_000 })
    await snap(page, '03-consent').catch(() => {})

    // back in the app, logged in
    await page.getByTestId('webid').waitFor({ timeout: 30_000 })
    expect(await page.getByTestId('webid').innerText()).toBe(webIdOf('alice'))
    await page.getByTestId('pod-root').filter({ hasText: storageOf('alice') }).waitFor({ timeout: 30_000 })
    expect(await page.getByTestId('name').innerText()).toContain('Alice')
    expect(page.url()).toBe(APP) // code and state were removed from the URL
    await page.getByText('Your notes').waitFor()

    // write a resource with the DPoP-bound token and see it listed
    const before = await page.getByTestId('file-row').count()
    await page.getByTestId('write-note').click()
    await page.getByText(/^hello-\d+\.ttl$/).first().waitFor({ timeout: 30_000 })
    expect(await page.getByTestId('file-row').count()).toBeGreaterThan(before)
    await snap(page, '04-logged-in')

    // the resource is really in alice's pod
    const list = await (await storeFor('alice')).list(`${storageOf('alice')}private/hello-pod/`)
    expect(list.some((e) => /hello-\d+\.ttl$/.test(e.url))).toBe(true)
  })

  it('restores the session after a reload without logging in again', async () => {
    await page.reload()
    await page.getByTestId('webid').waitFor({ timeout: 30_000 })
    expect(await page.getByTestId('webid').innerText()).toBe(webIdOf('alice'))
  })

  it('refreshes an expired access token with the refresh token', async () => {
    // age the stored token so the app must refresh before the next request
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('skpods-solid-web', 1)
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction('kv', 'readwrite')
            const st = tx.objectStore('kv')
            const get = st.get('session')
            get.onsuccess = () => {
              const v = get.result
              v.expiresAt = Date.now() - 1000
              st.put(v, 'session')
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          }
          open.onerror = () => reject(open.error)
        }),
    )
    await page.reload()
    await page.getByTestId('webid').waitFor({ timeout: 30_000 })
    await page.getByTestId('pod-root').filter({ hasText: storageOf('alice') }).waitFor({ timeout: 30_000 })
    const exp = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('skpods-solid-web', 1)
          open.onsuccess = () => {
            const g = open.result.transaction('kv').objectStore('kv').get('session')
            g.onsuccess = () => resolve(g.result.expiresAt)
          }
        }),
    )
    expect(exp).toBeGreaterThan(Date.now() + 30 * 60 * 1000)
  })

  it('logs out and forgets the session', async () => {
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.getByTestId('login').waitFor()
    await page.reload()
    await page.getByTestId('login').waitFor()
    expect(BASE).toBeTruthy()
  })
})
