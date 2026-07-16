# Sign the desktop release artifacts

**Area:** desktop/tooling · **Origin:** desktop-packaging research 2026-07-16 · **Priority:** P3
**Needs user:** account sign-ups (SignPath application, optional Apple Developer Program) and the
decision to spend $99/yr for macOS.
**Blocked by:** docs/tickets/tooling/desktop-release-ci.md (signing hooks into the CI release build)

Unsigned builds trip Windows SmartScreen ("Windows protected your PC") and macOS Gatekeeper
(Sequoia removed the right-click-open bypass; users must go through System Settings → "Open
Anyway"). Deliberately deferred at packaging time — the warnings are survivable (devilutionX ships
unsigned) but hurt casual adoption.

Research findings (2026-07, verified against the projects' CI):

- **Windows, $0: SignPath Foundation** — free code signing for OSS; exactly what OpenRA uses
  (`signpath/github-action-submit-signing-request@v2` in their packaging workflow). Requirements:
  OSI license (GPL ✓), releases built by public CI from the public repo, per-release manual
  approval, "signed by SignPath Foundation" publisher string + a credit on the site. EV certs no
  longer grant instant SmartScreen reputation (Microsoft removed that in 2024), so there is no
  reason to buy one. Alternative: Microsoft Store MSIX (Microsoft re-signs; individual registration
  now free) as a parallel channel.
- **macOS, $99/yr:** Apple Developer ID + `notarytool` notarization is the only clean path (OpenRA
  and OpenTTD both pay it from donations). No OSS waiver for individuals. Until then macOS builds
  ship unsigned with "Open Anyway" instructions; note Homebrew 5 will delist unsigned casks
  (~Sept 2026), so a cask is not an alternative channel without this.
- **Linux:** no signing problem; Flathub is the trust channel (separate concern, not this ticket).

## Scope

- Apply to SignPath Foundation once the repo is public and CI produces release artifacts; add the
  signing step to the release workflow (upload unsigned NSIS/portable artifacts, submit signing
  request, publish signed).
- Optionally: Apple Developer ID + notarization step (`codesign --options runtime`, `notarytool`,
  stapling) gated on the user buying the membership; electron-builder supports both natively.
- Update the download/README instructions to drop the "bypass the warning" caveats once signed.

## Verify

Download each published artifact on a clean machine/VM: Windows installer runs without the
SmartScreen "unknown publisher" block (reputation may need time on a fresh cert — check the
publisher string is SignPath Foundation); a notarized dmg opens without the Gatekeeper refusal.
