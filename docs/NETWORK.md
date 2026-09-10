# Network protocol

The wire contract between a game client and the relay server, version `PROTOCOL_VERSION = 1` in
`packages/net-protocol`. A change a client of the current version could not parse bumps the version;
the relay refuses a `hello` that names another.

The model is server-paced deterministic lockstep. Every client runs the full simulation. The relay
is the authority for time, order, membership, and session settings, and for nothing else: it holds
no game content, runs no simulation, and never interprets a command payload or a blob. That is what
keeps the server image free of decoded game data.

## Transport

WebSocket, one JSON text frame per message. A client message is at most `MAX_CLIENT_MESSAGE_BYTES`
(16 KiB), except a `blob`, which is at most `MAX_BLOB_MESSAGE_BYTES` (a 16 MiB payload in base64
plus its fields). A relay message is bounded by what it carries: a full tick frame holds up to
`MAX_MEMBERS * MAX_COMMANDS_PER_TICK` envelopes of `MAX_ENVELOPE_BYTES` each plus their sequence
wrappers, a little over 240 KiB, and a blob is as large as the one a client sent. A binary frame or
unparsable text closes the connection. Every message is an object with a string `kind`.

The relay replies to a message it cannot honour with `rejected { of, reason }`, naming the kind it
refused, and keeps the connection. A violation of the protocol itself gets `error { reason }`
followed by a close.

## Identity

The first message on a connection is `hello { protocol, token, nick }`. The `token` is a secret the
client generated and stored (16 to 128 URL-safe characters); it is the identity, and it is never
shown to other clients. The `nick` is display only. The relay answers `welcome { protocol, nick }`.

A `hello` with a token already connected replaces that connection: the older one gets
`error "replaced by a newer connection"` and is closed, and its room membership carries over. A token
that belongs to a room, connected or not, is put back into that room by `hello` alone.

## Rooms and seats

`listRooms` returns `rooms { rooms: [{ id, name, state, members, seats }] }`.

`createRoom { settings, seats }` makes a room and puts the sender in it. `settings` is
`{ name, world, seed, rules, speed }`, where `world` and `rules` are the session descriptor's, and
the world is fixed for the room's life. `seats` lists the world's seats in ascending order as
`{ player, mode, color }` with `mode` `ai` or `idle`; `human` is never chosen, it is what a claimed
seat becomes. `joinRoom { roomId }` joins a room in the lobby; a room that has started refuses. A
duplicate nick within a room gets a numeric suffix (`Ania`, `Ania2`). At most `MAX_MEMBERS` (12)
people share a room.

Every change to a room is broadcast to its members as `room { room }`, the whole view:
`{ id, state, creator, settings, seats: [{ player, mode, color, nick, ready }], members: [{ nick, seat, connected }] }`.

- `claimSeat { player }` sits down in a seat nobody holds, which makes it `human` whatever it was;
  `claimSeat { player: null }` stands up and returns it to its lobby setting.
- `setSeat { player, mode?, color? }` is the creator's: `mode` only on a vacant seat.
- `setReady { ready }` needs a seat.
- `leaveRoom` frees the seat and leaves, in the lobby only; the last member out drops the room, and
  a creator who leaves passes the role to the next member.

`start` is the creator's, and goes through only when every member has a seat and is ready. The relay
then sends each member `start { session, snapshotTick: null }`: the `GameSession` descriptor with
that member's own `localSeat`, and every claimed seat as `human`. Each member builds its world from
it and reports `loaded { tick, world: 0 }` with the tick that world stands at: the same on every
client of one room, 0 for a world with no setup tick and 1 for a decoded map whose placements drain
on one, and the relay refuses any other. The clock starts once every connected member has,
announced by `clock { tick, speed, paused: false, by: null }` naming the first tick to run. After
the start there is no host role.

## The clock and tick frames

Once started, the relay emits one `frame { tick, commands }` per simulation tick on its own clock,
at `TICKS_PER_SECOND` (12) times the session speed, empty frames included. Ticks count on from the
one the built worlds stood at and are never skipped. A client runs tick `t` only once it holds
frame `t`; that is the whole synchronisation rule. If the relay stalls it emits at most a short
burst and the game runs late; no tick is dropped.

`commands` is the list of `{ envelope, sequence }` that apply on that tick, with `sequence` counting
from 0 in the order the relay received them. Every client applies them in that order, after the
tick's own untargeted commands, through `Simulation.enqueueAt`.

Any member may change the clock with `clock { speed?, paused? }`. The relay applies it and broadcasts
`clock { tick, speed, paused, by }` with the sender's nick and the first tick the setting holds from.
Each member may start at most `PAUSE_BUDGET` (3) pauses per game; a resume costs nothing.

## Commands

A client sends `command { envelope, fromTick }`: a seat envelope from the sim's command contract, and
the tick the client's own sim had reached when the person issued it. The relay:

- accepts `origin: "player"` only; `setup`, `admin`, and `ai` envelopes are refused, since the AI
  seats run inside every client and trusted commands have no wire;
- stamps `player` with the seat the connection holds, whatever the envelope claimed;
- lands the envelope on tick `max(nextTick, fromTick + delay)`, where `delay` is the member's
  assigned input delay, so a command applies a fixed number of ticks after it was issued as long as
  the connection stays within its budget;
- accepts at most `MAX_COMMANDS_PER_TICK` (20) envelopes from one member on one tick, each at most
  `MAX_ENVELOPE_BYTES` (1 KiB) as JSON, and reports the rest as `rejected`.

The relay reads nothing else. The command payload reaches every client as sent, and every client
validates it with `parseCommandEnvelope` before enqueueing; an envelope the sim's parser refuses is
dropped on every client alike, so a bad payload cannot split the session.

One envelope in a frame does not come from a seat: `{ v, origin: "admin", command: { kind:
"setPlayerAi", player, enabled: true } }`, the relay's own, for a seat a kick vote handed to the AI.
It is the only trusted command the wire carries; a client refuses a frame with any other.

## Input delay

The relay pings each client once a second (`ping { t }`, answered by `pong { t }`) and keeps a
smoothed round trip and jitter per client. The assigned input delay is
`ceil((rtt + jitter) / tickLength) + 1` ticks, starting at 2, raised on the spot by a spike and
lowered one tick at a time once the smoothed trip has allowed it for ten quiet samples. A change is
sent as `delay { ticks }`; every member also gets its current delay at the start.

## Acknowledgements and the sync check

After every tick a client sends `ack { tick, digest, world }` with the sim's `SyncDigest.domains`
for that tick: one unsigned 32-bit word per domain (`rng`, `entities`, `players`, `movement`,
`settlers`, `economy`, `combat`, `fog`). `world` is the generation of the world the client reports
from: 0 for one built from the descriptor, otherwise the tick of the snapshot it was restored from.
An acknowledgement from another generation is still in flight from a world the client has thrown
away, and is ignored. Within a generation acknowledgements are consecutive; one out of order or
ahead of the clock is refused. The acknowledged tick is also how far the relay believes the client
has applied.

Once every client in sync has passed a tick, by acknowledging it or by being moved past it with a
snapshot, the relay compares the digests those clients reported for it. The majority digest is the
reference; on a tie, the client connected the longest (the earliest current connection, then the
earliest to join). A client in the minority gets `desync { tick, domains, reference }` naming the
domains that differ and the reference's nick, and is out of sync from then on: its acknowledgements
are ignored and its snapshots refused until it has rebuilt from a snapshot, and the notice is sent
again if it reconnects meanwhile. A client acknowledging a tick the room has already settled is
judged against that tick's reference, so a returning client is checked from its first tick back. A
disconnected client's reports do not count; it says where it stands again on its return.

## Waiting

The clock waits, emitting no frames, while any member is:

- `gone`: its connection dropped;
- `silent`: it has answered no ping for `SILENT_AFTER_MS` (4 s), whatever its socket says;
- `loading`: it has not said where its world stands, before the start or after a return;
- `lagging`: its acknowledged tick trails the clock by more than `WAIT_BEHIND_MS` (2 s) of frames,
  24 ticks at speed 1 and 24 times the speed otherwise;
- `resync`: it is out of sync and its snapshot has not arrived.

Every change to that set is broadcast as `waiting { for: [{ nick, reason, voteAfterMs }] }`; an
empty `for` ends the wait. Each member's `voteAfterMs` counts down from `KICK_COUNTDOWN_MS` (60 s)
from the moment that member began to be waited for, and restarts only once it has stopped being
waited for. A wait is over as soon as nobody is waited for: the dropped token returned, the silent
one answered, the lagging one caught up, or the diverged one rebuilt. A client that never loads or never acknowledges is waited
for and can be voted out, before the start as after it; a member kicked before the start is not
waited for to start the clock.

## Kick votes

Once a member's countdown has passed, any other member sends `kick { player }` for its seat; a
repeat from the same member counts once. Every yes is broadcast as
`kickVote { player, nick, yes: [nicks], needed }`, where `needed` is half of the connected members
other than the target, rounded up. A vote lives only while its target is waited for.

When the yeses reach `needed` the relay broadcasts `kicked { player, nick, mode, tick }`, removes
the member (its token is a stranger from then on), and returns the seat to its lobby setting. For
`mode: "ai"` the relay lands its `setPlayerAi` envelope on `tick`, the next unemitted one, outside
every budget, so the AI takes the seat on the same tick on every client. For `mode: "idle"` the seat
simply issues nothing more.

## Blobs

`blob { type, to, tick, bytes }` carries opaque bytes: `bytes` is base64 of at most `MAX_BLOB_BYTES`
(16 MiB) decoded, `type` is `snapshot`, `save`, or `map`, `to` names one member's nick or null for
everyone else in the room, and `tick` is required for a snapshot or a save. The relay never decodes
the bytes; it delivers them as `blob { type, from, tick, bytes }` with the sender's nick.

A `map` is relayed as addressed. A `save` is relayed as addressed and also refreshes the room's
cached snapshot. A `snapshot` is not relayed on request: it refreshes the cache and reaches whoever
is waiting to be brought back (see below); `to` is ignored. Both a snapshot and a save are accepted
from a client in sync only, at a tick up to the clock's, and never at tick 0.

The encoding of a snapshot or a save is the clients' contract, not the relay's: gzip of the sim's
canonical save JSON (`serializeSaveGame(exportSaveGame(sim))`), taken at a tick boundary, restored
with `restoreSimulation` onto the world the descriptor names. A save carries only the untargeted
commands still queued; the frames after its tick reconstruct the rest.

## Resync and catching up

The relay keeps the room's newest snapshot and every frame since it. Until the first snapshot it
keeps every frame from the first one. The cache is refreshed every `SNAPSHOT_REFRESH_MS` (5 min) by
`snapshotRequest` to the client in sync with the lowest round trip, which answers with a `snapshot`
blob at its current tick, and by every save a player uploads. A request unanswered for
`SNAPSHOT_RETRY_MS` (10 s) is repeated to whoever is best connected by then.

A client told `desync` drops its world and waits. The relay asks the best-connected client in sync
for a fresh snapshot and, when it arrives, sends the diverged client `blob { type: "snapshot" }`
followed by every frame after the snapshot's tick. The client restores, replays those frames, and
acknowledges from the snapshot's tick on; the wait ends once it is within the lag budget. A diverged
client that is away when the snapshot arrives takes the cache on its return, with `loaded { tick:
null }`.

A returning token gets `room`, `start { session, snapshotTick }` and `clock` again. `snapshotTick`
is the cached snapshot's tick, or null when the relay still holds every frame from the first. The
client answers `loaded`:

- `{ tick, world }` with the tick its world still stands at and that world's generation, and the
  relay sends the frames after it, or the cached snapshot and the frames after that when the frames
  before the cache are gone;
- `{ tick: null }` when it holds no world and a snapshot is cached, and the relay sends the snapshot
  and the frames after it;
- `{ tick, world: 0 }` with the tick of a world freshly built from the descriptor when
  `snapshotTick` was null.

A client whose world is out of sync must ask with `null`. Whatever the path, a snapshot blob always
replaces the client's world, and the frames that follow are applied through the same transport.

## Chat

`chat { text }` is broadcast to the room as `chat { from, text }`. One printable line, at most
`MAX_CHAT_LENGTH` (500) characters, like every other string that reaches another person.

## Limits

| Limit | Value |
| --- | --- |
| `MAX_CLIENT_MESSAGE_BYTES` | 16 KiB |
| `MAX_BLOB_BYTES` (decoded) | 16 MiB |
| `MAX_ENVELOPE_BYTES` | 1 KiB |
| `MAX_SEATS` (seat indices) | 16, the sim's `MAX_PLAYERS` |
| `MAX_MEMBERS` per room | 12 |
| rooms per relay | 64 |
| empty room kept for reconnects | 10 minutes |
| `MAX_COMMANDS_PER_TICK` per member | 20 |
| `PAUSE_BUDGET` per member per game | 3 |
| `MAX_SPEED` | 8 |
| `WAIT_BEHIND_MS` | 2 s of frames |
| `SILENT_AFTER_MS` | 4 s |
| `KICK_COUNTDOWN_MS` | 60 s |
| `SNAPSHOT_REFRESH_MS` / `SNAPSHOT_RETRY_MS` | 5 min / 10 s |
| nick / room name / chat line | 24 / 48 / 500 characters |
| token | 16 to 128 URL-safe characters |

## What is not here yet

Joining a running room and the end of a game are the save, join and endgame ticket. Version
reporting for deployment and the health endpoint are the operations ticket.
