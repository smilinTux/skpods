# Contributing to SKPods

Thanks for helping. This repo is public: docs and code stubs for connecting apps to Solid pods. By taking part you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Contributions are licensed under [Apache-2.0](./LICENSE).

Read [README.md](./README.md) and [AGENTS.md](./AGENTS.md) first. AI agents follow the same rules as people.

## Before you start

- Open an issue or comment on one for anything larger than a typo.
- Security problems go through [SECURITY.md](./SECURITY.md), privately. Never in an issue or PR.

## Branch and commit

- Never commit to `main`. Branch: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`.
- Commit small and often. Commit before any long check, not after.
- Commit messages: a short imperative subject, then a body that says why.
- A `Co-Authored-By` trailer names the agent that actually did the work, or is left out. Do not add one you cannot back up.
- Style: plain, direct English. No em dashes and no en dashes anywhere (docs, code, comments, commits, PR text). Use commas, parentheses, colons or a new sentence. Hyphens are fine.

## What a good change looks like

- Honest status labels: Working, Stub, Designed or Planned. Do not label something Working without evidence (a command, a test, a spec).
- Docs: one canonical home per fact, linked rather than copied. Follow the [SK repo doc standard](https://github.com/smilinTux/sk-standards/blob/main/standards/SK_REPO_DOC_STANDARD.md).
- Data models: reuse schema.org, vcard, FOAF and Solid terms before adding new ones. Version in the path (`/skpods/v1/`), never break `v1` in place.
- Code stubs: real signatures, `TODO` bodies, and a note at the top that it is a stub.
- Nothing private: no credentials, tokens, vault names, internal hostnames or IPs, private repo URLs, real personal data. Use placeholders (`<APP_PASSWORD>`) and the fake test accounts.

## Test gate

```bash
python3 <path-to-sk-standards>/scripts/docs_check.py --repo .
```

Also run the checks for the part you touched (see [SOP.md](./SOP.md) section 4). The PR is not ready until they pass.

## Review

Open a PR against `main` with a short description, what you verified, and any status label you changed. A maintainer reviews; at least one approval is needed to merge. Squash merge. We may ask you to soften a claim we cannot verify.
