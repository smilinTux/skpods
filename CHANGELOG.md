# Changelog

All notable changes to this repo are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Changed

- Showcase apps: the pod URL field is gone. All five apps share one `PodSignIn` block: a big "Sign in with skpods.id" button, "Continue as ..." for accounts remembered on the device, and a "Use a different pod" field that works out the sign-in server from a WebID, a handle or a server address. The default provider is one shared constant, `DEFAULT_ISSUER`.

## [0.1.1] - 2026-11-23

### Changed

- Generic platform docs; app-specific material moved out; .NET SDK renamed SKPods.Client.

## [0.1.0] - 2026-11-23

### Added

- Initial documentation set: README hub, SOP, AGENTS, SECURITY, CONTRIBUTING, LICENSE (Apache-2.0).
- `docs/ARCHITECTURE.md`: components, dataflows, trust boundaries, scale-out, extensibility.
- Status labels for each part: `pods-dev` live, schema v0 stub, SDK stubs, consent broker planned, Rust engine planned.
