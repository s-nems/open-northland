# Lockstep package contract

`packages/lockstep` describes a session and drives one client of it. The root
[`AGENTS.md`](../../AGENTS.md) applies in full.

## Boundary

- Depends on `@open-northland/sim` and nothing else. No DOM, Web APIs, Node I/O, render, audio, or app
  imports, so the same driver runs in a browser, in Electron, and in a headless Node client.
- No `Math.random` and no wall-clock reads: the caller passes elapsed milliseconds, the way
  `FixedTimestep` already takes them.
- Holds no game state. The sim owns the world; this package owns when a tick may run and which
  envelopes it carries.

## The descriptor

`GameSession` is the whole answer to what is being played, serializable as plain JSON so a server can
broadcast it and a menu can build a world from it. Anything the world identity already pins - a map's
authored diplomacy, its starting entities, its never-dies seats - stays in the map instead of being
repeated in the descriptor. `parseGameSession` validates every field, because the sender is another
client, and it holds the roster to ascending seat order, which is the order world assembly follows.
An explicit seat team overrides diplomacy between explicitly teamed seats; absent or null teams
leave the map's relations in place.

Every field but `localSeat` is shared by every client of a session.

## The driver

A tick runs only once the transport has handed over its complete input frame. A refused tick is not
skipped; the owed time is held at one frame's worth of ticks, so a short wait is made up and a long
one is neither sprinted through nor written off as dropped ticks. Command tick and sequence come from
the transport, never from local arrival order, which two clients would disagree about.

Single-player runs the same driver over `LoopbackTransport`. There is no separate single-player path
to keep in step.

Manual saves use `SessionDriver.captureSave` so accepted future input accompanies the world. Loopback
owns its pending frames; a relayed driver obtains them from the server. A reconnect snapshot instead
carries the existing world continuation and receives the live session's remaining frames separately.
