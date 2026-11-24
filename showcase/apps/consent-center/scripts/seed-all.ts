import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { actor, seedDelegations, seedGrandma, seedKid, webIdOf } from './seed'

const here = path.dirname(fileURLToPath(import.meta.url))
const BIN = process.env.SK_CONSENT_BIN ?? path.resolve(here, '../../../services/sk-consent/target/release/sk-consent')

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

