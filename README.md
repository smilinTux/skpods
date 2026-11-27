# SKPods

**SKPods hosts Solid pods: every person owns a pod, and apps read and write it only with that person's consent.** It is a generic platform: any app can use it, and anyone can run an identical instance of their own, deployed with the SKStacks role.
**Maturity tier:** T0, N/A (no key material is generated or held by this repo) · **Version phase:** Incubating v0 (docs and code stubs only) · **Status:** see the table below.

This repo is the one place a developer, and the AI coding agent working for them, reads to connect an app to Solid pods: architecture, access and consent model, the `pods-dev` server, test accounts, login, and code stubs.

## Status (honest labels)

| Part | Status | Evidence / where |
|---|---|---|
| `pods-dev` server | Live since 2026-11-23 (verified: discovery, profiles, CORS, agent DPoP login, own-pod read/write, cross-pod 403) | `https://pods-dev.skstack01.douno.it` (fake data only, resettable) |
| Engine: slim Nextcloud + Solid app | Working: live on `pods-dev` since 2026-11-23 | [skstacks role](https://github.com/smilinTux/skstacks) `v1/ansible/optional/skpods`, release `skstacks-v2.26.33` |
| Showcase apps (`showcase/`): Consent Center, Receipts Wallet, Pod Chat, Guardian (AI agent with a leash) | In progress | `showcase/` |
| SDK: .NET `PodStore` and DPoP client | Stub (real signatures, `TODO` bodies) | [sdk/dotnet/](./sdk/dotnet/) |
| SDK: Rust `sk-solid` crate | Stub (skeleton) | [sdk/rust/sk-solid/](./sdk/rust/sk-solid/) |
| Raw HTTP examples | Examples, unverified until `pods-dev` is live | [sdk/http/](./sdk/http/) |
| Consent broker (Rust) | Planned (Phase 3) | [docs/ACCESS-AND-CONSENT.md](./docs/ACCESS-AND-CONSENT.md) |
| Rust engine | Planned (Phase 4), only after it passes the conformance gate | [docs/CONFORMANCE.md](./docs/CONFORMANCE.md) |
| Conformance gate in CI | Planned (Phase 2) | [docs/CONFORMANCE.md](./docs/CONFORMANCE.md) |
| Production (`https://pods.skstack01.douno.it`) | Planned (Phase 4) | [SOP.md](./SOP.md) section 5 |

Phases: 0 pre-flight auth hardening (done on our build), 1 `pods-dev` live, 2 `sk-solid` tooling + conformance gate, 3 consent broker, 4 production + Rust engine.

## Start here

**(a) You are an app developer**

1. [docs/GETTING-STARTED.md](./docs/GETTING-STARTED.md): reach `pods-dev` and make your first request.
2. [docs/LOGIN-AND-AUTH.md](./docs/LOGIN-AND-AUTH.md): Solid-OIDC, DPoP, client credentials for agents.
3. [docs/TEST-ACCOUNTS.md](./docs/TEST-ACCOUNTS.md): the fake users and what each one covers.
4. [sdk/dotnet/](./sdk/dotnet/): the `PodStore` interface your app codes against.
5. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/ACCESS-AND-CONSENT.md](./docs/ACCESS-AND-CONSENT.md): the big picture, then who can see what.

**(b) You are an AI coding agent**

1. [AGENTS.md](./AGENTS.md): the rules for working in this repo.
2. [sdk/dotnet/](./sdk/dotnet/) and [sdk/http/](./sdk/http/).
3. [docs/LOGIN-AND-AUTH.md](./docs/LOGIN-AND-AUTH.md) and [docs/TEST-ACCOUNTS.md](./docs/TEST-ACCOUNTS.md) when you need to authenticate. Credentials are delivered privately by the SKPods admin. Never commit them.

## Repo map

| Path | What it is |
|---|---|
| [README.md](./README.md) | This hub. |
| [SOP.md](./SOP.md) | Operating procedure: architecture, build, test, deploy, configuration, reference, troubleshooting. |
| [AGENTS.md](./AGENTS.md) | Rules for AI agents working in this repo. |
| [SECURITY.md](./SECURITY.md) | Private vulnerability reporting, secret handling, scope. |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Branches, commits, review. |
| [CHANGELOG.md](./CHANGELOG.md) | Release history. |
| [LICENSE](./LICENSE) | Apache-2.0. |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Components, dataflows, trust boundaries, scale-out, extensibility. |
| [docs/GETTING-STARTED.md](./docs/GETTING-STARTED.md) | First steps against `pods-dev`. |
| [docs/LOGIN-AND-AUTH.md](./docs/LOGIN-AND-AUTH.md) | Login flows, DPoP, client credentials. |
| [docs/TEST-ACCOUNTS.md](./docs/TEST-ACCOUNTS.md) | The fake users and their roles. |
| [docs/ACCESS-AND-CONSENT.md](./docs/ACCESS-AND-CONSENT.md) | WAC, time-limited grants, the consent broker, audit log. |
| [docs/CONFORMANCE.md](./docs/CONFORMANCE.md) | The conformance gate and how we track Solid compatibility. |
| [docs/COMMUNITY.md](./docs/COMMUNITY.md) | How we work with the Solid community. |
| [docs/POD-LOCATIONS.md](./docs/POD-LOCATIONS.md) | Where pod files can live (S3, Google Drive, OneDrive, home pods) behind one WebID. |
| [sdk/dotnet/](./sdk/dotnet/) | .NET `PodStore` interface, DPoP client stub, example. |
| [sdk/rust/sk-solid/](./sdk/rust/sk-solid/) | Rust crate skeleton for the CLI and library. |
| [sdk/http/](./sdk/http/) | Raw curl/HTTP examples. |

## Quick links

- Dev server: `https://pods-dev.skstack01.douno.it` (fake data only, resettable)
- Production, later: `https://pods.skstack01.douno.it`
- Deploys with: the `skpods` role in [smilinTux/skstacks](https://github.com/smilinTux/skstacks), path `v1/ansible/optional/skpods`, env playbooks `deploy_skpods-dev.yml`, `deploy_skpods-staging.yml`, `deploy_skpods-prod.yml`
- Anyone can run an identical instance: see [SOP.md](./SOP.md) section 5.

## Honest claims (read this)

- Nothing here is audited. This repo holds docs and code stubs. It holds no secrets and generates no key material.
- The engine today is a slim standalone Nextcloud with only the pdsinterop Solid app. It is built from source by our CI and pinned by digest. It does not yet pass the full Solid conformance suite, and the repo says so in [docs/CONFORMANCE.md](./docs/CONFORMANCE.md).
- The consent broker and the Rust engine are plans, not software. Anything labelled Planned does not exist yet.
- `pods-dev` holds fake data only. Never put real personal data on it.

## Related projects / See also

- ⬆️ **Depends on:** [smilinTux/skstacks](https://github.com/smilinTux/skstacks): the `skpods` role that deploys the server, at a release tag.
- ⬆️ **Depends on:** [pdsinterop/solid-nextcloud](https://github.com/pdsinterop/solid-nextcloud): the Nextcloud Solid app that is today's engine.
- ⬆️ **Depends on:** [Solid specifications](https://solidproject.org/TR/protocol): Solid Protocol, [Solid-OIDC](https://solidproject.org/TR/oidc), [WAC](https://solidproject.org/TR/wac), [Type Indexes](https://solid.github.io/type-indexes/), [Solid Notifications](https://solidproject.org/TR/notifications-protocol), [WebID](https://www.w3.org/2005/Incubator/webid/spec/identity/).
- ⬇️ **Used by:** any app that talks to Solid pods, for example through the .NET `PodStore` interface.
- ↔️ **Sibling:** [W3C Solid Community Group](https://www.w3.org/community/solid/) and the Linked Web Storage work, where the protocol is standardized.
- 📐 **Standards:** [sk-standards](https://github.com/smilinTux/sk-standards): doc/SOP, security disclosure, architecture and dataflow.

*License: Apache-2.0.*
