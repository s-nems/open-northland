# Sign desktop release artifacts

**Area:** desktop, tooling · **Priority:** P1
**Needs user:** provide the Windows signing identity, Apple Developer credentials, and CI secret policy.

The release workflow publishes unsigned Windows and macOS installers. Windows shows an
unknown-publisher warning, and macOS Gatekeeper blocks a normal first launch. That is acceptable for
development builds, but it blocks a normal public release.

## Scope

- Sign Windows installers with the chosen certificate or trusted signing service.
- Sign and notarize both macOS architectures with hardened runtime enabled.
- Keep credentials in GitHub environments or repository secrets; forks and pull requests must not
  receive them.
- Make release publication fail when a required signature or notarization step fails.
- Leave local and pull-request builds unsigned and clearly labelled.

## Verify

- Windows reports the configured publisher and launches without the unknown-publisher warning.
- macOS passes `codesign --verify --deep --strict` and `spctl --assess` on both architectures after download.
- A manual unsigned build still works and remains visibly marked as a development build.
