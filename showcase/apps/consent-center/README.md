# Consent Center

The trust surface of the SKPods showcase. A person sees every request for their data, approves it for as long as they choose, watches the grant count down and switch itself off, and can verify that the record of all of it was not rewritten.

Fake data only, against `https://pods-dev.skstack01.douno.it`.

## The story

Logged in as **dw-alice** (Alice Rivera), who is the attorney-in-fact for **dw-grandma** (Rosa) and the parent of **dw-kid** (Theo):

1. **Sunrise Care** (`dw-care-facility`) asks for 24 hours of access to Rosa's care log (and her medication schedule and finances). The request lands in Alice's inbox marked "for Grandma Rosa". Her guardian rules already declined the finances with a counter-offer and suggest 24 hours for the care log.
2. Alice allows it for 24 hours, until the appointment ends (the booking `SUN-2207` in Rosa's pod), or a custom time.
3. The **facility view** (`/facility/`, logged in as the facility) turns from a locked screen into the real care log. The line under it shows the real `GET care-log.ttl -> 200`.
4. Alice's "Open access" page shows a live ring countdown. At the end the broker removes the access rule, the facility's next read is `403`, and its screen locks again. Alice can also **revoke now**.
5. **Audit** shows the hash chain as linked blocks. "Verify in my browser" recomputes every SHA-256. The tamper demo plays an attacker on a copy in the tab and shows exactly which link breaks.
6. **What's in my pod** opens a drawer with the real `.acl` files (the requester's rule appears on approval and the file disappears at expiry), the grant records, the policy and the folder listings, with links.

## What is real, what is mocked

| Part | Status |
|---|---|
| Login | Real browser Solid-OIDC (code + PKCE + DPoP) for both screens, driven in the e2e test through the Nextcloud forms |
| Requests, decisions, grants, expiry, revoke, audit | Real `sk-consent` (your own instance on 8781). Owner actions carry Alice's DPoP token, verified by the service |
| Live updates | Server-sent events from `sk-consent` (`/events`), with a resync on reconnect |
| Pod files in the drawer, the `.acl`, the facility's reads | Real requests to the pod with the viewer's own token |
| Chain verification | Recomputed in the browser with WebCrypto, same canonical JSON as the service. Also cross-checked with `/audit/verify` and against the mirror files in the pod |
| Requesters | Real accounts (`dw-care-facility`, `dw-practitioner`, `dw-bob`) with the requester name and kind taken from the request body. The service verifies the WebID, not the claimed name or kind |
| "Read reported" lines | Self-reported by the requester's client. Pods do not push access logs |
| Tamper demo | Edits a copy in the browser only |
| People Alice acts for | Read from `skpods/v1/delegations/*.ttl` in her pod (written by the seed). No legal check of a real power of attorney |

## Run it

Prerequisites: Node 22, the built `sk-consent` (`cd ../../services/sk-consent && cargo build --release`), the test credentials (see the showcase brief) and the minted per-account client credentials.

```bash
cd showcase && npm install
set -a; . pods-dev-test.env; . dw-clients.env; set +a        # SKPODS_BASE, DW_<USER>_..., 0600 files outside the repo
export SKCONSENT_CREDS_FILE=/path/sk-consent-agent.env        # the guardian agent's credentials

apps/consent-center/scripts/broker.sh &                       # sk-consent on 127.0.0.1:8781, public URL http://localhost:8781
npm run demo -w @skpods/consent-center                        # seed Grandma, Theo, Alice's delegations (idempotent)
npm run demo -w @skpods/consent-center -- requests            # also file 4 sample requests
npm run dev -w @skpods/consent-center                         # http://localhost:5174 and http://localhost:5174/facility/
```

- Cockpit: `http://localhost:5174/`, log in as `dw-alice`.
- Facility: `http://localhost:5174/facility/`, log in as `dw-care-facility` **in a private window**. The pod server keeps one login per browser, so a second login in the same window silently becomes the first user again.
- Settings: `VITE_POD_ISSUER`, `VITE_CONSENT_URL` (default `http://localhost:8781`), `VITE_RESIDENT_WEBID`, `VITE_POD_PROXY` (`off` to skip the proxy).

### Tests

```bash
npm run e2e -w @skpods/consent-center        # needs the env above; starts Vite and its own sk-consent with a fresh DB
```

`e2e/story.spec.ts` runs two real browser logins (Alice, facility) and covers: request, approve for 45 seconds, facility reads data (200), the real `.acl` and grant record in the drawer, automatic expiry (facility 403, rule file 404), audit verify, tamper with and without re-hashing, a second approval followed by revoke (facility 403 within seconds), and phone width. It writes the screenshots in `docs/screenshots/`.

## Engine limits hit

- **Origin header makes non-owner reads fail.** `GET <care-log.ttl>` with a valid DPoP token and an active read grant answers **200** without an `Origin` header and **403** with `Origin: http://localhost:5174`. The same happens for Alice (approver, not owner) reading Rosa's `.acl`. Adding `acl:origin <http://localhost:5174>` to the rule fixes it (200 from that origin, 403 from another). Owners reading their own pod are not affected. `sk-consent` does not write `acl:origin`, and a browser always sends `Origin`.
  - **Workaround here:** pod requests go through a same-origin proxy (`/pod`, Vite `server.proxy`/`preview.proxy`, a reverse proxy anywhere else) that drops `Origin` (`src/lib/podproxy.ts`). The DPoP proof is still signed for the real pod URL.
  - **Proposed change in `sk-consent`:** an env list of trusted app origins that adds `acl:origin` to every grantee, approver and owner rule it writes. Then the proxy can go.
- No ETag, no notifications: the facility screen polls every 3 seconds and on every grant event. See `packages/solid-web/ENGINE-NOTES.md`.
- `sk-consent` is the single writer of grant ACLs. Two instances (this app on 8781, the guardian app on 8782) that share Alice's pod would overwrite each other's rule files and the day's audit mirror, so the seed puts the lead story on Rosa and Theo.

## Proposed library changes (not made, `packages/*` is not mine)

- `@skpods/solid-web`: a public `session.fetchFor(origins)` (the broker call needs a DPoP fetch for another origin; this app reads two private members of `SolidSession` in `src/lib/session.ts`).
- `SolidSession.init`: tolerate React StrictMode (a login redirect can be consumed once; the app caches the init promise).
- `SolidSession.login`: an option for `prompt=login`, so a second identity in the same browser does not reuse the pod server's session.

## Files

`src/lib/chain.ts` canonical JSON and chain verification, `src/lib/broker.ts` typed client, `src/lib/useConsent.ts` live state, `src/components/` cards, picker, chain, drawer, `src/pages/Facility.tsx` the facility screen, `scripts/` seed and sample requests, `../../vocab/consent-center.ttl` the added terms.
