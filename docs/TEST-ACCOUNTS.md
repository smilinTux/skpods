# Test accounts on pods-dev

Status: pods-dev is live since 2026-11-23 (discovery, WebID profiles, CORS, agent login with DPoP, own-pod read/write and the cross-pod 403 all verified). Fake data only.
Maturity-tier: new (dev first)

The `dw-*` accounts below are demo test users: fake people and fake businesses. Never put real data in them. Passwords and client secrets are not in this repo: they are delivered privately by the SKPods admin (see [GETTING-STARTED.md](./GETTING-STARTED.md), section 2). Never commit them.

URL shapes (verified against the role docs): with `H=https://pods-dev.skstack01.douno.it`, user `<u>` has

- WebID: `H/apps/solid/~<u>/profile/card#me`
- Pod root: `H/apps/solid/~<u>/storage/`
- Private area: `H/apps/solid/~<u>/storage/private/`
- Example app data (planned layout): `H/apps/solid/~<u>/storage/skpods/v1/...`

## Accounts

| Username | Role | WebID | Pod root | Reset? | Login |
|---|---|---|---|---|---|
| `dw-alice` | Parent, owns the household | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-alice/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-alice/storage/` | Yes | Browser flow (password) |
| `dw-bob` | Spouse | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-bob/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-bob/storage/` | Yes | Browser flow (password) |
| `dw-kid` | Minor, pod managed by a parent | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-kid/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-kid/storage/` | Yes | Browser flow (password), used mostly through the parent's delegated access |
| `dw-grandma` | Elder-care resident | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-grandma/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-grandma/storage/` | Yes | Browser flow (password) |
| `dw-care-facility` | Business: elder-care facility | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-care-facility/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-care-facility/storage/` | Yes | Browser flow (password) |
| `dw-practitioner` | Business: visiting practitioner | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-practitioner/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-practitioner/storage/` | Yes | Browser flow (password) |
| `dw-agent` | Headless agent | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-agent/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~dw-agent/storage/` | Yes (credentials change on reset) | Client credentials + DPoP |
| `manolo` | A developer account (not reset) | `https://pods-dev.skstack01.douno.it/apps/solid/~manolo/profile/card#me` | `https://pods-dev.skstack01.douno.it/apps/solid/~manolo/storage/` | NO (only when asked by name) | Web UI, browser flow, or your own client credentials |

The server also has an install admin account. It is for operating the server, not for app work, and nothing in your code should ever use it.

## What each account is for

| Account | Scenarios to test with it |
|---|---|
| `dw-alice` | Household owner: invite and share household data with `dw-bob`; grant a business (`dw-care-facility`, `dw-practitioner`) access to one resource for a limited time; revoke it; check that the revoke takes effect. Delegation of `dw-kid`. |
| `dw-bob` | Partial household sharing: sees only what Alice shared, gets `403` on the rest. Cannot grant on resources he does not own. |
| `dw-kid` | Delegated control: the parent can read and manage the kid's pod, the kid's data never goes to a business without the parent's consent. |
| `dw-grandma` | Elder-care resident: care record, family live log, power of attorney (a family member acts for her). Consent request from the facility. |
| `dw-care-facility` | Business side of consent: requests access, receives a time-limited grant, loses it on revoke or expiry, keeps only references. Writes visit and care updates into the resident's pod where granted. |
| `dw-practitioner` | Provider linkage: a second business, to prove one customer can link several businesses and that businesses cannot see each other's grants. |
| `dw-agent` | Headless client credentials flow: an agent sees only what it was granted. AI agents and background jobs should be developed against this account. |
| `manolo` | Your own scratch space and the Nextcloud web UI. Not reset, so do not keep anything you cannot recreate. |

## Seed data

Today each pod starts empty apart from the default Solid profile and root. Fixture data per user (households, residents, visits) arrives with the seed tooling, `sk-solid seed --reset` (Planned, phase 2),. Until then, create your own test resources under `storage/skpods/v1/`.

## Reset policy

| Account | Reset behaviour |
|---|---|
| `dw-alice`, `dw-bob`, `dw-kid`, `dw-grandma`, `dw-care-facility`, `dw-practitioner`, `dw-agent` | Deleted and recreated on every reset, with their pod data. Passwords stay the same. |
| `dw-agent` | Also gets new client credentials on every reset. Ask the admin for the new pair, or mint your own pair again. |
| `manolo` | Never touched by a normal reset. Reset only when the admin is asked to, by name. |

How to trigger a reset: ask the SKPods admin or the reset CI job (Working). `sk-solid seed --reset`: Planned. See GETTING-STARTED.md, section 8.

## Permission test matrix

Rows are the caller (logged in as that user, or with that user's token). Columns are the resource. Expected HTTP status for a `GET` unless noted. "Own" means the caller's pod. Everything below assumes a fresh reset and no extra grants, unless the row says "after grant".

Legend: V = verified by our smoke test against the Solid app. E = expected from WAC and the SKPods design, to be confirmed on pods-dev. P = depends on the consent broker or fixtures (Planned).

| # | Caller | Resource | Action | Expected | Basis |
|---|---|---|---|---|---|
| 1 | anyone, no token | `~dw-alice/profile/card` | GET | 200 | V |
| 2 | anyone, no token | `~dw-alice/storage/` (root container) | GET | 200 (default root ACL, listing only) | V (documented behaviour) |
| 3 | anyone, no token | `~dw-alice/storage/private/` | GET | 401 or 403 | V |
| 4 | `dw-alice` | `~dw-alice/storage/private/x.ttl` | PUT, GET, DELETE | 200, 201 or 204 | V |
| 5 | `dw-agent` | `~dw-agent/storage/x.ttl` | PUT, GET, DELETE | 200, 201 or 204 | V |
| 6 | `dw-agent` | `~dw-alice/storage/private/` | GET | 403 | V |
| 7 | `dw-bob` | `~dw-alice/storage/private/` | GET | 403 | E |
| 8 | `dw-care-facility` | `~dw-grandma/storage/private/` | GET | 403 | E |
| 9 | `dw-practitioner` | `~dw-care-facility/storage/private/` | GET | 403 | E |
| 10 | `dw-bob` | `~dw-alice/storage/skpods/v1/household/` | GET | 403 before grant, 200 after Alice grants Read | E |
| 11 | `dw-bob` | `~dw-alice/storage/skpods/v1/household/` | PUT | 403 with Read only, 2xx with Write | E |
| 12 | `dw-care-facility` | one resource in `~dw-grandma` | GET | 403 before grant, 200 during grant, 403 after revoke or expiry | E (WAC), time limit needs the broker: P |
| 13 | `dw-alice` | `~dw-kid/storage/private/` | GET | 200 once parent control is set up by the fixtures | P |
| 14 | `dw-kid` data via a business | any `dw-kid` resource | GET | 403 without parent consent | P |
| 15 | `dw-agent` | resource an owner explicitly granted to `dw-agent` | GET | 200 | E |
| 16 | any user | another user's `.acl` | GET, PUT | 403 (only holders of Control may touch ACLs) | E |
| 17 | valid token, `Authorization: Bearer` instead of `DPoP` | any pod resource | any | 401 | E |
| 18 | DPoP proof with wrong `htu` or without `ath` | any pod resource | any | 401 | E |
| 19 | browser origin `https://app.example.org` | `OPTIONS` on a pod resource | OPTIONS | 200 or 204 with `Access-Control-Allow-Origin` | V |

Write each row as an automated test where you can. Rows marked V already pass in our smoke test and are the minimum bar for your first CI run. Rows marked E or P become real tests as the consent broker and fixtures land; keep them in your suite as skipped or expected-fail until then, so they flip on the day the feature arrives. WAC behaviour (who may read, write, append, control) is documented in [ACCESS-AND-CONSENT.md](./ACCESS-AND-CONSENT.md).

## Related projects / See also

- [GETTING-STARTED.md](./GETTING-STARTED.md), [LOGIN-AND-AUTH.md](./LOGIN-AND-AUTH.md)
- [ACCESS-AND-CONSENT.md](./ACCESS-AND-CONSENT.md), [CONFORMANCE.md](./CONFORMANCE.md), [ARCHITECTURE.md](./ARCHITECTURE.md)
