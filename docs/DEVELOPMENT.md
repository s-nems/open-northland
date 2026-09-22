# Development reference

This page collects commands and local-only tools. The design rules live in [`./AGENTS.md`](../AGENTS.md)
and the test strategy in [`TESTING.md`](TESTING.md).

## Common commands

```bash
npm ci                  # install the locked dependency set
npm run dev             # browser development server
npm run desktop         # Electron development build
npm run relay           # lockstep relay server on PORT (default 8765)
npm run build           # typecheck and build the browser app, then report per-mode JS size
npm test                # normal Vitest suite
npm test -- scenario    # test files matching a path fragment (includes full typecheck)
npm run test:watch      # watch mode
npm run check           # Biome formatting and lint checks
npm run check:fix       # apply safe formatting and lint fixes
npm run check:assets    # reject original, decoded, or unreviewed binary files
npm run check:docs      # validate Markdown and ticket links/contracts
npm run tickets:list    # priority-sorted ticket view
```

Use `npm install` only when dependencies or the lockfile need to change. For the shorter edit/test
loop and completion checks without duplicate typechecking, see [TESTING.md](TESTING.md#standard-gates).

`dev` and `shot` use the workspace packages' `source` exports directly. Vite watches their source
files; no separate compiler is needed. Changes to the client identity inputs (app, data, sim,
lockstep, net-client, net-protocol, or the lockfile) restart Vite and reload connected pages, ending
any active game so new code cannot retain an old multiplayer identity.

Production builds and plain Node tools use `dist/`. Run `npx tsc --build` before running a Node tool
against changed package sources; `npm run build` performs the full typecheck and production build.

## Worktree previews

Port `5173` belongs to the primary checkout on `main`. Linked worktrees default to `5174`;
choose a free port in `5174–5199` with `npm run dev:ports`. Development servers fail on a busy
port instead of silently moving. Use `127.0.0.1` consistently for startup, verification and links.
Automated harnesses can request `port: 0`; this searches from `5174`, never the main port.

Run these commands from the **task worktree root** (replace `5175` with the chosen free port):

```bash
primary_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
ON_CONTENT_DIR="$primary_root/content" npm run dev -- --port 5175
# In a second terminal, after the server reports ready:
npm run dev:verify -- 'http://127.0.0.1:5175/?map=magiczny_las'
```

Use the client's persistent terminal/background process support and keep its PID and log path.
Install dependencies with `npm ci` in each worktree; shared `node_modules` can resolve workspace
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
map load. The command above shares primary content for read-only use. Tasks writing content need
their own copy and `ON_CONTENT_DIR` pointing there. If the primary content is absent, prepare it
using [Local game content](#local-game-content); never hand off the fallback app as a real-map
preview. Browser verification is required even when identity matches, especially for asset changes.

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

A release builds `content/` from the pinned CulturesNation archive and ships the tree inside the
desktop installers and the web image; nothing is converted on a player's machine. The same command
does it locally:

```bash
npm run build:content
npm run build:content -- --zip "../CnMod 1.3.2.zip"
```

It keeps a cached `content/cnmod.zip` plus an unpacked `content/.cnmod-unpacked/`, verifies the
archive's SHA-256 on every run, downloads it only when the archive cache is missing or invalid,
shows download progress, reuses the unpacked cache when it already matches the pinned archive, and
empties `content/` except for the rendered music and the cached source data before running the
pipeline. The music stage re-renders only the tracks its own manifest no longer covers, so a rebuild
from an unchanged archive keeps them and saves most of the run; `--zip` still bypasses the archive
cache and uses the given file directly. While working on the pipeline itself, run it directly
against an unpacked mod, the directory that holds `DataCnmd/`:

```bash
npm run pipeline -- --mod-root "../CNMod-1.3.2" --out content
```

The mod archive carries every file the stages read: the rule tables, bobs, sounds, music, pictures,
fonts, strings, and the mod's maps. A game folder with the mod installed inside it works as
`--mod-root` too; the game's own packed `.lib` archives are not read, so its original campaigns and
tutorials are not converted. CnMod 1.3.2 is the current verified input; treat a newer release as
unverified until the real pipeline and content gates pass. The generated `content/` tree is ignored
by Git and `npm run check:assets` fails on anything tracked under it.

The output is laid out exactly as the app fetches it, so every host serves it as static files from
`/`: `ir.json`, the `maps-index.json` and `bobs-index.json` listings, and the `maps/`, `bobs/`,
`textures/`, `sounds/`, `music/`, `gui/`, `gui-bitmaps/`, `goods/` and `terrain-palettes/` directories.

The music stage renders the DirectMusic soundtrack (`DataX/DM2`, which the mod ships) to one ogg
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
fresh conversion into a temporary directory and validates the result. It reads the mod at
`CULTURES_MOD_ROOT`, `../CNMod-1.3.2` by default.
`test:engines` boots the app in Electron and the Playwright browsers and compares their state hashes
with Node (see `TESTING.md`).

`npm run missions:coverage` builds the workspace and reports static opcode coverage of the content's
`[MissionData]` scripts, per opcode and (with `--per-map`) per map. Unknown names count as missing
even when the decoder falls back to `True` or `None`; token-count warnings are reported separately.
Coverage does not prove successful execution, correct name joins, or map completion.
Fresh maps execute their scripts automatically. `?missions=off` disables execution for diagnostics;
loading a save preserves its stored mission rules.

## Browser entries

`npm run dev` opens the main menu. Direct entries are useful during focused work:

| URL query | Purpose |
| --- | --- |
| `?scene=<id>` | registered deterministic acceptance scene |
| `?map=<id>` | decoded map |
| `?relay=<ws url>&room=<id\|new>` | decoded map played through a relay server; see below |
| `?anim` | character animation gallery |
| `?icons` | decoded sprite-frame gallery |
| `?sounds` | sound-binding gallery |
| `?shot` | single-frame screenshot entry used by the harness |

Common modifiers include `lang=<pol|eng>`, `fog=<off|classic|classic-fow|recon|recon-fow>` (the
lobby's map setting, with `-fow` for fog of war; `off` reveals the map), `player=<...>`, `ai=<...>`, `sound=off`,
`intro=off` (skip the mission sheet a fresh world opens on), and `fullscreen=off`. `ai=<seat,...>`
names the seats a person could have taken that the strategic AI plays instead; a map's own computer
seats (authored `ai`, offered to nobody) play without being named. `seed=<n>` picks
the world seed a `?map=` session runs on, so two clients of one session start from the same world;
without it the map entry keeps its fixed default. Without `lang`
the language follows the browser, and English stands in for a
browser language with no shipped catalog. The graphics settings (render scale, frame-rate limit,
post-processing) live in the stored settings and never enter the URL; `postfx=<on|off>` overrides
the stored post-fx choice for that entry, so captures stay reproducible whatever the machine's
settings. The HUD scales from the canvas height sampled at game start (capped at 1.25x) times the
stored interface-scale setting; `uiscale=<n>` pins an absolute scale for reproducible diagnostics and is
not carried across menu/game switches. The menu's settings screen covers the player-facing options,
so direct query parameters are mainly for reproducible diagnostics.

The Graphics tab also owns four enhancements of the world view. They are stored settings, default on,
and apply to a running game without a restart. With all four off the world matches the previous
renderer except for two silhouettes that now draw either way: flat decor casts its authored shadow,
and settlers and animals draw the authored `_s` twin the original ships. For a before/after review
keep the map, camera and zoom fixed, and include x2 and a zoomed-out pan.

- **Original art filter** (`enhancedSampling`, `pixelArtScaler`): how original pixel art magnifies.
  `xbr` is an edge-directed pass, so diagonal outlines become straight cuts instead of stairs or
  blur, and it converges on plain bilinear as texels reach pixel size; `sharp` keeps whole texels
  and anti-aliases only their boundaries; `bilinear` is the sampler's own filter. Characters and
  animals get it in the paletted shader on palette-resolved colours. Buildings, trees, goods and the
  other frames the world's texture cache mints from nearest-loaded atlas pages get it through the
  `world` batcher the world sprites opt into, which also averages a frame-clamped 2x2 footprint
  below texel size. The filter claims the original's pages only: a presentation pack's art keeps the sampling its
  sprite-smoothing setting chose, and HUD icons, ground and flat decor batches sample as before. Any
  filter also removes device-pixel snapping from camera and character placement, magnifies original
  terrain with a tile-bounded Catmull-Rom bicubic filter and minifies it with four tile-bounded
  samples. Original terrain pages have no padded mip chain, so the bounded filter reduces aliasing
  without replacing mipmaps at extreme zoom-out; already mipmapped own terrain keeps its sampling.
  Finished buildings use isolated native-size frames with mipmaps and similarly bounded interior
  detail, falling back to the plain frame when the cache is unavailable, the frame oversized or its
  budget full; alpha, anchors and picking bounds stay unchanged. Construction, upgrades, shadows and
  already mipmapped art bypass it. Bakes run synchronously on first use and can add a frame-time
  spike; cached frames avoid repeat work.
- **Enhanced shadows** (`softShadows`): every silhouette the world draws (buildings, trees, tall
  blocks, animals, characters) is softened and painted at a multiplied alpha. Each settler and animal
  projects its own body frame onto the ground, sheared toward the light of the original building
  silhouettes; a character's head overlay casts too, cropped to the rows above its body frame so the
  two projections meet instead of darkening the ground twice. A bake falls back to the hard
  silhouette when the page is unreadable or a budget is full; a bake the per-frame budget defers is
  picked up on a later frame, so switching the setting on over a town softens progressively rather
  than stalling one frame. Flat decor (bushes, mushrooms, and the dead trees that block no walking)
  draws its authored silhouette under every decor body whatever the setting. The per-frame soft bakes
  cannot batch into a decor mesh, so with the setting on its own mesh shader applies the same
  strength and colour and blurs the silhouette with the bake's kernel, reading only inside the
  frame's own texels.
- **Enhanced water** (`enhancedWater`): crossing swells, darker shallows and darker still deep water
  (the map's own two pattern families), a bluer and slightly more saturated colour, stronger on the
  deep family, and a glint band drifting over the deep water.
- **Environment motion** (`environmentMotion`): interpolates fish, smooths the breeze on own
  vegetation and adds that breeze to the tall trees the original ships as one still frame (its
  walk-blocking dead trees), whose cast shadows lean with them. That breeze belongs to the static map layer: a
  harvestable the sprite pool draws, which is every one after a save is restored, stands still.

Original humans and animals keep their tick anchors under every setting: the original engine moves
a walker only together with its walk frame, and moving the body inside a frame hold would drag the
planted foot. Original work, tree and building clips retain their authored images and durations: a
fractional clock does not invent frames. Own-art motion interpolation follows its authored binding
whatever the settings say. Projectiles, damage smoke, fades and building collapse already use
interpolated presentation clocks.

Debug modes:

- `debug=diag` records replay and state-hash diagnostics;
- `debug=perf` adds browser performance marks;
- `debug=trace` records a trace that can be exported for offline profiling;
- `debug=profile` accumulates per-system sim cost for the whole session;
- `debug=missions` shows saved mission execution ticks and counts in a collapsible inspector;
- `debug=notices` raises one notification of every type on the seat's own settlers and buildings once a
  second, so the column shows every row without staging its cause: `?scene=sandbox&debug=notices`. The
  notes stand until dismissed or their subject is gone, so the column's order stays put for a review.

Flags combine: `?debug=profile,trace` runs both.

The on-canvas stats readout and the Admin / Debug palette are off by default: the "Debug tools"
toggle on the settings screen's Gameplay tab shows both, persists with the other settings, and applies
live inside a running game. A relayed session shows only the readout, since the palette's pokes are
trusted world edits with no wire.

A running game exposes `window.__opennorthland`. Besides the live `sim`, `renderer`, `sheet` and
`cameraCtl`, it answers `perf()` with one JSON-serialisable performance report, so an automated probe
reads numbers instead of screenshotting the on-canvas readout. `resetPerf()` opens a fresh measurement
window, and `setSpeed()` / `setPaused()` put the session into a state worth measuring: `setSpeed(1)`
gives a baseline the per-frame step cap cannot distort, and pausing isolates the render half of a
frame. Read `sampling.hidden` before trusting any timing: a background tab throttles its frame loop
and every millisecond becomes fiction.

A stored fullscreen preference is taken back on the session's first gesture, so a probe that clicks
resizes the viewport mid-measurement and also records its own window mode. Add `&fullscreen=off` to a
scripted URL: the session keeps the window it was given, stores nothing, and the menu shows no
fullscreen prompt.

## Screenshots

Create a deterministic screenshot:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Useful options are `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`.
Screenshots still need human review.

The menu's backdrop stills are committed under `packages/app/src/assets/menu-backdrops/`, one
1920x1080 JPEG per curated map: an ambient settlement of a decoded map with no HUD and no map edge in
frame. Replace a file there to change the rotation.

## Measuring performance

| question | reach for |
| --- | --- |
| what does the sim spend a tick on, and does it grow as the settlement develops? | `npm run bench:map` |
| which function inside that tick burns the time? | `npm run bench:profile` |
| does one axis (settlers, fighters) drive a system's cost? | `npm run bench:sim` |
| did my change make it slower? | `npm run bench:compare` |
| what does a live session spend a frame on, sim or render? | `?debug=profile` and `window.__opennorthland.perf()` |
| how much JavaScript does a URL mode download and parse before it starts? | the table `npm run build` prints |

Every report judges the machine that produced it. Numbers under an untrustworthy banner are void
rather than weak: re-run on an idle box instead of reading them.

The benchmarks run as plain Node programs over the compiled `dist/` of the workspace packages, with
no test runner in the process: a runner wraps every cross-module import, and that wrapper lands in a
CPU profile inside the sim's own frames. `bench:sim`, `bench:map` and `bench:profile` each rebuild the
workspace from scratch before measuring, so a bare run describes the working tree rather than whatever
was last built; `bench:compare` only reads two stored reports and runs on the build already there.

Run the synthetic simulation benchmark with `npm run bench:sim`. Its main controls are
`ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS`,
and `ON_BENCH_JSON`.

Run the real-map benchmark with `npm run bench:map`. It needs generated content and its controls are
`ON_BENCH_MAP`, `ON_BENCH_SEATS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS`,
`ON_BENCH_SYNC_DIGEST` (fold the per-tick sync digest, what a networked session pays), and
`ON_BENCH_JSON`. `ON_CONTENT_DIR` points it at a content directory outside the checkout. The default
run is 20k ticks; `ON_BENCH_TICKS=50000` covers a full AI build-out.

`npm run bench:profile` runs that same world and CPU-profiles the measured ticks, printing the top
functions and files by self time next to the per-system table for the same ticks, and writing the raw
`.cpuprofile` under `bench-out/` for DevTools or Speedscope. It takes the `bench:map` controls except
`ON_BENCH_WINDOWS` and `ON_BENCH_JSON`, and defaults to 2k ticks. It prints its per-system report
rather than storing it: profiled timings are inflated by the sampler and must never become a
`bench:compare` baseline.

Both real-map benchmarks take a checkpoint so a late-game hotspot hunt does not rebuild the
settlement every time:

```bash
ON_BENCH_CHECKPOINT=/tmp/late.checkpoint ON_BENCH_SKIP=40000 npm run bench:profile
```

The first run builds the world, runs `ON_BENCH_SKIP` ticks unmeasured, writes the checkpoint and
measures; every later run with the same path restores it and measures from there (warm-up still
applies - restored code is cold again). A checkpoint holding another map, seat count or content IR
version is refused by name rather than measured.

Every run keeps its report under `bench-out/` (untracked), so a baseline exists without having been
planned for. `npm run bench:compare` with no arguments compares the two most recent runs of the same
world; `npm run bench:compare -- before.json after.json` names two explicitly, and `ON_BENCH_JSON`
overrides where a run writes.

## Relay server

```bash
npm run relay
PORT=9000 npm run relay
```

Builds the workspace and serves the multiplayer relay over WebSockets on `PORT`, with its health
check at `/healthz` on the same port. It loads no content and runs no simulation; the protocol it
speaks is [`NETWORK.md`](NETWORK.md). `HOST` binds one address, `RELAY_MAX_ROOMS` and
`RELAY_MAX_CONNECTIONS` cap the rooms and the open sockets, and `RELAY_PUBLIC_URL` and `RELAY_BUILD`
are what the health check reports as the address and the build; the log is one JSON record per
line, a failed start included. Every message it handles is exercised by the tests under
`packages/net-server/test`, and the decoded-map run in `npm run test:content` plays real sessions
through it in memory. `ON_RELAY_URL=wss://…` points the socket test at a deployed relay instead:

```bash
ON_RELAY_URL=wss://relay.opennorthland.org npx vitest run --project core packages/net-server/test/ws-host.test.ts
```

The main menu's **Multiplayer** screen (`?menu=multiplayer` opens it directly) accepts an editable
relay address (default `wss://relay.opennorthland.org`) and nickname, lists rooms, and creates games
from installed maps or local saves. Players choose seats and readiness explicitly; the creator
controls teams and settings. Connecting with a token the relay still holds in a started game shows
that room with **Rejoin game** and **Leave room** instead of relaunching the game on its own.
Use separate browser profiles/private windows for two independent players. The default endpoint is
not deployed by the repository. For a local relay, enter `ws://127.0.0.1:8765`.

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
everyone is. The reconnect token is stored separately for each relay origin and path; the nickname is
shared in stored settings. A reload rejoins the same seat; two windows of one browser profile share
the identity for that relay, so give the second a private window
or another profile. Enter opens the chat line. The perf overlay's third line and `perf().net` carry
the round trip, the assigned input delay, the click-to-apply time and the jitter buffer's depth. A
forced divergence for a resync check is a console mutation of `__opennorthland.sim` in one window.

## Build version

`ON_VERSION=1.2.3 npm run build` stamps a semantic version into the main menu's version line and
writes `{"version":"1.2.3"}` to `version.json` beside `index.html`; without it both read `dev`. The
relay image takes its identifier as `--build-arg RELAY_BUILD=...` and reports it on `/healthz`.

## Desktop packaging

```bash
npm run desktop
npm run desktop:dist
npm run test:desktop    # app:// boot and save/load across a relaunch; requires local content
```

`desktop` opens the checkout's `packages/app/dist` and `content/` in an Electron window;
`ON_CONTENT_DIR` moves the content tree the same way it does for Vite. `desktop:dist` packages
`packages/app/dist` and the checkout's `content/` (the override does not apply) as resources of the
installers under `packages/desktop/release/`, so the packaged game plays without any content on the
player's machine.

## Brand assets

```bash
npm run brand
```

Regenerates every committed icon and logo from the masters in `tools/brand/source/`: the favicon,
web manifest icons and screenshot, Open Graph image, desktop `icon.png`/`icon.ico`/`icon.icns`, the
README logos for dark and light themes and the main menu lockup. Edit a master, run the command and
commit the outputs together. Sizes up to 32 px, including the favicon, come from `emblem-small.svg`,
a flat drawing of the same shield, because the painted longship turns to mud that small;
`emblem-mono.svg` is the single-colour ship for badges and print. The macOS `icon.icns` sets the
emblem on a rounded square, the shape macOS expects; Windows and Linux get the bare shield. The
script fails on a master drawn up to its canvas edge, which means the generator cropped it.

## Web image

The web image is the web app of a commit: nginx serving `packages/app/dist` and `content/` from one
document root, the app at `/`, the hashed `/assets/` cached for good, everything else revalidated, a
missing path a plain 404, and `/healthz` for the host. `deploy/web/Dockerfile` copies the two prebuilt trees and runs nothing.

To build and run the image locally, after `npm run build` with a `content/` in place:

```bash
npm run web:image
docker run --rm --publish 8080:80 open-northland-web
```

## Relay image

The relay image builds for `linux/amd64` and `linux/arm64` from `packages/net-server/Dockerfile`:
the relay and protocol packages compiled once, then only those two and `ws` in a Node image, so it
carries neither the simulation nor a content directory. It starts on environment variables alone:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8765` | Listening port |
| `HOST` | every interface | Address to bind; the image's health check probes loopback, so leave it unset in a container |
| `RELAY_PUBLIC_URL` | unset | Public `ws://` or `wss://` address reported by `/healthz` |
| `RELAY_MAX_ROOMS` | `64` | Maximum rooms |
| `RELAY_MAX_CONNECTIONS` | `256` | Maximum open WebSocket connections |
| `RELAY_BUILD` | unset | Build identifier reported by `/healthz`; set by the `RELAY_BUILD` build argument |

Rooms live in memory; restarting the process ends every match. The relay writes one JSON record
per log line. TLS termination and deployment configuration belong to the operator.

Size the machine from the limits, not the defaults: a room can retain about 22 MiB of base64
snapshot text plus 16 MiB of serialized replay history, and JavaScript objects, input parsing and
output queues add more, so 64 rooms can approach 2.4 GiB in retained payloads alone. Each of 256
sockets can additionally receive a maximum-size message and queue about 43 MiB of output. Choose
`RELAY_MAX_ROOMS` and `RELAY_MAX_CONNECTIONS` for the machine and measure its workload.

To build and check the same image locally:

```bash
npm run relay:image
node packages/net-server/scripts/smoke-image.mjs open-northland-relay
```

The smoke check runs the image with a public address and a room cap, reads them back from
`/healthz`, has the relay refuse another protocol version by name and welcome its own, and lists
the image's packages to prove the boundary.
