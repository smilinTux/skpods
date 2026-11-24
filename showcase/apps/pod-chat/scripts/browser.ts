// Browser helpers for the demo and the e2e test: log in through the Nextcloud forms, and authorise the app origin.
//
// ENGINE BEHAVIOUR (pods-dev): a pod only answers a request that carries `Origin: <app>` when the pod's OWNER has
// authorised that app origin, which happens when the owner signs in to the app once and presses Allow on the
// consent screen. Until then every request for that pod's private data answers 403, even for people the ACL names.
// So a chat only shows Sam's messages to Alice once Sam has used Pod Chat at least once. `ensureAuthorised` does
// that sign-in for the demo cast.
import fs from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'
import { actor } from './env'

export const APP = process.env.POD_CHAT_ORIGIN ?? 'http://localhost:5176/'
const envKey = (who: string) => who.toUpperCase().replace(/-/g, '_')

export function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: process.env.SKP_CHROME ?? (fs.existsSync('/usr/bin/google-chrome-stable') ? '/usr/bin/google-chrome-stable' : undefined), headless: true })
}

export async function loginAs(page: Page, who: string, waitFor: 'list' | 'none' = 'list') {
  await page.goto(APP)
  await page.getByTestId('login').click()
  await page.waitForURL(/\/login/, { timeout: 30_000 })
  await page.fill('input[name=user]', process.env[`DW_${envKey(who)}_USER`]!)
  await page.fill('input[name=password]', process.env[`DW_${envKey(who)}_PASSWORD`]!)
  await page.click('button[type=submit]')
  await page.getByRole('button', { name: 'Allow' }).click({ timeout: 30_000 })
  if (waitFor === 'list') await page.getByTestId('conversation-list').waitFor({ timeout: 45_000 })
}

/** Does this pod accept requests from the app origin yet? The owner asking for their own data is enough to find out. */
export async function originTrusted(who: string): Promise<boolean> {
  const a = await actor(who)
  const r = await a.session.fetch(a.root + 'skpods/v1/chat/', { headers: { Accept: 'text/turtle', Origin: new URL(APP).origin } })
  return r.status !== 403 || false
}

export async function ensureAuthorised(who: string[], log: (s: string) => void = () => {}): Promise<void> {
  const todo: string[] = []
  for (const w of who) if (!(await originTrusted(w))) todo.push(w)
  if (!todo.length) return log('every pod already trusts ' + new URL(APP).origin)
  const browser = await launch()
  try {
    for (const w of todo) {
      const page = await (await browser.newContext()).newPage()
      await loginAs(page, w, 'list')
      await page.close()
      log(`${w}: signed in once, pod now trusts ${new URL(APP).origin} (${(await originTrusted(w)) ? 'verified' : 'NOT verified'})`)
    }
  } finally {
    await browser.close()
  }
}
