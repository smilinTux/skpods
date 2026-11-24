# AGENTS.md (skpods)

Public hub repo for SKPods: architecture, access and consent model, `pods-dev` guides, and code stubs for connecting an app to Solid pods. Read [README.md](./README.md) for the overview and [SOP.md](./SOP.md) for operations. Standard: [AGENT_INSTRUCTIONS_STANDARD](https://github.com/smilinTux/sk-standards/blob/main/standards/AGENT_INSTRUCTIONS_STANDARD.md).

## Source of truth and invariants

- The server is deployed by the `skpods` role in [smilinTux/skstacks](https://github.com/smilinTux/skstacks), not from this repo. This repo documents and supports it.
- The pod is the only place personal data lives. Apps and bridges hold references only.
- Apps use plain Solid HTTP with DPoP through the `PodStore` interface. Never add engine-specific (Nextcloud) calls to app code.
- Pod paths are versioned (`/skpods/v1/...`) and found through Type Indexes. Do not hardcode paths in app logic where a Type Index lookup works.

## Commands

```bash
# docs gate (what CI runs)
python3 <path-to-sk-standards>/scripts/docs_check.py --repo .
# .NET stubs
cd sdk/dotnet && dotnet build
# Rust skeleton
cd sdk/rust/sk-solid && cargo build
# dev server smoke test
curl -s https://pods-dev.skstack01.douno.it/.well-known/openid-configuration
```

The .NET and Rust parts are stubs and may not build until their TODOs are filled in.

## Start here

1. [sdk/dotnet/](./sdk/dotnet/): the `PodStore` interface.
2. [docs/LOGIN-AND-AUTH.md](./docs/LOGIN-AND-AUTH.md) and [docs/TEST-ACCOUNTS.md](./docs/TEST-ACCOUNTS.md): authenticate with the fake accounts.
3. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md): how it fits together.

## Rules

- **Never commit credentials.** No passwords, tokens, app passwords, client secrets, keys, vault names or paths. They are delivered privately by the SKPods admin. Use env vars and placeholders like `<APP_PASSWORD>`.
- **Use test accounts only.** Work against the fake users on `pods-dev` (see [docs/TEST-ACCOUNTS.md](./docs/TEST-ACCOUNTS.md)). Never put real personal data in a pod, fixture, test or doc.
- **Reuse standard vocabularies.** Do not invent properties; reuse schema.org, vcard, FOAF and Solid terms first. Example data uses the `skp:` prefix (`https://w3id.org/skpods/v1#`) only where nothing standard fits.
- **Honest status labels.** Mark things Working, Stub, Designed or Planned. Never present the consent broker, the Rust engine or the conformance gate as working. `pods-dev` is live only once the README says so.
- **Stubs say they are stubs.** Real signatures, `TODO` bodies, a note at the top of the file.
- **Writing style:** no em dashes (U+2014) and no en dashes (U+2013) anywhere: code, comments, docs, commits, PR bodies. Use commas, parentheses, colons or a new sentence. Hyphens are fine.
- **Branch and commit:** never commit to `main`. Branch, commit as soon as a fast check passes and before any long verification, then open a PR.
- **Attribution:** a `Co-Authored-By` trailer names the agent that actually did the work, or is left out.

## Privacy

Never put any of these in code, docs, tests, fixtures, commits or issues: host names or IPs of internal machines, private repository URLs, vault or secret-store names, credentials, registry pull credentials, personal names or data, customer names, pricing or business projections. For this repo, also: no details of any security issue. Enforced by: review only.

## Hazards

- **Hostname is permanent.** Each pod's root ACL stores the owner's full WebID. Changing the server hostname after pods exist locks owners out. Do not suggest hostname changes casually.
- **WAC grants do not expire.** Do not promise time-limited access from WAC alone; that is the planned consent broker's job.
- **Pod URLs use `~<user>`:** `https://<host>/apps/solid/~<user>/profile/card#me` and `.../storage/`. Copying a different engine's URL shape will fail.
- **DPoP proofs are per request.** A proof is bound to the method and URL. Reusing one gives `401`.
- **Do not deploy from an untagged checkout.** Deploys go through the SKStacks role at a release tag.

## See also

- [smilinTux/skstacks](https://github.com/smilinTux/skstacks): the role that deploys SKPods.
- [pdsinterop/solid-nextcloud](https://github.com/pdsinterop/solid-nextcloud): the Solid app in today's engine.
- [SK_REPO_DOC_STANDARD](https://github.com/smilinTux/sk-standards/blob/main/standards/SK_REPO_DOC_STANDARD.md)
