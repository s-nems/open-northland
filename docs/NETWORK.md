# Network protocol

The wire contract between a game client and the relay server, version `PROTOCOL_VERSION = 5` in
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
unparsable text closes the connection. Every message is an object with a string `kind`. A close
with `CLOSE_REPLACED` (4000) or `CLOSE_PROTOCOL_ERROR` (1002) is final; after any other close a
client may reconnect on its token.

The relay replies to a message it cannot honour with `rejected { of, reason }`, naming the kind it
refused, and keeps the connection. A violation of the protocol itself gets `error { reason }`
followed by a close.

## Identity

The first message on a connection is `hello { protocol, token, nick }`. The `token` is a secret the
client generated and stored (16 to 128 URL-safe characters). Browser clients keep a separate token
for each normalized relay origin and path so another relay cannot impersonate them. The token is the
identity and is never shown to other clients. The `nick` is display only. The relay answers `welcome { protocol, nick }`,
or `error { reason }` naming both versions when it speaks another, and closes. The shapes of `hello`,
`welcome` and `error` hold across versions, so a mismatch reads the same on any pair. A connection
that has not said `hello` within `HELLO_TIMEOUT_MS` (10 s) is closed.

A `hello` with a token already connected replaces that connection: the older one gets
`error "replaced by a newer connection"` and is closed, and its room membership carries over. A token
that belongs to a room, connected or not, is put back into that room by `hello` alone. Its welcome
uses the room's retained canonical nick. When a join assigns a numeric suffix, a further `welcome`
announces that canonical nick before the first room view; it is a name update, not a new connection.
The relay attaches membership before publishing the view, so a client can answer it immediately.

## Rooms and seats

`listRooms` returns `rooms { rooms: [{ id, name, state, members, seats }] }`.

`createRoom { settings, seats }` makes a room and puts the sender in it. `settings` is
`{ name, world, seed, rules, speed, kickedSeatMode?, initialSave?, mapOrigin? }`, where `world` and `rules` are the session descriptor's, and
the world is fixed for the room's life. `seats` lists the world's seats in ascending order as
`{ player, mode, color, team? }` with `mode` `ai` or `idle`; `human` is never chosen, it is what a claimed
seat becomes. `joinRoom { roomId }` joins a room in the lobby; a room that has started refuses. A
duplicate nick within a room gets a numeric suffix (`Ania`, `Ania2`). At most `MAX_MEMBERS` (12)
people share a room.

Every change to a room is broadcast to its members as `room { room }`, the whole view:
`{ id, state, creator, settings, seats: [{ player, mode, color, team?, nick, ready }], members: [{ nick, seat, connected, compatibility }] }`.

- `claimSeat { player }` sits down in a seat nobody holds, which makes it `human` whatever it was;
  `claimSeat { player: null }` stands up and returns it to its lobby setting.
- `setSeat { player, mode?, color?, team? }` is the creator's: `mode` only on a vacant seat.
  `team` is an integer from 0 through 15, or null; omitted/null preserves map-authored diplomacy.
  Explicit teams are carried in the session descriptor, whose trusted setup applies the relations.
- `setSettings { settings }` is the creator's. It replaces `{ name, seed, rules, speed, kickedSeatMode? }` in full;
  including `world`, `initialSave` or `mapOrigin` is refused because these are immutable.
  The menu sends one settings replacement at a time and merges subsequent field edits onto its
  acknowledged room view. Unrelated room updates do not acknowledge it; refusal, disconnect, or
  leaving the room discards pending edits. A settings no-op does not produce a room update.
  A saved room also fixes its seed, rules, seat colors and teams; claims and creator-selected
  vacant AI/idle modes remain editable.
- `setCompatibility { compatibility }` supplies the sender's report or null to invalidate it.
- `setReady { ready }` needs a seat; becoming ready also requires all compatibility checks to pass.
- `leaveRoom` frees the seat and identity; the last member out drops the room, and
  a creator who leaves passes the role to the next member. During a running game, explicit departure
  immediately applies the same deterministic AI/idle seat handover as a passed kick vote, without
  a countdown or vote. Socket loss alone retains the seat for reconnection. The departing connection
  can create or join another room as soon as it receives `left`. If no client has reported the
  initial built tick yet, the handover notice and AI command wait for that baseline and name the
  actual first resumed tick; the identity and room slot are released immediately.

Every effective report, membership, seat, team, color or settings change clears all ready flags.
Repeating the same report, seat claim or settings preserves readiness. A reconnect in the lobby also
clears that member's compatibility report and all readiness, so the new client must check its files.
The started-game reconnect path keeps its existing snapshot and digest checks.

A compatibility report is `{ content, map, client, protocol, save? }`. Content and map are lowercase SHA-256
hex digests; `map: null` means the client lacks the map. The client version is a non-empty printable
line of at most 128 characters, and protocol names the version it speaks. The relay compares content,
map and client against the creator's report and requires its own protocol version from every member.
A saved room also requires every `save` report to equal its immutable initial-save fingerprint;
a fresh room requires an absent/null save report. Missing reports, missing maps and mismatches block ready and are checked again at Start, with a
refusal naming the member and category. `compatibilityIssues` exposes these results as pure data
(`nick`, `kind`, `reason`) for a lobby display. The hashes are client reports, not server-side content
validation; the relay does not read local content or map files.

`start` is the creator's, and goes through only when every member passes compatibility, has a seat
and is ready. The relay
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

The relay pings each client once a second (`ping { t, roundTripMs }`, answered by `pong { t }`) and
keeps a smoothed round trip and jitter per client; `roundTripMs` is that smoothed trip, carried so
the client can show it. The assigned input delay is
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
the member (its token is a stranger from then on), and returns the seat to `settings.kickedSeatMode`
(`ai` or `idle`), falling back to its original lobby mode when omitted. The room view reflects this mode. For
`mode: "ai"` the relay lands its `setPlayerAi` envelope on `tick`, the next unemitted one, outside
every budget, so the AI takes the seat on the same tick on every client. For `mode: "idle"` the seat
simply issues nothing more.

## Manual save order capture

`saveOrders { id, tick, world }` completes a locally captured tick-boundary save with every room
command the relay has accepted but that saved world has not applied. The requester must be connected,
loaded and in sync, use its current world generation, and name a tick between the initial world and
both its acknowledged tick and the relay clock. Missing retained history is a refusal, never an
incomplete success. No pause, clock advance or queue drain occurs.

The reply is `saveOrders { id, tick, frames }`: sparse nonempty frames strictly after `tick`, in
ascending tick order, combining retained emitted frames and accepted pending frames. Command sequence
numbers remain contiguous within each frame. Empty `frames` is a valid complete capture. The detached
reply preserves its contents even if another player's command arrives immediately afterwards; commands
accepted after the request belong only to later captures. The client persists these inputs as its
save continuation, retaining apply ticks and within-tick order.

`MAX_SAVE_ORDERS_BYTES` is 16 MiB. Both sides conservatively limit serialized JSON to one third that
many UTF-16 units, which bounds UTF-8 without platform APIs; oversized replies are refused atomically.
A client correlates the id, verifies the captured tick, and abandons pending requests on world/room
changes. A refusal includes `rejected { of: "saveOrders", requestId, reason }` when the request
id is valid, including parser refusals; a delayed rejection cannot cancel a newer capture. The local save is captured before this asynchronous exchange, never recaptured at reply time.

## Blobs

`blob { type, to, tick, bytes }` carries opaque bytes: `bytes` is base64 of at most `MAX_BLOB_BYTES`
(16 MiB) decoded, `type` is `snapshot`, `save`, `initialSave`, or `map`, `to` names one member's nick or null for
everyone else in the room, and `tick` is required for a snapshot or a save. The relay never decodes
the bytes; it delivers them as `blob { type, from, tick, bytes }` with the sender's nick.

A `map` is accepted only from the current creator in the lobby, with a null tick and an explicit
immutable `mapOrigin: "mod" | "user"`. It is relayed as addressed. `requestMap` sends the connected
creator `mapRequest { from }` so a member can retry delivery. Map and initial-save requests each
have a two-second per-member cooldown to bound small-request/large-response amplification. The origin is advisory: clients must
validate source provenance, sender identity, payload schema and the expected map fingerprint.
Map replacement after Start is refused.

An `initialSave` is creator-only, lobby-only, has `to: null` and the declared tick. The declaration is
`initialSave: { fingerprint, tick }`, copied into every session descriptor. Its fingerprint is SHA-256
of the exact base64 snapshot text. The relay hashes the opaque text, refuses a mismatch, caches one
bounded blob, and broadcasts it including to its uploader. `requestInitialSave` returns this cache,
including after a creator leaves. Ready and Start require the upload as well as matching reports.
Clients verify the hash, decoded save schema, tick and map, then restore against their actual content
before reporting compatibility. `prepareInitialSave` / `verifyInitialSave` provide the transport checks.

Saved starts name `snapshotTick: initialSave.tick`; the relay seeds its clock and snapshot cache there,
and rejects descriptor-generation or tick-zero substitutions. `WorldPort.open` can supply a verified
world with `initialSaveFingerprint` and generation equal to the saved tick, or return null and restore
the relay snapshot. The client verifies initial snapshot integrity before invoking the restore port.
Saved rules and diplomacy remain intact. Shared seat control (`setPlayerAi` for every roster seat)
is queued once on the first resumed tick by the client. The lobby releases its cache at Start so
normal snapshot retention can replace it.

A `save` is relayed as addressed and never refreshes the room's cached snapshot: its persisted
continuation already includes accepted future orders, so adding replay frames would apply them twice.
A `snapshot` is not relayed on request: it refreshes the cache and reaches whoever
is waiting to be brought back (see below); `to` is ignored. Both a snapshot and a save are accepted
from a client in sync only, at a tick up to the clock's, and never at tick 0.

The encoding of a snapshot or a save is the clients' contract, not the relay's: gzip of the sim's
canonical save JSON (`serializeSaveGame(exportSaveGame(sim))`), taken at a tick boundary, restored
with `restoreSimulation` onto the world the descriptor names. A manual save contains locally queued
commands and the accepted relay continuation obtained by `saveOrders`. An automatic snapshot contains
only the simulation queue; retained relay frames reconstruct accepted orders after its tick.

A manual multiplayer save writes the same captured document locally and through `shareSave` to the
relay. The current save format records validated session metadata and public roster names, with no reconnect
tokens or previous initial-save fingerprint. Saved humans become vacant seats when a new room is
created; nick matches are suggestions and each player explicitly claims a seat. Saves without session
metadata use the authored map roster. The new room's seat assignments supersede any saved, still-pending
administrative AI takeover from the previous room; player orders keep their saved ticks and order.
Only the current save format is accepted.

Verified custom maps are retained in browser storage, capped at four maps and 64 MiB of encoded
transfer payloads. Reads validate the documents again against their fingerprint and permitted origin;
known base or unknown installation origins remain ineligible for transferred-map fallback. A normal
multiplayer reload reconnects its token, checks compatibility and rebuilds from the relay snapshot
using the retained map. Unavailable storage leaves the current game usable but cannot retain its map.

## Resync and catching up

The relay keeps the room's newest snapshot and every frame since it. Until the first snapshot it
keeps every frame from the first one. Replay retention is limited to `MAX_HISTORY_BYTES` (16 MiB of
UTF-8 frame JSON) and `MAX_HISTORY_AGE_MS` (10 minutes of wall time since the oldest retained frame).
JSON bytes bound payload storage; frame counts are also bounded by the age limit and maximum tick
rate, so bookkeeping has a bound too. These are deployment budgets, not simulation constants.

The relay requests a refresh every `SNAPSHOT_REFRESH_MS` (5 min), or once history reaches half its
byte or age budget. `snapshotRequest` goes first to the client in sync with the lowest round trip,
which answers with a `snapshot` blob at its current tick. Unanswered requests retry every
`SNAPSHOT_RETRY_MS` (10 s), trying each eligible donor before repeating one, including when nobody
is currently waiting for resync. A newer automatic snapshot prunes only the frames it covers.
A same-tick snapshot also satisfies a refresh when no later frames are retained, as in a paused game.

If the age limit is reached or the next frame would exceed the byte limit, the relay ends that room:
connected members receive `error` with an explicit retention-limit reason, then `left`. All members,
including disconnected ones, lose their room association, and the snapshot and history are released.
Their connections remain usable and other rooms continue. The relay never silently discards a frame
needed to replay from its advertised snapshot.

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
| rooms per relay | `RELAY_MAX_ROOMS`, 64 by default |
| `HELLO_TIMEOUT_MS` | 10 s |
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

## The client

`packages/net-client` is the client half every host shares: `RelayClient` walks the lobby, opens the
world `start` names through a port the host supplies, runs it over `RelayTransport`, acknowledges
every tick, answers pings and snapshot requests, and asks a diverged world's host to restore. It runs
the sim a frame or two behind the relay's clock (`JITTER_BUFFER_TICKS`) by scaling the time it feeds
the driver, never by skipping a tick, so a late frame lands inside the buffer. `RelaySocket` keeps
the connection and reopens it on the same token after a drop; a connection the relay replaced or
refused stays closed. The desktop and browser app plays through the `?relay=` entry, the headless
test client through an in-memory network.

## Operations

Beside the WebSocket upgrade the relay serves one plain HTTP path, `GET /healthz`, answering
`{ ok, protocol, build, url, rooms, clients, uptimeSeconds }`: the version it speaks, the build it
came from, the `RELAY_PUBLIC_URL` it was given, and how busy it is. Every other path is a 404. The
image, its environment and the reverse proxy are described in
[`deploy/relay/README.md`](../deploy/relay/README.md).

## Match termination

Room states are `lobby`, `running`, and `ended`, with no reverse transition. Start permanently
closes the lobby. New participants require a new room, optionally created from a save; reconnecting
an existing participant is distinct from joining a running match.

A local defeat does not pause the shared clock or end the match while other participants remain
undecided. Once the simulation decides every declared participant, each client stops exactly at
that tick and sends `finish { tick, hash, world }` after its tick acknowledgement. `hash` is the
full simulation state hash (eight lowercase hexadecimal digits), not the incremental mutation
digest: the same result must also be reportable from an adopted save without an extra simulation
step. An already decided adopted world reports its loaded tick.

The relay compares result tick and hash from every connected participant with a loaded, synchronized
world. Stale world generations do not count. Once those reports agree, it stops its clock at the
result tick, clears waiting notices, broadcasts the ended room view and `ended { tick, hash }`. Frames
already emitted beyond that tick are never simulated by clients that reached the shared result.
If every connected participant reports a result but the tick or full hash differs, the relay ends
the room with an explicit result-disagreement error rather than claiming a shared result.
Disconnected identities do not block agreement; reconnect retains the result and permits restoration
and replay up to the final tick without restarting the clock.

A returning client verifies the final full hash before showing the result.
The final result replaces any earlier local defeat panel and offers exit to the menu. Leaving an
ended session releases membership without scheduling further AI commands. Commands, clock changes,
kicks, lobby edits and Start cannot restart the ended session. Another match needs a new room.
