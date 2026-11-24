# sk-consent

Consent broker and guardian agent for SKPods. One Rust service (axum, tokio, reqwest, rusqlite) that:

1. receives requests from businesses for a person's data,
2. decides each item with deterministic rules stored in the person's pod (auto approve with a maximum duration, ask the owner, or deny with an explanation and a counter offer),
3. writes a read-only WAC grant on exactly that resource, and removes it at expiry (or on revoke),
4. keeps a hash-chained audit log, mirrored into the person's pod.

Status against `https://pods-dev.skstack01.douno.it` (fake data only): the full clinic story runs and is covered by an integration test (see Tests). Details of what is verified, mocked or untested are at the end.

## Run it

```bash
export SKPODS_BASE=https://pods-dev.example.org          # Solid server, also the OIDC issuer
export SKCONSENT_CREDS_FILE=/path/agent.env               # 0600 file: SKCONSENT_CLIENT_ID=... SKCONSENT_CLIENT_SECRET=...
cargo run -- serve                                        # http://127.0.0.1:8787
```

Agent credentials are the guardian's Solid identity (client credentials, DPoP bound). Mint them once from the agent account:
`POST $SKPODS_BASE/apps/solid/client-credentials` with Basic auth (user, password or app password), header `OCS-APIRequest: true`, body `{"name":"sk-consent"}`. Keep the secret in a 0600 file outside the repo.

The demo from the command line (test accounts need `DW_ALICE_USER/PASSWORD` and `DW_PRACTITIONER_USER/PASSWORD` in the environment; the tool mints short-lived credentials for them and revokes them again):

```bash
cargo run -- seed-demo                                    # fake PII, providers, booking, policy and ACLs in Alice's pod
cargo run -- serve &
cargo run -- simulate-clinic --owner-approves --duration 20s --watch-expiry
```

`simulate-clinic` acts as the clinic: files a 5 item request, optionally acts as the owner to approve the item that needs a tap (with a real DPoP token), reads every item and prints HTTP 200 or 403, then waits for expiry and reads again. Without `--owner-approves` it waits (`--wait-owner`, default 60s) for a human to decide through the API.

### Configuration (environment)

| Variable | Meaning | Default |
|---|---|---|
| `SKPODS_BASE` | Solid server base URL | required |
| `SKCONSENT_CREDS_FILE` or `SKCONSENT_CLIENT_ID` + `SKCONSENT_CLIENT_SECRET` | guardian credentials | required |
| `SKCONSENT_BIND` | listen address | `127.0.0.1:8787` |
| `SKCONSENT_DB` | SQLite file | `sk-consent.db` |
| `SKCONSENT_PUBLIC_URL` | URL clients use to reach this service, checked against the DPoP `htu` | `http://<bind>` |
| `SKCONSENT_CORS_ORIGINS` | extra allowed origins, comma separated | none |
| `SKCONSENT_CORS_LOCALHOST` | allow any `http://localhost:*` and `http://127.0.0.1:*` | `1` |
| `DEMO_INSECURE_OWNER` | **DEV ONLY.** `1` skips token verification and trusts the `X-Demo-WebID` header | `0` |
| `GUARDIAN_LLM_BASE_URL`, `GUARDIAN_LLM_MODEL`, `GUARDIAN_LLM_API_KEY` | optional OpenAI-compatible endpoint for friendly explanations | off |

## HTTP API (JSON)

| Method and path | Who | What |
|---|---|---|
| `POST /requests` | requester | File a request. Decided synchronously. Returns 201 with the request and one decision per item. |
| `GET /requests?subject=<webid>` | open (demo) | List requests, newest first. |
| `GET /requests/{id}` | open (demo) | One request. |
| `POST /requests/{id}/decide` | owner or named approver | `{"decisions":[{"item_id","action":"approve"\|"deny","duration":"24h","reason"}]}` for items in `awaiting_owner`. `duration` takes `24h`, `PT2H`, seconds or `until_booking_end`; default is the guardian's recommendation, else 24h; capped by the policy `ceiling`. |
| `GET /grants?subject=&status=` | open (demo) | List grants (`active`, `revoked`, `expired`, `failed`). |
| `POST /grants/{id}/revoke` | owner, approver, or the grantee (release) | Revoke now. `{"reason": "..."}` optional. Idempotent. |
| `POST /grants/{id}/access` | grantee | Report a read `{"http_status":200}`. Recorded as `data_read`, flagged self-reported (pods do not push access logs). |
| `GET /policy?subject=` | open (demo) | The policy as loaded from the pod. |
| `GET /audit?subject=` | open (demo) | Audit entries. |
| `GET /audit/verify?subject=` | open | Recompute every chain: `{"ok","first_bad_index","first_bad_subject","chains":[...]}`. |
| `GET /events?subject=` | open (demo) | Server-sent events: `audit`, `request`, `grant`, each with the full object. Use these for live UIs. |
| `GET /healthz` | open | Status, agent WebID, whether the LLM and the insecure bypass are on. |

New request body:

```json
{
  "requester": {"webid": "https://.../profile/card#me", "name": "Bayview Family Clinic", "kind": "clinic"},
  "subject": "https://.../~dw-alice/profile/card#me",
  "purpose": "Pre-visit intake for your annual check-up",
  "items": [{"data_class": "dob"}, {"data_class": "insurance_member_id"}, {"data_class": "ssn"}],
  "requested_duration": "72h",
  "context": {"booking_ref": "BAY-1042"}
}
```

`kind` is `clinic`, `care_facility`, `business`, `person` or `agent`. Each item comes back with `status` (`granted`, `awaiting_owner`, `denied`, `revoked`, `expired`, `error`), a `decision` (`action`, `duration_s`, `expires_at`, `reason`, `counter_offer`, `recommendation`, `rule_id`, `decided_by`, optional `explanation`) and a `grant_id`. A `resource` in an item is optional: the policy catalog says where each data class lives, and a request naming a different resource is denied.

### Authentication

Owner and requester calls carry a DPoP-bound Solid access token: `Authorization: DPoP <access_token>` and a `DPoP` proof header (the same shape the browser Solid-OIDC flow produces). The service verifies the token signature against the issuer JWKS, `iss`, `exp`, the proof signature, `htm`, `htu` (`SKCONSENT_PUBLIC_URL` plus the path), `iat` within 5 minutes, a one-time `jti`, `ath`, and that the proof key matches the token's `cnf.jkt`. The identity is the `webid` claim. A requester WebID in the body is overwritten by the verified one. Owner actions need the subject's WebID or one of the policy's `approvers` (attorney-in-fact, parent).

Limits, stated plainly: JWKS is cached 10 minutes; the replay cache is in memory and per process; `aud` is not checked; there is no token revocation check; the `htu` check assumes the path the service sees is the path the client signed (a reverse proxy that rewrites paths needs `SKCONSENT_PUBLIC_URL` and matching paths); the read endpoints (`GET /requests`, `/grants`, `/audit`, `/events`) are open in this demo, so run it on localhost or behind auth. With `DEMO_INSECURE_OWNER=1`, none of this applies: identity is whatever `X-Demo-WebID` says. The service logs a warning at start when it is on.

## Pod layout

All under the subject's storage root:

```
skpods/v1/health/            dob.ttl allergies.ttl medications.ttl insurance-card.ttl ssn.ttl   (demo fixtures)
skpods/v1/providers/         bayview-family-clinic.ttl      skp:ProviderLink
skpods/v1/bookings/          booking-bayview-1042.ttl       schema:Reservation
skpods/v1/consents/policy.jsonld                            guardian policy
skpods/v1/consents/requests/<id>.ttl                        skp:ConsentRequest (mirror)
skpods/v1/consents/grants/<id>.ttl                          skp:ConsentGrant (mirror, updated on revoke or expiry)
skpods/v1/consents/audit/<yyyy-mm-dd>.jsonl                 audit entries of that day (mirror)
```

The vocabulary is in `showcase/vocab/skpods-consent.ttl`. `seed-demo` sets these ACLs: the agent gets Read and Control (default) on `health/`, Read on `providers/` and `bookings/`, Read, Write and Control on `consents/`, never on the whole pod. `ssn.ttl` has its own ACL with the owner only, so the guardian cannot read or grant it even if the policy were wrong.

When a grant is approved the broker writes `<resource>.acl` with owner, agent (Read, Control), approvers, and one `acl:Read` authorization per active grantee on that resource, found through the resource's `Link rel="acl"`. When the last grant is gone the `.acl` is deleted and the container default applies. After a revoke the broker re-reads the ACL and records `revoke_verified`.

## Policy format

JSON-LD (the `@context` is informational; the service reads plain JSON). Rules run top to bottom, first match wins, no match means `ask_owner`. A missing policy means the guardian refuses requests for that person (404).

```json
{
  "@context": {"@vocab": "https://w3id.org/skpods/v1#"}, "@type": "GuardianPolicy", "version": 1,
  "owner": "<subject WebID>", "agent": "<guardian WebID>", "approvers": [],
  "managedContainers": ["skpods/v1/health/"],
  "catalog": {"dob": {"path": "skpods/v1/health/dob.ttl", "label": "Date of birth"}},
  "ceiling": "30d",
  "rules": [
    {"id": "never-share-ssn", "dataClasses": ["ssn"], "action": "deny",
     "reason": "...", "counterOffer": {"dataClass": "insurance_member_id", "message": "..."}},
    {"id": "basic-health-booked-provider", "dataClasses": ["dob", "allergies", "medications"],
     "requesterKinds": ["clinic"], "when": {"requesterInProviders": true, "hasBooking": true},
     "action": "approve", "maxDuration": "72h", "reason": "..."},
    {"id": "insurance-ask-owner", "dataClasses": ["insurance_member_id"], "requesterKinds": ["clinic"],
     "when": {"requesterInProviders": true}, "action": "ask_owner", "reason": "...",
     "recommend": {"action": "approve", "duration": "24h", "reason": "..."}}
  ]
}
```

- `dataClasses`: class names or `"*"`. `requesterKinds`: optional filter.
- `when.requesterInProviders`: the pod has an active `skp:ProviderLink` naming the requester as `skp:provider` and the subject as `skp:client`.
- `when.hasBooking`: the pod has a confirmed `schema:Reservation` with the requester as provider and the subject in `underName`, ending in the future, and matching `schema:identifier` when the request cites a `booking_ref`.
- `approve`: duration is the request capped to `maxDuration` (no request: the maximum, or 24h without one). Never longer than asked.
- Anything outside `managedContainers`, or a resource that differs from the catalog, is denied before the rules run.
- The default policy (`sk_consent::policy::demo_policy`) is: dob, allergies, medications auto for 72h for a booked, known clinic; insurance member ID asks the owner (recommending 24h); SSN denied with the counter offer "insurance member ID instead".

The LLM never decides. With `GUARDIAN_LLM_*` set, it is asked only to reword a decision that is already made; the result goes in `decision.explanation` and the rule `reason` stays. A failure or timeout (6s) leaves `explanation` empty. Tested against a local OpenAI-compatible endpoint.

## Audit chain

One chain per subject. Entry: `{seq, ts, event, subject, actor, request, item, grant, grantee, resource, data_class, detail, prev, hash}`; `hash = sha256(canonical JSON of the entry without hash)` (keys sorted, compact), `prev` is the previous hash, entry 0 uses `sha256("sk-consent audit genesis v1:" + subject)`. Events: `request_received`, `decision`, `grant_written`, `grant_failed`, `data_read` (self-reported), `revoke`, `expiry`, `revoke_verified`. The log holds identifiers, resources, modes and times, not personal content. Per-subject chains mean the pod mirror (`audit/<date>.jsonl`) can be verified from its entries alone. `GET /audit/verify` reports the first bad `seq`. Tamper-evident, not tamper-proof: someone who controls the database and recomputes every hash after an edit is not detected, unless the head hash (returned by verify) was stored elsewhere. The mirror in the pod is a second copy to compare against.

## Expiry

A sweeper runs every second over the persisted grants in SQLite and revokes anything past its end time (concurrently, one task per grant). Nothing lives only in memory, so a restart still revokes (tested by killing the service mid-grant). A failed revoke leaves the grant active and retries every 5 seconds.

## Tests

```bash
cargo test                       # unit tests: policy, audit chain, durations, DPoP proof shape, Turtle, store tamper
# live story against a pod server (ignored by default):
set -a; . creds.env; set +a; export SKCONSENT_CREDS_FILE=agent.env
cargo test --test clinic_story -- --ignored --nocapture
```

The integration test starts the service in process, seeds Alice's pod, files the clinic request for 20s, approves the insurance item as Alice with a real DPoP token, reads each item as the clinic (200, then 403 after the 20s expiry, SSN 403), revokes the insurance grant as the owner (clinic gets 403 at once), verifies the audit chain, then tampers with the store and expects `verify` to fail at the right index.

## What is verified, mocked, untested

- Verified on pods-dev: client-credentials mint and login as agent, Alice and the clinic; ES256 DPoP proofs (the server advertises RS256 in discovery but accepts ES256 for this flow, there is no RS256 fallback here); deep PUT creating parent containers; `Link rel="acl"` and per-resource `.acl` PUT and DELETE by an agent holding Control on the container (grant gives 200, delete gives 403 for the grantee); mirror writes; the owner-token verification with a real Alice token; auto revoke at 20s; restart persistence; optional LLM path.
- The engine converts JSON-LD to Turtle when asked for `text/turtle`, so the policy is read with `Accept: application/ld+json`.
- Mocked or approximate: "data read" events are reported by the grantee's client, not observed by the pod (no access log push exists); browser tokens are verified in the integration test with a client-credentials token, not with a token from the browser authorization-code flow.
- Untested: the browser authorization-code token path against `POST /requests/{id}/decide` (same checks, different grant); behaviour under concurrent requests for the same resource beyond a lock around ACL writes; Windows.
