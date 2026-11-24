# Engine notes: what pods-dev actually does

Verified 2026-11-23 and 2026-11-24 against `https://pods-dev.skstack01.douno.it` (Nextcloud app with a pdsinterop based Solid engine), with fake data only. Every line below was observed with a real request, mostly by the integration tests in `test/integration/`. Items marked **TEST** are asserted by a test, **PROBE** were observed by hand and are not (yet) a test. Statuses are exact.

Read this before building on the engine. Several behaviours differ from the Solid spec, and a few can damage a container.

## Summary table

| Topic | Result |
|---|---|
| Login: authorization code + PKCE (S256) | Works, public client, no secret needed for the code exchange (**TEST**, browser) |
| Login: implicit `id_token token` | Authorize endpoint redirects with tokens in the fragment (**PROBE**). Not used: code flow is complete and better |
| Dynamic registration | `POST /apps/solid/register` answers 201 but ignores the requested grant and response types: it always reports `implicit` / `id_token token` / `client_secret_basic`, even when you ask for `authorization_code` and auth method `none`. It still accepts the code flow afterwards (**TEST**) |
| Refresh token | Issued for scope `openid webid offline_access`, rotates on use. The refresh grant needs client authentication: `client_id` alone gives 401, HTTP Basic with the `client_secret` from registration gives 200 (**TEST**, browser reload with an aged token) |
| Token lifetime | 3600 s access token (**TEST**) |
| DPoP algorithm | Discovery advertises `["RS256"]` only. We follow `dpop_signing_alg_values_supported` and implement RS256 and ES256 (**TEST** RS256 live, ES256 unit only) |
| Token shape | `token_type` is `Bearer` but the token is DPoP bound (`cnf.jkt`). Send `Authorization: DPoP <token>` plus a proof with `ath`. The access token carries a `webid` claim, the id token does not (its `sub` is the WebID) (**TEST**) |
| DPoP nonce | Server never sent a `DPoP-Nonce` in our runs. The client handles it if it appears (unit tested) |
| N3 Patch | Works, `Accept-Patch: text/n3` is the only flavour. **BUG: only the last triple of an `inserts` or `deletes` clause is applied** (**TEST**) |
| SPARQL Update | `PATCH` with `application/sparql-update` answers 501 `Could not parse the requested resource for patching` (**PROBE**) |
| N3 Patch with `solid:where` variables | Variables are treated as IRIs and corrupt data: do not use (**PROBE**) |
| ETag / Last-Modified | **Never sent**, on any resource or container (**PROBE**). `Cache-Control: no-cache, no-store, must-revalidate` |
| `If-Match`, `If-None-Match` on write | **Ignored**: a wrong `If-Match` and `If-None-Match: *` on an existing resource both succeed and overwrite (201) (**PROBE**) |
| Notifications | `/.well-known/solid` advertises WebSocket and WebHook channels. WebSocket subscription answers 200 but its `source` URL points at an in-cluster host that browsers cannot resolve. WebHook registration answers 200 (needs a public target, delivery not tested). No `Updates-Via` header. Treat as unavailable, poll (**PROBE**) |
| `acl:agent` | Works, per resource and per container with `acl:default` (**TEST**) |
| `acl:agentGroup` | **Not enforced**: a member of a `vcard:Group` (group document public) still gets 403 (**PROBE**) |
| `acl:agentClass foaf:Agent` | Public access works (**PROBE**) |
| `acl:agentClass acl:AuthenticatedAgent` | Not used by the showcase. Grant named agents (`acl:agent`) only |
| Append-only | Works for `POST` into the container (201, the slug is honoured including its extension). The appender gets 403 on GET, list, PUT-overwrite, PUT-create, PATCH and DELETE (**TEST**) |
| Mode headers | `WAC-Allow` is sent on every response: `user="read write control",public="read"` (**TEST**) |
| Invalid `.acl` | **Invalid Turtle in a `.acl` answers 500 and then every request for that container, including the owner's, answers 500.** The API cannot repair it (GET, PUT, DELETE of the `.acl` all 500). Recovery needs the Nextcloud Files WebDAV (`/remote.php/dav/files/<user>/solid/...`) (**PROBE**) |
| Owner lockout | A valid `.acl` without a Control rule for the owner locks the owner out: 403 on everything, forever, via the API (**PROBE**) |
| CORS | Preflight 200, `Access-Control-Allow-Origin` echoes the origin (or `*`), credentials true, allows `authorization`, `dpop`, `content-type`, `link`, `slug` (**PROBE**) |

## Resources and containers

- **PUT creates missing parents.** `PUT a/b/c.ttl` on an empty container answers 201 and creates `a/` and `a/b/` (**TEST**). A replace also answers 201, not 200 or 204. `PATCH` on a missing resource creates it (201).
- **PUT on an existing container** answers `400 Requested path ... already exists. Can not "PUT" existing container.` (spec says 409 or an idempotent success). To create an empty container, `POST` to the parent with `Slug: name` and `Link: <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"`: 201, the new container is `name/` (**TEST**, `ensureContainer`).
- **DELETE of a non-empty container** answers `400 Only empty containers can be deleted`. A container also counts as non-empty while a child's `<child>.acl` exists, and those `.acl` files are not listed. `PodStore.deleteRecursive` deletes `<child>.acl` and the container's own `.acl` explicitly (**TEST**).
- **Content type follows the file extension on read.** `.ttl` gives `text/turtle`, `.json` gives `application/json`, a name without extension gives `application/octet-stream`, `.bin` gives `application/x-bin`, whatever the PUT said. Always give resources a matching extension (`req-1.ttl`). `POST` with `Slug: x.ttl` keeps the extension; a POST without a slug gets an upper case UUID plus `.ttl` for Turtle bodies (**TEST** for slug).
- **HEAD answers 204 for everything, including resources and containers that do not exist.** Use GET to test existence (404 means missing). `PodStore.exists` uses GET (**TEST**).
- **GET missing** is 404 with a text body. **DELETE missing** is 404.
- **Container listings** (`ldp:contains`) include `.acl` documents of the container itself and nothing else about the children (no sizes, dates or types except `ldp:Container`). `PodStore.list` hides `.acl` (**TEST**).
- **Turtle is stored verbatim on first PUT, and rewritten with absolute IRIs once a PATCH touches it.** Relative `<#x>` therefore survives until the first patch. Always parse with the resource URL as base (`parseTurtle(text, url)`).
- **`Accept: application/ld+json`** returns a JSON-LD array body, but the `Content-Type` header still says `text/turtle`. Do not trust the header: ask for Turtle.
- Anonymous or unauthorised requests to protected resources answer **403** (not 401). A garbage `Authorization: DPoP` header answered 409 once (**PROBE**).
- A root level `GET storage/` is public (default root ACL: public Read on the root listing only). Children inherit nothing for the public (the root rule has no `acl:default` for public), so `storage/private/...` is owner only (**TEST**).

## Patch details

`PATCH` with `text/n3` and a `solid:InsertDeletePatch`:

- Single triple per clause works, relative (`<#x>`) or absolute subject IRIs, deleting and inserting together (**TEST**).
- **Only the last triple of each `solid:inserts` / `solid:deletes` clause takes effect.** Reproduced with N-Triples separated by newlines, with `;` lists and with Turtle shorthand (**PROBE**, all variants). Two deletes plus one insert in one request deleted only the last one.
- `PodStore.patch()` therefore sends **one request per triple**, deletes first. This is not atomic: a failure half way leaves a partial change. When you need an all-or-nothing change of a small document, use `PodStore.replaceTurtle` (GET, modify, PUT), accepting that without ETag two writers can overwrite each other (last write wins).
- Deleting a triple that is not there is silently fine (201).

## Concurrency and change detection

There is no ETag, no Last-Modified, and conditional headers are ignored, so **optimistic concurrency is impossible on the server**. Design apps so that each writer owns its own resources (one file per message, per receipt, per consent), never edit a shared document from two actors, and use Append-only containers for deliveries. `watchResource` (poll plus body hash, backoff while idle, paused while the tab is hidden) is the change detection primitive; for a container, poll the listing and compare the child URL set.

## Web Access Control

What works (all **TEST**, `test/integration/wac.test.ts`):

1. `Link: <r.ttl.acl>; rel="acl"` on every response (also HEAD). The URL is relative to the resource. A resource with no own `.acl` answers 404 for it and inherits from the nearest container `.acl` that has `acl:default`; the pod root `.acl` is created at provisioning.
2. A resource `.acl` PUT by the owner takes effect at once. Grant, then the grantee reads (200, `WAC-Allow: user="read"`) and cannot write (403); rewriting the `.acl` without the rule revokes at once (403 again).
3. A container `.acl` with `acl:default` is inherited by children that exist and by children created later.
4. Relative IRIs in `.acl` (`<./>`) resolve against the `.acl` URL. `PodStore` and the WAC helpers always write absolute IRIs anyway.
5. Writing needs `Control` on the target: a non-owner with Read and Write gets 403 on `GET` and `PUT` of the `.acl`.

Rules the helpers enforce because the engine will not:

- `writeAcl` parses the document first (invalid Turtle bricks the container with 500s, see above) and **refuses a rule set in which the owner has no Control** (lockout).
- When a resource gets its first own `.acl`, the inherited rules from the container no longer apply to it. `grantAccess` starts from `owner: Read Write Control` only, so any public or shared rule inherited from the container is dropped for that resource. Re-add it explicitly if you want it.

## Notifications: what to do in apps

Poll. Use `watchResource` with `intervalMs` around 3000 for chat and 5000 to 15000 for dashboards. The WebHook channel could drive a server side component (for example the Rust `sk-consent` service) later, but it has not been exercised.

## Login: the exact browser flow that works

1. `GET /.well-known/openid-configuration`. Endpoints from discovery. `code_challenge_methods_supported: ["S256"]`.
2. `POST registration_endpoint` with `{application_type: "web", client_name, redirect_uris: [exact URI], grant_types: ["authorization_code","refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope}` returns 201 with `client_id` and (despite `none`) a `client_secret`. The response lies about the grant types (see table). Cache the client per issuer and redirect URI.
3. Redirect to `authorization_endpoint` with `response_type=code`, `scope=openid webid offline_access`, `code_challenge`, `code_challenge_method=S256`, `state`, `prompt=consent`. The Nextcloud login form appears (fields `user`, `password`), then a consent page with Allow and Deny buttons. The callback is `redirect_uri?code=...&state=...&iss=<issuer>`.
4. `POST token_endpoint` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` and a DPoP proof (no `ath`), no client authentication. Response: `access_token`, `refresh_token`, `id_token`, `token_type: Bearer`, `expires_in: 3600`.
5. Refresh: `grant_type=refresh_token`, `refresh_token`, `client_id`, **with HTTP Basic client authentication using the registered `client_secret`**, and a DPoP proof from the same key. The response contains a new refresh token.
6. `http://localhost:<port>` redirect URIs are accepted by registration. Registering a client does not need any authentication.

Agent flow (client credentials): `POST /apps/solid/client-credentials` with Basic user and password (an app password also works, a normal account password worked for the test users), `OCS-APIRequest: true`, returns `client_id`, `client_secret`, `webid`. Then `grant_type=client_credentials&scope=webid` with Basic client auth and a DPoP proof. No refresh token: the Node helper re-requests the token at 80 percent of its lifetime with the same key.

## Hazards found while testing

- One malformed `.acl` makes a container unreachable through the API, including for its owner (see above). Never hand-write ACL Turtle in app code: use `writeAcl`.
- Test data created through the API can be removed through the Nextcloud WebDAV endpoint with the account password when the API cannot (`DELETE /remote.php/dav/files/<user>/solid/<path>/`). The test suites always clean up through the pod API.
- Pod seeds are server side data. Profile names and some container names on pods-dev come from the seeding, not from these apps.
