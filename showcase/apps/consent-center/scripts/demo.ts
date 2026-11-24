// Demo seed for the Consent Center.
//   npm run demo               seed the pods (Grandma, Theo, Alice's delegations and, if the binary is built, Alice's own health data)
//   npm run demo -- requests   also file the sample requests with the broker (SKCONSENT_URL, default http://localhost:8781)
// Needs SKPODS_BASE and the minted per-account credentials in the environment (see README).
import { BASE } from './seed'
import { seedAll } from './seed-all'
import { fileRequests } from './requests'

const BROKER = process.env.SKCONSENT_URL ?? 'http://localhost:8781'
await seedAll()
if (process.argv[2] === 'requests') {
  const r = await fileRequests(BROKER, console.log)
  console.log(`Filed ${r.length} requests with ${BROKER}`)
}
console.log(`Done. Pods: ${BASE}`)
