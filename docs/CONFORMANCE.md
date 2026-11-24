# Conformance gate

> Status: the pass count below is **Working** (measured). The CI gate, the per-release record and the
> SKPods scenario runner are **Planned** for phase 2. pods-dev is live since 2026-11-23.

SKPods promises that any spec-following Solid app works against it, and that the engine can be swapped
without touching apps. This file is the test that backs that promise.

## 1. Summary for an AI agent

- Two suites run against every engine build: the official **Solid conformance test harness (CTH)** and the
  **SKPods permission scenarios** (section 4).
- Today's Nextcloud engine passes **12 of 35 MUST features** in the harness.
- The Rust engine replaces Nextcloud **only when it passes at least as many** as the Nextcloud engine, and passes every SKPods scenario.
- Standard Solid apps (Penny, the SolidOS data browser) must still log in and work on every release.
- Apps depend on the Solid spec, not on one engine. If an app works only on one engine, that is an app bug.

## 2. The official harness (CTH)

The Solid project publishes a conformance test harness that runs the specification's tests against a
server. We run it against the SKPods URL with a pair of test users and record the result as a list of
features: each is MUST or SHOULD and passes or fails.

- Covers the Solid Protocol (resources, containers, content negotiation, CORS, WAC, Link headers) and, where the harness
  has them, authentication tests.
- The count we track is MUST features passed out of the 35 the harness lists for our target profile.
- **Current: 12 of 35 on the Nextcloud engine.**
- Reference servers publish their own numbers. We compare ours with theirs each release. The goal is to
  keep improving the count, and never to regress.

### 2.1 How results are tracked per release (Planned)

Each engine release produces one result record, kept in this repo under `conformance/results/<release>.json`:

```json
{
  "release": "skpods-nextcloud:<nc-version>-solid-<sha>",
  "digest": "sha256:<digest>",
  "date": "YYYY-MM-DD",
  "harness": { "version": "<cth version>", "must_total": 35, "must_passed": 12, "should_passed": 0 },
  "failed_must": ["<feature id>", "..."],
  "skpods": { "total": 0, "passed": 0, "failed": ["D-xx"] },
  "interop": { "penny": "pass", "solidos": "pass" }
}
```

(The numbers in this sample are placeholders except the 12 and 35.) CI compares each new record with the
previous one and fails on any regression in `must_passed` or in a SKPods scenario. The release notes quote
the numbers.

## 3. Interop smoke tests

On every release, by hand until automated:

| Check | Pass condition |
|---|---|
| Penny (a Solid app) | Log in with a `dw-*` account, create a note, read it back |
| SolidOS data browser | Log in, browse the pod root, open the profile, edit a resource |
| Discovery | `/.well-known/openid-configuration` returns an `issuer` equal to the public host |
| Profile | The WebID document is Turtle and contains `https://` IRIs only |
| CORS | `OPTIONS` on the pod root answers with `Access-Control-Allow-*` for a foreign origin |

A failed smoke test blocks the release even if the harness count is unchanged.

## 4. SKPods permission scenarios

These test the model in [ACCESS-AND-CONSENT.md](./ACCESS-AND-CONSENT.md) with the `dw-*` accounts (see
[TEST-ACCOUNTS.md](./TEST-ACCOUNTS.md)). Scenarios D-01 to D-08 are expressible with plain WAC and run on the
Nextcloud engine in phase 2. D-09 to D-14 need the consent broker (phase 3). Each starts from a fresh seed
(`sk-solid seed --reset`). "403" means the server refused an authenticated request; "401" means no valid token.

| # | Scenario | Expected outcome |
|---|---|---|
| D-01 | `dw-alice` reads her own `/skpods/v1/household/` | 200 |
| D-02 | `dw-bob` reads `dw-alice`'s `/skpods/v1/household/` before any share | 403 |
| D-03 | `dw-alice` adds the household group read; `dw-bob` reads the household container | 200. `dw-bob` PUT to it: 403. |
| D-04 | Anonymous GET of `dw-alice`'s pod root and of `/skpods/v1/` | 401 or 403, never 200 |
| D-05 | `dw-alice` shares only the calendar with `dw-bob`; `dw-bob` reads calendar and finance | Calendar 200, finance 403 |
| D-06 | `dw-agent` (client credentials) with no grant reads `dw-alice`'s household | 403 |
| D-07 | `dw-alice` grants `dw-agent` Read on one container; the agent reads it, then reads a sibling | Container 200, sibling 403, write 403 |
| D-08 | Parent control: `dw-alice` (delegate) reads and writes `dw-kid`'s pod; `dw-bob` has no delegation | `dw-alice` 200, `dw-bob` 403 |
| D-09 | `dw-care-facility` requests 24h Read on `dw-grandma`'s care log; before approval it reads the log | 403, and a pending request exists |
| D-10 | The family delegate approves; the facility reads the log; the facility tries to write | Read 200, write 403, grant record present in `dw-grandma`'s `/skpods/v1/consents/`, audit entry added |
| D-11 | Grant expires (use a short test duration, for example 60 s); the facility reads again | 403 after expiry, the consent record is `revoked` with reason `expired`, an audit entry is added, the ACL has no facility authorization |
| D-12 | Early revoke by the delegate while the grant is active | 403 within seconds, reason `revoked-by-delegate`, audit entry added |
| D-13 | Audit chain: verify the chain, alter one stored entry, verify again | First verify passes, second fails and names the broken entry |
| D-14 | Broker restart mid-grant: stop the broker past `expiresAt`, restart | The reconciler removes the expired authorization, the facility reads 403 |
| D-15 | Practitioner linkage: `dw-practitioner` holds a grant on `dw-alice`'s household container only; it tries `dw-grandma`'s care log | Household 200 while granted, care log 403 |
| D-16 | Business WebID, not staff: a staff member of `dw-care-facility` signing in as themselves reads `dw-grandma`'s log | 403 (the grant names the business WebID, the app decides which staff may use it) |
| D-17 | No payment data: write a body containing a card-number pattern to a pod container through the app's `PodStore` | The app refuses to store it (processor reference only) |
| D-18 | Reset: `sk-solid seed --reset`, then run D-01 and D-02 again | Same results as a first run, previous grants gone |

D-17 is an app-level rule, run against the app team's module. All others run against the pod server and broker.
The SKPods scenarios must also pass on the Rust engine, with identical expected status codes.

## 5. Engine replacement rule

The setting `skpods.ENGINE` selects the engine. A new engine becomes selectable for **dev** when it
passes all SKPods scenarios that apply to its phase, and for **prod** only when:

1. its CTH `must_passed` is **greater than or equal to** the Nextcloud engine's current count,
2. every SKPods scenario D-01 to D-18 passes with the same expected outcomes,
3. both interop smoke tests pass, and
4. the result record is added to the repo and reviewed.

No exception for deadlines. If the Rust engine passes fewer, the Nextcloud engine stays.

## Related projects / See also

- [ACCESS-AND-CONSENT.md](./ACCESS-AND-CONSENT.md): the model the scenarios test.
- [TEST-ACCOUNTS.md](./TEST-ACCOUNTS.md): the `dw-*` accounts.
- [COMMUNITY.md](./COMMUNITY.md): publishing results when the Rust engine passes.
- [ARCHITECTURE.md](./ARCHITECTURE.md): where the engine setting sits.
- [Solid conformance test harness](https://github.com/solid-contrib/conformance-test-harness).
