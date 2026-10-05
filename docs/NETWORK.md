# Network protocol

The wire contract between a game client and the relay server, version `PROTOCOL_VERSION = 21` in
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
with `CLOSE_REPLACED` (4000), `CLOSE_PROTOCOL_ERROR` (1002) or `CLOSE_SERVICE_RESTART` (1012, the
relay shutting down with its rooms) is final; after any other close a client may reconnect on its
token.

The relay replies to a message it cannot honour with `rejected { of, reason }`, naming the kind it
refused, and keeps the connection. A violation of the protocol itself gets `error { reason }`
followed by a close whose reason text is the bare code. A `reason` is never prose: it is
`{ code, ...values }`, one of the codes in `net-protocol`'s `RelayReason` with the values that code
names (a seat index, a nick, a count), and each client words it in its player's language. Only
`malformed` carries text, the parser's `detail`, which is a developer diagnostic and is not shown.

## Identity

The first message on a connection is `hello { protocol, token, nick }`. The `token` is a secret the
client generated and stored (16 to 128 URL-safe characters). Browser clients keep a separate token
for each normalized relay origin and path so another relay cannot impersonate them. The token is the
identity and is never shown to other clients. The `nick` is display only. The relay answers `welcome { protocol, nick }`,
or `error { reason: { code: "protocolUnsupported", client, relay } }` naming both versions when it
speaks another, and closes. The shapes of `hello`,
`welcome` and `error` hold across versions, so a mismatch reads the same on any pair. A connection
that has not said `hello` within `HELLO_TIMEOUT_MS` (10 s) is closed.

A `hello` with a token already connected replaces that connection: the older one gets
`error { reason: { code: "replaced" } }` and is closed, and its room membership carries over. A token
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
`{ player, mode, offers, color, team?, authoredTribe?, tribe?, difficulty? }` with `mode` `ai`, `idle` or `absent`;
`human` is never chosen, it is what a claimed seat becomes. `offers` lists the vacant modes the map's
`playeroption` row allows the seat, `mode` among them. `authoredTribe` is the tribe the map's roster
names for the seat, and `tribe` the one it starts as when that differs (a saved world's choice); a seat
without `authoredTribe` offers no tribe choice, and `tribe` needs it. Tribe ids are integers from 1
through `MAX_TRIBE_ID` (255); which of them name a civilization is the clients' content to say.
`difficulty` (`easy`, `medium` or `hard`) marks a seat the computer may play at a level and is the level
it starts at; the clients give it to a civilization seat the strategic AI plays, never to a monster seat
or a scripted camp whose map script stops that AI.
An `absent` seat idles, and a fresh world places none of its authored settlers,
buildings, walls, animals or signposts. A room resumed from a save refuses `absent`, since its world
already stands. `joinRoom { roomId }` joins a room in the lobby; a room that has started refuses. A
duplicate nick within a room gets a numeric suffix (`Ania`, `Ania2`). At most `MAX_MEMBERS` (12)
people share a room.

Every change to a room is broadcast to its members as `room { room }`, the whole view:
`{ id, state, creator, settings, seats: [{ player, mode, offers, color, team?, authoredTribe?, tribe?, difficulty?, nick, ready }], members: [{ nick, seat, connected, compatibility, load, loading, roundTripMs, delayTicks, behindTicks }] }`,
where a seat carries `authoredTribe` and its current `tribe` together or neither.
A member's `load` is the one its last acknowledgement reported (below), null before its first. Its
`loading` is the boot progress in whole percent it last reported before its world loaded (below),
null once that world has loaded and before its first report. `roundTripMs` is the relay's smoothed
round trip to the member in milliseconds (0 until its first pong) and `delayTicks` its assigned input
delay (see [Input delay](#input-delay)), both null while it is disconnected. `behindTicks` is how many
ticks its acknowledgements trail the clock: 0 before the clock runs, after the match ended, and while
the relay does not follow its world (disconnected, loading, or out of sync). Once the room has
started, a moved load, progress, round trip, delay or `behindTicks` alone sends a view at most once
per `LOAD_VIEW_INTERVAL_MS` (1 s) per room; in the lobby only progress does. Any other change carries
the current figures with it.

- `claimSeat { player }` sits down in a seat nobody holds, which makes it `human` whatever it was;
  `claimSeat { player: null }` stands up and returns it to its lobby setting.
- `setSeat { player, mode?, color?, team?, tribe?, difficulty? }` is the creator's: `mode` only on a
  vacant seat that offers it. A seated member may also send `tribe` alone for its own seat. `tribe` needs
  a seat with an `authoredTribe` (else `seatTribeUnavailable`), and reaches the start descriptor's seat
  only when it differs from the authored one; a seat without it plays the map's roster tribe.
  `difficulty` needs a seat that has one (else `seatDifficultyUnavailable`), and reaches the start
  descriptor's seat only while the computer plays it; a computer seat without one plays `hard`.
  `team` is an integer from 0 through 15, or null; omitted/null preserves map-authored diplomacy.
  Explicit teams are carried in the session descriptor, whose trusted setup applies the relations
  and joins each team's seats into one fog mask (`setSharedVision`), so teammates explore, see and
  meet as one in every fog mode.
- `setSettings { settings }` is the creator's. It replaces `{ name, seed, rules, speed, kickedSeatMode? }`
  in full; including `world`, `initialSave` or `mapOrigin` is refused because these are immutable,
  and a replacement that changes nothing produces no room update. A saved room also fixes its seed,
  rules, seat colors, teams, tribes and levels; claims and creator-selected vacant AI/idle modes remain
  editable.
- `setCompatibility { compatibility }` supplies the sender's report or null to invalidate it.
- `setReady { ready }` needs a seat; becoming ready also requires all compatibility checks to pass.
- `leaveRoom` frees the seat and identity; the last member out drops the room, and
  a creator who leaves passes the role to the next member. Once the clock runs, explicit departure
  immediately applies the same deterministic AI/idle seat handover as a passed kick vote, without
  a countdown or vote. A seated member that leaves after the start but before the clock runs ends the
  room instead (see [Waiting](#waiting)). Socket loss alone retains the seat for reconnection. The
  departing connection can create or join another room as soon as it receives `left`.

Every effective report, membership, seat, team, color, tribe, level or settings change clears all ready
flags.
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
and a command sent before any world has loaded. The clock starts once every member has loaded, one
whose connection dropped included, so a game never starts without one of its players. The start is
announced by `clock { tick, speed, paused: false, by: null, governed: null }` naming the first tick
to run. The app reports `loaded` only once its display draws the world, so every player's game
starts together rather than when the slowest one's sim is built. A client holding no world that asks
with `loaded { tick: null }` instead counts as loaded once the relay serves it the room's snapshot,
before its display shows the restored world. Until then it may send
`loading { progress }`, its boot progress in whole percent (0-100), which the room view shows; the
relay ignores progress from a member whose world has loaded.
After the start there is no host role.

## The clock and tick frames

Once started, the relay emits one `frame { tick, commands }` per simulation tick on its own clock,
at `TICKS_PER_SECOND` (12) times the running speed, empty frames included. Ticks count on from the
one the built worlds stood at and are never skipped. A client runs tick `t` only once it holds
frame `t`; that is the whole synchronisation rule. If the relay stalls it emits at most a short
burst and the game runs late; no tick is dropped.

`commands` is the list of `{ envelope, sequence }` that apply on that tick, with `sequence` counting
from 0 in the order the relay received them. Every client applies them in that order, after the
tick's own untargeted commands, through `Simulation.enqueueAt`.

Any member may change the clock with `clock { speed?, paused? }`. The relay applies it and broadcasts
`clock { tick, speed, paused, by, governed }` with the sender's nick and the first tick the setting
holds from; a speed request carries `governed` recomputed for the new requested speed. Pauses are
unlimited.

`speed` is always the requested speed. The running speed is `governed.speed` while `governed` is
`{ nick, speed, cause }`, and `speed` when it is null: the relay governs the clock while any member is
slow (see [Pacing](#pacing)) and runs it at the slowest one's pace. `cause` is `load` when that
member's reported tick cost bounds the speed, and `lag` when the catch-up share does: the member says
it could keep up, yet trails, as over a poor link. Clients run their driver at
`governed?.speed ?? speed`. The relay broadcasts `clock` with `by: null` whenever the governing member,
its speed or its cause changes.

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

After every tick a client sends `ack { tick, digest, world, load }` with the sim's `SyncDigest.domains`
for that tick: one unsigned 32-bit word per domain (`rng`, `entities`, `players`, `movement`,
`settlers`, `economy`, `combat`, `fog`). `world` is the generation of the world the client reports
from: 0 for one built from the descriptor, otherwise the tick of the snapshot it was restored from.
An acknowledgement from another generation is still in flight from a world the client has thrown
away, and is ignored. Within a generation acknowledgements are consecutive; one out of order or
ahead of the clock is refused. The acknowledged tick is also how far the relay believes the client
has applied.

`load { tickMs, buffered }` is the client's own pace. `tickMs` is the wall time one tick costs it in
milliseconds, the larger of two exponential moving averages whose newest tick weighs
`1 / TICKS_PER_SECOND`: the sim's, on the thread that runs it (frame admission, the step, and the
host's work to hand the tick to its display), and the display's, sampled once per drawn frame as the
frame interval over the most ticks a frame takes in on average, weighing as the ticks that frame
took in. The app's sim worker steps only a couple of frames
past the tick its display drew, so a display that cannot keep up also leaves the client's
acknowledgements behind, and the relay governs the room for it as for a slow sim.
`buffered` is the frames it holds received and not yet applied. The relay keeps the latest load of
an accepted acknowledgement as sent, with no smoothing of its own.

Once every client in sync has passed a tick, by acknowledging it or by being moved past it with a
snapshot, the relay compares the digests those clients reported for it. The majority digest is the
reference; on a tie, the client connected the longest (the earliest current connection, then the
earliest to join). A client in the minority gets `desync { tick, domains, reference }` naming the
domains that differ and the reference's nick, and is out of sync from then on: its acknowledgements
are ignored and its snapshots refused until it has rebuilt from a snapshot, and the notice is sent
again if it reconnects meanwhile. The reference, if connected, gets one `disputed { tick, domains,
diverged }` naming the nicks newly out of sync at that tick and the union of their differing domains,
so both sides can keep that tick's digest inputs for a diagnostics bundle. A client acknowledging a tick the room has already settled is
judged against that tick's reference, so a returning client is checked from its first tick back. A
disconnected client's reports do not count; it says where it stands again on its return.

## Waiting

The clock holds, emitting no frames, while any member is:

- `gone`: its connection dropped;
- `silent`: it has answered no ping for `SILENT_AFTER_MS` (4 s), whatever its socket says;
- `loading`: it has not said where its world stands, before the start or after a return;
- `resync`: it is out of sync and its snapshot has not arrived.

A held clock runs for nobody: a `clock { paused: false }` changes the pause flag and nothing else, and
the frames resume once nobody is waited for. A member that is merely behind is never waited for; see
[Pacing](#pacing).

Every change to the waited set is broadcast as `waiting { for: [{ nick, reason, voteAfterMs }] }`; an
empty `for` ends the wait. Each member's `voteAfterMs` counts down from `KICK_COUNTDOWN_MS` (60 s)
from the moment that member began to be waited for, and restarts only once it has stopped being waited
for. A wait is over as soon as nobody is waited for: the dropped token returned, the silent one
answered, or the diverged one rebuilt. A client that never loads or stops answering pings is waited
for and can be voted out, before the start as after it; a member kicked before the start is not waited
for to start the clock. Before the clock runs, a member that has not loaded and whose boot has not
moved for `LOADING_STALL_MS` (2 min, counted from the start, its last `loading`, its `loaded`, or its
drop or return) ends the room: every connected member gets `error { loadingTimedOut, nick }` and
`left`, and the players host again. The app shows no countdown for it and offers no vote on its
loading screen. A seated member that leaves the room before the clock runs ends it at once, with
`error { leftBeforeStart, nick }` and `left` to the others.

## Pacing

A member the relay follows (connected, heard, loaded and in sync) is lagging while its acknowledged
tick trails the clock by more than `LAG_BEHIND_MS` (1 s) of frames at the requested speed, 12 ticks
at speed 1 and 12 times the speed otherwise. A lagging member catches up alone and the room notices
nothing. Once it has lagged for `SLOW_GRACE_MS` (4 s) of wall time in a row it is slow, and stays slow
until it trails by no more than `GOVERN_RELEASE_MS` (0.5 s) of frames. A member the clock holds for
is neither.

A slow member is never waited for, gets no countdown and cannot be voted out. While any member is
slow the relay governs the clock, whatever the requested speed. Each slow member's bound is the lower
of its sustainable speed with headroom, `TICK_MS / load.tickMs * GOVERNOR_HEADROOM` (0.8), or
`GOVERNOR_HEADROOM` times the requested speed before its first load report, and the catch-up share
of the requested speed, `CATCH_UP_SHARE` (0.8) times it. `cause` names the lower one, `lag` on a tie.
The bound is rounded to `GOVERNED_SPEED_STEP` (0.05), never above the requested speed and never below
`MIN_GOVERNED_SPEED` (0.25) unless the requested speed is; a member slower than that falls further
behind at it. The lowest bound wins, and a tie goes to the member furthest behind. The governed
speed drops at once but rises only by `GOVERNED_RISE_STEPS` (2) steps or more at a time, so a load
report jittering across one rounding boundary does not become a `clock` broadcast per advance. Once
nobody is slow the clock runs at the requested speed again.

## Kick votes

Once a member's countdown has passed, any other member sends `kick { player }` for its seat; a
repeat from the same member counts once. Every yes is broadcast as
`kickVote { player, nick, yes: [nicks], needed }`, where `needed` is half of the connected members
other than the target, rounded up. A vote lives only while its target is waited for; a member that is
only slow is refused with `notWaitedFor`.

When the yeses reach `needed` the relay broadcasts `kicked { player, nick, mode, cause, tick }`, removes
the member (its token is a stranger from then on), and returns the seat to `settings.kickedSeatMode`
(`ai` or `idle`) when the seat offers it, else to its lobby mode, and to `idle` for an `absent` one,
whose settlers already stand. The room view reflects this mode. For
`mode: "ai"` the relay lands its `setPlayerAi` envelope on `tick`, the next unemitted one, outside
every budget, so the AI takes the seat on the same tick on every client. For `mode: "idle"` the seat
simply issues nothing more. A vote passed before any world has loaded holds its handover notice and
AI command until the first `loaded` fixes the built tick, and then names the first resumed tick.
`cause` says why the seat was left: `vote`, or `left` for a member
that left the started game itself.

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

A reply over `MAX_SAVE_ORDERS_BYTES` (16 MiB of serialized UTF-8 JSON) is refused whole. A refusal carries
`rejected { of: "saveOrders", requestId, reason }` whenever the request named a valid id, parser
refusals included.

## Blobs

`blob { type, to, tick, bytes }` carries opaque bytes: `bytes` is base64 of at most `MAX_BLOB_BYTES`
(16 MiB) decoded, `type` is `snapshot`, `save`, `initialSave`, or `map`, `to` names one member's nick or null for
everyone else in the room, and `tick` is required for a snapshot or a save. The relay never decodes
the bytes; it delivers them as `blob { type, from, tick, bytes }` with the sender's nick.

A `snapshot` upload also requires `world`, the donor's world generation at capture, as on an
acknowledgement. An upload from another generation is stale and ignored, even if its tick is newer
than the corrected cache; compression and delivery may have started before the donor's resync.

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
saved human seats as vacant and each player claims one explicitly, with the saved seats' colors, teams,
tribes and levels, since its world already stands; the new room's seats supersede a
seat handover the previous room had scheduled but not applied, and player orders keep their saved
ticks and order.

A client keeps the custom maps it verified in browser storage, capped at four maps and 64 MiB of
encoded transfer text, and validates a copy again against its fingerprint and permitted origin before
playing it; base and unknown origins are never served from that store. A reload rejoins on the token,
checks compatibility, and rebuilds over the retained map from the relay's cached snapshot, or from the
descriptor while the relay still holds every frame.

## Resync and catching up

The relay keeps the room's newest snapshot and every frame since it. Until the first snapshot it
keeps every frame from the first one. Replay retention is limited to `MAX_HISTORY_BYTES` (16 MiB of
UTF-8 frame JSON) and `MAX_HISTORY_AGE_MS` (10 minutes of wall time since the oldest retained frame).

The relay requests a refresh every `SNAPSHOT_REFRESH_MS` (5 min), or once history reaches half its
byte or age budget. `snapshotRequest` goes to the client in sync with the lowest round trip, which
answers with a `snapshot` blob at its current tick. An unanswered request is repeated every
`SNAPSHOT_RETRY_MS` (10 s) to the next eligible donor, at once when the asked donor drops, and one
request is outstanding however many members wait for it. A snapshot prunes the frames it covers.
With no retained frames, a same-tick upload also satisfies a paused refresh. An older upload leaves
the cache unchanged.

When the cached snapshot's donor is found out of sync, the cache is held back: a drop forgets held
digests, so that tick may never have been judged. Reconnects then wait for a replacement while a
client in sync can send one; with none left, returning clients take the held copy and diverged ones
keep waiting for the next donor. The held copy's tick still marks the start of retained replay
history. A same-tick upload can replace it. Otherwise the first copy of a tick stays cached, so a
delayed same-tick duplicate cannot undo a correction.

A diverged member is served only a snapshot whose tick is later than its discarded world generation.
Otherwise it keeps waiting for a fresh donor upload, so a repeated resync cannot make that world's
in-flight acknowledgements or snapshot uploads current again.

If the age limit is reached or the next frame would exceed the byte limit, the relay ends that room:
connected members receive `error` with the `historyBytes` or `historyAge` reason, then `left`. All members,
including disconnected ones, lose their room association, and the snapshot and history are released.
Their connections remain usable and other rooms continue. The relay never silently discards a frame
needed to replay from its advertised snapshot.

A client told `desync` drops its world and waits. The relay asks the best-connected client in sync for
a fresh snapshot and, when it arrives, sends the diverged client `blob { type: "snapshot" }` followed
by every frame after the snapshot's tick. The client restores, replays those frames, and acknowledges
from the snapshot's tick on, catching up as any lagging member does (see [Pacing](#pacing)). A
diverged client that drops leaves the queue: on its return it asks with `loaded { tick: null }` and
takes the cache, or the next snapshot when none is cached yet or the cache is held back. Nothing is
sent to it before it asks.

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

`chat { text }` is broadcast to the room as `chat { from, text, tick }`, where `tick` is the clock's
next tick when the relay received the line, null before the clock has started. One printable line, at
most `MAX_CHAT_LENGTH` (500) characters, like every other string that reaches another person. Unicode
line and paragraph separators are refused along with control characters.

The relay keeps each room's lines, the lobby's included, up to the newest `MAX_CHAT_HISTORY_LINES`
(500); the log ends with the room. A member gets `chatHistory { lines: [{ from, text, tick }] }`, oldest
first, right after the room view each time it enters the room: on creating it, on joining it, and on
every return of its token, before `start` and `clock`.

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
| `MAX_SPEED` | 8 |
| `LAG_BEHIND_MS` / `GOVERN_RELEASE_MS` | 1 s / 0.5 s of frames |
| `SLOW_GRACE_MS` | 4 s |
| `GOVERNOR_HEADROOM` / `CATCH_UP_SHARE` / `MIN_GOVERNED_SPEED` | 0.8 / 0.8 / 0.25 |
| `GOVERNED_SPEED_STEP` / `GOVERNED_RISE_STEPS` | 0.05 / 2 steps |
| `MAX_REPORTED_TICK_MS` / `MAX_REPORTED_BUFFERED` in `load` | 60 s / an hour of ticks at `MAX_SPEED` |
| `SILENT_AFTER_MS` | 4 s |
| `KICK_COUNTDOWN_MS` | 60 s |
| `LOADING_STALL_MS` | 2 min |
| `SNAPSHOT_REFRESH_MS` / `SNAPSHOT_RETRY_MS` | 5 min / 10 s |
| nick / room name / chat line | 24 / 48 / 500 characters |
| `MAX_CHAT_HISTORY_LINES` per room | 500 |
| room id / world id / command kind / `malformed` detail | 32 / 128 / 64 / 200 characters |
| `MAX_SEED` | 2^32 - 1 |
| token | 16 to 128 URL-safe characters |

## The client

`packages/net-client` is the client half every host shares: `RelayClient` walks the lobby, opens the
world `start` names through a port the host supplies, runs it over `RelayTransport`, acknowledges
every tick, answers pings and snapshot requests, and asks a diverged world's host to restore. It runs
the sim a frame or two behind the relay's clock (`JITTER_BUFFER_TICKS`) by scaling the time it feeds
the driver, never by skipping a tick, so a late frame lands inside the buffer. `RelaySocket` keeps
the connection and reopens it on the same token after a drop; a connection the relay replaced or
refused stays closed. The desktop and browser app plays through the `?relay=` entry, whose client,
link and world run in a network worker, the headless test client through an in-memory network. The
app's client holds `loaded` until the display draws its first frame of the world, and keeps the
loading screen up until the room's clock runs and nobody is still loading. A
stalled display thread does not delay the app's acknowledgements: the worker keeps stepping and
acknowledging, and drops the transient events of ticks the display has not taken.

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

Window focus and tab visibility do not change room membership: a client that stops ticking but
answers pings is paced for, and one that stops answering is waited for and can be voted out, under
the rules above. Neither is removed on its own, and both drain their buffered frames when they
resume. The desktop window disables Electron's background throttling so a minimized
client keeps ticking.

In a browser the network worker steps and acknowledges on its own `setTimeout` chain, so a hidden tab
does not stop it, but the browser slows it. Measured with a dedicated worker running a 20 ms timer chain
and a 20 ms interval, on a tab hidden behind another tab of the same window for seven minutes (macOS):

| Browser | Visible | Hidden |
| --- | --- | --- |
| Chrome 153 | 22 ms per firing | about 95 ms per firing from the moment the tab is hidden, steady for the whole seven minutes, no drop to once per second |
| Safari 27 | not measured, hidden from the start | about 100 ms per firing for four and a half minutes, then the tab stopped reporting at all and stayed silent |
| Firefox 155 | 24 ms per firing | not reached: behind another window and minimized the page never reported itself hidden and kept 24 ms |

The lockstep driver owes `elapsed * speed` ticks per firing and steps at most five of them, so a
clamped 100 ms firing still delivers up to 50 ticks a second: derived from the driver, not measured in
the worker, a hidden Chrome tab keeps pace up to about speed 4 and trails beyond it. The room is then
paced for it, and on return it drains its buffered frames at up to five ticks per firing. A Safari tab
suspended this way acknowledges nothing and is `silent` after `SILENT_AFTER_MS`; nothing distinguishes
it from a crashed client. Neither case is designed around: the desktop build is the primary target.

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
