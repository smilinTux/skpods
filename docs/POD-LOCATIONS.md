# Pod locations

Status: design. Nothing on this page is built yet unless it says so.

## The idea

Your name stays put. Your files can live where you like.

A person's WebID (for example `https://alex.skpods.id/profile/card#me`) never changes. Their profile points at the pod storage (`pim:storage`), and the files behind that storage can live in different places. Apps always read and write through the pod address and the Solid APIs, so moving the files never changes anything for an app.

## Why this works with the engine

The Nextcloud engine keeps each pod in one folder per account. Anything mounted at that folder becomes the pod's storage, and the Solid layer (WAC permissions, Solid-OIDC login, WebID profiles) does not change. The engine mounts S3, WebDAV, SFTP and SMB natively. Providers without a native connector are reached through a bridge that exposes them over WebDAV.

One rule for every location: **the pod server is the only door.** Storage providers cannot enforce Solid access rules, so only the pod server reads or writes the files. Sharing a file directly from a storage provider bypasses the pod's sharing rules, and the app says so plainly.

## Locations

### Run by a pod server (works from phone and computer)

| Location | Access we request | What the pod server can see | Status |
|---|---|---|---|
| Pod server's own storage | Not applicable | The pod | Working (`pods-dev`) |
| S3-compatible storage (Garage, Cloudflare R2, Backblaze B2, Wasabi, AWS) | An access key limited to one bucket | One bucket | Planned. First test case, using Garage |
| Google Drive | `drive.file` (only files the app created) | The skpods folder | Planned |
| OneDrive (personal, work and school) | `Files.ReadWrite.AppFolder` | `Apps/skpods` | Planned |
| Dropbox | App folder | `Apps/skpods` | Later |
| Box, pCloud | Provider OAuth | A folder or the account | Later |
| WebDAV (Nextcloud, Koofr, Hetzner Storage Box) | An app password | What that password allows | Later |

Google `drive.file` note: the app only sees files it created. A file added to the skpods folder through the Drive website stays invisible to the pod.

### Home pod only (on the person's own computer)

Providers that would need the person's real account password, or that have no official API, are never connected from a shared server. A home pod (the pod server running on the person's own Windows, Mac or Linux machine, reachable through a tunnel) can point at their desktop sync folder instead:

- Local disk.
- MEGA, Proton Drive and iCloud Drive, through their desktop sync folders.
- Google Drive, OneDrive and Dropbox desktop folders, as an alternative to the hosted connection (watch out for online-only placeholder files).

Phones do not host pods: they sleep, change networks and have no stable public address. On a phone, people choose a server-run location and the app keeps an offline copy that syncs back.

## Plain or encrypted

- **Plain (default):** files are normal files at the provider, and people can open them in the provider's own app.
- **Private mode (opt-in):** the pod server encrypts files before they reach the provider, so the provider cannot read them. Files then only open through the pod, and losing the key means losing the files.

## Safety rules

- The narrowest permission each provider offers, never full account access.
- Provider tokens encrypted at rest, never logged, never shown to apps.
- A Disconnect button that revokes access at the provider and offers to move the pod first.
- No password-based provider connections on shared servers.

## Moving between locations

Moving a pod copies the data, verifies it, then flips the one `pim:storage` pointer in the profile. The pod portability work (archive format, server-to-server move, link rewriting, conformance test) is tracked separately and will get its own page.

## Order

1. Prove the storage swap with an S3 bucket per pod (Garage) on `pods-dev`: conformance suite, speed, quotas.
2. Backup copies to Google Drive and OneDrive.
3. Google Drive and OneDrive as primary storage, after the same tests pass.
4. Home pod for Windows, Mac and Linux.
5. More providers as people ask for them.
