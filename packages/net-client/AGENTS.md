# Net-client package contract

`packages/net-client` is one client of a relayed session: the state machine that walks the lobby,
opens the world the relay's `start` names, runs it through `@open-northland/lockstep` over the relay
transport, acknowledges every tick with its digest, follows the relay's clock, and answers snapshot
requests. The root [`AGENTS.md`](../../AGENTS.md) applies in full; the wire contract is
[`docs/NETWORK.md`](../../docs/NETWORK.md).

## Boundary

- Depends on `net-protocol`, `lockstep` and `sim`, and on the Web platform only through
  `WebSocket`, `CompressionStream`, `Response` and `crypto`, never the document. The DOM lib is on
  for their types; the headless client under `packages/net-server/test/support/`, which runs this
  package under Node, is what holds the boundary.
- Holds no display and no content. The world comes through a `WorldPort` the host supplies: a build
  from the descriptor, a restore from a snapshot, or a refusal that asks the relay for its cached
  snapshot. The host decides what a served snapshot does to its world; the client only drops the one
  it had.
- `RelayClient` is the frame loop's `SessionDriver` and the HUD's `SessionClock`: elapsed time in,
  paced a frame or two behind the relay to hold the jitter buffer; tempo and pause read as the relay
  last broadcast them, and a change is a request the relay applies for everyone.
- The snapshot encoding is this package's contract with every other client: gzip of the canonical
  save JSON, base64 on the wire, the session's map named in the header.

## Verification

Unit tests cover the pieces with a clock or a socket behind them. The state machine is proven end
to end by the headless client under `packages/net-server/test/support/`, which wraps `RelayClient`
over an in-memory relay, and by the decoded-map run in `packages/app/test/content/`.
