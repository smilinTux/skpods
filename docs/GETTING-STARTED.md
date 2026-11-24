# Getting started on pods-dev (15 minutes)

Status: pods-dev is live since 2026-11-23 (discovery, WebID profiles, CORS, agent login with DPoP, own-pod read/write and the cross-pod 403 all verified).
Maturity-tier: new (dev first)
Audience: app developers and the AI coding agents working with them.

By the end of this page you will have logged in on the web, found your WebID and pod, read and written a resource over Solid HTTP with DPoP, run the permission check, and know how to get clean test data back.

## 1. What pods-dev is

| Fact | Value |
|---|---|
| Base URL (and OIDC issuer) | `https://pods-dev.skstack01.douno.it` |
| Purpose | Solid pod server for building and testing apps. Fake data only. Resettable. |
| Engine today | A slim standalone Nextcloud with only the Solid app, built from source by our CI and pinned by digest |
| Engine later | A Rust engine behind the same HTTP surface, switched on only after it passes the same conformance gate |
| Production (later) | `https://pods.skstack01.douno.it` |
| Your code talks to | Plain Solid HTTP with Solid-OIDC and DPoP, through a `PodStore` interface. Nothing Nextcloud-specific. |

Anyone can run an identical instance with the SKStacks role `v1/ansible/optional/skpods` (release `skstacks-v2.26.33`, playbook `deploy_skpods-dev.yml`) in [github.com/smilinTux/skstacks](https://github.com/smilinTux/skstacks). See [ARCHITECTURE.md](./ARCHITECTURE.md).

Let `H=https://pods-dev.skstack01.douno.it` in the commands below.

## 2. Get your credentials (delivered privately)

The SKPods admin sends your credentials through a private channel. Never commit them, never paste them into a ticket, a chat or an AI prompt.

| You get | Used for |
|---|---|
| `manolo` username and password | Web login, and as the login for the browser flow (see [LOGIN-AND-AUTH.md](./LOGIN-AND-AUTH.md), path 1) |
| Passwords for the `dw-*` human test users | Browser-flow tests as a parent, spouse, and so on (see [TEST-ACCOUNTS.md](./TEST-ACCOUNTS.md)) |
| `dw-agent` `client_id` and `client_secret` | Headless agent tests (path 2) |

Keep them in environment variables or a local secret store:

```bash
export SKPODS_BASE=https://pods-dev.skstack01.douno.it
export SKPODS_USER=dw-agent
export SKPODS_CLIENT_ID='<CLIENT_ID>'
export SKPODS_CLIENT_SECRET='<CLIENT_SECRET>'
```

You can mint your own client credentials for `manolo` from an app password. See LOGIN-AND-AUTH.md, "Minting client credentials".

## 3. Check the server is up

```bash
curl -s $SKPODS_BASE/.well-known/openid-configuration | python3 -m json.tool
```

Expected: HTTP 200 and `"issuer": "https://pods-dev.skstack01.douno.it"` (https, no trailing slash). The document also lists `token_endpoint`, `authorization_endpoint`, `jwks_uri` and the registration endpoint. If `issuer` starts with `http://`, stop and tell the admin: every WebID would be wrong.

## 4. Log in on the web

Open `https://pods-dev.skstack01.douno.it/` and sign in as `manolo`. This is the Nextcloud web UI of your own pod (path 3 in LOGIN-AND-AUTH.md). Your pod is the `solid/` folder in your Files. The server runs a slim app set, so some Nextcloud menus are missing on purpose.

## 5. Find your WebID and pod

For a user `<user>` on pods-dev:

| Thing | URL |
|---|---|
| WebID | `https://pods-dev.skstack01.douno.it/apps/solid/~<user>/profile/card#me` |
| Profile document | `https://pods-dev.skstack01.douno.it/apps/solid/~<user>/profile/card` |
| Pod root (storage) | `https://pods-dev.skstack01.douno.it/apps/solid/~<user>/storage/` |
| Private area (owner only) | `https://pods-dev.skstack01.douno.it/apps/solid/~<user>/storage/private/` |

Note the tilde: `~manolo`, not `@manolo`.

```bash
# public: the profile is world-readable
curl -s -H 'Accept: text/turtle' $SKPODS_BASE/apps/solid/~dw-alice/profile/card
# public: the pod root container listing is readable by default
curl -s -H 'Accept: text/turtle' $SKPODS_BASE/apps/solid/~dw-alice/storage/
```

The Solid app's default root ACL makes each pod's storage root itself publicly readable (a container listing). Anything private goes under `storage/private/`, which only the owner can read. Example app data goes under `storage/skpods/v1/...`. Do not put personal data in the root.

Whether the profile lists the pod root (`pim:storage`) and the issuer (`solid:oidcIssuer`): verify on pods-dev. Do not hardcode the storage path in app code; read it from the profile once it is confirmed, or from config.

## 6. First read and write

Reading public resources works with plain curl. Anything authenticated needs a DPoP proof, which curl cannot sign. Use one of:

- the reference script in [LOGIN-AND-AUTH.md](./LOGIN-AND-AUTH.md#reference-script-headless-agent) (Python, about 70 lines),
- the raw HTTP examples in [../sdk/http/](../sdk/http/),
- the .NET client stub in [../sdk/dotnet/](../sdk/dotnet/).

What the script does, so you can follow along in any language:

1. `GET $H/.well-known/openid-configuration`, take `token_endpoint`.
2. `POST token_endpoint` with HTTP Basic `client_id:client_secret`, form body `grant_type=client_credentials&scope=webid`, and a `DPoP` proof header. The answer is a DPoP-bound access token (one hour).
3. `PUT $H/apps/solid/~dw-agent/storage/hello.ttl` with `Authorization: DPoP <token>`, a new `DPoP` proof (with `ath`), `Content-Type: text/turtle`. Expect 200, 201 or 204.
4. `GET` it back, expect 200 and your triples. `DELETE` it, expect 200 or 204.

## 7. Run the permission check

The permission check proves the rules the whole product depends on: you can read and write your own pod, and you cannot read someone else's private area.

```bash
python3 solid_check.py --other dw-alice      # copy the script from LOGIN-AND-AUTH.md
```

Expected output (PASS or FAIL per line, never secrets):

```
[PASS] discovery
[PASS] webid profile (other user, https IRIs)
[PASS] cors preflight
[PASS] token (client_credentials + DPoP)
[PASS] write own pod
[PASS] read own pod
[PASS] delete own resource
[PASS] other user's private storage denied   (403)
[PASS] anonymous read of own private storage denied   (401 or 403)
RESULT: ALL PASS
```

Any FAIL on the last two lines is a blocker: tell the admin before you build anything on top. The full matrix of who may read and write what is in [TEST-ACCOUNTS.md](./TEST-ACCOUNTS.md).

## 8. Reset test data

| Method | Status |
|---|---|
| Ask the SKPods admin, or run the reset CI job | Working. Recreates every `dw-*` user and their pod. |
| `sk-solid seed --reset` (recreates all test users and fixture data in under a minute) | Planned (phase 2). Not available yet. |

Facts about a reset:

- Every `dw-*` user is deleted and recreated, and with it their pod data. Fixtures are not re-applied until the seed tooling exists, so expect empty pods right now.
- `manolo` is NOT reset (it is marked non-resettable). It is only reset when the admin is asked for it by name.
- Resetting recreates `dw-agent`, so its `client_id` and `client_secret` change. Ask for the new pair after a reset, or mint a new pair (LOGIN-AND-AUTH.md).
- You never need admin access on the server for any of this.

## 9. Rules

1. Fake data only. No real names, addresses, phone numbers, health data or children's data, ever, on pods-dev.
2. Test only with the `dw-*` accounts. Use `manolo` for your own dev work and treat its pod as scratch space too.
3. Never commit credentials, tokens or app passwords. Use environment variables and `<PLACEHOLDER>` values in docs and tests.
4. Code to the `PodStore` interface and Solid HTTP. No Nextcloud-specific URLs other than the Solid paths above, no WebDAV, no OCS calls (the single exception is minting client credentials, which is an admin-style bootstrap step, not app code).
5. The hostname is permanent for the life of the environment. If it ever changes, all test users are reset.
6. Report anything that looks like a security problem privately (see [../SECURITY.md](../SECURITY.md)), not in a public issue.

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Connection refused, 404 or TLS error on every URL | pods-dev is down or being redeployed | Status line at the top of this page |
| `401` on an authenticated call | Proof or token problem: wrong `htm`/`htu`, missing `ath`, expired proof, `Bearer` instead of `DPoP` | [LOGIN-AND-AUTH.md](./LOGIN-AND-AUTH.md) errors table |
| `403` on your own pod | WebID in the token does not match the owner, or the hostname changed since the pod was created | Decode the token, compare `webid` claim to the URL; ask the admin |
| `403` on another user's private area | Correct. That is the rule. | n/a |
| Browser login fails with CORS errors | Your app origin is blocked or a proxy header is interfering | Run the `OPTIONS` check in LOGIN-AND-AUTH.md |
| `dw-agent` credentials stopped working | A reset recreated the user | Ask for a new pair |

## Related projects / See also

- [LOGIN-AND-AUTH.md](./LOGIN-AND-AUTH.md): the three login paths in detail.
- [TEST-ACCOUNTS.md](./TEST-ACCOUNTS.md): every test user and the permission matrix.
- [ARCHITECTURE.md](./ARCHITECTURE.md), [ACCESS-AND-CONSENT.md](./ACCESS-AND-CONSENT.md), [CONFORMANCE.md](./CONFORMANCE.md).
- [../sdk/dotnet/](../sdk/dotnet/), [../sdk/http/](../sdk/http/).
- [Solid Protocol](https://solidproject.org/TR/protocol), [Solid-OIDC](https://solidproject.org/TR/oidc), [WAC](https://solidproject.org/TR/wac).
