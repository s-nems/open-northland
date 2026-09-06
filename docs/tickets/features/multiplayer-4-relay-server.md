# Build the relay server and the lockstep wire protocol

**Area:** web, desktop · **Focus:** new package packages/net-server · **Priority:** P2
**Blocked by:** [multiplayer-3-session-and-loopback.md](multiplayer-3-session-and-loopback.md)

There is no server and no network code in the repository. The chosen model is server-paced
deterministic lockstep with a relay: the server is the authority for time (the tick clock), order
(which envelopes apply on which tick, in which sequence), membership (rooms, seats, identities), and
session settings (speed, pause). It holds no game content and runs no simulation. Every client runs
the full sim and reports a per-tick digest; the server compares digests and arranges a resync from a
client that holds the majority state. This keeps the server image free of decoded game data, keeps
its CPU cost near zero per room, and matches what Recoil and OpenTTD do.

Deployment target: a Docker image on the owner's machine behind a TLS reverse proxy on a subdomain of
opennorthland.org, reached over `wss://`.

Measured inputs for sizing: about 90 bytes per command as JSON, players issue roughly one command
every 1.5 to 2 s with bursts of 3 to 4 per second, the sim ticks 12 times per second, a state
snapshot (`exportSaveGame` plus gzip level 1) is about 1.3 MB and takes about 0.5 s to produce and
0.45 s to restore.

## Scope

- `docs/NETWORK.md`: the protocol contract (message catalogue with versions, tick frame layout,
  identity, room and seat lifecycle, clock policy, digest exchange, blob relay, limits). Update the
  "Saves and multiplayer" section of `docs/ARCHITECTURE.md` to point at it. Register the new package
  in `docs/tickets/README.md` and `scripts/check-docs.mjs` area lists.
- A new workspace package `packages/net-server` (Node, `ws` or uWebSockets.js, JSON frames for now)
  with its own `AGENTS.md`, no dependency on `sim`, `render`, or `app`, and no content on disk or in
  the image.
- Identity: a client-generated secret token plus a nick the player chose; the token identifies a seat
  across reconnects, the nick is display only, and a duplicate nick in a room gets a numeric suffix.
- Rooms: create, list, join, leave. The creator owns lobby settings and the start button; after start
  there is no host role.
- Seats: up to 12, with mode, colour, team, ready flag, and the `GameSession` descriptor the server
  broadcasts on start.
- Game clock: tick frames emitted on the server clock at the session speed, empty frames included,
  each carrying the envelopes due on that tick in server-assigned sequence. The server stamps the seat
  from the connection, drops `setup` and `admin` origins from clients, validates envelopes with the
  sim's parser contract, and rate-limits envelopes per client per tick. Input delay per client is
  derived from measured round trip: ceil((rtt + jitter) / tick length) + 1, raised quickly on spikes
  and lowered slowly.
- Waiting policy: when a client's acknowledged tick falls behind by more than a threshold, or its
  socket drops, the clock stops and every client is told who is being waited for, with a countdown.
  After 60 s any player may open a kick vote; at least 50% of connected human players voting yes kicks
  the seat, which becomes idle or AI according to its lobby setting. The only server-originated sim
  command is the trusted `setPlayerAi` for a kicked seat; keep that allowlist explicit.
- Speed and pause: any player may change them; the server applies and announces who did it, with a
  per-player pause budget per game.
- Digests: per-tick digests from every client, compared after all have reported; the majority is the
  reference, a minority client is marked out of sync and receives a snapshot from a majority donor
  through the blob relay, then the command frames since that snapshot's tick.
- Blob relay: snapshots, saves, and maps as opaque bytes from one client to another or to all, with
  size limits and no inspection.
- Chat within a room.
- Operations: Docker image with no content, configuration by environment variables, a health endpoint,
  structured logs, and a deployment note under `deploy/`.
- A headless test client in Node that uses the real sim through the driver and transport interface of
  the previous ticket, so the server is proven with real state, not mocks.
- Non-goals: no lobby UI, no Electron transport, no map or save semantics beyond relaying bytes, no
  binary framing, no WebTransport.

## Verify

- Headless: 2, 4, and 12 test clients play 10 000 ticks of `magiczny_las` through the server and end
  with identical digests and identical `hashState()`; the replay logs match tick for tick.
- Fault injection in the test harness: added jitter and latency change the assigned delay and never
  the outcome; a dropped client stops the clock, a reconnect with the same token resumes it, and a
  client that missed frames catches up from the frames alone; a client with an injected divergence is
  detected within one tick, resynced from a donor snapshot, and finishes with the majority hash.
- Kick vote: the countdown, the 50% rule, and the idle or AI fallout are covered by tests.
- Envelope stamping and rejection: a client cannot issue for another seat or send `setup`/`admin`.
- The image builds without `content/`, starts with only environment variables, and answers the health
  endpoint. A deployment to the subdomain answers a `wss://` handshake.
- `npm run check`, `npm run build`, `npm test`, `npm run check:docs`, `npm run test:content` where
  content exists.
