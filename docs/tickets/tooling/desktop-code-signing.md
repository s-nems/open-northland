# Sign desktop release artifacts

**Area:** desktop + tooling · **Priority:** P3
**Needs user:** signing accounts, CI secrets, and a decision on paid macOS distribution.

Unsigned Windows and macOS builds trigger operating-system trust warnings. That is acceptable for
development artifacts but adds friction to a public player release.

Provider requirements, prices, and platform policies change. Re-check the official Windows and Apple
distribution documentation when this ticket starts instead of relying on old research notes.

## Scope

- Choose the current Windows signing route for an open-source project and integrate it into the
  release workflow without exposing credentials.
- Add Apple Developer ID signing and notarization when the project has the required account.
- Keep unsigned development builds working and label them clearly.
- Update release instructions after signed artifacts are available. Treat Linux store/repository
  publishing as separate work.

## Verify

- Download release artifacts on clean Windows and macOS machines or VMs.
- Confirm the expected publisher identity, signature, and notarization with platform tools.
- Confirm a normal user launch no longer hits the unsigned-publisher refusal path.
