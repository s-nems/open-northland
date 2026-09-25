# Network protocol

The wire contract between a game client and the relay server, version `PROTOCOL_VERSION = 8` in
`packages/net-protocol`. A change one side of the current version could not honour, a message shape
or the value set of a validated field such as the fog mode ids, bumps the version; the relay refuses a
`hello` that names another.

The model is server-paced deterministic lockstep. Every client runs the full simulation. The relay
is the authority for time, order, membership, and session settings, and for nothing else: it holds
no game content, runs no simulation, and never interprets a command payload or a blob. That is what
keeps the server image free of decoded game data.

Map-script integration and multiplayer eligibility are documented in
[`MISSIONS.md`](formats/MISSIONS.md#multiplayer-integration). Seat commands include tribute payments,
trader route orders and civilian lessons; all peers must understand their payloads.

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
that belongs to a started room, connected or not, is put back into that room by `hello` alone; in
the lobby a dropped connection is a leave, so only a running game keeps a member across a drop. Its
welcome uses the room's retained canonical nick. When a join assigns a numeric suffix, a further
`welcome` announces that canonical nick before the first room view; it is a name update, not a new
connection. The relay attaches membership before publishing the view, so a client can answer it
immediately. The host closes a connection that has sent nothing, a pong included, for
`SILENT_SOCKET_MS` (30 s); the token may return on a new socket.

## Rooms and seats

`listRooms` returns `rooms { rooms: [{ id, name, state, members, seats }] }`.

`createRoom { settings, seats }` makes a room and puts the sender in it. `settings` is
`{ name, world, seed, rules, speed, kickedSeatMode?, initialSave?, mapOrigin? }`, where `world` and `rules` are the session descriptor's, and
the world is fixed for the room's life. `seats` lists the world's seats in ascending order as
`{ player, mode, color, team? }` with `mode` `ai`, `idle` or `absent`; `human` is never chosen, it is what
a claimed seat becomes. An `absent` seat idles, and a fresh world places none of its authored settlers,
buildings, walls, animals or signposts. A room resumed from a save refuses `absent`, since its world
already stands. `joinRoom { roomId }` joins a room in the lobby; a room that has started refuses. A
duplicate nick within a room gets a numeric suffix (`Ania`, `Ania2`). At most `MAX_MEMBERS` (12)
people share a room.

Every change to a room is broadcast to its members as `room { room }`, the whole view:
`{ id, state, creator, settings, seats: [{ player, mode, color, team?, nick, ready }], members: [{ nick, seat, connected, compatibility }] }`.

- `claimSeat { player }` sits down in a seat nobody holds, which makes it `human` whatever it was;
  `claimSeat { player: null }` stands up and returns it to its lobby setting.
- `setSeat { player, mode?, color?, team? }` is the creator's: `mode` only on a vacant seat.
  `team` is an integer from 0 through 15, or null; omitted/null preserves map-authored diplomacy.
  Explicit teams are carried in the session descriptor, whose trusted setup applies the relations
  and joins each team's seats into one fog mask (`setSharedVision`), so teammates explore, see and
  meet as one in every fog mode.
- `setSettings { settings }` is the creator's. It replaces `{ name, seed, rules, speed, kickedSeatMode? }`
  in full; including `world`, `initialSave` or `mapOrigin` is refused because these are immutable,
  and a replacement that changes nothing produces no room update. A saved room also fixes its seed,
  rules, seat colors and teams; claims and creator-selected vacant AI/idle modes remain editable.
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
A reconnect into a started game is checked by its snapshot tick and digests instead.

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
it and reports `loaded { tick, world: 0 }` with the tick that world stands at (0 for a world with no
setup tick, 1 for a decoded map whose placements drain on one). The first report fixes the room's
built tick; the relay refuses any other tick from the rest, a second `loaded` on the same connection,
and a command sent before any world has loaded. The clock starts once every connected member has
loaded, announced by `clock { tick, speed, paused: false, by: null }` naming the first tick to run.
After the start there is no host role.

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
`ceil((rtt + jitter) / tickLength) + 1` ticks, starting at 2 and never below 1, raised on the spot by
a spike and lowered one tick at a time once the smoothed trip has allowed it for ten quiet samples. A
change is sent as `delay { ticks }`; every member also gets its current delay at the start.

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
(`ai` or `idle`), falling back to its original lobby mode when omitted, and to `idle` for an `absent`
one, whose settlers already stand. The room view reflects this mode. For
`mode: "ai"` the relay lands its `setPlayerAi` envelope on `tick`, the next unemitted one, outside
every budget, so the AI takes the seat on the same tick on every client. For `mode: "idle"` the seat
simply issues nothing more.

## Manual save order capture

`saveOrders { id, tick, world }` completes a locally captured tick-boundary save with every room
command the relay has accepted but that saved world has not applied. The requester must be connected,
loaded and in sync, use its current world generation, and name a tick between the initial world and
both its acknowledged tick and the relay clock. Missing retained history is a refusal, never an
incomplete success. No pause, clock advance or queue drain occurs.

The reply is `saveOrders { id, tick, frames }`: the nonempty frames strictly after `tick`, in
ascending tick order, from the retained emitted frames and the accepted pending ones; sequence
numbers stay contiguous within a frame, and empty `frames` is a complete capture. A command accepted
after the request belongs to a later capture. The client stores the frames as the save's
continuation, with their apply ticks and within-tick order, against the world it captured before
asking.

A reply over `MAX_SAVE_ORDERS_BYTES` (16 MiB of JSON) is refused whole. A refusal carries
`rejected { of: "saveOrders", requestId, reason }` whenever the request named a valid id, parser
refusals included.

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
`initialSave: { fingerprint, tick }` with `tick` at least 1, copied into every session descriptor.
Its fingerprint is SHA-256 of the exact base64 snapshot text. The relay hashes the opaque text,
refuses a mismatch, caches one bounded blob, and broadcasts it to every member, the uploader
included. `requestInitialSave` returns this cache, including after the creator leaves. Ready and
Start require the upload as well as matching reports; a client verifies the hash, the decoded save,
its tick and its map, and restores it against its own content before it reports `save` in its
compatibility report.

A saved start names `snapshotTick: initialSave.tick`; the relay seeds its clock and snapshot cache
there, and every world reported for it must carry that generation. Saved rules and diplomacy stay as
saved; each client queues the roster's seat control once on the first resumed tick. The lobby
releases its cache at Start, and the room's snapshot retention takes over.

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

A manual multiplayer save is written locally and shared through the relay as a `save` blob. What a
save records of its session (the descriptor and the public roster, never a token) is the save
format's contract in [`DATA-FORMAT.md`](DATA-FORMAT.md). A room created from a save offers the
saved human seats as vacant and each player claims one explicitly; the new room's seats supersede a
seat handover the previous room had scheduled but not applied, and player orders keep their saved
ticks and order.

A client keeps the custom maps it verified in browser storage, capped at four maps and 64 MiB of
encoded transfer text, and validates a copy again against its fingerprint and permitted origin before
playing it; base and unknown origins are never served from that store. A reload rejoins on the token,
checks compatibility, and rebuilds from the relay snapshot over the retained map.

## Resync and catching up

The relay keeps the room's newest snapshot and every frame since it. Until the first snapshot it
keeps every frame from the first one. Replay retention is limited to `MAX_HISTORY_BYTES` (16 MiB of
UTF-8 frame JSON) and `MAX_HISTORY_AGE_MS` (10 minutes of wall time since the oldest retained frame).

The relay requests a refresh every `SNAPSHOT_REFRESH_MS` (5 min), or once history reaches half its
byte or age budget. `snapshotRequest` goes to the client in sync with the lowest round trip, which
answers with a `snapshot` blob at its current tick. An unanswered request is repeated every
`SNAPSHOT_RETRY_MS` (10 s) to the next eligible donor, at once when the asked donor drops, and one
request is outstanding however many members wait for it. A snapshot prunes the frames it covers; in
a paused game a snapshot at the cached tick counts as the refresh.

If the age limit is reached or the next frame would exceed the byte limit, the relay ends that room:
connected members receive `error` with an explicit retention-limit reason, then `left`. All members,
including disconnected ones, lose their room association, and the snapshot and history are released.
Their connections remain usable and other rooms continue. The relay never silently discards a frame
needed to replay from its advertised snapshot.

A client told `desync` drops its world and waits. The relay asks the best-connected client in sync
for a fresh snapshot and, when it arrives, sends the diverged client `blob { type: "snapshot" }`
followed by every frame after the snapshot's tick. The client restores, replays those frames, and
acknowledges from the snapshot's tick on; the wait ends once it is within the lag budget. A diverged
client that drops leaves the queue: on its return it asks with `loaded { tick: null }` and takes the
cache, or the next snapshot when none is cached yet. Nothing is sent to it before it asks.

A returning token gets `room`, its pending `desync` notice if it has one, `start { session,
snapshotTick }`, `clock` while the game runs, and `ended` once it has ended. `snapshotTick`
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
| `SILENT_SOCKET_MS` | 30 s |
| started room kept with nobody connected | 10 minutes |
| `MAX_COMMANDS_PER_TICK` per member | 20 |
| `PAUSE_BUDGET` per member per game | 3 |
| `MAX_SPEED` | 8 |
| `WAIT_BEHIND_MS` | 2 s of frames |
| `SILENT_AFTER_MS` | 4 s |
| `KICK_COUNTDOWN_MS` | 60 s |
| `SNAPSHOT_REFRESH_MS` / `SNAPSHOT_RETRY_MS` | 5 min / 10 s |
| nick / room name / chat line | 24 / 48 / 500 characters |
| room id / world id / command kind / refusal reason | 32 / 128 / 64 / 200 characters |
| `MAX_SEED` | 2^32 - 1 |
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
came from, the `RELAY_PUBLIC_URL` it was given, and how busy it is. `GET` or `HEAD` of any other
path is a 404, any other method a 405. The image, its environment and its sizing are described in
[Development: Relay image](DEVELOPMENT.md#relay-image).

## Match termination

Room states are `lobby`, `running`, and `ended`, with no reverse transition. Start permanently
closes the lobby. New participants require a new room, optionally created from a save; reconnecting
an existing participant is distinct from joining a running match.

A local defeat does not pause the shared clock or end the match while other participants remain
undecided. Once the simulation decides every declared participant, each client stops exactly at
that tick and sends `finish { tick, hash, world }` after its tick acknowledgement. `hash` is the
full simulation state hash (eight lowercase hexadecimal digits), not the per-tick digest; a world
adopted already decided reports its loaded tick.

The relay compares result tick and hash from every connected participant with a loaded, synchronized
world, and holds the result while a connected member is still loading or out of sync. Stale world
generations do not count. Once those reports agree, it stops its clock at the
result tick, clears waiting notices, broadcasts the ended room view and `ended { tick, hash }`. Frames
already emitted beyond that tick are never simulated by clients that reached the shared result.
If every connected participant reports a result but the tick or full hash differs, the relay ends
the room with an explicit result-disagreement error rather than claiming a shared result.
Disconnected identities do not block agreement; reconnect retains the result and permits restoration
and replay up to the final tick without restarting the clock.

A returning client verifies the final hash before it shows the result. Leaving an ended session
releases membership without scheduling a seat handover. Commands, clock changes, kicks, lobby edits
and Start cannot restart the ended session; another match needs a new room.

## Background windows

Window focus and tab visibility do not change room membership: a client that stops ticking is waited
for and can be voted out under the rules above, never removed on its own, and drains its buffered
frames when it resumes. The desktop window disables Electron's background throttling so a minimized
client keeps ticking.

## Public relay security boundary

The relay accepts anonymous players. A client-generated token is a bearer secret for reconnecting,
not an account or a ban-resistant identity. The official client generates 24 random bytes; the
relay never publishes tokens in room views or logs. Protect tokens in transit with WSS. Room ids
and nicknames are public, and anyone can enter an open lobby. A modified client can lie about its
simulation or sabotage its own match; digest agreement is not an anti-cheat guarantee.

The host bounds application and WebSocket control traffic together at 256 messages/s with a
512-message burst, and 1 MiB/s with a two-blob burst. Recovery requests (`loaded`, `saveOrders`,
`requestInitialSave`) share a separate four-request burst, refilling one request every two seconds,
before relay dispatch. Exceeding a traffic budget disconnects the sender. WebSocket compression is
disabled, payloads are capped, an unacknowledged close is terminated after one second, and a socket
silent for 30 s is closed.

The HTTP host caps all TCP connections at the configured WebSocket limit plus 16, including sockets
that have not sent upgrade headers. Headers have a five-second deadline, a request ten seconds, an
idle keep-alive socket Node's default of five seconds, and a keep-alive connection serves at most
100 requests. These bounds do not reserve capacity for legitimate users when an attacker fills every
slot. Limits apply per connection or room, not to process memory or network throughput; sizing a
deployment is covered with the image in [Development: Relay image](DEVELOPMENT.md#relay-image).

A public deployment needs an updated Node/container base, TLS, edge connection/upgrade rate limits,
and explicit process memory/CPU and log limits. Bind the relay only to the proxy's private network
or loopback, block direct public access to its port, run it without root, and give it no host mounts,
secrets or Docker socket. The image already runs as `node` and needs no writable game data; use a
read-only filesystem and drop capabilities. The host does not trust `X-Forwarded-For`; per-address
controls belong at the proxy with a correctly configured trusted-proxy chain. Reconnecting creates a
new socket budget, so edge limits must also cover connection churn. Bandwidth DDoS protection
belongs upstream.
