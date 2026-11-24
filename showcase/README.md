# SKPods showcase

Four small apps that show what Solid pods feel like when the software around them is good: fast, honest, and pleasant. They run against the SKPods dev server (`https://pods-dev.skstack01.douno.it`, a Nextcloud app with a Solid engine, fake data only).

| App | What it shows | Status |
|---|---|---|
| **Consent Center** (`apps/consent-center`) | Every request for your data in one place. Approve with an expiry ("24h", "until the appointment ends"), watch grants count down and switch off by themselves, verify a tamper-evident audit chain. Lead story: a care facility gets 24h on Grandma's care log. | **works against pods-dev**: e2e 7/7 ([README](apps/consent-center/README.md), [screenshots](apps/consent-center/docs/screenshots/)) |
| **Receipts Wallet** (`apps/receipts-wallet`) | Businesses drop receipts into your pod through an Append-only inbox. You keep them across providers; search, totals, export. | **works against pods-dev**: e2e 6/6 ([README](apps/receipts-wallet/README.md), [screenshots](apps/receipts-wallet/docs/screenshots/)) |
| **Pod Chat** (`apps/pod-chat`) | Each person's messages live in their own pod; the conversation is assembled from both. Live-ish updates by smart polling. Leave the chat and your messages vanish for everyone, because they were always yours. | **works against pods-dev**: e2e 8/8 ([README](apps/pod-chat/README.md), [screenshots](apps/pod-chat/docs/screenshots/)) |
| **Guardian** (`apps/guardian`) | An AI guardian agent with a leash: a clinic asks for personal data before a visit, the agent decides under a policy stored in the owner's pod, and the owner sees and can revoke everything. Presenter mode plays the whole story. | **works against pods-dev**: e2e 15/15 ([README](apps/guardian/README.md), [video](apps/guardian/docs/presenter-mode.webm), [screenshots](apps/guardian/docs/screenshots/)) |
| **Hello Pod** (`apps/hello-pod`) | The smallest app on the stack: log in, show your WebID, pod root and a file list, write a note. Proves login, DPoP and the UI kit end to end. | **works against pods-dev** |

Shared code:

| Package | Purpose |
|---|---|
| `packages/solid-web` | TypeScript library: Solid-OIDC login for browsers (discovery, dynamic client registration, code + PKCE, DPoP, refresh, restore, logout), a DPoP `fetch`, a Node client-credentials login for agents and tests, `PodStore` (get, put, post, N3 patch, delete, list, containers, type index), Turtle read and write with `n3`, WAC helpers, a polling watcher. **Read `packages/solid-web/ENGINE-NOTES.md` first**: it lists what the engine really does, including the behaviours apps must design around. |
| `packages/ui` | Design system: Tailwind preset (deep navy, teal glow, warm accent, light and dark) and React components: `AppShell`, `Card`, `Button`, `ConsentChip`, `Countdown`, `AuditTimeline`, `Avatar`, `ToastProvider`, `EmptyState`, `ErrorState`, `Skeleton`, `ThemeToggle`. |
| `vocab/skpods-showcase.ttl` | Terms in `https://w3id.org/skpods/v1#` (prefix `skp:`) used by the apps. Reuse schema.org, vcard, FOAF and Solid terms first. |

Pod paths used by the apps live under `<storage>/skpods/v1/` (for example `consents/`, `health/`, `receipts/`, `chat/`). Find the storage root from the WebID profile (`pim:storage`) and data containers through the Type Index; never build paths from the WebID by string concatenation.

## Run it

Needs Node 22.

```bash
cd showcase
npm install
npm run dev:hello          # http://localhost:5173  (port is fixed: the OIDC redirect URI is registered for it)
```

Open it, press Log in, sign in at the Nextcloud form with a test account and press Allow on the consent screen. Test accounts are fake and not in this repository.

### Use the library

```ts
import { SolidSession, PodStore } from '@skpods/solid-web'

const session = await SolidSession.init({ defaultIssuer: 'https://pods-dev.skstack01.douno.it' })
if (session.state === 'anonymous') await session.login()          // redirects; init() finishes the login on return
const store = new PodStore(session.fetch)                          // DPoP fetch, refreshes tokens itself
const root = await store.storageRoot(session.webId!)
await store.put(`${root}private/hello.ttl`, '<#hi> <http://schema.org/name> "hello" .')
```

Headless (tests, services):

```ts
import { agentLogin } from '@skpods/solid-web/node'
const agent = await agentLogin({ issuer, clientId, clientSecret })  // client credentials + DPoP
const store = new PodStore(agent.fetch)
```

## Tests

```bash
npm test                                     # unit tests (no network)
```

Integration tests talk to the live dev server and need test credentials in env files you pass by path (never commit them):

```bash
SKP_TEST_ENV=/path/pods-dev-test.env npm run test:integration
```

The env file holds `SKPODS_BASE` and `DW_<USER>_USER` / `DW_<USER>_PASSWORD` for the fake accounts (alice, bob, kid, grandma, care_facility, practitioner, agent). Optional `DW_<USER>_CLIENT_ID` / `_CLIENT_SECRET` avoid minting a fresh client per run. The browser test needs Chrome or Chromium (`SKP_CHROME=/path/to/chrome` to override; `SKP_SHOT_DIR` saves screenshots).

| Suite | What it proves |
|---|---|
| `test/unit` | DPoP proofs for RS256 and ES256 verify, `ath`, `htu`, nonce retry and refresh retry, token not sent cross-origin, Turtle, ACL parse and serialise, lockout guard |
| `test/integration/browser-login` | Playwright drives the real Nextcloud login form and consent screen for a test account through Hello Pod: login, WebID and pod root shown, private container written and listed, session restored after reload, refresh with an aged token, logout |
| `test/integration/agent` | Client-credentials login, token claims, profile and type index discovery, put, get, patch, list, delete, nested containers, type index registration, 403 on another user's private area |
| `test/integration/wac` | A test user shares a resource with another through `.acl`, the grantee can read but not write, revoke gives 403 again; container default inheritance; Append-only inbox; engine quirks |

## Honest status

Works against pods-dev: everything in the table above marked as such, verified by the suites listed. Not verified: ES256 against a live server (the dev server only accepts RS256), WebHook notification delivery, token behaviour beyond one hour. Known engine limits (no ETag, N3 patch applies only the last triple per clause, `acl:agentGroup` not enforced) are documented with exact requests in `packages/solid-web/ENGINE-NOTES.md`.
