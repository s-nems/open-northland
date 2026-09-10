# Net-server package contract

`packages/net-server` is the relay a networked game runs through. It is the authority for time (the
tick clock), order (which envelope applies on which tick, in which position), membership (rooms,
seats, identities), and session settings (speed, pause), and for nothing else. The root
[`AGENTS.md`](../../AGENTS.md) applies in full; the wire contract is
[`docs/NETWORK.md`](../../docs/NETWORK.md).

## Boundary

- Holds no game content and runs no simulation. Runtime dependencies are `ws` and
  `@open-northland/net-protocol`; `lockstep` and `sim` are type-only and test-only, so the server
  image never loads them. That is what keeps the image shareable under `docs/LEGAL.md`.
- Never interprets a command payload or a blob. It reads an envelope's authority half, stamps the
  seat from the connection, and forwards the rest byte for byte; every client validates with the
  sim's parser. A blob is a type, a tick, and bytes the relay stores or forwards unread.
- Issues one trusted command of its own, `setPlayerAi` for a kicked seat, and no other; the wire
  parser on every client refuses any other trusted envelope in a frame.
- `Relay` is transport-free and clock-free: the host feeds it connections, messages, and `advance`
  calls on a poll, and a test feeds it the same from a virtual clock and an in-memory network. Keep
  new behavior in `relay/`, not in the WebSocket host.

## Verification

Unit tests drive `Relay` directly. The headless client under `test/support/` runs the real sim over
`@open-northland/lockstep`, so a relay change is proven against real state; the decoded-map run of
that harness lives in `packages/app/test/content/`.
