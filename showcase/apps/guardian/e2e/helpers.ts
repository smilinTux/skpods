// Shared Playwright helpers: launch Chrome, log in as dw-alice through the Nextcloud form, wait for services.
import fs from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

export const APP = process.env.GUARDIAN_APP ?? 'http://localhost:5177/'
export const CONSENT = process.env.VITE_CONSENT_URL ?? 'http://127.0.0.1:8782'
export const BRIDGE = process.env.VITE_BRIDGE_URL ?? 'http://127.0.0.1:8790'

export function loadEnv() {
  for (const f of (process.env.SKP_TEST_ENV ?? '').split(':').filter(Boolean)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

export async function launch(): Promise<Browser> {
  const exe = process.env.SKP_CHROME ?? (fs.existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : undefined)
  return chromium.launch({ executablePath: exe, headless: true })
}

export async function waitUp(url: string, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`not reachable: ${url}`)
}

/** Drives the real flow: app login button, Nextcloud login form, consent screen. Credentials come from the environment, never from code. */
export async function loginAsAlice(page: Page) {
  await page.goto(APP)
  await page.getByTestId('login').click()
  await page.waitForURL(/\/login/, { timeout: 30_000 })
  await page.fill('input[name=user]', process.env.DW_ALICE_USER!)
  await page.fill('input[name=password]', process.env.DW_ALICE_PASSWORD!)
  await page.click('button[type=submit]')
  await page.getByRole('button', { name: 'Allow' }).click({ timeout: 30_000 })
  await page.waitForURL((u) => u.origin === new URL(APP).origin, { timeout: 30_000 })
  await page.getByTestId('present').waitFor({ timeout: 30_000 })
}

export async function newContext(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  return browser.newContext({ colorScheme: 'dark', viewport: { width: 1600, height: 900 }, ...opts })
}
