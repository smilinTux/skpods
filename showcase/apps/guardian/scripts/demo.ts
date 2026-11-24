// `npm run demo`: seed Alice's pod with the fake clinic story (PII, provider link, booking, ACLs, default policy).
// It shells out to the sk-consent binary's `seed-demo` command, which uses the agent flow (client credentials)
// for dw-alice and dw-practitioner, and revokes its short-lived credentials again.
//
// Env: SKPODS_BASE, DW_ALICE_USER/_PASSWORD, DW_PRACTITIONER_USER/_PASSWORD, SKCONSENT_CREDS_FILE (the guardian's credentials).
// SK_CONSENT_BIN points at a built binary; otherwise `cargo run --release` inside services/sk-consent is used.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const svc = path.resolve(here, '../../../services/sk-consent')
for (const k of ['SKPODS_BASE', 'DW_ALICE_PASSWORD', 'DW_PRACTITIONER_PASSWORD', 'SKCONSENT_CREDS_FILE']) {
  if (!process.env[k]) {
    console.error(`${k} is not set (see the README)`)
    process.exit(1)
  }
}
const bin = process.env.SK_CONSENT_BIN
const r = bin ? spawnSync(bin, ['seed-demo'], { stdio: 'inherit' }) : spawnSync('cargo', ['run', '--release', '--', 'seed-demo'], { cwd: svc, stdio: 'inherit' })
process.exit(r.status ?? 1)
