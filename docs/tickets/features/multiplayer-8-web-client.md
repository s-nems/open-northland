# Verify optional web multiplayer compatibility

**Area:** web, app · **Focus:** web shell compatibility · **Priority:** P3

Electron is the primary client. The app already has a shared relay client and multiplayer lobby;
verify them in the packaged web shell with its installed content and storage.

## Scope

- Verify the shared lobby and game flow through the web shell's installed content.
- Establish supported engines from cross-engine determinism evidence and refuse unsupported engines
  in the lobby with a clear message.
- Confirm nick and relay-scoped identity survive web-shell reloads.
- Verify HTTPS pages connect through WSS.

Background clients use ordinary relay waiting and kick voting. Visibility alone never removes a
player. A client that resumes uses existing buffered-frame and reconnect/resync mechanisms.
No dedicated hidden-tab scheduler or visibility-triggered snapshot recovery is required.

## Verify

- Two supported browser clients play a real map with identical hashes.
- An unsupported engine is refused before starting, with a clear message.
- Reload preserves identity and uses existing reconnection.
- Run `npm run check`, `npm run build`, `npm test`, `npm run web:site`, and a human browser pass.

Non-goals: WebTransport, service-worker game traffic, shell-specific simulation, automatic removal
on tab switching, and special hidden-tab catch-up.
