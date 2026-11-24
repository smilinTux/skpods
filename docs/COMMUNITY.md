# Staying aligned with the Solid community

SKPods runs a Solid server. We want any spec-following Solid app to work against it and any app data
to be readable by other Solid apps, without our stack running one specific implementation. This file is how
we do that.

## 1. Principles

1. **Follow the specs, not one implementation.** Solid Protocol, Solid-OIDC, DPoP, WAC (ACP later), Type
   Indexes, WebID profiles, Solid Notifications. If an app works only against one server, we treat that as an app bug.
2. **Prove it.** Every engine build runs the official conformance harness and our SKPods scenarios
   ([CONFORMANCE.md](./CONFORMANCE.md)). Counts are tracked per release.
3. **Fix upstream, do not fork away.** A bug we find goes upstream as a small, focused PR. Several are
   open today on the Nextcloud Solid app. Until a PR merges, our build carries it on a branch, and we drop
   the carried change when upstream has it. We do not keep a private variant of behaviour.
4. **Open what is standard, keep what is ours.** The vocabulary and shapes can be open. The apps and the
   consent broker stay ours.
5. **No Node.js in our stack.** We stay compatible with what the Community Solid Server and others offer,
   without running it.

## 2. Engagement stages

| Stage | When | How |
|---|---|---|
| 1. Contributor | Now | PRs and issues upstream on the Nextcloud Solid app (maintainer contact already open). Read along on the Solid forum and chat. Security findings go privately to maintainers, never in public (section 4). |
| 2. Ask the spec people | When we hit a spec gap or ambiguity (time-limited access is the likely first one) | An issue on the relevant Solid spec repo, or a forum thread, with our concrete use case. |
| 3. Share the vocabulary | When a vocabulary is stable and used by a real app | Publish the shapes and vocabulary openly and ask for review, so other Solid apps can read the data. Separates what we open (vocabulary) from what stays app-specific. |
| 4. Announce the engine | When the Rust engine passes our conformance gate | Publish conformance results, get listed as a Solid server implementation, invite feedback. |
| 5. Standards work | If SKPods extends the protocol (for example consent with expiry) | Join the W3C Solid Community Group (free) and follow the W3C Linked Web Storage (LWS) working group, where the Solid protocol is being standardized. Propose extensions there instead of shipping private ones. |

Status: stage 1 is **Working**. Stages 2 to 5 are **Planned** and are triggered by the events in the table.

## 3. How we contribute

- **Small PRs.** One fix per PR, with a test, a clear description and a link to the spec text. Easy to review, easy to merge.
- **Carry branch.** Our build is the upstream app plus a branch of open PRs. When a PR merges, we drop it from the branch and bump the pinned version. The build is pinned by digest and built from source by our CI.
- **Spec gaps go to the spec people** (stage 2), not into our code as a private rule. Time-limited
  access is the likely first gap: WAC has no expiry, so our broker adds it
  ([ACCESS-AND-CONSENT.md](./ACCESS-AND-CONSENT.md) section 4). If a standard way appears, we move to it.
- **Be a good guest.** Use the project's issue templates and chat norms. Credit others. Do not ping maintainers for status.
- **Share results.** Conformance numbers go in release notes; stage 4 makes them public.

## 4. Security findings

If you find a security problem in a Solid server, app or library we use, report it **privately to the
maintainers** through their security contact, never in a public issue, PR or forum post. Our own policy
and contact for this repo are in [SECURITY.md](../SECURITY.md). In public places (issues, PRs, release
notes, forum posts) we describe changes in generic terms, for example "hardening" or "correctness fix",
until the maintainers have shipped a fix and say details may be shared.

## 5. What this means for app developers

- Build against the Solid spec through the `PodStore` interface. Do not call anything engine-specific.
- If you see behaviour that looks wrong, check it against the spec text first. If the spec is unclear, open
  an issue with a concrete use case (stage 2). If it is a bug, tell us and we send a small PR upstream.
- Do not put app-specific terms into a standard vocabulary. Reuse schema.org, vcard, FOAF and Solid terms
  first.

## Related projects / See also

- [CONFORMANCE.md](./CONFORMANCE.md): the gate and the counts.
- [ACCESS-AND-CONSENT.md](./ACCESS-AND-CONSENT.md): the consent broker and the standards it may adopt later.
- [ARCHITECTURE.md](./ARCHITECTURE.md): engine setting and layers.
- [Solid Project](https://solidproject.org/), [W3C Solid Community Group](https://www.w3.org/community/solid/), [Solid specifications](https://solidproject.org/TR/).
