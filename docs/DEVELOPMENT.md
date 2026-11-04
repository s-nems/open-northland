# Development reference

This page collects commands and local-only tools. The design rules live in [`./AGENTS.md`](../AGENTS.md)
and the test strategy in [`TESTING.md`](TESTING.md).

## Common commands

```bash
npm ci                  # install the locked dependency set
npm run dev             # browser development server (builds missing or stale content first)
npm run desktop         # Electron development build
npm run relay           # lockstep relay server on PORT (default 8765)
npm run build           # content step, typecheck and browser app build with per-mode JS size
npm test                # normal Vitest suite (fast tier)
npm run test:slow       # slow tier: scale, long-run and real-time tests
npm test -- scenario    # test files matching a path fragment (includes full typecheck)
npm run test:watch      # watch mode
npm run check           # Biome formatting and lint checks
npm run check:fix       # apply safe formatting and lint fixes
npm run check:assets    # reject original, decoded, or unreviewed binary files
npm run check:docs      # validate Markdown and ticket links/contracts
npm run check:translations # validate the translation overlays under translations/
npm run tickets:list    # priority-sorted ticket view
```

Use `npm install` only when dependencies or the lockfile need to change. For the shorter edit/test
loop and completion checks without duplicate typechecking, see [TESTING.md](TESTING.md#standard-gates).

`dev` and `shot` use the workspace packages' `source` exports directly. Vite watches their source
files; no separate compiler is needed. Changes to the client identity inputs (app, data, sim,
lockstep, net-client, net-protocol, or the lockfile) restart Vite and reload connected pages, ending
any active game so new code cannot retain an old multiplayer identity.

Production builds and plain Node tools use `dist/`; `packages/app` compiles to `dist-tsc/` instead,
because its `dist/` is the Vite build that ships. Run `npx tsc --build` before running a Node tool
against changed package sources; `npm run build` performs the full typecheck and production build.

## Repository scripts

Root `scripts/` holds the Node tools behind the npm commands:

- `bench/`: Node benchmark entry points and their runner; `bench/browser/` the browser benchmarks.
- `browser/`: the shared Chromium session, input helpers and original-game gate.
- `content/`: build, locate and inspect generated content (`build-content.mjs`, `convert-map.mjs`,
  mission tools).
- `test-modes/`: the runners behind `npm run test:content`, `test:pipeline`, `test:engines`,
  `test:boot` and `test:shaders`.
- `net-lab/`: the multiplayer browser lab and the chaos proxy.
- `dev/`: `ports.sh`, `reset.sh` and the diagnostic bundle tool.
- `report/`: `symbolicate.mjs`, which maps a bug report's stacks through a build's hidden source
  maps ([Source maps](BUILDING.md#source-maps)).
- `test/`: the scripts' own `node --test` suites, mirroring these folders.

The files left at the root keep their paths for outside callers: the asset check and its policy
(the art fork loads its policy beside it), the docs and ticket tools, the data-pack reader with its
release pin and unzip (imported by the pipeline and the deployment repository), and the smoke-image
helper.

## Worktree previews

Port `5173` belongs to the primary checkout on `main`. Linked worktrees default to `5174`;
choose a free port in `5174–5199` with `npm run dev:ports`. Development servers fail on a busy
port instead of silently moving. Use `127.0.0.1` consistently for startup, verification and links.
Automated harnesses can request `port: 0`; this searches from `5174`, never the main port.

Run these commands from the **task worktree root** (replace `5175` with the chosen free port):

```bash
npm run dev -- --port 5175
# In a second terminal, after the server reports ready:
npm run dev:verify -- 'http://127.0.0.1:5175/?map=magiczny_las'
```

Use the client's persistent terminal/background process support and keep its PID and log path.
Give each worktree its own `node_modules`: on APFS,
`cp -c -R "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/node_modules" node_modules`
clones the primary checkout's tree without using extra disk space, then `npm install` applies any
lockfile difference; elsewhere run `npm ci`. A shared or symlinked `node_modules` resolves workspace
imports to another checkout. Vite rejects workspace imports outside this checkout's `src/` trees.
Development serves source directly; compiling `dist/` does not fix a wrong preview.

`dev:verify` compares `/__dev/checkout` with this checkout's real path and current client-build hash,
then checks generated IR, nonempty map/sprite indexes, the requested map (or first indexed map),
and a sprite atlas/PNG over HTTP. Missing content fails verification even if the menu boots.
The endpoint reports the serving PID, branch/HEAD at startup and content directory; HTTP 200 alone
does not prove identity. An older server without this endpoint must be restarted. The build hash
covers multiplayer identity inputs, not assets or every rendering module.

After the last edit or rebase, run verification, open the **same URL** in a browser, inspect console
errors and exercise the changed behavior. For real maps also check `/maps-index.json` and the chosen
map load. The worktree's `content/` starts as a clone or copy of the primary checkout's tree when that
tree matches this checkout's archive, IR version and translations ([Local game content](#local-game-content)),
so a task that writes content changes only its own copy. If the primary content is absent, prepare it
there first; never hand off the fallback app as a real-map preview. Browser verification is required
even when identity matches, especially for asset changes.

Immediately before handoff, rerun `dev:verify` and give a clickable link to the tested map/scene,
the checkout/branch, and any remaining human checks. Before integration, keep the task preview
available. After integration, verify the primary app on `:5173` from the primary checkout and hand
off that URL. The primary app must actually contain the integrated change.

At session cleanup, stop **all temporary servers started by this session**, including abandoned
attempts and test harnesses. Check recorded PIDs against their current command/cwd before stopping
them; stop their Node/Vite children too, not just the npm wrapper. Wait for exit, then use
`npm run dev:ports` to confirm the task listeners disappeared before deleting their worktree.
Do this on failure/cancellation too. Leave the primary development server and other sessions'
processes alone; never use `killall node`, `pkill node`, or kill by port alone. Retain a task server
only on explicit user request and report its PID/port. `npm run dev:reset` explicitly replaces the
primary server and must not be used to start a worktree preview.

## Local game content

A release builds `content/` from the pinned source data pack and ships the converted tree inside
installers and the web image. Player-selected local maps are converted separately in a Worker.

`npm run dev` and `npm run build` start with `node scripts/content/build-content.mjs --if-stale`, which
builds `content/` when the tree is missing or its `build-stamp.json` names another archive hash, IR
version or translation set, and otherwise returns at once. In a Git worktree it first clones the
primary checkout's `content/` when that tree's stamp matches, and a worktree that must convert clones
the primary checkout's unpacked pack instead of extracting the archive again. A clone (APFS, or a
reflink on Btrfs or XFS) shares the bytes until either tree changes them; where the two checkouts sit
on different volumes or the file system cannot clone (ext4, NTFS), the worktree copies the tree
instead, which takes seconds and the tree's full size on disk (about 1.3 GB). The stamp does
not track the converter itself: after a pipeline change that keeps the IR version, run
`npm run build:content`, which always rebuilds and takes the unpacked pack only from this checkout's
cache or the archive, never from the primary checkout.

Without local configuration the build downloads the pinned pack from
`https://opennorthland.org/data/<sha256>.zip` after describing the archive and asking for
confirmation; Enter accepts. When the download is declined,
or cannot be asked for because there is no terminal (CI, an agent), nothing is downloaded:
`--if-stale` skips the content step with a note and `build:content` fails. `ON_DATA_ACCEPT=1` in
the process environment (it is not read from `.env`) grants the consent. To use a local
archive, set `ON_DATA_ZIP=/absolute/path/to/data.zip` in the ignored root `.env`; `.env.example`
shows the setting. Process environment wins, followed by this checkout's `.env`, then the primary
checkout's `.env` for a Git worktree. Relative paths resolve against their configuration file (or
the checkout root for an environment value). An empty value selects the normal download/cache path.
No other dotenv settings are loaded by this command. An invalid explicit archive fails without
falling back to the network.

The archive hash in `scripts/data-release.json` pins the input and names its download URL. Downloaded
archives (`<sha256>.zip`) and the unpacked tree live under ignored `.cache/data/`, outside the served
`content/`. Every build verifies the archive and the manifest's file inventory and hashes; a damaged
unpacked cache is rebuilt and a damaged download is fetched again, while a local archive must match
the pin. Published packs stay available under their hash, so any checkout builds its own pin. A pin
whose pack is not published yet fails before downloading anything: publish first, then commit the pin.

Conversion runs in a temporary tree and replaces `content/` only after success. Existing rendered
music is reused when its own source fingerprint and render version still match. To run the pipeline
against an already unpacked pack:

```bash
npm run pipeline -- --data-root .cache/data/unpacked --out content
```

The [source pack contract](DATA-PACK.md) describes the base and the campaign layout. Original source
assets, local archives, unpacked trees and generated content must never be committed. The pack is
built and versioned independently. Its initial base derives from CnMod 1.3.2;
readable rules and community maps use the pack layout documented in the contract. Pack construction
removes tools and unrelated files before publication.

The sound stage encodes every clip twice, losslessly as FLAC (the encoder in
`packages/formats/src/audio/`) and compactly as Ogg Opus (libopus's WebAssembly build from npm,
muxed by the same package); like the music stage below, it needs nothing beyond Node and npm.

The music stage renders the DirectMusic soundtrack (`DataX/DM2`, included in the pack) to one ogg
track per segment entirely in Node: segment interpretation, DLS synthesis, reverb, and ogg encoding
all run from npm dependencies, with no native toolchain. Without `DataX/DM2` the stage is skipped
with a note and the game simply has no music.

Local content gates:

```bash
npm run test:content
npm run test:pipeline
npm run test:engines
```

`test:content` checks consumers against an existing `content/` directory. `test:pipeline` performs a
fresh conversion into a temporary directory and validates the result. It reads the unpacked data pack at
`ON_DATA_ROOT`, `.cache/data/unpacked` by default.
`test:engines` boots the app in Electron and the Playwright browsers and compares their state hashes
with Node (see `TESTING.md`).

`npm run missions:coverage` builds the workspace and reports static opcode coverage of the content's
`[MissionData]` scripts, per opcode and (with `--per-map`) per map. Unknown names count as missing
even when the decoder falls back to `True` or `None`; token-count warnings are reported separately.
Coverage does not prove successful execution, correct name joins, or map completion.
Fresh maps execute their scripts automatically. `?missions=off` disables execution for diagnostics;
loading a save preserves its stored mission rules.

`npm run mission:script -- <map id> [--lang pol] [--pages] [--mission <n>]` prints one map's script as
the game runs it: every mission with decoded goals and results, opcodes this build cannot run marked,
goal texts, the pages its results open and, with `--pages`, every briefing page. It reads the
generated sidecars, so corrections are included. `npm run map:convert -- <map id>` re-converts one
base map from the unpacked pack through the corrections into this checkout's own `content/` and
refreshes its `maps-index.json` row; it refuses a shared primary content directory (`ON_CONTENT_DIR`),
and a worktree's own `content/` is the clone `npm run dev` or `npm run build` left. Campaign maps need
the full `build:content`. Both need the workspace built (`npx tsc --build`).

## Translation overlays

`translations/<lang>/` holds text the data pack does not ship: imported fan translations and the
project's own translations and edits, as JSON overlays the pipeline applies while it converts. A map
overlay is filed under the SHA-256 of the map's raw `map.dat`. [`translations/AGENTS.md`](../translations/AGENTS.md)
owns the layout and the rules.

```bash
npm run check:translations
```

The check validates every overlay against its schema and the layout, and fails only on those. With
the unpacked pack at `ON_DATA_ROOT` (by default `.cache/data/unpacked` of this checkout, else of the
primary checkout) it also warns about overlays whose basis text changed since the pack shipped it,
translations into a language the pack ships, string ids, labels and type ids the source lacks,
source-language overlays on maps that refuse them, values whose goal prefix, placeholders or tags
differ from the source, and values still equal to the source text: an unfinished skeleton. The
pipeline log's `[pipeline] translations:` lines count the overlays each run applied, left out or found
stale.

The check also fails on a Han character that an overlay or a Chinese app catalog uses and the bundled
Noto Sans SC subset lacks. After an import adds such characters, rerun
`tools/translations/subset-han-font.sh <dir with NotoSansSC-Regular.otf and NotoSansSC-Bold.otf>` to
rebuild both weights.

```bash
npm run translations:skeleton -- path/to/map.rar --lang chs
npm run translations:skeleton -- path/to/MapFolder --lang eng --basis eng --force
npm run translations:derive-cht
```

The skeleton command writes a map overlay for each map of a `.zip`, `.rar`, `.c2m` or folder into
`translations/` (or `--out`). An existing overlay of the same text is replaced only with `--force`;
one of other text keeps its file and the skeleton takes a variant name beside it. Its basis is
`--basis`, else the first source language the map ships, and every value is that language's text, for
a translator to replace in place. A `--lang` equal to the basis writes an edit template; a `--lang` the
map ships itself is refused, since the shipped text wins. The check sees only maps of the pack, so it
cannot flag an unfinished skeleton of a catalogue map.

## Browser entries

See [Browser entries](BROWSER-DEVELOPMENT.md#browser-entries).

## Screenshots

See [Screenshots](BROWSER-DEVELOPMENT.md#screenshots).

## Measuring performance

See [Measuring performance](PERFORMANCE.md#measuring-performance).

## Relay server

```bash
npm run relay
PORT=9000 npm run relay
```

Builds the workspace and serves the multiplayer relay over WebSockets on `PORT`, with its health
check at `/healthz` on the same port. It loads no content and runs no simulation; the protocol it
speaks is [`NETWORK.md`](NETWORK.md). `HOST` binds one address, `RELAY_MAX_ROOMS` and
`RELAY_MAX_CONNECTIONS` cap the rooms and the open sockets, `RELAY_PUBLIC_URL` and `RELAY_BUILD`
are what the health check reports as the address and the build, and `RELAY_HALL_FILE` names the file
the server chat and recently seen players survive a restart in; the log is one JSON record per
line, a failed start included.

The log is meant to be read after the fact by someone holding only the file. Beside joins,
departures and each room's life, it says why a game froze, slowed or ended. `held`, `governed` and
`paused` close each hold, governed episode or pause of the running clock of 5 s or more, with whom it
was for or who paused, why and how long. Governed runs with less than a minute of running clock
between them are one episode, whose line comes once the clock has run that long without the
governor, and governed time counts only while the clock runs, neither held nor paused. `snapshot`
closes each refresh with its donor, size, time from the first request and the requests it took;
`snapshot unanswered` names, once a round, a donor that let its retry window pass, or whose upload
outlasted `SNAPSHOT_UPLOAD_MAX_MS` with what of it had arrived (`receivingKib`), and `snapshot refused` an upload of
no use. Every five minutes `status` counts clients, rooms, players, the sockets that closed without
`hello` (`anonymous`; they get no line of their own) and those turned away at `RELAY_MAX_CONNECTIONS`
(`refusedConnections`), with the longest gap between the relay's own polls (`pollMaxMs`) and the
process memory (`rssMib`). `room status` sums up the interval for each
running room: time held by reason, governed and paused time, who set the speed or paused, a hold or a
snapshot request still open (`waitingFor` and `waitingMs`, `snapshotPending`), and for each member the
mean and highest round trip of the interval's samples, highest input delay, ticks behind, tick cost
and buffered frames, boot progress, drops, and refused messages by `kind:code`. A game's end, a room's
drop and the relay's stop add a last `room status`. `disconnect` carries the close code (1000 with the
client's reason in `closeReason`, 1001 for a page that closed, 1005 for a close without a code, 1006
for a dropped link), the relay's `cause` when it closed the socket, the transport `error`, how long the
link had been quiet and its smoothed round trip. `hello` with `replaced` is a client that took its
identity over from a connection the relay still held, quiet for `quietMs`: a link the client gave up
on, or a second tab.

Every message the relay handles is exercised by the tests under `packages/net-server/test`, and the
decoded-map run in `npm run test:content` plays real sessions through it in memory.
`ON_RELAY_URL=wss://…` points the socket test at a deployed relay instead:

```bash
ON_RELAY_URL=wss://relay.opennorthland.org npx vitest run --project core packages/net-server/test/host/ws-host.test.ts
```

The main menu's **Multiplayer** screen (`?menu=multiplayer` opens it directly) accepts an editable
relay address (default `wss://relay.opennorthland.org`) and nickname, lists rooms, and creates games
from installed maps or local saves. Players choose seats and readiness explicitly; the creator
controls seats and settings. Connecting with a token the relay still holds in a started game shows
that room with **Rejoin game** and **Leave room** instead of relaunching the game on its own.
Use separate browser profiles/private windows for two independent players. The default endpoint is
not deployed by the repository. For a local relay, enter `ws://127.0.0.1:8765`.

`?menu=campaign` opens the **Campaign** tab of **New Game**; `?menu=campaign&campaign=<id>` also
selects the campaign with that `campaigns-index.json` id. The menu reads `campaign` once and drops it
from the address, so a later visit to the tab keeps the player's own choice.

To serve an isolated generated content tree with Vite, set `ON_CONTENT_DIR` to an absolute path or a
path relative to the checkout. This is the same override the content test runner accepts.

The developer entry remains available in two windows of one dev server. The first creates
the room and waits for `players` people; it rewrites its URL to the room's id, which the others
join with:

```text
?relay=ws://localhost:8765&room=new&map=magiczny_las&players=2&nick=Ania
?relay=ws://localhost:8765&room=<id from the first window>&nick=Bartek
```

Each window sits in the first open seat and reports ready on its own; the creator starts once
everyone is. The creator's lobby card links the next player in a new tab, its room and a free nick
filled in. A `nick=` in the URL gets its own reconnect token for that relay, so tabs of one browser
play as different people and a reload rejoins the same seat; without one, the tab uses the menu's
identity. Enter opens the
chat line. `perf().net` carries the round trip, the assigned input
delay, the click-to-apply time and the jitter buffer's depth. The runtime has no write access to the
world, so a forced divergence for a resync check runs in the headless multi-client harness under
`packages/net-server/test/support/`, not from a browser console.

## Network chaos proxy

```bash
node scripts/net-lab/chaos-proxy.mjs --upstream ws://127.0.0.1:8765 [--port 8780] [--host 127.0.0.1] \
  [--profile lan|home|far|mobile|bad] [--seed 1] [--log-dir DIR] [--max-queued-bytes N]
```

A TCP proxy for the WebSocket connections between real clients (browsers, Electron, headless Node
clients) and a relay (`ws://` or `wss://`) that impairs the link the way a home connection does,
without root. It sends the client's upgrade request on with the relay's `Host`, the client's path
(unless it is `/`) and query in place of the upstream URL's, and no extension offer, so the frames
stay uncompressed; from then on it carries the bytes both ways unchanged. Each direction keeps its order and nothing is
dropped while the link is up. The impairments act on bytes, not messages: a bandwidth cap releases
them in 20 ms slices, so a message the relay sends as fragments with a control ping after each
arrives fragment by fragment with its pings in between, and an upload shows byte progress at the
relay before it is whole. Jitter stretches the gaps between chunks and never reorders them. A dead
relay drops the client's connection before its handshake completes; a relay that refuses the upgrade
gets its answer passed to the client.

`--log-dir` writes `connection-<id>.jsonl` per connection. A frame reader on each direction watches
the bytes without changing them and logs each whole message (size, fragment count, `kind` from the
start of a text message), each ping and pong, and each close frame with its code and reason, with
the delay through the proxy, plus the connection events; stdout gets the events without the frames.
`--seed` fixes the jitter sequence of every connection, so a run repeats.

Latency is one way, so a round trip is twice it; caps are in Mbit/s or KiB/s as written. These are
not the load lab's profiles of the same names: its `home` is a 40 ms round trip at 1 / 6 MiB/s (see
[Multiplayer load lab](TESTING.md#multiplayer-load-lab)).

| Profile | One-way latency | Jitter | Up / down cap | Stalls | Flapping |
| --- | --- | --- | --- | --- | --- |
| `lan` (default) | 1 ms | 0 | none | none | none |
| `home` | 30 ms | ±3 ms | 10 / 50 Mbit/s | none | none |
| `far` | 100 ms | ±20 ms | 5 / 20 Mbit/s | none | none |
| `mobile` | 150 ms | ±80 ms | 1 / 4 Mbit/s | 1.5 s every 20 s | none |
| `bad` | 120 ms | ±60 ms | 64 / 256 KiB/s | 3 s every 8 s | dropped after 45 s |

Stall times count from a connection's opening, or from the moment the stall setting changed. A
stall freezes both directions, halfway through a message too, and then releases the held bytes at
once, like a TCP retransmission wait. When more than 1 MiB waits in one direction (queued in the
proxy plus unsent on the target socket), the proxy stops reading the sender until less than 256 KiB
waits, so the sender's own buffer (`bufferedAmount`) grows as behind a full TCP window. Queued bytes
per connection are capped at `--max-queued-bytes`, 16 MiB by default, which only a runaway reaches;
past it the client gets 1013 `proxyQueueFull`, the relay 1001, and the log says so.

`GET /control` on the same port returns the state: the upstream, the default profile and settings,
the remaining unreachable time, and per open connection its `id`, settings, queued bytes and chunks,
whether each direction's reader is paused, and its frame, byte and dropped-byte counts. `POST
/control` takes one JSON object with `content-type: application/json` (415 otherwise); every field
is optional:

| Field | Effect |
| --- | --- |
| `connection` | Applies the rest to that connection id only; without it, to the default for new connections and to every open one. |
| `profile` | Replaces the settings with that profile. |
| `set` | Merges into the settings (the profile's, when both are given): `up`, `down` or `both` as `{ latencyMs, jitterMs, bytesPerSecond }` (`null` for no cap), `stall: { everyMs, forMs } \| null`, `flap: { everyMs, code } \| null`, `halfOpen: boolean`. |
| `disconnect` | `{ code, reason, afterMs }`: closes the client with `code` after `afterMs` and drops the relay side. `1006` (the default) drops the client without a close frame, and so does any code while the client sits halfway through a frame, since a close frame cannot be spliced into one. |
| `unreachableMs` | Refuses new connections for that long, by dropping the TCP connection; open ones are untouched. |

`halfOpen: true` stops forwarding in both directions without closing either socket, which is what
the relay's silence timeout must catch; `false` resumes and delivers what was held. `flap` drops
each connection `everyMs` after it opened or after the setting changed, so reconnects keep
flapping. An unknown field or a bad value answers 400 with `{ error }`. Control answers only peers
on this machine, also when `--host 0.0.0.0` opens the proxy itself to the LAN, and refuses any
request with an `Origin` header (403), so a web page cannot drive it. Example:

```bash
curl -s localhost:8780/control -H 'content-type: application/json' -d '{"profile":"mobile"}'
curl -s localhost:8780/control -H 'content-type: application/json' -d '{"connection":2,"set":{"halfOpen":true}}'
curl -s localhost:8780/control -H 'content-type: application/json' \
  -d '{"connection":2,"disconnect":{"code":1006,"afterMs":500}}'
```

To play the developer lobby through it, run the relay and the proxy, then point the windows at the
proxy port; each window may sit behind its own connection settings:

```bash
npm run relay
node scripts/net-lab/chaos-proxy.mjs --upstream ws://127.0.0.1:8765 --profile home --log-dir /tmp/chaos
```

```text
?relay=ws://127.0.0.1:8780&room=new&map=magiczny_las&players=2&nick=Ania
?relay=ws://127.0.0.1:8780&room=<id from the first window>&nick=Bartek
```

## API server

See [API server](API.md#api-server).

## Build version

See [Build version](BUILDING.md#build-version).

## Release checks

See [Release checks](BUILDING.md#release-checks).

## Desktop packaging

See [Desktop packaging](BUILDING.md#desktop-packaging).

## Brand assets

See [Brand assets](BUILDING.md#brand-assets).

## Web image

See [Web image](BUILDING.md#web-image).

## Relay image

See [Relay image](BUILDING.md#relay-image).

## API image

See [API image](API.md#api-image).
