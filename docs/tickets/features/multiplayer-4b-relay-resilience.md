# Make the relay resilient: waiting for players, kick votes, digests, resync, and blob relay

**Area:** web, desktop · **Focus:** packages/net-server · **Priority:** P2
**Blocked by:** [multiplayer-4a-relay-core.md](multiplayer-4a-relay-core.md)

The core relay keeps everyone on one clock as long as everyone keeps up and nobody diverges. A real
game has a player whose connection drops, a laptop that falls behind, and eventually a client whose
state differs. The policy chosen for these cases is StarCraft-like: the game waits with a countdown,
the players can vote the missing seat out, and a diverged client is repaired from the others instead
of ending the match.

Measured inputs: a state snapshot (`exportSaveGame` plus gzip level 1) is about 1.3 MB and takes
about 0.5 s to produce on the donor and 0.45 s to restore.

## Scope

- Acknowledgements: each client reports the tick it has applied together with that tick's sync
  digest from the sim; the report doubles as the lag signal.
- Waiting policy: when a client's applied tick falls more than 2 s of game time behind the server
  clock (24 ticks at x1, scaled with the session speed), or its socket drops, the clock stops and
  every client is told who is being waited for, with a 60 s countdown. A reconnect with the same
  token, or the lagging client catching up, resumes the clock.
- Kick vote: after the countdown any player may open a vote; at least 50% of connected human players
  voting yes kicks the seat, which becomes idle or AI according to its lobby setting. The AI case is
  the only server-originated sim command: a trusted `setPlayerAi` envelope on an announced tick; keep
  that allowlist explicit and tested.
- Digest comparison: once every client has reported a tick, compare digests; the reference is the
  majority, and on a tie the longest-connected client. A minority client is marked out of sync and
  told which domain differed.
- Resync: the out-of-sync client receives a snapshot from a reference client through the blob relay,
  then the command frames since that snapshot's tick, and rejoins the clock once caught up.
- Blob relay: snapshots, saves, and maps as opaque bytes from one client to another or to all, with a
  16 MB limit and no inspection.
- Cached room snapshot: the server keeps the latest snapshot of a room, refreshed every 5 minutes
  from the client with the lowest round trip and on every save a player uploads, so a rejoining or
  late-joining client does not have to wait for a donor.
- Extend `docs/NETWORK.md` with every message this ticket adds.
- Non-goals: no lobby UI, no Electron transport, no Docker image.

## Verify

- Fault injection in the headless harness: a dropped client stops the clock and the others see the
  countdown; a reconnect with the same token resumes without a resync; a client that missed frames
  catches up from the frames alone; a client with an injected divergence is detected within one tick,
  named by domain, resynced from a reference snapshot, and finishes with the majority hash; a
  two-client tie resolves to the longer-connected one.
- Kick vote: the countdown, the 50% rule, the idle fallout, and the AI fallout on the same tick on
  every client are covered by tests.
- The cached snapshot refreshes on the 5-minute cadence and on an uploaded save; a late joiner from
  it matches the room's hash after catch-up.
- A blob over 16 MB is refused; blobs are relayed byte-identical.
- `npm run check`, `npm run build`, `npm test`, `npm run check:docs`, `npm run test:content` where
  content exists.
