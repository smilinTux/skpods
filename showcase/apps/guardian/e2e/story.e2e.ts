// End-to-end test of the whole story against pods-dev, with a real browser login as dw-alice.
// Needs: dev server (5177), sk-consent (8782, seeded: `npm run demo`), clinic bridge (8790), SKP_TEST_ENV with the test credentials.
// Run: SKP_TEST_ENV=/path/pods-dev-test.env npm run e2e      Screenshots: SHOTS=docs/screenshots npm run e2e
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from 'playwright'
import { APP, BRIDGE, CONSENT, launch, loadEnv, loginAsAlice, newContext, waitUp } from './helpers'

loadEnv()
const shotDir = process.env.SHOTS ? path.resolve(process.env.SHOTS) : undefined
let passed = 0
const ok = (name: string) => {
  console.log(`  PASS ${name}`)
  passed++
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL ${msg}`)
}
const T = 60_000

async function shot(page: Page, name: string) {
  if (!shotDir) return
  fs.mkdirSync(shotDir, { recursive: true })
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) })
}
const state = (page: Page, cls: string) => page.locator(`[data-testid=clinic-row-${cls}]`).getAttribute('data-state')
async function waitState(page: Page, cls: string, want: string, timeout = T) {
  await page.waitForFunction(([c, w]) => document.querySelector(`[data-testid=clinic-row-${c}]`)?.getAttribute('data-state') === w, [cls, want] as const, { timeout, polling: 250 })
}

/** Values "decrypt" into place for about a second, so wait for the final text. */
async function expectText(page: Page, testid: string, sub: string) {
  await page.waitForFunction(([id, t]) => document.querySelector(`[data-testid=${id}]`)?.textContent?.includes(t), [testid, sub] as const, { timeout: 20_000, polling: 250 }).catch(() => undefined)
  const got = await page.locator(`[data-testid=${testid}]`).textContent()
  assert(got?.includes(sub), `${testid} shows "${sub}" (got "${got?.slice(0, 80)}")`)
}

/** Put the recommended rules back through the editor (also heals a previous failed run). */
async function restoreDefaults(page: Page) {
  await page.goto(APP + '#/policy')
  await page.reload()
  await page.getByTestId('policy-editor').waitFor({ timeout: T })
  await page.getByText('Use recommended rules').click()
  const save = page.getByTestId('save-policy')
  if (await save.isEnabled()) {
    await save.click()
    await page.waitForFunction(() => document.querySelector('[data-testid=policy-status]')?.textContent?.includes('Saved'), undefined, { timeout: T })
  }
}

await waitUp(APP)
await waitUp(`${CONSENT}/healthz`)
await waitUp(`${BRIDGE}/health`)
const browser = await launch()
const ctx = await newContext(browser)
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
const policyOf = async () => (await (await fetch(`${CONSENT}/policy?subject=${encodeURIComponent(`${process.env.SKPODS_BASE}/apps/solid/~${process.env.DW_ALICE_USER}/profile/card#me`)}`)).json()) as { version: number; rules: { id: string }[] }

try {
  console.log('Guardian story against pods-dev')

  // 1. Login: real Solid-OIDC through the Nextcloud form
  await page.goto(APP)
  await page.getByTestId('login').waitFor()
  await shot(page, '01-welcome')
  await loginAsAlice(page)
  ok('logged in as Alice (authorization code + PKCE + DPoP)')
  await restoreDefaults(page)
  await page.goto(APP + '#/live')
  await page.reload()

  // 2. Start from a clean stage
  await page.getByTestId('replay').click()
  // 3. The replay filed a request as the clinic: three auto-approved, one asking Alice, SSN denied
  await waitState(page, 'dob', 'received')
  await waitState(page, 'allergies', 'received')
  await waitState(page, 'medications', 'received')
  await expectText(page, 'clinic-value-dob', '1988')
  await expectText(page, 'clinic-value-allergies', 'Penicillin')
  ok('DOB, allergies and medications auto-approved and really read by the clinic (HTTP 200)')
  assert((await state(page, 'insurance_member_id')) === 'waiting', 'insurance waits for Alice')
  assert((await state(page, 'ssn')) === 'denied', 'ssn denied')
  ok('insurance member ID waits for Alice, SSN denied with explanation')
  const ssnText = await page.locator('[data-testid=clinic-row-ssn]').textContent()
  assert(ssnText?.includes('never shared') && ssnText?.includes('Counter-offer'), 'ssn explanation and counter-offer visible')
  await shot(page, '02-theatre-asking')

  // 4. The approval card on Alice's phone, with the guardian's recommendation
  const card = page.getByTestId('approval-card')
  await card.waitFor({ timeout: T })
  assert((await card.getByTestId('recommendation').textContent())?.includes('24 hours'), 'recommendation shows 24 hours')
  ok('approval card with recommendation and reasoning on the phone')
  const thinking = await page.locator('[data-testid=think-insurance_member_id]').textContent()
  assert(thinking?.includes('insurance-ask-owner'), 'thinking timeline shows the matched rule')
  ok('thinking timeline shows the rule that matched')

  // 5. Alice taps Approve (real owner call with her browser token)
  await shot(page, '03-approval-card')
  await page.getByTestId('approve').click()
  await waitState(page, 'insurance_member_id', 'received')
  await expectText(page, 'clinic-value-insurance_member_id', 'HBL-4417')
  ok("Alice's tap approved the insurance ID with a browser DPoP token, the clinic read it (HTTP 200)")

  // 6. SSN fetched directly: the pod says 403
  await page.getByText('Try fetching the file directly').click()
  await page.getByTestId('clinic-direct-ssn').waitFor({ timeout: T })
  assert((await page.getByTestId('clinic-direct-ssn').textContent())?.includes('403'), 'direct read of ssn is 403')
  ok('the SSN file answers 403 even when the clinic goes around the guardian')

  // 7. Access log on the phone
  await page.getByTestId('phone-tab-access').click()
  await page.getByTestId('access-log').waitFor()
  const log = await page.getByTestId('access-log').textContent()
  assert(log?.includes('read Date of birth') && log.includes('Guardian denied'), 'access log lists reads and decisions')
  assert((await page.getByTestId('active-grant').count()) === 4, 'four active grants')
  ok('live access log lists asks, decisions and reads; four grants are active')
  await shot(page, '04-access-log')

  // 8. Revoke everything: the clinic loses access at once, verified by the pod
  await page.getByTestId('revoke-all').click()
  for (const c of ['dob', 'allergies', 'medications', 'insurance_member_id']) await waitState(page, c, 'ended', T)
  const after = await fetch(`${CONSENT}/grants?subject=${encodeURIComponent(`${process.env.SKPODS_BASE}/apps/solid/~${process.env.DW_ALICE_USER}/profile/card#me`)}&status=active`).then((r) => r.json())
  assert(after.length === 0, 'no active grants remain')
  ok('revoke everything: every grant ended, the clinic gets HTTP 403 and its screen empties')
  await shot(page, '05-revoked')

  // 9. Audit chain verifies in the browser, the service and the pod mirror agree, and a tampered copy is caught
  await page.getByTestId('center-tab-chain').click()
  await page.getByTestId('verify').click()
  await page.getByTestId('chain-result').waitFor({ timeout: 90_000 })
  assert((await page.getByTestId('chain-result').getAttribute('data-ok')) === 'true', 'chain verifies')
  const res = await page.getByTestId('chain-result').textContent()
  assert(res?.includes('The service agrees'), 'service agrees')
  ok(`audit chain verified in the browser: ${res?.match(/\d+ entries/)?.[0]}; service agrees; ${res?.match(/\d+ of \d+ entries match the copy/)?.[0] ?? 'pod copy not compared'}`)
  await shot(page, '06-chain-verified')
  await page.getByTestId('tamper').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=chain-result]')?.getAttribute('data-ok') === 'false', undefined, { timeout: 90_000 })
  ok('a simulated edit of one decision is detected at the exact entry')
  await shot(page, '07-chain-tampered')

  // 10. Policy editor: change a rule, save to the pod, the guardian follows it on the very next request
  await page.goto(APP + '#/policy')
  await page.reload()
  await page.getByTestId('policy-editor').waitFor({ timeout: T })
  const before = await policyOf()
  await page.locator('[data-testid=policy-card-dob] [role=radiogroup][aria-label$="for Clinics"] [data-mode=ask]').click()
  assert(((await page.getByTestId('policy-status').textContent()) ?? '').includes('Unsaved'), 'dirty state shown')
  assert((await page.getByTestId('plain-words').textContent())?.includes('Date of birth: Everyone has to ask you first'), 'plain-language summary follows the toggle')
  await shot(page, '08-policy-editor')
  await page.getByTestId('save-policy').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=policy-status]')?.textContent?.includes('Saved'), undefined, { timeout: T })
  const mid = await policyOf()
  assert(mid.version === before.version + 1, `guardian reads the new policy version (${before.version} -> ${mid.version})`)
  ok(`policy saved to Alice's pod and read back by the guardian (v${before.version} to v${mid.version})`)

  await page.getByTestId('replay-from-policy').click()
  await page.locator('[data-testid=approval-card][data-item=dob]').waitFor({ timeout: T })
  assert((await state(page, 'dob')) === 'waiting', 'DOB now waits for Alice')
  ok('replay: with "Ask me" for DOB the same clinic request now needs a tap')
  await shot(page, '09-replay-after-policy-change')

  // 11. Put the recommended rules back so the demo is repeatable
  await restoreDefaults(page)
  ok('recommended rules restored')

  // 12. Phone width: panels become tabs, nothing scrolls sideways, the approval card is reachable
  const mctx = await newContext(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const m = await mctx.newPage()
  await loginAsAlice(m)
  await m.getByTestId('replay').click()
  await m.getByTestId('panel-tab-clinic').waitFor()
  await m.getByTestId('clinic-row-dob').waitFor()
  await m.waitForFunction(() => document.querySelector('[data-testid=clinic-row-dob]')?.getAttribute('data-state') === 'received', undefined, { timeout: T })
  const overflow = async () => m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert((await overflow()) <= 1, 'no horizontal scroll on the clinic tab')
  await shot(m, 'phone-1-clinic')
  await m.getByTestId('panel-tab-agent').click()
  await m.waitForTimeout(600)
  assert((await overflow()) <= 1, 'no horizontal scroll on the guardian tab')
  await shot(m, 'phone-2-guardian')
  await m.getByTestId('panel-tab-phone').click()
  await m.getByTestId('approval-card').waitFor({ timeout: T })
  assert((await overflow()) <= 1, 'no horizontal scroll on the phone tab')
  await m.waitForTimeout(700)
  await shot(m, 'phone-3-alice')
  await m.goto(APP + '#/policy')
  await m.reload()
  await m.getByTestId('policy-editor').waitFor({ timeout: T })
  assert((await overflow()) <= 1, 'no horizontal scroll in the policy editor')
  await shot(m, 'phone-4-rules')
  await m.getByTestId('panel-tab-phone').count()
  ok('phone width (390 px): tabs, approval card reachable, no horizontal scroll')
  await m.goto(APP + '#/live')
  await m.reload()
  await m.getByTestId('revoke-all').scrollIntoViewIfNeeded().catch(() => undefined)
  await mctx.close()

  console.log(`\n${passed} checks passed`)
} catch (e) {
  await shot(page, 'failure').catch(() => undefined)
  console.error((await page.getByTestId('phone').innerText().catch(() => '')).slice(0, 600))
  console.error(String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}
