# Build the relay server core and the lockstep wire protocol

**Area:** web, desktop · **Focus:** new package packages/net-server · **Priority:** P2
**Blocked by:** [multiplayer-3-session-and-loopback.md](multiplayer-3-session-and-loopback.md)

There is no server and no network code in the repository. The chosen model is server-paced
deterministic lockstep with a relay: the server is the authority for time (the tick clock), order
(which envelopes apply on which tick, in which sequence), membership (rooms, seats, identities), and
session settings (speed, pause). It holds no game content and runs no simulation. Every client runs
the full sim. This keeps the server image free of decoded game data, keeps its CPU cost near zero per
room, and matches what Recoil and OpenTTD do.

Measured inputs for sizing: about 90 bytes per command as JSON, players issue roughly one command
every 1.5 to 2 s with bursts of 3 to 4 per second, the sim ticks 12 times per second, and a per-tick
frame carries at most twelve seats' commands.

This ticket is the core: identity, rooms, seats, the clock, command frames, and a headless client
harness. Resilience (waiting, kicks, digests, resync, blobs) and operations (image, deployment) are
the two follow-up tickets.

## Scope

- `docs/NETWORK.md`: the protocol contract for what this ticket implements (message catalogue with a
  protocol version, tick frame layout, identity, room and seat lifecycle, clock rules, limits). The
  follow-up tickets extend it. Update the "Saves and multiplayer" section of `docs/ARCHITECTURE.md`
  to point at it. Register `net-server` in the ticket area lists of `docs/tickets/README.md` and
  `scripts/check-docs.mjs`.
- A new workspace package `packages/net-server` (Node, `ws` or uWebSockets.js, JSON frames for now)
  with its own `AGENTS.md`, no dependency on `sim`, `render`, `app`, or `lockstep` at runtime, and no
  content on disk.
- Identity: a client-generated secret token plus a nick the player chose; the token identifies a seat
  across reconnects, the nick is display only, and a duplicate nick in a room gets a numeric suffix.
- Rooms: create, list, join, leave. The creator owns lobby settings and the start button; after start
  there is no host role.
- Seats: up to 12, with mode, colour, team, ready flag, and the `GameSession` descriptor the server
  broadcasts on start.
- Game clock: tick frames emitted on the server clock at the session speed, empty frames included,
  each carrying the envelopes due on that tick in server-assigned sequence. The server stamps the seat
  from the connection, drops `setup` and `admin` origins from clients, validates envelopes with the
  sim's parser contract, and accepts at most 20 envelopes per client per tick. Input delay per client
  is derived from measured round trip: ceil((rtt + jitter) / tick length) + 1, raised quickly on
  spikes and lowered slowly.
- Speed and pause: any player may change them; the server applies and announces who did it, and each
  player has a budget of 3 pauses per game.
- Chat within a room.
- A headless test client in Node built on `packages/lockstep` and the real sim, so the server is
  proven with real state, not mocks.
- Non-goals: no waiting policy or kick vote, no digests or resync, no blob relay, no lobby UI, no
  Electron transport, no Docker image, no binary framing, no WebTransport.

## Verify

- Headless: 2, 4, and 12 test clients play 10 000 ticks of `magiczny_las` through the server and end
  with identical `hashState()`; the replay logs match tick for tick.
- Injected jitter and latency change the assigned delay and never the outcome.
- Envelope stamping and rejection: a client cannot issue for another seat or send `setup`/`admin`; the
  21st envelope in a tick is dropped and reported.
- Speed and pause changes from any client reach every client on the same tick; the fourth pause of one
  player is refused.
- A duplicate nick gets a suffix; a reconnect with the same token reclaims the seat.
- `npm run check`, `npm run build`, `npm test`, `npm run check:docs`, `npm run test:content` where
  content exists.
