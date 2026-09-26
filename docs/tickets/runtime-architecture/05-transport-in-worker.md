# Run the relayed session and its transport inside the worker

**Area:** net-client, app, lockstep · **Focus:** relay-client, worker host · **Priority:** P2
**Blocked by:** [00 Heavy-load reference](00-heavy-load-reference.md)

The `?map=` entry already runs its sim, `LockstepDriver` and `LoopbackTransport` in a worker
(`packages/app/src/session/worker/`, entry `entries/map/sim-worker.ts`). The relayed entry does not:
`RelayClient` is the session driver on the main thread and reads the live sim for the per-tick
digest, the acknowledgement, `captureSave` and the match end. Serving those through worker round
trips would put a main-thread hop in every acknowledgement, so a main-thread stall would still delay
the acknowledgement the relay measures lag by. The relayed world therefore boots inline until the
client itself moves into the worker. `RelayClient` and `RelaySocket` depend on the Web platform only
through `WebSocket`, the compression streams, timers and `performance`, all of which a worker has.

## Scope

- `RelayClient`, `RelaySocket`, the digest trail and the pacer run in the worker, from the lobby on:
  a `WebSocket` cannot move between threads, so the worker is created when the client enters
  networking and owns the connection for the whole session. The main thread receives a mirror of the
  lobby state, the room clock, the waiting set and the connection figures, and sends lobby actions,
  clock requests, chat and commands. Snapshot requests are answered from the worker, which owns the
  world.
- The `?relay=` entry and the menu's network game (`entries/relay.ts`, `entries/relay/network-game.ts`)
  boot their world through the worker instead of `inlineMapWorld`. Replace the seams that need the
  sim's identity on the main thread: `OpenedWorld.sim` behind the `WorldPort`, and
  `networkSaveSession` (`net/save-session.ts`), which compares `client.sim` to decide whether a save
  still belongs to the running world.
- The worker's undelivered-tick hold (`UNDELIVERED_LIMIT_SECONDS` in `session/worker/serve.ts`) stops
  a local session's clock while the main thread stops drawing. A relayed worker cannot stop the room
  clock: decide what it keeps of undelivered ticks' events while it keeps stepping and acknowledging.

## Verify

- The headless client under `packages/net-server/test/support/` runs against the worker host as well
  as the inline one, with identical digests.
- A relayed room of two clients plays through the worker: `npm run test:content` with
  `relay-map-parity.test.ts`, and the relay entry and the menu's network game in a browser.
- Under a synthetic main-thread stall (a busy loop of 200 ms once a second on one client), that
  client's acknowledgements keep their cadence and the relay never lists it as lagging.
- Lobby, start, reconnect, resync and network save paths pass with the connection in the worker.
- Closing numbers on the 00 checkpoint for the relayed session: frame p95, per-tick receive cost
  beside sim time, boot time and memory before and after.
- `npm test`, `npm run check`, `npm run build`, `npm run test:desktop`.
