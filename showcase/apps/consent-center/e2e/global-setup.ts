import { seedAll } from '../scripts/seed-all'

// Fresh pod data (Grandma, Theo, Alice's delegations) before the story runs.
export default async function setup() {
  await seedAll(() => undefined)
}
