// Demo seed for the Consent Center.
//   npm run demo               seed the pods (Grandma, Theo, Alice's delegations and, if the binary is built, Alice's own health data)
//   npm run demo -- requests   also file the sample requests with the broker (SKCONSENT_URL, default http://localhost:8781)
// Needs SKPODS_BASE and the minted per-account credentials in the environment (see README).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, actor, seedDelegations, seedGrandma, seedKid, webIdOf } from './seed'
import { fileRequests } from './requests'

const here = path.dirname(fileURLToPath(import.meta.url))
const BIN = process.env.SK_CONSENT_BIN ?? path.resolve(here, '../../../services/sk-consent/target/release/sk-consent')
const BROKER = process.env.SKCONSENT_URL ?? 'http://localhost:8781'

export async function seedAll(log: (s: string) => void = console.log) {
  const alice = await actor('alice')
  log('Grandma: care log, medication schedule, providers, booking, policy, ACLs')
  await seedGrandma(await actor('grandma'), alice.webId, webIdOf('dw-care-facility'))
  log('Theo: allergies, immunizations, providers, booking, policy, ACLs')
  await seedKid(await actor('kid'), alice.webId, webIdOf('dw-practitioner'))
  log('Alice: delegation records (who she acts for)')
  await seedDelegations(alice)
  if (fs.existsSync(BIN) && process.env.DW_ALICE_PASSWORD) {
    log("Alice: own health data, providers, booking and guardian policy (sk-consent seed-demo)")
    execFileSync(BIN, ['seed-demo'], { stdio: 'ignore', env: process.env })
  } else log('Alice: skipped seed-demo (binary not built or DW_ALICE_PASSWORD unset)')
}

const cmd = process.argv[2] ?? 'seed'
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('demo.ts')) {
  await seedAll()
  if (cmd === 'requests') {
    const r = await fileRequests(BROKER, console.log)
    console.log(`Filed ${r.length} requests with ${BROKER}`)
  }
  console.log(`Done. Pods: ${BASE}`)
}
