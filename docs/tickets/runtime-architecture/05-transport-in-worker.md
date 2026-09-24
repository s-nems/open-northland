# Run the session transport inside the worker

**Area:** net-client, app, lockstep · **Focus:** relay-client, worker host · **Priority:** P2
**Blocked by:** [04 Sim worker host](04-sim-worker-host.md)

With the sim in a worker but the transport on the main thread, every tick's frame and every
acknowledgement with its digest would still cross the main thread, so a main-thread stall would still
delay the acknowledgement the relay measures lag by. `RelayClient` and `RelaySocket` depend on the
Web platform only through `WebSocket`, the compression streams, timers and `performance`, all of
which a worker has.

## Scope

Two steps, each with its own gate:

1. `LoopbackTransport` runs in the worker for single-player and scenes. The main thread submits
   envelopes as messages.
2. `RelayClient`, `RelaySocket`, the digest trail and the pacer run in the worker, from the lobby on:
   a `WebSocket` cannot move between threads, so the worker is created when the client enters
   networking and owns the connection for the whole session. The main thread receives a mirror of
   the lobby state, the room clock, the waiting set and the connection figures, and sends lobby
   actions, clock requests, chat and commands. Snapshot requests are answered from the worker, which
   owns the world.

## Verify

- The headless client under `packages/net-server/test/support/` runs against the worker host as well
  as the inline one, with identical digests.
- Under a synthetic main-thread stall (a busy loop of 200 ms once a second on one client), that
  client's acknowledgements keep their cadence and the relay never lists it as lagging.
- Lobby, start, reconnect and resync paths pass with the connection in the worker.
- `npm test`, `npm run check`, `npm run build`.
