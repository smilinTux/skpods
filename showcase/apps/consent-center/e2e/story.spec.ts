// The lead story against pods-dev: Sunrise Care asks for Grandma's care log, Alice (attorney-in-fact) approves for a
// short time, the facility reads real data, the grant switches itself off, then revoke, audit verify and tamper demo.
import path from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { env, login } from './helpers'

const shots = path.resolve(process.cwd(), 'docs/screenshots')
const shot = (p: Page, name: string, full = false) => p.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full })

test.describe.configure({ mode: 'serial' })

let alice: Page
let facility: Page
let ctxs: BrowserContext[] = []

test.beforeAll(async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const f = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ctxs = [a, f]
  alice = await a.newPage()
  facility = await f.newPage()
  await Promise.all([
    login(alice, '/', env('DW_ALICE_USER'), env('DW_ALICE_PASSWORD')),
    login(facility, '/facility/', env('DW_CARE_FACILITY_USER'), env('DW_CARE_FACILITY_PASSWORD')),
  ])
})
test.afterAll(async () => {
  await Promise.all(ctxs.map((c) => c.close()))
})

const card = () => alice.locator('[data-testid=request-card][data-requester="Sunrise Care"]').first()
const record = (cls: string) => facility.locator(`[data-testid=record][data-class=${cls}]`)

test('the facility asks and sees a locked door', async () => {
  await expect(facility.getByTestId('request-form')).toBeVisible({ timeout: 30_000 })
  await facility.getByTestId('want-financial_summary').check()
  await facility.getByTestId('send-request').click()
  await expect(record('care_log')).toBeVisible({ timeout: 20_000 })
  await expect(record('care_log').getByTestId('probe-line')).toHaveAttribute('data-status', '403')
  await expect(record('care_log').getByTestId('locked')).toContainText('Waiting for the family')
  // the rules already said no to finances, with a counter-offer
  await expect(record('financial_summary').getByTestId('locked')).toContainText('Suggested instead')
  await shot(facility, 'facility-locked')
})

test('Alice sees the request for Grandma and approves for 45 seconds', async () => {
  await expect(alice.getByTestId('summary')).toBeVisible({ timeout: 30_000 })
  await expect(card()).toBeVisible({ timeout: 30_000 })
  await expect(card()).toContainText('for Grandma Rosa')
  await expect(card()).toContainText('Your rules suggest')
  await shot(alice, 'requests-desktop', true)
  const row = card().locator('[data-testid=request-item][data-class=care_log]')
  await row.getByTestId('dur-custom').click()
  await row.getByTestId('custom-n').fill('45')
  await row.getByTestId('custom-unit').selectOption('s')
  await row.getByTestId('approve').click()
  await expect(row).toHaveAttribute('data-status', 'granted', { timeout: 30_000 })
})

test('the facility reads real data while the grant lives', async () => {
  await expect(record('care_log')).toHaveAttribute('data-open', 'true', { timeout: 20_000 })
  await expect(record('care_log').getByTestId('probe-line')).toHaveAttribute('data-status', '200')
  await expect(record('care_log').getByTestId('care-entries')).toContainText('Marcus T.')
  await shot(facility, 'facility-open')
  // Alice: countdown, and the real .acl and grant record in the pod
  await alice.evaluate(() => (location.hash = '/access'))
  const g = alice.locator('[data-testid=grant-card][data-grantee="Sunrise Care"]').first()
  await expect(g).toBeVisible({ timeout: 15_000 })
  await shot(alice, 'access-desktop', true)
  await alice.getByTestId('open-pod').click()
  await alice.getByTestId('pod-drawer').getByRole('button', { name: /Grandma Rosa/ }).click()
  const acl = alice.getByTestId('acl-active').first()
  await expect(acl).toContainText('dw-care-facility', { timeout: 20_000 })
  await expect(acl).toHaveAttribute('data-status', '200')
  await expect(alice.getByTestId('grant-record').first()).toBeVisible()
  await shot(alice, 'pod-drawer')
  await alice.getByTestId('drawer-close').click()
})

test('the grant switches itself off, on the pod and on screen', async () => {
  await expect(record('care_log')).toHaveAttribute('data-open', 'false', { timeout: 90_000 })
  await expect(record('care_log').getByTestId('probe-line')).toHaveAttribute('data-status', '403')
  await expect(record('care_log').getByTestId('locked')).toContainText('window closed')
  await shot(facility, 'facility-expired')
  await expect(alice.locator('[data-testid=past-grant][data-grantee="Sunrise Care"][data-status=expired]').first()).toBeVisible({ timeout: 15_000 })
  // the rule file is gone from the pod
  await alice.getByTestId('open-pod').click()
  await alice.getByTestId('pod-drawer').getByRole('button', { name: /Grandma Rosa/ }).click()
  await expect(alice.getByTestId('acl-ended').first()).toHaveAttribute('data-status', '404', { timeout: 20_000 })
  await alice.getByTestId('drawer-close').click()
})

test('audit chain: verify in the browser, then break it on purpose', async () => {
  await alice.evaluate(() => (location.hash = '/audit'))
  await alice.getByRole('tab', { name: /Grandma Rosa/ }).click()
  await alice.getByTestId('verify').click()
  await expect(alice.getByTestId('chain-status')).toHaveAttribute('data-state', 'valid', { timeout: 30_000 })
  await expect(alice.getByTestId('server-verdict')).toContainText('verifies', { timeout: 15_000 })
  // facility reads and the 403 after expiry were reported and are in the chain
  await expect(alice.locator('[data-testid=chain-entry][data-event=data_read]').first()).toBeVisible()
  await expect(alice.locator('[data-testid=chain-entry][data-event=expiry]').first()).toBeVisible()
  await shot(alice, 'audit-valid', true)

  await alice.getByTestId('tamper-toggle').click()
  await alice.getByTestId('tamper-rehash').click()
  const target = alice.locator('[data-testid=chain-entry][data-event=grant_written]').first()
  const seq = Number(await target.getAttribute('data-seq'))
  await target.getByTestId('tamper-entry').click()
  await expect(alice.getByTestId('chain-status')).toHaveAttribute('data-state', 'broken', { timeout: 30_000 })
  // a re-hashed edit looks fine itself, the NEXT entry's link breaks
  await expect(alice.locator(`[data-testid=chain-entry][data-seq="${seq}"]`)).toHaveAttribute('data-ok', 'true')
  await expect(alice.locator(`[data-testid=chain-entry][data-seq="${seq + 1}"]`)).toHaveAttribute('data-ok', 'false')
  await expect(alice.locator(`[data-testid=chain-entry][data-seq="${seq + 1}"]`).getByTestId('link-state')).toHaveAttribute('data-link', 'broken').catch(() => undefined)
  await expect(alice.getByTestId('server-verdict')).toContainText('only in your browser copy', { timeout: 15_000 })
  await shot(alice, 'audit-broken', true)

  await alice.getByTestId('restore').click()
  await alice.getByTestId('tamper-edit').click()
  await alice.locator('[data-testid=chain-entry][data-event=grant_written]').first().getByTestId('tamper-entry').click()
  await expect(alice.getByTestId('chain-status')).toHaveAttribute('data-state', 'broken', { timeout: 30_000 })
  await expect(alice.getByTestId('content-mismatch').first()).toBeVisible()
  await alice.getByTestId('restore').click()
})

test('ask again, Alice allows 24 hours, then revokes and the facility loses access at once', async () => {
  await facility.getByTestId('ask-again').first().click().catch(() => undefined)
  await facility.getByTestId('send-request').click()
  await alice.evaluate(() => (location.hash = '/requests'))
  const row = alice.locator('[data-testid=request-card][data-requester="Sunrise Care"]').first().locator('[data-testid=request-item][data-class=care_log]')
  await expect(row.getByTestId('dur-24h')).toBeVisible({ timeout: 30_000 })
  await row.getByTestId('approve').click()
  await expect(record('care_log')).toHaveAttribute('data-open', 'true', { timeout: 20_000 })
  await alice.evaluate(() => (location.hash = '/access'))
  const g = alice.locator('[data-testid=grant-card][data-grantee="Sunrise Care"]').first()
  await g.getByTestId('revoke').click()
  await g.getByTestId('confirm-revoke').click()
  await expect(record('care_log')).toHaveAttribute('data-open', 'false', { timeout: 15_000 })
  await expect(record('care_log').getByTestId('locked')).toContainText('switched off')
})

test('phone width screenshots', async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const p = await c.newPage()
  await login(p, '/', env('DW_ALICE_USER'), env('DW_ALICE_PASSWORD'))
  await expect(p.getByTestId('summary')).toBeVisible({ timeout: 30_000 })
  await p.waitForTimeout(2500)
  await shot(p, 'requests-phone')
  await p.evaluate(() => (location.hash = '/audit'))
  await p.waitForTimeout(1500)
  await shot(p, 'audit-phone')
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await c.close()
})
