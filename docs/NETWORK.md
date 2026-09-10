# Network protocol

The wire contract between a game client and the relay server, version `PROTOCOL_VERSION = 1` in
`packages/net-protocol`. A change a client of the current version could not parse bumps the version;
the relay refuses a `hello` that names another.

The model is server-paced deterministic lockstep. Every client runs the full simulation. The relay
is the authority for time, order, membership, and session settings, and for nothing else: it holds
no game content, runs no simulation, and never interprets a command payload. That is what keeps the
server image free of decoded game data.

## Transport

WebSocket, one JSON text frame per message. A client message is at most `MAX_CLIENT_MESSAGE_BYTES`
(16 KiB); a relay message is bounded by what it carries, and a full tick frame holds up to
`MAX_MEMBERS * MAX_COMMANDS_PER_TICK` envelopes of `MAX_ENVELOPE_BYTES` each plus their sequence
wrappers, a little over 240 KiB, so a client must not cap what it receives anywhere near that. A binary frame or unparsable text closes the connection. Every message is an
object with a string `kind`.

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
then sends each member `start { session }`: the `GameSession` descriptor with that member's own
`localSeat`, and every claimed seat as `human`. Each member builds its world from it and reports
`loaded`. The clock starts once every connected member has, announced by
`clock { tick: 1, speed, paused: false, by: null }`. After the start there is no host role.

A connection that drops in the lobby leaves the room. One that drops during a game keeps its seat
and shows as disconnected; the same token reclaims it with `hello` and receives the room, the
descriptor it started with, and the clock again. Catching up on the frames it missed is the
resilience ticket's work; until then a returning client cannot run.

## The clock and tick frames

Once started, the relay emits one `frame { tick, commands }` per simulation tick on its own clock,
at `TICKS_PER_SECOND` (12) times the session speed, empty frames included. Ticks are numbered from 1
and never skipped. A client runs tick `t` only once it holds frame `t`; that is the whole
synchronisation rule. If the relay stalls it emits at most a short burst and the game runs late;
no tick is dropped.

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

## Input delay

The relay pings each client once a second (`ping { t }`, answered by `pong { t }`) and keeps a
smoothed round trip and jitter per client. The assigned input delay is
`ceil((rtt + jitter) / tickLength) + 1` ticks, starting at 2, raised on the spot by a spike and
lowered one tick at a time once the smoothed trip has allowed it for ten quiet samples. A change is
sent as `delay { ticks }`; every member also gets its current delay at the start.

## Chat

`chat { text }` is broadcast to the room as `chat { from, text }`. One printable line, at most
`MAX_CHAT_LENGTH` (500) characters, like every other string that reaches another person.

## Limits

| Limit | Value |
| --- | --- |
| `MAX_CLIENT_MESSAGE_BYTES` | 16 KiB |
| `MAX_ENVELOPE_BYTES` | 1 KiB |
| `MAX_SEATS` (seat indices) | 16, the sim's `MAX_PLAYERS` |
| `MAX_MEMBERS` per room | 12 |
| rooms per relay | 64 |
| empty room kept for reconnects | 10 minutes |
| `MAX_COMMANDS_PER_TICK` per member | 20 |
| `PAUSE_BUDGET` per member per game | 3 |
| `MAX_SPEED` | 8 |
| nick / room name / chat line | 24 / 48 / 500 characters |
| token | 16 to 128 URL-safe characters |

## What is not here yet

Acknowledgements and the waiting policy, kick votes, digest comparison and resync, the blob relay, and
the cached room snapshot are the resilience ticket. Version reporting for deployment and the health
endpoint are the operations ticket.
