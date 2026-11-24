# Security policy

## Report a vulnerability (private only)

Use GitHub private vulnerability reporting on this repository: **Security > Report a vulnerability**. Do not open a public issue, pull request or discussion for a security problem, and do not post details anywhere public.

- We acknowledge a report within 72 hours.
- We triage, fix in private, and coordinate a disclosure date with you. Target is 90 days or sooner; active exploitation shortens it.
- With your consent we credit you in the advisory and the [CHANGELOG](./CHANGELOG.md).
- Good-faith research that follows this policy will not be pursued.

## Scope

| In scope | Out of scope |
|---|---|
| Documents, schema, fixtures and code stubs in this repo | Third-party dependencies (report upstream; we will track and update) |
| Mistakes in this repo that would lead a reader to an insecure setup | Theoretical findings with no realistic impact on a supported setup |
| Credentials or private data committed here by mistake | Real personal data (none should exist here; `pods-dev` is fake data only) |

For the Solid app and Nextcloud, report to their maintainers as well as to us if the issue is in their code.

## Supported versions

| Version | Supported |
|---|---|
| Latest 0.x release | Yes |
| Older | No |

## What this repo holds

Documentation, schema v0 (stub), and code stubs. It holds no secrets and generates no key material. It is not audited and makes no cryptographic claims.

## Secret handling

- Never commit passwords, tokens, app passwords, client secrets, private keys or vault contents. Credentials are delivered privately by the SKPods admin.
- Read credentials from environment variables or a local secret store. Use placeholders such as `<APP_PASSWORD>` in docs and examples.
- Use the fake test accounts on `pods-dev` ([docs/TEST-ACCOUNTS.md](./docs/TEST-ACCOUNTS.md)). Never put real personal data on `pods-dev`.
- If you commit a secret by accident, do not just delete it in a new commit. Report it privately so it can be rotated and the history cleaned.
- Do not include internal hostnames, IP addresses or private repository locations in any issue, PR, doc or fixture.

## Security model (summary)

Apps authenticate with Solid-OIDC and DPoP-bound tokens; access to each resource is decided by WAC; time-limited consent is owned by a consent broker (Planned) with a chain-linked audit log. Detail and trust boundaries: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/ACCESS-AND-CONSENT.md](./docs/ACCESS-AND-CONSENT.md).

Standard: [SECURITY_DISCLOSURE_STANDARD](https://github.com/smilinTux/sk-standards/blob/main/standards/SECURITY_DISCLOSURE_STANDARD.md).
