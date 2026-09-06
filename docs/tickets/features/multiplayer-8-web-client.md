# Let the web shell join networked games on engines that hash identically

**Area:** web, app · **Focus:** web shell, net transport · **Priority:** P3
**Blocked by:** [multiplayer-5-electron-net-client.md](multiplayer-5-electron-net-client.md)

Web is an addition to desktop, not a requirement. It joins only on engines that passed the
cross-engine determinism check recorded by the first multiplayer ticket; a browser that did not is
refused in the lobby by its engine fingerprint rather than allowed to desync.

Two web-specific behaviors matter. A page served over `https://` must connect over `wss://`, which
the server deployment already provides. A hidden tab stops `requestAnimationFrame`, so the session
clock keeps running on the server while the client stops ticking; on return it must catch up from the
frames it missed or, past the waiting threshold, resync from a snapshot.

## Scope

- The WebSocket transport and lobby flow from the desktop tickets working in the web shell, with the
  engine fingerprint reported to the lobby.
- Hidden-tab handling: keep receiving frames while hidden, catch up on return within the driver's
  cap, and fall back to the snapshot resync path beyond it.
- Storage of the identity token and nick in the web shell's settings store.
- Non-goals: no WebTransport, no service-worker involvement in game traffic, no shell-specific sim
  changes.

## Verify

- Two Chromium tabs play a real map through the server with identical hashes; hiding one tab for
  longer than the waiting threshold ends in a resync and an identical hash afterwards.
- A browser with a failing engine fingerprint is refused in the lobby with a clear message.
- `npm run check`, `npm run build`, `npm test`, `npm run web:site`, plus a human pass in the browser.
