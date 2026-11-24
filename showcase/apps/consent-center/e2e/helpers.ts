import type { Page } from '@playwright/test'

export const PODS = (process.env.SKPODS_BASE ?? 'https://pods-dev.skstack01.douno.it').replace(/\/$/, '')

/** Drives the real Nextcloud login form and the consent screen of the Solid-OIDC flow. */
export async function login(page: Page, path: string, user: string, password: string) {
  await page.goto(path)
  await page.getByTestId('login').click()
  await page.waitForURL(/\/login/, { timeout: 30_000 })
  await page.fill('input[name=user]', user)
  await page.fill('input[name=password]', password)
  await page.click('button[type=submit]')
  await page.getByRole('button', { name: 'Allow' }).click({ timeout: 30_000 })
  await page.waitForURL((u) => u.origin === 'http://localhost:5174', { timeout: 30_000 })
}

export const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} is not set (source the test credentials file)`)
  return v
}
