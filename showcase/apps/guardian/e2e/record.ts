// Records presenter mode (the captioned auto-play of the whole story) as a webm in docs/.
// Real run: logs in through the Nextcloud form, then presses "Presenter mode". The login part is cut from the video.
// Needs: dev server on 5177, sk-consent on 8782 (seeded), clinic bridge on 8790, SKP_TEST_ENV pointing at the test credentials.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, loadEnv, loginAsAlice, newContext, waitUp, APP, BRIDGE, CONSENT } from './helpers'

loadEnv()
const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.resolve(here, '../docs')
const shots = process.env.SHOTS_DIR
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'guardian-rec-'))

await waitUp(APP)
await waitUp(`${CONSENT}/healthz`)
await waitUp(`${BRIDGE}/health`)

const browser = await launch()
const t0 = Date.now()
const ctx = await newContext(browser, { recordVideo: { dir: tmp, size: { width: 1280, height: 720 } } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
console.log('logging in')
await loginAsAlice(page)
console.log('logged in')
await page.waitForTimeout(2500)
if (shots) fs.mkdirSync(shots, { recursive: true })
const cutAt = (Date.now() - t0) / 1000
// Presenter mode needs the clinic bridge and the service: the Send button enables once both answered.
await page.waitForFunction(() => !(document.querySelector('[data-testid=send-request]') as HTMLButtonElement | null)?.disabled, undefined, { timeout: 30_000 })
await page.getByTestId('present').click()
let last = ''
let n = 0
const deadline = Date.now() + 4 * 60_000
while (Date.now() < deadline) {
  const fin = await page.getByTestId('presenter').getAttribute('data-finished', { timeout: 1500 }).catch(() => null)
  const title = await page.getByTestId('caption-title').textContent({ timeout: 1500 }).catch(() => '')
  if (shots && title && title !== last) {
    await page.waitForTimeout(1800)
    await page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, '0')}.png`) })
  }
  last = title ?? last
  if (fin === 'true') break
  await page.waitForTimeout(400)
}
await page.waitForTimeout(2500)
const video = page.video()
await ctx.close()
await browser.close()
const raw = await video!.path()
fs.mkdirSync(docs, { recursive: true })
const out = path.join(docs, 'presenter-mode.webm')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, cutAt - 0.2)), '-i', raw, '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '7', '-row-mt', '1', '-an', out])
fs.rmSync(tmp, { recursive: true, force: true })
console.log('video', out, `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
