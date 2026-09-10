# Connect the desktop client to the relay server

**Area:** app, desktop · **Focus:** view/runtime, net transport · **Priority:** P2

With the resilient relay and the loopback driver in place, the desktop shell needs the network
transport and the player-facing pieces of a networked session. Desktop has priority over web:
Electron shares V8 with Node, so the determinism spike already covers it.

Responsiveness in lockstep comes from the interface reacting at once while the command applies a few
ticks later (two to three ticks at 12 ticks per second, 170 to 250 ms at a 100 ms round trip). The HUD
must acknowledge every issued command immediately and must never wait for its application.

The relay already provides the client's pure half: `RelayTransport` in `packages/net-protocol`
(frames in, commands out, the sim's parser injected) and the headless client under
`packages/net-server/test/support/`, which walks the lobby, builds a world from the broadcast
descriptor, follows the clock, answers pings, acknowledges every tick with its digest, answers a
snapshot request with a gzip save, rebuilds from a snapshot blob, and records waits, votes, kicks
and desyncs. The desktop client wraps that logic around a real socket and a HUD rather than writing
it again; promote what it reuses out of test support, the snapshot codec included (the browser side
of it is `CompressionStream`, as the save-load codec already does).

World assembly on every client must come from the descriptor alone. The map entry today declares the
match participants and the assistant grants from the local seat, which two clients would do
differently; `humanSeatsOf(session)` is the shared answer, and the headless twin in
`packages/app/test/content/real-map-world.ts` already builds that way.

## Scope

- A WebSocket (`wss://`) socket around `RelayTransport`, with reconnect on the same token, a jitter
  buffer of one to two ticks behind the server clock, and catch-up through the driver when frames
  arrive late (several ticks per frame within the existing `FixedTimestep` cap).
- Identity storage: the token and nick live in the desktop settings store next to the other stored
  settings in `packages/app/src/view/settings-store.ts`.
- Immediate feedback on issue. Investigate first where the order acknowledgement cue fires today; if
  it fires from a sim event, it fires after the lockstep delay and a cue on send must be added.
  Selection, target marker, and placement ghost already react locally; keep them that way.
- The waiting overlay: who is being waited for, the countdown, and the kick vote control with the
  current tally.
- HUD readouts: round trip, assigned input delay in ticks and milliseconds, and each player's status
  (connected, lagging, dropped).
- Speed and pause through the server, announced in the chat area with the actor's nick.
- Chat input and log.
- Desync handling: on an out-of-sync notice, stage the reference snapshot through the existing
  staged-save relaunch (`takeStagedSave` and the restore path in
  `packages/app/src/view/runtime/save-load/`) and rejoin the session on the same token, so no in-place
  sim swap is needed. The relaunch costs a full boot; that is accepted for now and stated in the HUD
  message. Attach the digest trace and command log to the diagnostics bundle for desync reports.
- Non-goals: no lobby UI beyond a temporary developer entry that joins a room by id, no web shell
  changes, no binary framing.

## Verify

- Two Electron instances on one machine (or two dev-server windows) play a real map through the
  server: commands from each apply on both, hashes agree, and the perf overlay reports the click-to-
  apply delay.
- Killing one instance stops the other's clock with the overlay and countdown; restarting it on the
  same token resumes without a resync; a forced divergence (a debug-only local mutation) ends in a
  resync and an identical hash afterwards.
- Speed and pause changes from either side apply to both and are announced.
- `npm run check`, `npm run build`, `npm test`, plus a human pass on the overlay, the readouts, and the
  feel of issuing orders at an injected 150 ms round trip.
