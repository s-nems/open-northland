# Network protocol

The wire contract between a game client and the relay server, version `PROTOCOL_VERSION = 59` in
`packages/net-protocol`. A change one side of the current version could not honour (a message shape, or
the value set of a validated field such as the fog mode ids) bumps the version; the relay refuses a
`hello` that names another.

The model is server-paced deterministic lockstep. Every client runs the full simulation. The relay is the
authority for time, order, membership and session settings, and for nothing else: it holds no game
content, runs no simulation and never interprets a command payload or a blob, which keeps the server image
free of decoded game data.

Map-script integration and multiplayer eligibility are in
[`MISSIONS.md`](formats/MISSIONS.md#multiplayer-integration). Seat commands include tribute payments,
trader route orders and civilian lessons; all peers must understand their payloads. Constant values are
in [Limits](#limits), refusal codes per message in [Refusal codes](#refusal-codes).

## Transport

WebSocket, one JSON text frame per message, each an object with a string `kind`; a binary frame or
unparsable text closes the connection. A client message is at most `MAX_CLIENT_MESSAGE_BYTES`, a `blob` at
most `MAX_BLOB_MESSAGE_BYTES`. A relay message is bounded by what it carries: a tick frame holds up to
`MAX_SEATS * MAX_COMMANDS_PER_TICK` envelopes, at most `MAX_COMMAND_BYTES_PER_TICK` per member plus
sequence wrappers (a little over 16 MiB in all), and a blob is as large as the one a client sent.

A close with `CLOSE_REPLACED` (4000), `CLOSE_PROTOCOL_ERROR` (1002) or `CLOSE_SERVICE_RESTART` (1012, the
relay shutting down with its rooms) is final; after any other close a client may reconnect on its token.
A traffic-budget excess closes with 1013 and `trafficLimit`, also for a stalled TCP upload that releases a
burst of valid catch-up acknowledgements; the returning client reports its world and tick through
`loaded`. A fault while the relay handles a message closes that connection with 1011 and `relayFault`.
A client closes an open socket with 1000 and a reason saying why: `closed` when its player ends the
session, `linkQuiet` when it replaces a link it heard nothing on (`LINK_REPLACE_MS`, or
`TRANSFER_REPLACE_MS` while it awaits a large message). The relay only logs the reason, so a page that
closed (1001) or a link that dropped (1006) reads apart from it.

A message the relay cannot honour gets `rejected { of, reason }` naming its kind, and the connection
stays. A protocol violation gets `error { reason }` and a close whose reason text is the bare code. A
message that fails to parse is refused with `malformed` when its sender has said `hello` and its kind is
known, and is a violation otherwise. A `reason` is `{ code, ...values }`, a `RelayReason` code with the
values it names (a seat index, a nick, a count), never prose: each client words it in its player's
language. Only `malformed` carries text, the parser's `detail`, a developer diagnostic that is not shown.

## Identity

The first message on a connection is `hello { protocol, token, nick, flag? }`. The `token` is a secret the client
generated and stored: the identity, never shown to other clients. Browser clients keep one token per
normalized relay origin and path, so another relay cannot impersonate them. The `nick` is display only,
and so is `flag`: two capital letters naming the flag the player shows beside the nick, left out for none.
The relay checks only that shape and leaves out a `hello` flag of another, so `hello` still parses for any
version; a client draws the codes its flag set has and nothing for others. A member keeps the flag it joined its room with, as it keeps its nick. The online players of `presence`,
`hallChat` and `chat` lines and room members carry that `flag` beside the nick, left out likewise; a
client that knows no flags ignores the field.
The relay answers `welcome { protocol, nick, build? }`, `build` being its `RELAY_BUILD` when set, or,
speaking another version, `error { reason: { code: "protocolUnsupported", client, relay } }` and a close.
`hello`, `welcome` and `error` keep their shapes across versions, so a mismatch reads the same on any
pair. A connection without `hello` within `HELLO_TIMEOUT_MS` is closed, and the host closes a socket with
no incoming transport data, a pong included, for `SILENT_SOCKET_MS`; the token may return on a new socket.

A `hello` with a token already connected replaces that connection: the older one gets
`error { reason: { code: "replaced" } }` and is closed, and its room membership carries over. A token that
belongs to a started room, connected or not, is put back into that room by `hello` alone, and its
`welcome` uses the room's retained canonical nick; in the lobby a dropped connection is a leave. Any
other `hello` whose nick another connection or a room member holds, ignoring case, compatibility forms and invisible characters,
gets the lowest free numeric suffix in its `welcome`, as a room join does. When a
join assigns a numeric suffix, a further `welcome` announces that canonical nick before the first room
view, as a name update, not a new connection. The relay attaches membership before publishing the view,
so a client can answer it immediately.

## Rooms and seats

`listRooms` returns `rooms { rooms: [{ id, name, state, members, seats, world, locked, playedMs }] }`:
`members` holds the nicks of the members connected now, `world` is the room's `settings.world`, `locked`
whether joining asks a password, and `playedMs` the wall milliseconds since the room's clock first ran,
null before it runs and once the match ended. A client
outside a room also gets the list unasked, see [The hall](#the-hall).
`createRoom { settings, seats, password? }` makes a room with the sender in it as creator; a `password`
(one printable line of at most `MAX_ROOM_PASSWORD_LENGTH`, trimmed) locks it. `joinRoom { roomId, password? }`
joins a room in the lobby; a started room refuses, as does a room that banned the sender's token or peer
address (`banned`). A locked room refuses a missing or wrong password with `wrongPassword`, and once the
sender's peer address has spent `JOIN_PASSWORD_BURST` such attempts, one more each
`JOIN_PASSWORD_REFILL_MS`, refuses any `joinRoom` to a locked room with `retryTooSoon`. An open room
ignores a password. The relay keeps only a SHA-256 digest of the password, and no view, summary or log
line carries it. A duplicate nick within a room gets a numeric suffix
(`Ania`, `Ania2`). Observers occupy no map seat and have no slot limit; the lobby shows each observer and
one more free observer row.

`settings` is `{ name, world, seed, rules, speed, kickedSeatMode?, initialSave?, mapOrigin?, catalogMap? }`;
`world` and `rules` are the session descriptor's, and the world is fixed for the room's life. A map
world's optional `variant` names one of the map's committed variants (`packages/data/src/map-variants/`),
which also decides the seats the creator lists. Alliances
come from the map's diplomacy and in-game diplomacy; while the rules' `alliedVision` is on, the sim joins
mutual friends into one fog mask and follows later stance changes, so allies explore, see and meet as one
in every fog mode. The rules' `peace` (30, 45, 60, 75, 90, 120 or 180 minutes, or null) opens a peace from the
match start among every human, idle and lobby computer seat. `seats` lists the world's seats in ascending order:

| Field | Meaning |
| --- | --- |
| `player` | Seat index. |
| `mode` | `map-ai`, `computer`, `idle` or `absent` (below). `human` is never chosen; it is what a claimed seat becomes. |
| `claimable` | Required. False for scenario-only or hidden seats, whose claims get `seatNotClaimable`. |
| `offers` | The vacant modes the map's `playeroption` row allows the seat, `mode` among them. |
| `color` | Seat color. |
| `authoredTribe?` | The tribe the map's roster names; a seat without it offers no tribe choice. |
| `tribe?` | The tribe it starts as when that differs (a saved world's choice); needs `authoredTribe`. Ids run from 1 through `MAX_TRIBE_ID`; which name a civilization is the clients' content to say. |
| `difficulty?` | `easy`, `medium` or `hard`: the computer may play the seat at a level, and this is the one it starts at. Clients give it to a civilization seat the computer player controls, never to a monster seat or a reserved map AI camp with autonomous control disabled. |

| Mode | Lobby | Offered | Effect |
| --- | --- | --- | --- |
| `computer` | Computer | Where a computer is allowed; the default of selectable authored AI seats. | Autonomous control. An explicit selection enables both controllers and overrides `AI_Disable`, `HAI_Disable` and module switches, within the tribe's capabilities. |
| `idle` | Idle | Where a computer is allowed. | Entities remain without AI control. |
| `absent` | None | Where `playeroption` allows None; refused in a room resumed from a save, whose world already stands. | The seat idles, and a fresh world places none of its authored settlers, buildings, walls, animals or signposts. Authored `PLAYER_TYPE_NONE` seats are absent and unclaimable. |
| `map-ai` | Map AI | Only on reserved scenario seats, as their sole mode; they cannot be claimed. | The map's `[AIData]` configuration, respecting `AI_Disable`, `HAI_Disable` and module switches. |

An explicit `playeroption` row decides whether a person may take a seat, even when its roster default is
`human`; without that row the authored player type decides. The computer and map AI controllers have
separate enabled gates: disabling every known computer module is not a substitute for the blanket
computer gate. The receiving app validates the room and session roster against the verified map before
starting the world, and reads hidden seats from that map, including maps transferred by the host; the
relay validates wire consistency without loading map content.

### The room view

Every change to a room is broadcast to its members as `room { room }`, the whole view:
`{ id, state, creator, settings, locked, seats, members }`, `locked` as in the room list. A seat carries the fields above plus `nick` and
`ready`, with `authoredTribe` and its current `tribe` together or neither. A member is:

| Field | Meaning |
| --- | --- |
| `nick`, `flag`, `seat`, `connected`, `compatibility` | Identity, seat and report. |
| `load` | What its last acknowledgement reported ([below](#acknowledgements-and-the-sync-check)); null before its first. |
| `loading` | Boot progress in whole percent last reported before its world loaded; 100 once loaded; null before its first report. |
| `roundTripMs` | The relay's smoothed round trip to it in ms, 0 until its first pong; null while disconnected. |
| `delayTicks` | Its assigned [input delay](#input-delay); null while disconnected. |
| `behindTicks` | Ticks its acknowledgements trail the clock; 0 before the clock runs, after the match ended, and while the relay does not follow its world (disconnected, loading or out of sync). |

Once the room has started, loading included, a moved load, progress, round trip, delay or `behindTicks`
alone sends a view at most once per `LOAD_VIEW_INTERVAL_MS` per room. Before `start` no figure alone sends
a view: a link measurement is stored and shown with the next view, and progress is refused with
`gameNotStarted`. Any other change carries the current figures with it.

### Lobby messages

- `claimSeat { player }` sits down in a seat nobody holds, which makes it `human`.
  `claimSeat { player: null }` becomes a read-only observer: in the lobby the seat returns to its vacant
  setting; in a running game it releases control, marks the seat idle in the view and leaves the world
  unchanged. A running observer cannot reclaim a seat, and a reconnect keeps the observer role.
- `setSeat { player, mode?, color?, tribe?, difficulty? }` is the creator's; a seated member may send
  `color` and `tribe` for its own seat. A `color` another seat wears is refused `colorTaken` (the
  wearer's seat in `wearer`); a map's duplicate colours stand until changed. `mode` applies only to a vacant seat that offers it. `tribe` needs an
  `authoredTribe` (else `seatTribeUnavailable`) and reaches the start descriptor only when it differs from
  the authored one; a seat without it plays the roster tribe. `difficulty` needs a seat that has one (else
  `seatDifficultyUnavailable`) and reaches the start descriptor only while the computer plays it; a
  computer seat without one plays `hard`.
- `moveMember { nick, player }` is the creator's: it seats that member at a claimable seat, swapping it
  with the seat's occupant, who takes the mover's seat or joins the observers; `player: null` makes the
  member an observer. Unknown nicks are refused `notMember`.
- `banMember { nick }` is the creator's: it removes that member as `leaveRoom` would and bars its token
  and its connection's peer address from the room for the room's life, a later creator's included; the
  members still inside, who may share that address, keep their way back. The banned member gets
  `error { banned }` and `left`, and is in the hall again. The creator's own nick is refused `banSelf`,
  an unknown one `notMember`.
- `setSettings { settings }` is the creator's and replaces `{ name, seed, rules, speed, kickedSeatMode? }`
  in full; `world`, `initialSave`, `mapOrigin` and `catalogMap` are immutable and refused. A replacement
  that changes nothing produces no room update. A saved room also fixes its seed, rules, seat colors,
  tribes and levels; claims and creator-selected vacant AI and idle modes stay editable.
- `setCompatibility { compatibility }` supplies the sender's report, or null to invalidate it.
  `setReady { ready }` needs a seat; becoming ready also requires every compatibility check to pass.
- `leaveRoom` frees the seat and identity. The last member out drops the room; a leaving creator passes
  the role to the next member. Once the clock runs, leaving applies at once the seat handover of a passed
  [kick vote](#kick-votes), without countdown or vote; a seated member leaving before the clock runs ends
  the room ([Waiting](#waiting)). Socket loss alone keeps the seat for reconnection. The departing
  connection can create or join another room once it receives `left`.

Readiness is each member's own. It clears only when that member changes its own report, takes another
seat itself or stands up; the creator's settings and seat changes, a `moveMember` and other members
joining or leaving keep it, and Start checks compatibility again. A reconnect in the lobby clears that
member's report and readiness, so the new client must check its files; a reconnect into a started game
is checked by its snapshot tick and digests instead.

A compatibility report is `{ content, map, client, protocol, save? }`: lowercase SHA-256 hex digests of
content and map (`map: null` when the client lacks the map), a non-empty printable client version, the
protocol version it speaks, and the initial-save fingerprint (absent or null in a fresh room). The relay
requires content, map and client to match the creator's report, its own protocol version from every
member, and in a saved room every `save` to equal the room's immutable fingerprint. Missing reports or maps
and mismatches block ready and are checked again at Start, refused naming the member and category;
`compatibilityIssues` exposes them as pure data (`nick`, `kind`, `reason`) for a lobby display. The hashes
are client reports, not server-side validation: the relay reads no content or map files.

### Starting

1. The creator sends `start`, which goes through only when every member passes compatibility, every seated
   player is ready and a saved room's initial save is uploaded ([Saves](#saves)). There is no host role
   after the start.
2. Each member gets `start { session, snapshotTick }` and its `delay { ticks }`: the `GameSession`
   descriptor with its own `localSeat` and every claimed seat as `human`, and null for a fresh world or the
   initial save's tick for a saved one.
3. Until its world has loaded a member may send `loading { progress }` in whole percent, which the room
   view shows; progress from a member whose world has loaded is ignored.
4. Each member reports `loaded { tick, world }`: the tick its built world stands at (0 with no setup tick,
   1 for a decoded map whose placements drain on one) and its generation (0 when built from the
   descriptor). The first report fixes the room's built tick; the relay refuses any other tick, a second
   `loaded` on the same connection, and a command before any world has loaded. A client holding no world
   asks with `loaded { tick: null }` and counts as loaded once served the room's snapshot, before its
   display shows the restored world.
5. The clock starts once every seated player has loaded, one whose connection dropped included, so a game
   never starts without one of its players.
   `clock { tick, speed, paused: false, by: null, governed: null }` names the first tick to run.

The app reports `loaded` only once its display has shown the world's first frame and begun the next, so
first-use graphics work still holds the room and every player's game starts together. A hidden page runs
no animation frames, so there it reports `loaded` once it has drawn one frame, and a tab hidden through
its load neither holds the room nor runs out its loading time.

## The clock and tick frames

Once started, the relay emits one `frame { tick, commands }` per simulation tick on its own clock, at
`TICKS_PER_SECOND` times the running speed, empty frames included. Ticks count on from the built tick and
are never skipped. A client runs tick `t` only once it holds frame `t`; that is the whole synchronisation
rule. After a relay stall one advance emits at most 12 frames and the game runs late; no tick is dropped.
`commands` is the list of `{ envelope, sequence }` that apply on that tick, `sequence` counting from 0 in
the order the relay received them; every client applies them in that order, after the tick's own
untargeted commands, through `Simulation.enqueueAt`.

Any seated player may send `clock { speed?, paused? }`. The relay applies it and broadcasts
`clock { tick, speed, paused, by, governed }` with the sender's nick and the first tick the setting holds
from; a speed request carries `governed` recomputed for the new requested speed. Pauses are unlimited.
`speed` is always the requested speed. While any seated player is slow ([Pacing](#pacing)) the relay
governs the clock at the slowest one's pace: `governed` is `{ nick, speed, cause }` and the running speed
is `governed.speed`; otherwise `governed` is null. `cause` is `load` when that member's reported tick cost
bounds the speed, and `lag` when the catch-up share does: it says it could keep up, yet trails, as over a
poor link. Clients run their driver at `governed?.speed ?? speed`. The relay broadcasts `clock` with
`by: null` whenever the governing member, its speed or its cause changes.

## Commands

A client sends `command { envelope, fromTick }`: a seat envelope from the sim's command contract, and the
tick its own sim had reached when the person issued it. The relay:

- accepts `origin: "player"` only; `setup`, `admin` and `ai` envelopes are refused, since the AI seats run
  inside every client and trusted commands have no wire;
- stamps `player` with the seat the connection holds, whatever the envelope claimed;
- lands the envelope on tick `max(nextTick, fromTick + delay)` with the member's input delay, so a command
  applies a fixed number of ticks after it was issued while the connection stays within its budget; a
  later command from the same member never lands before its last accepted one, even when its delay falls
  or its world is restored to an earlier tick;
- admits per member and tick at most `MAX_COMMANDS_PER_TICK` complete player gestures, each at most
  `MAX_ENVELOPE_BYTES` as JSON, and `MAX_COMMAND_BYTES_PER_TICK` in all, and per member at most
  `MAX_PENDING_COMMANDS_PER_MEMBER` pending gestures and `MAX_PENDING_COMMAND_BYTES`, paused rooms
  included;
- reserves recovery space: retained frames plus pending gestures, with a conservative frame-overhead
  charge, may use `MAX_COMMAND_HISTORY_BYTES` of the `MAX_HISTORY_BYTES` history store, so empty ticks and
  seat handovers keep flowing while a snapshot refresh frees capacity.

Input over a budget is refused whole with `commandBudget`, never postponed to a later tick; admitted
gestures keep their application tick. The relay reads nothing else. Every client validates the payload
with `parseCommandEnvelope` before enqueueing, and an envelope the sim's parser refuses is dropped on
every client alike, so a bad payload cannot split the session. The only trusted command the wire carries
is the relay's own, for a seat a kick vote handed to the AI, and a client refuses a frame with any other:
`{ v, origin: "admin", command: { kind: "setAiControl", player, enabled: true, computerEnabled: true, mapAiEnabled: true } }`.

Group orders:

- An army's movement, attack-move, direct attack, stance or regeneration selection is one opaque command,
  bounded by the sim to `MAX_UNIT_ORDER_MEMBERS` unique members; formation movement carries each member's
  target. Settler selections also carry needs, equipment, jobs, training, lessons, chests and work
  assignments. Shared actions use one payload, differing ones a closed per-member list of at most two
  actions in order; nested actions pass the same ownership checks as single orders. Vehicle movement and
  attack selections are grouped too, boarding groups keeping both the unit's and the vehicle's ownership
  checks; a mixed army emits a settler group and a vehicle group.
- Ground clicks first ask the simulation host for current formation slots, excluding blocked terrain,
  structure bodies and occupied destinations, with members paired within their land component; vehicle
  commanders keep the clicked target so their vehicle can judge its own surface and clearance. While that
  query is pending, a newer order supersedes only its affected actors, Shift keeps the order of
  overlapping gestures, and a commander's pending walk also observes orders to its vehicle. Only the
  completed member destinations enter the relay command.
- Every admitted member receives the order on the same tick; a larger selection is refused locally as one
  gesture with a visible notice. The relay neither splits a selection nor interprets unit ids. Ordinary
  redirects replace the previous standing order when they apply; Shift keeps the sim's waypoint queue.
  Pending commands, saves and replays keep the complete group. Player routes drain on that tick, sharing
  successful corridors and proofs of unreachable regions under the same obstacle view instead of
  deferring soldiers by count.
- The client checks the serialized envelope's UTF-8 size before sending and reports `envelopeTooLarge`
  locally, so an oversized gesture cannot disconnect its sender or partly enter the command stream.

## Input delay

The relay pings each client once a second with `ping { t, roundTripMs }`, answered by `pong { t }`; a ping
unanswered for 5 s is superseded by the next. It keeps a smoothed round trip and jitter (the mean
deviation from the trip) per client; `roundTripMs` is that trip, for display. A sample counts as at most
twice the smoothed trip, or the trip plus one tick when that is more, and the first as at most one second;
trip and jitter then move a quarter of the way toward it, so one late pong moves both a little and a
lasting change carries over within about ten samples. A pong measures a transfer, not the link, and is no
sample, when its ping was outstanding while a message from the client was still arriving (such as its
snapshot upload), or was sent while a fragmented message to the client was unread (a snapshot or map it
downloads) until the client answers the control ping after that message's last fragment.

The assigned delay is `ceil((rtt + jitter) * effectiveSpeed / TICK_MS) + 1` ticks of the smoothed
values, where `effectiveSpeed` is the requested speed or the governed speed while the relay limits the
clock. It starts at `INITIAL_INPUT_DELAY_TICKS` and stays between 1 and `MAX_INPUT_DELAY_TICKS` at any
speed. The first sample sets it directly; after that it rises at most one tick per sample, and drops to
the budget once the budget has stayed below it for three samples in a row. A clock speed change
recalculates it immediately from the existing smoothed link measurements. A change is sent as
`delay { ticks }`. A delay lower than the link needs never splits state: a command whose
stamped tick plus delay has passed lands on the next unemitted tick, applying as soon as it arrives, with
a click-to-apply time that follows the link's jitter. A higher delay only adds latency, which is why the
cap holds even on a slower link.

## Order responsiveness

Any seated player may select `responsiveness { mode }` for the whole room, paused or not: `auto` (the
default), `responsive`, `balanced` or `smooth`; selecting the current mode changes nothing. The relay
broadcasts `responsiveness { mode, bufferTicks, by }`, and sends the current state after `chatHistory`
whenever a member joins or reconnects. `by` is the last explicit selector's nick, or null before anyone
chooses; automatic reserve changes keep it. The in-game Network window shows the mode and its reserve in
milliseconds at the running speed, announces mode changes, and disables changes while disconnected.

Manual modes target one, two and three received tick frames. The client adjusts its playout pace toward
the target, and after a decrease also drains the last extra frame, which the ordinary pacing deadband
would keep. It never drops frames or changes command application ticks to switch modes. This reserve is
distinct from the per-member input delay.

Auto starts at `AUTO_INITIAL_BUFFER_TICKS`. It takes the worst connected, loaded, in-sync seated member's
`min(25 ms, RTT * 0.1) + 2 * jitter` as a reserve in milliseconds, converts it to ticks at the effective
governed speed and clamps it to 1..`MAX_RESPONSIVENESS_BUFFER_TICKS`: stable latency is already covered by
the input delay, and the capped RTT margin only supplements measured variation. An unmeasured active link
keeps at least two ticks; spectators do not count. A higher target must persist for one running second
per tick the reserve rises, a lower one for ten running seconds per tick it falls. Pauses and held rooms
reset both timers, and reconnects invalidate stale link measurements. Since the jitter comes from clamped
samples, one late pong lifts the target little and only for a few seconds.

## Acknowledgements and the sync check

After every tick a client sends `ack { tick, digest, world, load }`. `digest` is the sim's
`SyncDigest.domains` for that tick, one unsigned 32-bit word per domain (`rng`, `entities`, `players`,
`movement`, `settlers`, `economy`, `combat`, `fog`). `world` is the generation the client reports from: 0
for a world built from the descriptor, otherwise the tick of the snapshot it was restored from; an
acknowledgement from another generation is in flight from a world the client has thrown away and is
ignored. Within a generation acknowledgements are consecutive; one out of order or ahead of the clock is
refused. The acknowledged tick is how far the relay believes the client has applied.

`load { tickMs, buffered }` is the client's own pace. `tickMs` is the wall time one tick costs it, the
larger of two exponential moving averages whose newest tick weighs `1 / TICKS_PER_SECOND`: the sim's, on
the thread that runs it (frame admission, the step, and the host's work to hand the tick to its display),
and the display's, sampled once per drawn frame as the frame interval over the most ticks a frame takes in
on average, weighing as the ticks that frame took in. `buffered` is the frames received and not yet
applied. The relay keeps the latest load of an accepted acknowledgement as sent, unsmoothed. The app's
sim worker steps only a couple of frames past the tick its display drew, so a display that cannot keep up
also holds back the acknowledgements, and the relay governs the room for it as for a slow sim.

Once every client in sync has passed a tick, by acknowledging it or by a snapshot moving it past, the
relay compares their digests for it. The majority digest is the reference; on a tie, the client connected
the longest (the earliest current connection, then the earliest to join). A client in the minority gets
`desync { tick, domains, reference }` naming the differing domains and the reference's nick, and is out of
sync from then on: its acknowledgements are ignored and its snapshots refused until it has rebuilt from a
snapshot, and the notice is sent again if it reconnects meanwhile. The reference, if connected, gets one
`disputed { tick, domains, diverged }` naming the nicks newly out of sync at that tick and the union of
their differing domains, so both sides can keep that tick's digest inputs for a diagnostics bundle.

A client keeps the inputs of its last `DISPUTE_WINDOW_TICKS` acknowledged ticks, at most
`DISPUTE_RING_BYTES`, dropping the oldest first; a verdict for a tick it no longer holds records no
inputs. A client acknowledging a tick the room has already settled is judged against that tick's
reference, so a returning client is checked from its first tick back. A disconnected client's reports do
not count; it says where it stands again on its return.

## Waiting

The clock holds, emitting no frames, while any seated player is:

- `gone`: its connection dropped;
- `silent`: the relay has heard nothing from it for `SILENT_AFTER_MS`, whatever its socket says. Any
  message counts, and so does progress on one still arriving, so a pong queued behind a large upload does
  not make its sender silent; on a large message to the client, its answer to the control ping after each
  fragment ([security boundary](#public-relay-security-boundary)) keeps it heard;
- `loading`: it has not said where its world stands, before the start or after a return, and is still
  heard; a loader that went silent is waited for as `silent`;
- `resync`: it is out of sync and its snapshot has not arrived;
- `slow`: it has been slow for `SLOW_WAIT_AFTER_MS` on end and has not caught up since ([Pacing](#pacing)).

A held clock runs for nobody: `clock { paused: false }` changes the pause flag and nothing else, and the
frames resume once nobody is waited for. Every change to the waited set is broadcast as
`waiting { for: [{ nick, reason, voteAfterMs }] }`; an empty `for` ends the wait. `voteAfterMs` is what is
left of `KICK_COUNTDOWN_MS` after the time the room has waited for that member, counting down while it is
waited for. Waited time is kept when the wait ends, up to `KICK_COUNTDOWN_MS` however long the member was
waited for, and forgiven at `WAIT_FORGIVENESS` waited millisecond per millisecond not waited for, so even a
member that was gone for an hour has its whole countdown back after `KICK_COUNTDOWN_MS / WAIT_FORGIVENESS`
(600 s) of play: a member that answered after 30 s of a wait and drops again 100 s later
starts at 40 s, and 300 s later gets the whole countdown again. One that keeps ending its waits just in
time still reaches a vote: silent 2 s of every 6, so held a third of the time, it is votable in its waits
after about 4 minutes. The clock's start clears every member's waited time, so the load everyone was
waited through counts against nobody, and the `waiting` after its `clock` names whom the running room
waits for.

A client that never loads or stops answering pings is waited for and can be voted out, before the start
as after it; a member kicked before the start is not waited for to start the clock. A client whose own
link is lost reckons a countdown for itself from the drop of its socket or, on a socket that stays open,
after `LINK_QUIET_MS` (equal to `SILENT_AFTER_MS`) without a relay message, and in a game on screen the
app shows it on a screen that takes no order until the relay is heard again. It counts the whole
`KICK_COUNTDOWN_MS` from the loss while the relay carries over the waited time the member still owes, so
it is an upper bound: the others may be offered the vote sooner.

Before the clock runs, a player that has not loaded and whose boot has not moved for `LOADING_STALL_MS`
(counted from the start, its last `loading`, its `loaded`, or its drop or return) loses its seat as a
passed kick takes it: `kicked { cause: "loadingTimedOut" }`, the seat follows `settings.kickedSeatMode`,
and the clock starts once the others have loaded. A hidden or frozen tab is an absent player: it never
holds the others past the stall, nor ends their room. The handover waits for the first `loaded`, which
fixes the tick it lands on; until then every other player is still booting too. Only when no player is
left whose boot moves does the room end: every connected member gets `error { loadingTimedOut, nick }` and
`left`, and the players host again. Observers count neither way. The app shows no countdown for the stall
and offers no vote on its loading screen. A seated member that leaves before the clock runs ends the room
at once, with `error { leftBeforeStart, nick }` and `left` to the others.

Observers cannot issue commands, change the shared clock or responsiveness, or vote to kick. Their
loading, disconnection and rendering speed never hold or pace the game. Their digests are compared against
the players' without counting toward the majority; when only observers remain, their reports decide the
reference and the final result.

## Pacing

A member is judged by its backlog: how far its acknowledged tick trails the clock beyond the frames a
healthy client on its link still holds, which are one smoothed round trip of frames at the speed the clock
emits them, rounded up, plus the room's [response reserve](#order-responsiveness). A member on a 450 ms
link with a reserve of 2 trails by 7 or 8 ticks at speed 1 with a backlog of none. Its own `load.buffered`
is not taken off: a client that cannot keep up holds its backlog there. A member the relay follows
(connected, heard, loaded and in sync) is:

| Verdict | When |
| --- | --- |
| lagging | Backlog over `LAG_BEHIND_MS` of frames at the requested speed (12 ticks at speed 1). It catches up alone; the room notices nothing. |
| slow | Lagging for `SLOW_GRACE_MS` of wall time on end, or a backlog over `SLOW_AT_ONCE_MS` of frames at once; until its backlog is no more than `GOVERN_RELEASE_MS` of frames. |
| waited for as `slow` | Slow for `SLOW_WAIT_AFTER_MS` of wall time on end; released, no longer votable, once its backlog is no more than `GOVERN_RELEASE_MS` of frames. |

A member the clock holds for is not judged for lag while held, since the held clock adds none, and neither
is a snapshot donor while its upload arrives ([Resync and catching up](#resync-and-catching-up)). Either keeps its
verdict, and wall time under a hold for it counts toward neither `SLOW_GRACE_MS` nor `SLOW_WAIT_AFTER_MS`.
The pause is per member: a hold for another member stops the clock, so a lagging member closes its gap,
but its own grace keeps running. A slow member that goes silent is slow again on its return; one that had
lagged 1 s has 3 s of grace left on its return, however long it was away. Only leaving the room, or a
world rebuilt from a snapshot after a resync or a return without one, clears the verdict and the lag.

While any seated player is slow the relay governs the clock, whatever the requested speed. Each slow
member's bound is the lower of its sustainable speed with headroom,
`TICK_MS / load.tickMs * GOVERNOR_HEADROOM` (`GOVERNOR_HEADROOM` times the requested speed before its
first load report), and the catch-up share, `CATCH_UP_SHARE` times the requested speed; `cause` names the
lower one, `lag` on a tie.
The bound is rounded to `GOVERNED_SPEED_STEP`, never above the requested speed and never below
`MIN_GOVERNED_SPEED` unless the requested speed is; a member slower than that falls further behind at it.
The lowest bound wins, a tie going to the member furthest behind. The governed speed drops at once but
rises only by `GOVERNED_RISE_STEPS` steps or more at a time, and while the same member stays governed at
the same speed its `cause` stays as announced, so a load report jittering across a rounding boundary or
the bounds' crossing does not broadcast a `clock` per advance. Once nobody is slow the clock runs at the
requested speed again, unless a previously slow member's reported load still cannot sustain that speed
with headroom. Such a member keeps only the capacity limit after catching up, without the catch-up share;
it no longer counts toward a slow wait while its backlog is small. A sufficient load improvement releases
the limit. This prevents the room repeatedly returning to full speed and falling behind on the same
unchanged slow machine.

The `slow` wait exists because a seat that cannot keep up even at the floor would otherwise hold the room
there indefinitely. The clock holds for it as for any waited member, so it catches up while the others
wait, and its countdown and vote run as for every other reason. A chronically slow seat alternates between
governed play and holds, and the waited time it keeps between them makes each later hold votable sooner:
the others decide whether to wait for it or vote it out.

## Kick votes

Once a member's countdown has passed, any other member sends `kick { player, yes: true }` for its seat; a
repeat counts once. `kick { player, yes: false }` withdraws the sender's yes, refused with
`noVoteToWithdraw` when it has none. Each yes and withdrawal is broadcast as
`kickVote { player, nick, yes: [nicks], needed }`. A yes is cast only while its target is waited for; one
against a member that is slow but not yet waited for as `slow` is refused with `notWaitedFor`. The yeses
outlive their wait while the target still owes waited time ([Waiting](#waiting)) and are dropped once it
owes none, so yeses against a member that drops in short waits add up: two voters of three may each say
yes in a different wait. Between its target's waits a vote is hidden, as clients drop its tally with the
wait; the relay broadcasts the tally again when the target is waited for again, and its countdown must
run out again before it takes a yes or passes.

The electorate is the connected members other than the target, and `needed` is a strict majority of it,
`floor(others / 2) + 1` (`kickVotesNeeded`): both of two, 2 of 3, 3 of 4. A yes counts only while its
voter is connected, again if the voter returns while the vote is open, and never once it left the room.
Each drop, return or departure recounts every open vote and broadcasts each tally that moved, so a vote
can pass on a vote, a voter's return, or another member dropping or leaving. A vote passes only while the
relay would still wait for its target with its countdown run out: a yes against a target that answered or
loaded since the last poll is refused with `notWaitedFor`, a recount passes no vote against it, and its
vote is hidden from the next poll. A member whose `loaded` is accepted, on its return or after a reload,
gets one `kickVote` per open vote right after its `waiting`, since it missed the broadcasts that built it.

Several members may be waited for at once, each with its own countdown and vote, and each electorate
excludes every dropped member: with four players and two dropped, each vote needs both of the two still
connected, and the last connected member kicks each of the others alone. The clock stays held until every
waited member is back or kicked. Kicking one leaves the others' countdowns and votes as they were; a
member no longer waited for after its return hides only the vote against itself. With every member
dropped nobody can vote: the room ends at the history age limit ([Resync](#resync-and-catching-up)), or
after the `EMPTY_ROOM_TTL_MS` a room with nobody connected is kept when no frame is retained, whichever
comes first.

When the yeses reach `needed`:

1. The relay broadcasts `kicked { player, nick, mode, cause, tick }` and removes the member. A member whose
   link was down when its seat was taken, by a vote or a loading stall, gets that `kicked` and `left` once,
   after `welcome`, when its token next says `hello` while the room lasts; afterwards, and once the room
   ended, its token is a stranger.
2. The seat goes to `settings.kickedSeatMode` (`computer` or `idle`), which the room view reflects. `idle`
   always applies; `computer` applies when the seat offers it, otherwise a lobby AI seat stays AI and every
   other vacant mode falls back to `idle`, whose settlers already stand.
3. For `computer` the relay lands its `setAiControl` envelope on `tick`, the next unemitted one, outside
   every budget, so the AI takes the seat on the same tick on every client. An `idle` seat simply issues
   nothing more.
4. A vote passed before any world has loaded holds its handover notice and AI command until the first
   `loaded` fixes the built tick, and then names the first resumed tick.

`cause` is `vote`, `loadingTimedOut` for a boot that stalled before the clock ran, or `left` for a member
that left the started game itself.

## Manual save order capture

`saveOrders { id, tick, world }` completes a locally captured tick-boundary save with every room command
the relay has accepted but that saved world has not applied. The requester must be connected, loaded and
in sync on its current world generation, and `tick` must lie between the initial world and both its
acknowledged tick and the relay clock. Missing retained history is a refusal, never an incomplete success.
No pause, clock advance or queue drain occurs. The reply is `saveOrders { id, tick, frames }`: the
nonempty frames strictly after `tick`, in ascending tick order, from the retained emitted frames and the
accepted pending ones, with sequence numbers contiguous within a frame; empty `frames` is a complete
capture. A command accepted after the request belongs to a later capture. The client stores the frames as
the save's continuation, with their apply ticks and within-tick order, against the world it captured
before asking. A reply over `MAX_SAVE_ORDERS_BYTES` of serialized UTF-8 JSON is refused whole. A refusal
is `rejected { of: "saveOrders", requestId, reason }` whenever the request named a valid id, parser
refusals included.

## Blobs

`blob { type, to, tick, bytes }` carries opaque bytes, at most `MAX_BLOB_BYTES` decoded, as base64; `to`
names one member's nick, or null for everyone else in the room. The relay delivers it as
`blob { type, from, tick, bytes }` with the sender's nick.

| `type` | Sender | `tick` | Delivery |
| --- | --- | --- | --- |
| `map` | The current creator, in the lobby | null | As addressed; the relay keeps the latest for the room's life. |
| `initialSave` | The creator, in the lobby, `to: null` | The declared tick | Cached and broadcast to every member, the uploader included. |
| `snapshot` | A client in sync, with `world` | 1 up to the clock's | Not relayed: refreshes the cache and reaches whoever waits to be brought back; `to` is ignored. |
| `save` | A client in sync | 1 up to the clock's | As addressed; never refreshes the cache, since its continuation already includes accepted future orders that replay frames would apply twice. |

A `snapshot`'s `world` is the donor's world generation at capture, as on an acknowledgement. An upload from
another generation is stale and ignored, even if its tick is newer than the corrected cache; compression
and delivery may have started before the donor's resync.

### Maps

A `map` needs an explicit immutable `mapOrigin: "mod" | "user" | "catalog"`. A `catalog` origin comes with
`catalogMap: { entryId, mapId, fingerprint, irVersion }`: the room's map, its catalogue entry, its
terrain-and-script fingerprint and the content version it was converted for; neither field is allowed
without the other. A member without the map fetches that conversion from the catalogue's server when its
own content version matches, verifies the fingerprint, and asks the creator through the relay only when
the server cannot deliver it. The origin is advisory: clients must validate source provenance, sender
identity, payload schema and the expected map fingerprint.

A `map` the creator addresses to itself is a deposit: the relay keeps it and forwards it to nobody. The
creator deposits a `user` or `mod` origin map once the lobby settles on it, so a member returning to the
started game without the map is served even when every guest already had it; a catalogue map and a map the
page's own maps index lists are never deposited. The relay keeps the latest map text the creator delivered
or deposited for the room's life, replaced by its next delivery or deposit. In the lobby the text counts
only while it is the creator's current copy: the current creator sent it, and the map fingerprint that
creator reports is the one it reported when sending. Start keeps such a text and drops any other, so a
text another creator sent, or one the creator's report has moved past, is not served after Start.
`requestMap` answers with the kept text as the same `blob { type: "map", from }` the creator sent: in the
lobby while it is the creator's current copy, and after Start to any member, such as one that returns
without the map. Otherwise, in the lobby, it sends the connected creator `mapRequest { from }` so a member
can retry delivery; after Start it is refused with `mapNotKept`. Map replacement after Start is refused.
The relay answers one member's map request, and separately its initial-save request, at most once per
`TRANSFER_REQUEST_COOLDOWN_MS`, to bound small-request/large-response amplification; a client retries a
map request refused with `retryTooSoon` once after it.

A map's bytes are the clients' contract: gzip of the JSON envelope `{ version: 2, mapId, map, script }`,
so `MAX_BLOB_BYTES` bounds the compressed map. A receiver refuses anything but a gzip stream and stops
inflating past `MAX_MAP_DOCUMENT_BYTES` plus the envelope's keys. A client keeps the custom maps it
verified in browser storage, up to `MAX_CACHED_MAPS` maps and `MAX_CACHED_MAP_BYTES` of encoded transfer
text (a delivered map is stored as the text it arrived in), and validates a copy again against its
fingerprint and permitted origin before playing it; base and unknown origins are never served from that
store. A catalogue map fetched from the catalogue's server joins the player's installed catalogue maps.

### Saves

The `initialSave` declaration is `initialSave: { fingerprint, tick }` with `tick` at least 1, copied into
every session descriptor; its fingerprint is SHA-256 of the exact base64 snapshot text. The relay hashes
the opaque text, refuses a mismatch and caches one bounded blob, which `requestInitialSave` returns, also
after the creator leaves. Ready and Start require the upload as well as matching reports; a client
verifies the hash, the decoded save, its tick and its map, and restores it against its own content before
it reports `save` in its compatibility report. A saved start names `snapshotTick: initialSave.tick`; the
relay seeds its clock and snapshot cache there, and every world reported for it must carry that
generation. The lobby releases its cache at Start, and the room's snapshot retention takes over.

Saved rules and diplomacy stay as saved; each client queues the roster's seat control once on the first
resumed tick. Local post-result command grants and pending `continueMatch` commands are removed before
inherited orders run, so importing a single-player save never restores a defeated multiplayer seat's
authority. A room created from a save offers the saved human seats as vacant and each player claims one
explicitly, with the saved seats' colors, tribes and levels; its seats supersede a seat handover the
previous room had scheduled but not applied, and player orders keep their saved ticks and order.

The encoding of a snapshot or a save is the clients' contract: gzip of the sim's canonical save JSON
(`serializeSaveGame(exportSaveGame(sim))`), taken at a tick boundary and restored with `restoreSimulation`
onto the world the descriptor names. A manual save contains locally queued commands and the accepted relay
continuation obtained by `saveOrders`; an automatic snapshot contains only the simulation queue, and
retained relay frames reconstruct accepted orders after its tick. A multiplayer save, manual or
automatic, is written only on the saving player's machine; nothing is sent to the room. The protocol keeps
the `save` blob type and the relay still forwards one, but no client sends or reads it. What a save records of its session (the descriptor
and the public roster, never a token) is the save format's contract in [`DATA-FORMAT.md`](DATA-FORMAT.md).

## Resync and catching up

The relay keeps the room's newest snapshot and every frame since it, or before the first snapshot every
frame from the first one, within `MAX_HISTORY_BYTES` of UTF-8 frame JSON and `MAX_HISTORY_AGE_MS` of wall
time since the oldest retained frame. When the age limit is reached or the next frame would exceed the
byte limit, the relay ends the room: connected members get `error` with `historyBytes` or `historyAge`,
then `left`; every member, disconnected ones included, loses its room association; the snapshot and
history are released. Connections stay usable and other rooms go on. The relay never silently discards a
frame needed to replay from its advertised snapshot.

Snapshot refresh:

- The relay asks for one every `SNAPSHOT_REFRESH_MS`, or once history reaches half its byte or age budget:
  `snapshotRequest` goes to the eligible client in sync and not silent with the lowest round trip, which
  answers with a `snapshot` blob at its current tick. While any seated player remains only seated players
  donate, observer uploads are refused and observers are not retried; with none, observers keep the cache.
- An unanswered request is repeated every `SNAPSHOT_RETRY_MS` to the next eligible donor, at once when the
  asked donor drops or diverges; one request is outstanding however many members wait. A donor that goes
  silent keeps the request until the retry: its export runs on the thread that answers pings. One whose
  upload is still arriving keeps it past the retry, up to `SNAPSHOT_UPLOAD_MAX_MS` from the request, and
  meanwhile is not judged for lag ([Pacing](#pacing)): its acknowledgements wait behind the upload.
- A snapshot prunes the frames it covers. With no retained frames, a same-tick upload also satisfies a
  paused refresh. An older upload leaves the cache unchanged.
- When the cached snapshot's donor is found out of sync, the cache is held back, since a drop forgets held
  digests and that tick may never have been judged. Reconnects then wait for a replacement while a client
  in sync can send one; with none left, returning clients take the held copy and diverged ones keep
  waiting for the next donor. The held copy's tick still marks the start of retained history. A same-tick
  upload can replace it; otherwise the first copy of a tick stays cached, so a delayed same-tick duplicate
  cannot undo a correction.

A client told `desync` drops its world and waits. When the fresh snapshot arrives the relay sends it
`blob { type: "snapshot" }` and every frame after its tick; the client restores, replays them and
acknowledges from the snapshot's tick on, catching up as any lagging member does. A diverged member is
served only a snapshot later than its discarded world generation, so a repeated resync cannot make that
world's in-flight acknowledgements or uploads current again. A diverged client that drops leaves the
queue; on its return it asks with `loaded { tick: null }` and takes the cache, or the next snapshot when
none is cached or the cache is held back. Nothing is sent to it before it asks.

A returning token gets `room`, `chatHistory`, its pending `desync` notice if any,
`start { session, snapshotTick }`, `clock` while the game runs, and `ended` once it has ended.
`snapshotTick` is the cached snapshot's tick, or null while the relay still holds every frame from the
first. The client answers `loaded`, and must answer `{ tick: null }` when its world is out of sync:

- `{ tick, world }`, the tick its world still stands at and that world's generation: the relay sends the
  frames after it, or the cached snapshot and the frames after that when the frames before the cache are
  gone;
- `{ tick: null }`, holding no world while a snapshot is cached: the relay sends the snapshot and the
  frames after it. A cache more than `RETURN_SNAPSHOT_MAX_TICKS` behind the clock would cost the client
  that long a replay and the room a governed clock meanwhile, so the relay asks a donor for a fresh
  snapshot through the one outstanding request, and the clock holds for the client as `loading` until it
  arrives; with no eligible donor, or none answering within `SNAPSHOT_RETRY_MS`, the client takes the
  cache;
- `{ tick, world: 0 }`, a world freshly built from the descriptor, when `snapshotTick` was null.

A snapshot blob always replaces the client's world, and the frames that follow are applied through the
same transport. An accepted `loaded` is answered with `ended` once the match has ended, else with
`waiting` for the current waited set and one `kickVote` per open vote. A token whose seat was taken while
its link was down gets its `kicked` and `left` after `welcome` ([Kick votes](#kick-votes)); one whose room
ended meanwhile gets `welcome` alone. So the client answers every `welcome` while it holds a started room
with `joinRoom` for that room and reads the refusal: a member put back is refused `alreadyInRoom` and
stays; `gameStarted` means the room goes on without it and `noRoom` that it ended, and on either the
client ends its game with a notice and leaves the room as the relay's `left` would have.

## Chat

`chat { text }` is broadcast to the room as `chat { from, flag?, text, at, tick }`: `at` is the relay's wall clock
when it received the line, in Unix epoch milliseconds, and `tick` the clock's next tick then, null before
the clock has started. The text is one printable line of at most `MAX_CHAT_LENGTH` characters; Unicode
line and paragraph separators are refused along with control characters. The relay keeps each room's
newest `MAX_CHAT_HISTORY_LINES` lines, the lobby's included, and the log ends with the room. A member gets
`chatHistory { lines: [{ from, flag?, text, at, tick }] }`, oldest first, right after the room view each time it
enters the room: on creating it, on joining it, and on every return of its token, before `start` and
`clock`.

## The hall

A client outside a room is in the hall: the room list, who is on the relay, and the relay's own chat.
Each time a client arrives there (after `welcome` unless its token was put back into a room, and after
leaving a room) it gets, within `HALL_ARRIVAL_MS`, what changed since it last heard the hall on this
connection: `rooms` and `presence` when they differ (`rooms` also whenever a game is running, for its clock), and `hallChatHistory`, whole the first time
(`replaces: true`) and later with only the lines said since (`replaces: false`, sent when there are any),
whole again when some it missed are no longer kept.
Then, at most once per `HALL_REFRESH_MS`, it gets `rooms` and `presence` again when either changed. A running clock's advance alone is no
change; the client counts `playedMs` on from when the list arrived. A member of a room gets none of these.

`presence { online: [{ nick, flag?, room }], recent: [{ nick, at }] }` names each introduced connection by its
last `welcome` nick, once per nick, with the id of the room it is in or null; `recent` lists the nicks seen within
`SEEN_KEPT_MS` that are not online, newest first, `at` being when the relay last saw them, in Unix epoch
milliseconds. Only an identity online for `SEEN_AFTER_MS`, across connections that replaced one another, is remembered. Each list carries at most `MAX_PRESENCE_ENTRIES`.

`hallChat { text }` from a client in the hall is broadcast to the hall as `hallChat { from, flag?, text, at }`,
`from` being the sender's last `welcome` nick; the text follows the room chat's rules. A connection may say
`HALL_CHAT_BURST` lines at once and one more every `HALL_CHAT_REFILL_MS`, an allowance its peer address
shares with its other connections (the proxy's `X-Forwarded-For`, else the socket's peer); past that it is
refused with `retryTooSoon`. The relay keeps the newest `MAX_HALL_CHAT_LINES` lines of the last `HALL_CHAT_KEPT_MS`, and
`hallChatHistory { lines: [{ from, flag?, text, at }], replaces }` replays them oldest first. With `RELAY_HALL_FILE` set the
chat, without its flags, and the seen times survive a restart ([Relay image](BUILDING.md#relay-image)).

## Refusal codes

By message, what the relay answers with `rejected` (the connection stays) or `error` (the connection
closes or the room ends). `RelayReason` holds each code's values.

| Message | Codes |
| --- | --- |
| first message | `helloFirst` (not a `hello`), `helloOverdue`, `protocolUnsupported`; `replaced` to the older connection |
| any | Closing: `messageTooLarge`, `malformed` (unknown kind or before `hello`), `trafficLimit`, `relayFault`, `serverRestart`. Refused: `malformed`, `alreadyIntroduced` (a second `hello`), `notInRoom` (a room message outside a room) |
| `createRoom`, `joinRoom` | `alreadyInRoom`; `relayFull` to create; `noRoom`, `gameStarted`, `banned`, `retryTooSoon`, `wrongPassword` to join, in that order |
| `hallChat` | `alreadyInRoom`, `retryTooSoon` |
| `leaveRoom` | `notInRoom` |
| `claimSeat` | `noSeat`, `seatNotClaimable`, `seatTaken`; `gameStarted` for a seat after the start |
| `setSeat` | `gameStarted`, `creatorOnly`, `savedSeatsFixed`, `noSeat`, `seatTribeUnavailable`, `seatDifficultyUnavailable`, `seatTaken` (a mode for a taken seat), `seatModeUnavailable` |
| `moveMember` | `gameStarted`, `creatorOnly`, `notMember`, `noSeat`, `seatNotClaimable` |
| `banMember` | `gameStarted`, `creatorOnly`, `notMember`, `banSelf` |
| `setSettings` | `gameStarted`, `creatorOnly`, `savedRulesFixed`; an immutable field is `malformed` |
| `setCompatibility`, `loading`, `responsiveness` | `gameStarted`; `gameNotStarted`; `seatRequired` |
| `setReady` | `gameStarted`, `initialSaveMissing`, `seatRequired`, `noCreator`, `incompatible` |
| `start` | `gameStarted`, `creatorOnly`, `initialSaveMissing`, `noCreator`, `incompatible`, `memberNotReady` |
| `requestMap` | `mapDeliveryOff`, `mapNotKept`, `mapProviderAway`, `creatorHasMap`, `retryTooSoon` |
| `requestInitialSave` | `gameStarted`, `notFromSave`, `initialSaveMissing`, `retryTooSoon` |
| `blob` in the lobby | `gameNotStarted` (a snapshot or save), `creatorOnly`, `mapDeliveryOff`, `mapUploadHasTick`, `notFromSave`, `initialSaveForEveryone`, `initialSaveTickMismatch`, `initialSaveFingerprintMismatch`, `noRecipient` |
| `blob` after the start | `lobbyFilesFixed` (a map or initial save), `snapshotUnsynced`, `tickNotEmitted`, `seatRequired` (an observer's snapshot while players remain), `noRecipient` |
| `loaded` | `gameNotStarted`, `alreadyLoaded`, `worldOutOfSync`, `noSnapshot`, `initialSaveGeneration`, `worldTickMismatch`, `worldBeforeStart`, `tickNotEmitted`; past the recovery burst it closes with `trafficLimit` |
| `ack` | `gameNotStarted`, `notLoaded`, `ackOutOfOrder`, `tickNotEmitted` |
| `command` | `envelopeTooLarge`, `gameNotStarted`, `matchEnded`, `noWorldYet`, `seatRequired`, `commandBudget`; a non-player origin is `malformed` |
| `clock` | `gameNotStarted`, `seatRequired`, `matchEnded` |
| `kick` | `gameNotStarted`, `matchEnded`, `seatRequired`, `seatEmpty`, `voteSelf`, `notWaitedFor`, `voteNotOpen`, `noVoteToWithdraw` |
| `saveOrders` | `gameNotStarted`, `saveUnsynced`, `saveOtherWorld`, `saveBeforeStart`, `saveUnacknowledged`, `saveExpired`, `saveTooLarge`, `retryTooSoon` |
| `finish` | `gameNotStarted`, `notLoaded`, `resultTickUnacknowledged`, `matchEnded`, `resultAlreadyReported` |
| room ended (`error`, `left`) | `historyBytes`, `historyAge`, `loadingTimedOut`, `leftBeforeStart`, `resultDisagreement`, `relayFault` |
| banned from the lobby (`error`, `left`) | `banned` |
| local `rejected { of: "command" }` | `commandBudget`, `envelopeTooLarge`, `notLoaded` ([The client](#the-client)) |

## Limits

Each value verified against its constant; the owning package is in brackets.

| Constant | Value | Bounds |
| --- | --- | --- |
| `TICKS_PER_SECOND`, `TICK_MS` [protocol] | 12, 1000/12 ms | Frames per second at speed 1, the sim's rate. |
| `MAX_SPEED` [protocol] | 8 | Requested speed. |
| `MAX_SEATS` [protocol] | 16 | Seat indices, the sim's `MAX_PLAYERS`; observers have no slot limit. |
| `DEFAULT_MAX_ROOMS` [server] | 64 | Rooms per relay when `RELAY_MAX_ROOMS` is unset. |
| `MAX_COMMANDS_PER_TICK` [protocol] | 20 | Gestures one member lands on one tick; a client's gestures in flight. |
| `MAX_ENVELOPE_BYTES`, `MAX_COMMAND_BYTES_PER_TICK` [protocol] | 512 KiB, 1 MiB | One envelope as JSON; envelopes one member lands on one tick. |
| `MAX_CLIENT_MESSAGE_BYTES` [protocol] | 513 KiB | A client message other than a blob: one envelope plus 1 KiB. |
| `MAX_BLOB_BYTES`, `MAX_BLOB_MESSAGE_BYTES` [protocol] | 32 MiB, about 42.7 MiB | A decoded blob, also the kept map text (one delivery or deposit per room); its message, base64 plus 1 KiB. |
| `MAX_SAVE_ORDERS_BYTES` [protocol] | 16 MiB | A `saveOrders` reply as UTF-8 JSON. |
| `TRANSFER_REQUEST_COOLDOWN_MS` [protocol] | 2 s | Time between one member's answered `requestMap`, and between its answered `requestInitialSave`. |
| `MAX_PENDING_COMMANDS_PER_MEMBER`, `MAX_PENDING_COMMAND_BYTES` [server] | 128, 2 MiB | Accepted future gestures per member, paused rooms included. |
| `MAX_COMMAND_HISTORY_BYTES` [server] | 12 MiB | Retained frames plus pending input at admission, with overhead. |
| `MAX_HISTORY_BYTES`, `MAX_HISTORY_AGE_MS` [server] | 16 MiB, 10 min | Retained replay history; a refresh is asked at half of either. |
| `EMPTY_ROOM_TTL_MS` [server] | 10 min | A started room with nobody connected and no retained frame. |
| `MAX_UNIT_ORDER_MEMBERS` [sim] | 4096 | Unique members in one army gesture. |
| `HELLO_TIMEOUT_MS`, `SILENT_SOCKET_MS` [server] | 10 s, 30 s | Connection without `hello`; socket with no incoming transport data. |
| `SILENT_AFTER_MS` [server] | 4 s | Nothing heard before a member is `silent`. |
| `LOAD_VIEW_INTERVAL_MS`, `LOADING_STALL_MS` [server] | 1 s, 2 min | Views for moved figures alone; unmoved boot before the clock runs. |
| `KICK_COUNTDOWN_MS`, `WAIT_FORGIVENESS` [server] | 60 s, 0.1 | Waited time before a vote opens, and the most a member owes; waited ms forgiven per ms not waited for. |
| `INITIAL_INPUT_DELAY_TICKS`, `MAX_INPUT_DELAY_TICKS` [server] | 2, 12 | Input delay at the start, and its cap in ticks at any speed. |
| `AUTO_INITIAL_BUFFER_TICKS`, `MAX_RESPONSIVENESS_BUFFER_TICKS` [protocol] | 2, 6 | Auto reserve before measurement, and its cap; manual reserves are 1, 2, 3. |
| `LAG_BEHIND_MS`, `SLOW_GRACE_MS`, `SLOW_AT_ONCE_MS` [server] | 1 s, 4 s, 5 s | Backlog that lags; lag before slow; backlog slow at once (the sum of the two). |
| `SLOW_WAIT_AFTER_MS`, `GOVERN_RELEASE_MS` [server] | 30 s, 0.5 s | Slow time before it is waited for; backlog that releases. |
| `GOVERNOR_HEADROOM`, `CATCH_UP_SHARE`, `MIN_GOVERNED_SPEED` [server] | 0.8, 0.8, 0.25 | Governed speed bounds. |
| `GOVERNED_SPEED_STEP`, `GOVERNED_RISE_STEPS` [server] | 0.05, 2 | Governed speed rounding and rise. |
| `MAX_REPORTED_TICK_MS`, `MAX_REPORTED_BUFFERED`, `MAX_LOADING_PROGRESS` [protocol] | 60 s, 345600, 100 | `load` values (an hour of ticks at `MAX_SPEED`) and `loading` percent. |
| `SNAPSHOT_REFRESH_MS`, `SNAPSHOT_RETRY_MS`, `SNAPSHOT_UPLOAD_MAX_MS` [server] | 5 min, 10 s, 60 s | Snapshot refresh cadence, retry, and the longest an arriving upload keeps the request. |
| `RETURN_SNAPSHOT_MAX_TICKS` [server] | 120 | Cache age a returning client replays (10 s at speed 1). |
| `DISPUTE_WINDOW_TICKS`, `DISPUTE_RING_BYTES` [client] | 960, 24 MiB | Digest inputs a client keeps for a dispute. |
| `MAX_QUEUED_COMMANDS` [client] | 100 | Local command outbox. |
| `LINK_QUIET_MS`, `LINK_REPLACE_MS`, `TRANSFER_REPLACE_MS` [client] | 4 s, 8 s, 5 min | Quiet link; socket replacement; replacement while awaiting a transfer. |
| `MAX_CACHED_MAPS`, `MAX_CACHED_MAP_BYTES`, `MAX_MAP_DOCUMENT_BYTES` [app] | 4, 64 MiB, 64 MiB | Verified custom maps in browser storage; an inflated map envelope. |
| `MAX_HELD_TICKS` [app] | 10 min at `MAX_SPEED` | Ticks the worker holds for a stopped display. |
| `MESSAGES_PER_SECOND`, `MESSAGE_BURST`, `BYTES_PER_SECOND`, `BYTE_BURST` [server] | 256, 512, 1 MiB, two blob messages | Traffic per connection. |
| `RECOVERY_BURST` [server] | 4, one more every 2 s | `loaded`, `saveOrders`, `requestInitialSave`, `requestMap` per connection. |
| `TEXT_FRAGMENT_BYTES`, `MAX_OUTSTANDING_CONTROL_PINGS` [server] | 32 KiB, 5462 | Outgoing fragments; ping credits. |
| `MAX_TRIBE_ID`, `MAX_SEED` [protocol] | 255, 2^32 - 1 | Seat tribe id; room seed. |
| `MIN_TOKEN_LENGTH`, `MAX_TOKEN_LENGTH` [protocol] | 16, 128 | Token, URL-safe characters. |
| `MAX_NICK_LENGTH`, `MAX_ROOM_NAME_LENGTH`, `MAX_CHAT_LENGTH`, `MAX_CHAT_HISTORY_LINES` [protocol] | 24, 48, 500, 500 | Characters; chat lines kept per room. |
| `MAX_HALL_CHAT_LINES`, `HALL_CHAT_KEPT_MS` [protocol, server] | 200, 14 days | Server chat lines kept and replayed. |
| `HALL_CHAT_BURST`, `HALL_CHAT_REFILL_MS` [server] | 5, 2 s | Server chat lines per peer address. |
| `MAX_ROOM_PASSWORD_LENGTH` [protocol] | 32 | Characters of a room password. |
| `JOIN_PASSWORD_BURST`, `JOIN_PASSWORD_REFILL_MS` [server] | 5, 5 s | Wrong or missing room passwords per peer address. |
| `MAX_PRESENCE_ENTRIES`, `SEEN_KEPT_MS`, `SEEN_AFTER_MS` [protocol, server, server] | 500, 7 days, 15 s | Entries of each `presence` list; how long a nick stays recent; how long a connection stays to be remembered. |
| `HALL_REFRESH_MS`, `HALL_ARRIVAL_MS` [server] | 1 s, 100 ms | The hall's update cadence; how often arrivals in the hall are served. |
| `MAX_ROOM_ID_LENGTH`, `MAX_WORLD_ID_LENGTH`, `MAX_COMMAND_KIND_LENGTH`, `MAX_REASON_LENGTH` [protocol] | 32, 128, 64, 200 | Characters; the last bounds `malformed`'s `detail`. |
| `MAX_CLIENT_VERSION_LENGTH`, `MAX_RELAY_BUILD_LENGTH` [protocol] | 128, 128 | Printable characters of a report's `client` and of `welcome`'s `build`. |

## The client

`packages/net-client` is the client half every host shares. `RelayClient` walks the lobby, opens the world
`start` names through a port the host supplies, runs it over `RelayTransport`, acknowledges every tick,
answers pings and snapshot requests, and asks a diverged world's host to restore. It runs the sim behind
the relay's clock by the room's [response reserve](#order-responsiveness), scaling the time it feeds the
driver without skipping ticks, so a late frame lands inside the buffer. Small buffer errors adjust
the pace by ten percent per tick, with a one-frame deadband above the target; refilling bottoms out at
75% of the running speed. Beyond three excess frames the catch-up acceleration grows faster, so a
snapshot replay can still drain promptly. These are client pacing choices, not simulation rules.
Catch-up is capped at 192 ticks/s
at the effective governed speed, leaving room for commands and pongs within `MESSAGES_PER_SECOND`; every
applied tick still sends its digest. A wait for a frame keeps at most one tick of owed time, so after a
hold the pacer refills the buffer and a burst of late frames runs one tick per display frame rather than
five. A `snapshotRequest` is skipped while the world stands behind the newest snapshot tick the client has
seen the relay cache. The client keeps the room's chat as the relay logs it: `chatHistory` replaces it on
every entry and return, and each `chat` appends to it, up to `MAX_CHAT_HISTORY_LINES`; the hall's chat
likewise, from `hallChatHistory` (replacing or appending, as it says) and `hallChat`, up to
`MAX_HALL_CHAT_LINES`.

The command outbox sends a gesture only while fewer than `MAX_COMMANDS_PER_TICK` of the client's own are
in flight (sent and not yet applied or refused) and their JSON bytes with its own stay within
`MAX_COMMAND_BYTES_PER_TICK`. The rest wait in order, up to `MAX_QUEUED_COMMANDS`, and leave as earlier
ones apply, so a long wall line, orders given while paused or a few large army orders land over
successive ticks instead of being refused with `commandBudget`. A gesture past a full outbox, an oversized
one and one issued with no world are refused locally with `rejected { of: "command" }` (`commandBudget`,
`envelopeTooLarge`, `notLoaded`). One issued while disconnected waits until the room admits the world
again, also when the return is served a snapshot or a desync rebuilds the world, since the restored world
is the same game further on. Leaving the room drops the outbox.

When a socket is replaced or another world adopted, the commands in flight stay counted but unmeasured for
click-to-apply: the relay keeps what the old socket delivered and lands it first, while some may be lost
or inside a restored world. The outbox sends nothing new until they are settled: each of this seat's
commands applied, dropped or refused meanwhile is one of them, and the rest are forgotten once the world
has run past the last tick the relay could land them on, which is the tick the next `clock` (on a new
socket) or the newest frame (on a restored world) names, plus the input delay. An old command that lands
later still, under a delay raised on the lost socket, takes a newer command's stamp.

`RelaySocket` keeps the connection:

- It reopens on the same token after a drop; a connection the relay replaced or refused stays closed. An
  attempt that has not opened within 10 s is closed and retried even if no close event comes.
- An open socket that carried nothing from the relay for `LINK_QUIET_MS` is reported quiet, and the player
  sees the lost-link screen. A quiet poll that runs more than two poll intervals after the one before
  found its thread blocked (by a world build or restore, for instance) with messages possibly queued, so
  it counts the silence from that moment instead of judging the link. Only the first delayed poll since
  the last relay message gets this grace; repeated delayed polls without a message still replace a dead
  link.
- A browser socket reports a large message only once it is complete, so silence cannot tell a stalled
  route from a transfer still arriving; what the client awaits decides. A socket quiet for
  `LINK_REPLACE_MS` is replaced by a new one on the same token, which rejoins within a second, since a
  link dropped without a close would otherwise hold the room until the kick vote.
- While the client awaits a large message the bound is `TRANSFER_REPLACE_MS`, within which a full
  `MAX_BLOB_BYTES` blob (about 45 MB as base64) arrives at 1.2 Mbit/s. It awaits a map or initial save it
  requested, each until that blob or a refusal of every request for it arrives (a `retryTooSoon` answers
  only the repeat), and a snapshot after `desync`, after `loaded { tick: null }`, or after a `loaded`
  whose tick stands behind `start`'s `snapshotTick`. The host hands the socket the client's
  `awaitsTransfer`; a socket without it keeps a quiet link open. Each new socket forgets what the old one
  awaited and is served again from its own `start`.
- A large message nobody asked for, such as a broadcast initial save, counts as silence,
  so a link slower than its size over `LINK_REPLACE_MS` loses it to a replacement; the room's state is
  served again either way.

The desktop and browser app plays through the `?relay=` entry, whose client, link and world run in a
network worker; the headless test client uses an in-memory network. The app keeps the loading screen up
until the room's clock runs and nobody is still loading. The worker wakes and feeds its client at the
pace the client plays: the governed speed while the room is governed, up to the catch-up cap while it
drains a backlog. It steps at most a couple of display frames past the tick the display drew, a lead that
grows with a catch-up pace while the display draws at least four frames a second, so a slower display
paces the room. A display that has taken in nothing for four of its frames, and for at least 500 ms, has
stopped, as a hidden page's frame loop does: the worker keeps stepping and acknowledging, and hands the
display every tick since in one batch when it draws again, without their momentary sound and effect
events. Past `MAX_HELD_TICKS` held ticks it drops the records held so far and steps on, and the
display's world rebuilds whole when it draws again.

## Operations

Beside the WebSocket upgrade the relay serves one plain HTTP path, `GET /healthz`, answering
`{ ok, protocol, build, url, rooms, clients, uptimeSeconds }`: the version it speaks, the build it came
from, the `RELAY_PUBLIC_URL` it was given, and how busy it is. `GET` or `HEAD` of any other path is a 404,
any other method a 405. The image, its environment and its sizing are in
[Development: Relay image](DEVELOPMENT.md#relay-image).

## Match termination

Room states are `lobby`, `running` and `ended`, with no reverse transition. Start closes the lobby for
good, so new participants need a new room, optionally created from a save; reconnecting an existing
participant is distinct from joining a running match. A local defeat does not pause the shared clock or
end the match while other participants remain undecided.

1. Once the simulation decides every declared participant, each client stops exactly at that tick and
   sends `finish { tick, hash, world }` after its tick acknowledgement. `hash` is the full simulation state
   hash (eight lowercase hexadecimal digits), not the per-tick digest; a world adopted already decided
   reports its loaded tick.
2. The relay compares result tick and hash from every connected participant with a loaded, synchronized
   world, and holds the result while a connected member is still loading or out of sync. Stale world
   generations do not count, and disconnected identities do not block agreement.
3. Once the reports agree, it stops its clock at the result tick, clears waiting notices, and broadcasts
   the ended room view and `ended { tick, hash }`. Frames already emitted beyond that tick are never
   simulated by clients that reached the shared result. If every connected participant reports but the
   tick or hash differs, the relay ends the room with `resultDisagreement` rather than claim a result.

Reconnect keeps the result and permits restoration and replay up to the final tick without restarting the
clock; a returning client verifies the final hash before it shows the result. Leaving an ended session
releases membership without scheduling a seat handover. Commands, clock changes, kicks, lobby edits and
Start cannot restart it.

## Background windows

Window focus and tab visibility do not change room membership: a client that stops ticking but answers
pings is paced for, and is waited for as `slow` once it has stayed slow for `SLOW_WAIT_AFTER_MS`
([Pacing](#pacing)); one that stops answering is waited for as `silent`. Either can then be voted out.
Both drain their buffered frames when they resume. The desktop window disables Electron's background throttling so a
minimized client keeps ticking.

In a browser the network worker steps and acknowledges on its own `setTimeout` chain, so a hidden tab
whose frame loop stopped does not stop it ([The client](#the-client)), but the browser slows it. Measured
with a dedicated worker running a 20 ms timer chain and a 20 ms interval, on a tab hidden behind another
tab of the same window for seven minutes (macOS):

| Browser | Visible | Hidden |
| --- | --- | --- |
| Chrome 153 | 22 ms per firing | about 95 ms per firing from the moment the tab is hidden, steady for the whole seven minutes, no drop to once per second |
| Safari 27 | not measured, hidden from the start | about 100 ms per firing for four and a half minutes, then the tab stopped reporting at all and stayed silent |
| Firefox 155 | 24 ms per firing | not reached: behind another window and minimized the page never reported itself hidden and kept 24 ms |

The worker's clock owes at most five ticks of wall time per firing, so a clamped 100 ms firing still
delivers up to 50 ticks a second: derived from the clock, not measured in a browser, a hidden Chrome tab
keeps pace up to about speed 4 and trails beyond it. The room is then paced for it, and waits for it as
`slow` if it stays slow for `SLOW_WAIT_AFTER_MS`; on return it drains its buffered frames at the client's
catch-up rate. A Safari tab suspended this way acknowledges
nothing and is `silent` after `SILENT_AFTER_MS`; nothing distinguishes it from a crashed client. Neither
case is designed around: the desktop build is the primary target.

## Public relay security boundary

The relay accepts anonymous players. A client-generated token is a bearer secret for reconnecting, not an
account or a ban-resistant identity. The official client generates 24 random bytes; the relay never
publishes tokens in room views or logs. Protect tokens in transit with WSS. Room ids and nicknames are
public. Anyone can enter an open lobby; a locked one asks its password, and wrong guesses are bounded
per peer address. A ban bars the token and the peer address, so a player who changes both still gets
back in, and a newcomer behind the same address is barred with it; the members already inside are not.
Each IPv6 address counts on its own, so a client holding a block of them escapes the per-address
allowances and the address ban by switching addresses. A modified client can lie about its simulation
or sabotage its own match; digest agreement is not an anti-cheat guarantee.

The host bounds application and unsolicited WebSocket control traffic together by `MESSAGES_PER_SECOND`
with a `MESSAGE_BURST` and `BYTES_PER_SECOND` with a `BYTE_BURST`. Recovery requests (`loaded`,
`saveOrders`, `requestInitialSave`, `requestMap`) share a separate `RECOVERY_BURST` before relay dispatch.
A `saveOrders`, `requestInitialSave` or `requestMap` past it is answered `rejected` with `retryTooSoon` and
the connection stays; a `loaded` past it closes the connection as a traffic excess does, since a refused `loaded` would
leave the room waiting for that world, and the reconnect reports it again. WebSocket compression is
disabled, payloads are capped, an unacknowledged close is terminated after one second, and a socket
silent for `SILENT_SOCKET_MS` is closed. Incoming bytes keep a progressing upload alive before its complete
message can be parsed, and keep its sender heard by the relay; application traffic is still validated and
budgeted.

Large outgoing text messages use `TEXT_FRAGMENT_BYTES` WebSocket fragments with a control ping after each,
so a passive receiver answers while downloading: at 16 KiB/s an answer comes every two seconds for the
whole message, and the answer to the last one says it has read the message. Matching requested pongs
spend only the byte budget; unsolicited or excess pongs spend both. Outstanding ping credits are capped at
`MAX_OUTSTANDING_CONTROL_PINGS`, twice the fragments a full send buffer holds, so every fragment of a
message the buffer accepts gets its ping. Fragmentation preserves one application message and does not
change the game protocol.

The HTTP host caps all TCP connections at the configured WebSocket limit plus 16, including sockets that
have not sent upgrade headers. Headers have a five-second deadline, a request ten seconds, an idle
keep-alive socket Node's default of five seconds, and a keep-alive connection serves at most 100
requests. These bounds do not reserve capacity for legitimate users when an attacker fills every slot.
Limits apply per connection or room, not to process memory or network throughput; sizing a deployment is
covered with the image in [Development: Relay image](DEVELOPMENT.md#relay-image).

A public deployment needs an updated Node/container base, TLS, edge connection/upgrade rate limits, and
explicit process memory/CPU and log limits. Bind the relay only to the proxy's private network or
loopback, block direct public access to its port, run it without root, and give it no host mounts,
secrets or Docker socket. The image already runs as `node` and needs no writable game data; use a
read-only filesystem and drop capabilities. The host takes the last `X-Forwarded-For` entry as the peer
address, so the proxy must overwrite the header: a client that reaches the relay directly can forge it and
escape the hall chat and password allowances and a room's address ban, leaving only the token ban.
Connection and upgrade limits per address belong at the proxy with a correctly configured trusted-proxy
chain. Reconnecting creates a new
socket budget, so edge limits must also cover connection churn. Bandwidth DDoS protection belongs
upstream.
