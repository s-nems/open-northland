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

Common modifiers include `lang=<pol|eng|ger|rus>`, `fog=<off|classic|classic-fow|recon|recon-fow>` (the
lobby's map setting, with `-fow` for fog of war; `off` reveals the map), `player=<...>`, `ai=<...>`, `sound=off`,
`intro=off` (skip all automatic briefing windows, including script chapters), `fullscreen=off`,
`weather=<rain|snow|sand|clear>[:<percent>]` (whole-map weather in this view only, default 30; the sim's
weather is untouched; `weather=ambient[:<percent>]` holds the game's own weather, 100 a light episode, 300 a storm), and
`weathermode=<map|variable|winter>` (the lobby's match weather, `map` when no param names one), and
`tint=<palette index>` (a map script's whole-map vertex tint held in this view only). `ai=<seat,...>`
names the seats a person could have taken that the strategic AI plays instead; a map's own computer
seats (authored `ai`, offered to nobody) play without being named. `seed=<n>` picks
the world seed a `?map=` session runs on, so two clients of one session start from the same world;
without it the entry draws one and writes it into the address, so a match's link replays it. Without `lang`
the language follows the browser, and English stands in for a
browser language with no shipped catalog. The short codes `pl`, `en`, `de` and `ru` also work.
The GUI strings, goods names, history books and mission briefings are extracted in all four languages
when the mod supplies them; maps without a requested translation use their available source text.
Project-authored UI and fallback text live in `packages/app/src/i18n/catalogs/`.
The graphics settings (render scale, frame-rate limit,
post-processing) live in the stored settings and never enter the URL; `postfx=<on|off>` overrides
the stored post-fx choice for that entry, so captures stay reproducible whatever the machine's
settings. The HUD scales with the display's height (1.75x on a 2160-line display, never under 1x on a
smaller one, lowered to fit a small window) times the stored interface-scale setting, and a map opens at the same zoom (never under 1:1, without the setting) unless
`zoom=<n>` pins it; `uiscale=<n>` pins an absolute scale for reproducible diagnostics and is
not carried across menu/game switches. The menu's settings screen covers the player-facing options,
so direct query parameters are mainly for reproducible diagnostics.

For HUD checks, use `/?map=magiczny_las&intro=off` to load the map without dismissing the briefing.
For a playable match or victory checks, use `/?map=magiczny_las&ai=1,2,3,4,5&intro=off`:
without `ai=`, the other selectable seats are idle and do not count toward elimination, even though
their settlements remain on the map. Mission scripts still run in both cases, and recorded chapters
remain available from the mission book. Omit `intro=off` when testing the briefing itself.

The Graphics tab also owns five enhancements of the world view. They are stored settings, default on,
and apply to a running game without a restart. With all five off the world matches the previous
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
  silhouette when the page is unreadable or a budget is full. A map's first frame softens everything it
  shows; after it a bake the per-frame budget defers waits for a later frame, so switching the setting
  on over a town softens progressively rather than stalling one frame. Flat decor (bushes, mushrooms,
  and the dead trees that block no walking) draws its authored silhouette under every decor body
  whatever the setting. The per-frame soft bakes cannot batch into a decor mesh, so with the setting
  on its own mesh shader applies the same strength and colour and blurs the silhouette with the
  bake's kernel, reading only inside the frame's own texels.
- **Enhanced water** (`enhancedWater`): crossing swells, darker shallows and darker still deep water
  (the map's own two pattern families), a bluer and slightly more saturated colour, stronger on the
  deep family, and a glint band drifting over the deep water.
- **Environment motion** (`environmentMotion`): interpolates fish, smooths the breeze on own
  vegetation and adds that breeze to the tall trees the original ships as one still frame (its
  walk-blocking dead trees), whose cast shadows lean with them. That breeze belongs to the static map layer: a
  harvestable the sprite pool draws, which is every one after a save is restored, stands still.
- **Grounded buildings** (`groundedBuildings`): finished buildings, palisade posts and the maps' built
  stone walls stand in the ground instead of on it, an invented look rather than the original's. From
  the art alone the renderer finds where each wall meets the ground, sinks that foot a few pixels,
  darkens the wall toward it, shades the ground beside it and covers it with what the ground is along
  each stretch of the foot: a stain of its colour, tufts on grass, a drift on snow. The ground's
  colours come from the terrain's per-cell colours, so a presentation pack without them draws the
  original look, and whatever covers a wall's foot takes that wall's own light. A frame with no ground
  line, an unreadable page, or a full GPU budget draws as the original. A map's first frame grounds
  everything it shows; after it a bake the per-frame budget defers waits for a later frame, so
  switching the setting on over a town grounds it progressively. Construction stages, the
  placement ghost and a collapse draw the plain body.

Original humans and animals keep their tick anchors under every setting: the original engine moves
a walker only together with its walk frame, and moving the body inside a frame hold would drag the
planted foot. Original work, tree and building clips retain their authored images and durations: a
fractional clock does not invent frames. Own-art motion interpolation follows its authored binding
whatever the settings say. Projectiles, damage smoke, fades and building collapse already use
interpolated presentation clocks.

Debug modes:

- `debug=diag` records replay and state-hash diagnostics, and every 120 ticks checks the sim's
  invariants and logs any violation. In a worker session each delta also carries a digest of the
  entities it names, which the drawn mirror must match, and on the invariant ticks the mirror's indexes
  are checked against a fresh walk; either disagreement is logged on the `mirror` channel;
- `debug=perf` adds browser performance marks;
- `debug=trace` records a trace that can be exported for offline profiling;
- `debug=profile` accumulates per-system sim cost for the whole session;
- `debug=missions` shows saved mission execution ticks and counts in a collapsible inspector;
- `debug=notices` raises one notification of every type on the seat's own settlers and buildings once a
  second, so the column shows every row without staging its cause: `?scene=sandbox&debug=notices`. The
  notes stand until dismissed or their subject is gone, so the column's order stays put for a review.

Flags combine: `?debug=profile,trace` runs both.

A relayed session's diagnostics bundle carries `game.net.dispute`, the last desync verdict the client
took part in on either side: its role, tick, domains, the counterpart nicks and the digest fold inputs of
that tick. Given the diverged and the reference member's bundles, `npm run diag -- diff a.json b.json`
names the first fold input that differs: the rng state, the entity allocator, a fog word, or an entity's
component word, in fold order. It reads `packages/sim/dist`, so run `npm run build` first. Like `diff`,
it exits 0 when the retained inputs agree, 1 when it names a difference, and 2 when it cannot compare:
a bundle without a verdict or without inputs, verdicts for different ticks, unreadable JSON or a
missing build.

The on-canvas stats readout and the Admin / Debug palette are off by default: the "Debug tools"
toggle on the settings screen's Gameplay tab shows both, persists with the other settings, and applies
live inside a running game. A relayed session shows only the readout, since the palette's pokes are
trusted world edits with no wire.

A running game exposes `window.__opennorthland`. Besides the session `host` (the world as the runtime
reads it: `tick` and `snapshot()` synchronously, `await hashState()` for the hash and the tick it was
taken at, and `await run(ticks)`, which steps a paused session), the live
`renderer`, `sheet` and `cameraCtl`, it answers `await perf()` with one JSON-serialisable performance
report, so an automated probe reads numbers instead of screenshotting the on-canvas readout.
`resetPerf()` opens a fresh measurement window, and `setSpeed()` / `setPaused()` put the session into
a state worth measuring: `setSpeed(1)` gives a baseline the per-frame step cap cannot distort, and
pausing isolates the render half of a frame. The `?map=` entry runs its sim in a worker, which may
have stepped past the drawn tick, so `await setPaused(true)` before reading `host.tick` as the tick
the session stopped on. There `frame.simMs` and `window.simMsPerTick` time the worker's steps, and
`frame.receiveMs` and `window.receiveMsPerTick` this thread's cost of taking them in; the receive cost
counts message deserialization only in Chromium, which deserializes on the first read of the message,
so elsewhere it is the mirror apply alone. `window.batchesPerFrame` counts the tick messages a frame
took in, and `window.maxLeadTicks` how far the worker stepped past the drawn tick. The worker steps at
most the ticks of two frames and 50 ms of wall time, plus one, past the drawn tick (`leadTickLimit`),
so a slow main thread first costs frame rate and, past 250 ms frames, delivered speed, which shows in
`throughput.deliveredSpeed`; a sim slower than its clock shows in `droppedTicks`. Either way the
system menu shows delivered against requested speed once two consecutive windows, each with at least
half a second of unpaused running, deliver under nine tenths of the requested ticks. Read
`sampling.hidden` before trusting any timing: a background tab throttles its frame loop and every
millisecond becomes fiction.

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

The menu's backdrop stills are committed under `packages/app/src/assets/menu-backdrops/` as
2560x1440 JPEGs named after their map: a decoded map's settlement or landscape with no HUD and no map
edge in frame. The boot card shows the still the menu last showed. Replace a file there to change
the rotation, and keep `scripts/check-repository-assets.mjs` in step.

## Measuring performance

| question | reach for |
| --- | --- |
| what does the sim spend a tick on, and does it grow as the settlement develops? | `npm run bench:map` |
| which function inside that tick burns the time? | `npm run bench:profile` |
| which function makes a tick's garbage? | `ON_BENCH_PROFILE=alloc npm run bench:profile` |
| does one axis (settlers, fighters) drive a system's cost? | `npm run bench:sim` |
| did my change make it slower? | `npm run bench:compare` |
| does a world restored with cold caches step as the continuous one does? | `npm run bench:parity` |
| what does a live session spend a frame on, sim or render? | `?debug=profile` and `window.__opennorthland.perf()` |
| how does a developed checkpoint render at different speeds and zooms? | `npm run bench:browser` against a running development server |
| how much JavaScript does a URL mode download and parse before it starts? | the table `npm run build` prints |

Every report judges the machine that produced it. Numbers under an untrustworthy banner are void
rather than weak: re-run on an idle box instead of reading them.

A render change is checked pixel by pixel with `npm run bench:browser-shots -- capture <checkpoint>
<origin> <out-dir>` on each side and `npm run bench:browser-shots -- compare <dir-a> <dir-b>`: paused
world screenshots at zoom 1, 0.5, 0.35 and 2, optionally after `ON_BENCH_SHOT_STEPS` stepped ticks.

The headed browser benchmark consumes a normal `bench:map` checkpoint with its state-hash stamp:

```bash
npm run bench:browser -- bench-out/late.t100000.checkpoint http://127.0.0.1:5174 bench-out/browser 15
```

The arguments are checkpoint, development-server origin, output directory (default
`bench-out/browser`) and seconds per measurement window (default 15). Start the server separately in
this checkout. `ON_BENCH_BROWSER_MODE=baseline` runs only the baseline matrix;
`ON_BENCH_BROWSER_MODE=profile` runs only diagnostics; the default `all` runs both. Diagnostics
cover the dense and widest views at x3, each with its own CPU, allocation and GPU files.
`ON_BENCH_BROWSER_WINDOWS=dense:3,wide:0` replaces the baseline matrix with those `camera:speed`
windows (cameras `dense`, `zoom07`, `zoom05`, `wide`, `empty`), and `ON_BENCH_BROWSER_PROFILE_VIEWS`
names the diagnostic views. `ON_BENCH_BROWSER_CPU_THROTTLE=4` slows the main thread four times
through DevTools CPU emulation, the weak-CPU proxy for the frame. Chromium refuses the emulation for
workers, so the sim worker keeps full speed; the report records each thread's answer.
`ON_BENCH_BROWSER_SEAT=0` has the spectator watch that seat, so the frame draws through its fog and
fills its HUD figures as a played seat does. `ON_BENCH_BROWSER_WORKER_PROFILE=1` CPU-profiles the sim
worker through every baseline window, writing `<camera>-x<speed>-worker.cpuprofile` and adding the
worker's busy and sampled milliseconds and its heap after a forced collection to the window's report;
the sampling slows the worker, so read its `simMsPerTick` from an unprofiled run. The probe verifies
its checkout, client build and generated content, derives map,
seed, AI seats and rules from the checkpoint, and checks the restored hash before every condition.
It opens muted headed Chromium at 1440×900, device scale 1, with fullscreen disabled. Each window
restores the same state and warms for five seconds. Run it after other benchmarks finish on an idle
machine; recorded OS load and a repeated dense x3 window help assess stability, but do not certify
an idle machine or calibrate CPU speed. A window whose one-minute load per CPU exceeds 1.5 at either
boundary is invalid; the report distinguishes this from camera drift or browser failure. Platforms
without load-average support report the gate unavailable.

The baseline matrix covers a dense settlement at pause and x1/x3/x10; zoom 0.35 at pause and x3/x10;
zoom 0.7 and 0.5 at x3; an off-map camera at x3; and a repeated dense x3 window. `report.json` records
exact RAF interval quantiles, existing `perf()` figures, observed camera and canvas, tick ranges,
visibility, hardware and errors. The `perf().frame` CPU/draw figures are recent EMAs, while RAF
quantiles and the `perf().window` means (`cpuMsPerFrame`, `receiveMsPerFrame`, `drawMsPerFrame` and
its world-renderer share `worldMsPerFrame`, the rest being HUD, minimap, overlays and audio) cover the
whole window. Each window also counts the WebGL calls per rendered frame (`gl`: draws, texture binds, program
switches, buffer uploads and their KB), which weigh far more per call on integrated GPUs than here. A window hidden at any point is invalid. Screenshots identify the
chosen view. Camera gestures are suspended and input is blocked on the probe's page; every measured
RAF checks camera scale/offset, canvas dimensions and device scale for drift. Dense placement is
selected once from the greatest nearby building count, among the watched seat's own buildings when
one is watched.

Separate x3 windows write a CPU profile and allocation profile with summary tables and
elapsed time, ticks and frame counts. CPU sampling runs with a GPU timer query around the main Pixi
stage (world, HUD and weather)
submission when the browser exposes `EXT_disjoint_timer_query_webgl2`; disjoint results are discarded.
GPU capture has its own tick/time boundaries, stops before output writes, and drains outstanding
queries for at most twelve frames or two seconds, reporting discarded queries.
That GPU diagnostic excludes subsequent portrait/inset draws and compositor work. An unavailable
extension is reported explicitly. `perf().frame.gpuMs` is the RAF interval minus measured app CPU,
including idle time, vsync and compositor work; it is not a GPU execution measurement. Diagnostic
timings include instrumentation overhead and must not replace baseline measurements. Failures leave
metadata and completed windows in the output directory before the browser closes.
Browser errors and hidden or invalid windows make the command fail with a nonzero exit status.

The benchmarks run as plain Node programs over the compiled `dist/` of the workspace packages, with
no test runner in the process: a runner wraps every cross-module import, and that wrapper lands in a
CPU profile inside the sim's own frames. `bench:sim`, `bench:map` and `bench:profile` each rebuild the
workspace from scratch before measuring, so a bare run describes the working tree rather than whatever
was last built; `bench:compare` only reads two stored reports and runs on the build already there.

Run the synthetic simulation benchmark with `npm run bench:sim`. Its main controls are
`ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_HUNTERS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`,
`ON_BENCH_WINDOWS`, and `ON_BENCH_JSON`. `ON_BENCH_HUNTERS=120` adds hunting strips below the
settlements: most hunters on hare herds among dense wood nodes, a quarter on a sheep pasture beyond
the last-resort probe, so they chase livestock.

Run the real-map benchmark with `npm run bench:map`. It needs generated content and measures the
session a `?map=<id>&player=observer&ai=<seats>&seed=<n>&fog=classic` search describes, parsed by the map
entry's own URL adapter and built by its world builder, so the map's own computer seats play beside the named ones as they do in the
browser. `player=overseer` builds the same world whenever seat 0 is an AI seat. Its controls:

| knob | meaning |
| --- | --- |
| `ON_BENCH_MAP` | decoded map id, default `magiczny_las` |
| `ON_BENCH_SEATS` | `?ai=` seats: a count `n` names `0..n-1` (default 6), a comma list names the seats, `n,` the one seat `n` |
| `ON_BENCH_TRIBES`, `ON_BENCH_SEED` | `?tribes=` as the search spells it (`0:4,1:2`; unset keeps the authored tribes) and `?seed=` (default 7) |
| `ON_BENCH_PROGRESSION`, `ON_BENCH_NEEDS` | `on`/`off`, the `?progression=` and `?needs=` overrides; unset keeps the map's rule |
| `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS` | measured ticks (default 20k), unmeasured warm-up, report segments |
| `ON_BENCH_SYNC_DIGEST` | fold the per-tick sync digest, what a networked session pays |
| `ON_BENCH_ASSERTS` | `on` keeps the sim's fixed-point overflow asserts; unset runs without them, as the production build does, so the numbers describe the shipped game. Tests and the dev server always run them |
| `ON_BENCH_MIRROR` | `on` measures the snapshot delta path per delta (take, V8 serialize and deserialize as `postMessage` does them, mirror apply bare and with the indexes the runtime's frame reads, serialized size) and checks the mirror against the live snapshot and its indexes against a fresh walk at each window's end; that check and its full-snapshot clone add GC to the next window |
| `ON_BENCH_MIRROR_BATCH` | ticks per delta under `ON_BENCH_MIRROR` (default 1), the batching a worker does when several ticks reach one frame |
| `ON_BENCH_MIRROR_SPLIT` | `on` under `ON_BENCH_MIRROR` times each frame index reader (`FRAME_INDEX_READERS`) on a mirror of its own and reports its median upkeep over a bare apply of the same delta |
| `ON_BENCH_MIRROR_PARITY` | `on` under `ON_BENCH_MIRROR` draws each delta's span from 1 to 7 ticks and checks the indexes against a fresh walk after every delta; a difference fails the run |
| `ON_BENCH_MIRROR_BREAKDOWN` | `on` under `ON_BENCH_MIRROR` lists per window what the deltas are made of, per component: writes per delta, the share that rewrote an equal value or created the entity, the kilobytes they carry and the record fields that changed most; tallied outside the timings, its garbage lands in the tick GC columns |
| `ON_BENCH_MIRROR_DIGEST` | `on` under `ON_BENCH_MIRROR` has the deltas carry the `debug=diag` truth digest: take includes the worker's fold, `truth` samples the main thread's check, and a mismatch fails the run |
| `ON_BENCH_CHECKPOINT`, `ON_BENCH_SKIP`, `ON_BENCH_CHECKPOINTS` | checkpoints, below |
| `ON_BENCH_JSON` | where the report is written instead of `bench-out/` |

`ON_CONTENT_DIR` points it at a content directory outside the checkout. `ON_BENCH_TICKS=50000` covers
a full AI build-out. Per system the report gives the mean, median, p95 and max per tick and the share of
the summed time; a system that works one tick in many, such as an AI seat every 48 ticks, ranks by its
mean, where its median would read as free. Each window reports the tick median, p95, p99 and max, the settlers, fighters
(soldier and hero jobs) and buildings alive at its end, the GC pause time, count and longest pause from
V8's `gc` entries, and heap and RSS at its end; the run lists its ten slowest ticks by sim tick with
the three systems that filled each.

`npm run bench:profile` runs that same world and CPU-profiles the measured ticks, printing the top
functions by self time and by total time (self plus callees) and the top files next to the per-system
table for the same ticks, and writing the raw `.cpuprofile` under `bench-out/`, named with the map, the
AI seats and the first profiled tick, for DevTools or Speedscope. The profiled code is the `tsc`
output, unminified and source-mapped, so function names and `file:line` survive. It takes the
`bench:map` controls except `ON_BENCH_WINDOWS`, `ON_BENCH_JSON` and `ON_BENCH_CHECKPOINTS`, and
defaults to 2k ticks. It prints its per-system report rather than storing it: profiled timings are
inflated by the sampler and must never become a `bench:compare` baseline. `ON_BENCH_PROFILE=alloc`
samples allocations instead of CPU, garbage included: the same tables in kilobytes, the kilobytes a
tick allocates, and a `.heapprofile` for DevTools' Memory panel. It answers which function makes the
garbage the `bench:map` GC columns pay for. The profile lists every sample, so a late-game run that
allocates tens of gigabytes overflows the inspector's reply: widen the sampling with
`ON_BENCH_ALLOC_INTERVAL` (bytes between samples, default 4096) or profile fewer ticks.

Both real-map benchmarks take a checkpoint so a late-game hotspot hunt does not rebuild the
settlement every time:

```bash
ON_BENCH_CHECKPOINT=/tmp/late.checkpoint ON_BENCH_SKIP=40000 npm run bench:profile
```

The first run builds the world, runs `ON_BENCH_SKIP` ticks unmeasured, writes the checkpoint and
measures; every later run with the same path restores it and measures from there (warm-up still
applies - restored code is cold again). `ON_BENCH_CHECKPOINTS` lists absolute sim ticks at which a
`bench:map` run also writes `<stem>.t<tick>.checkpoint`, the stem being `ON_BENCH_CHECKPOINT` without
its `.checkpoint`. A write happens between two measured ticks, outside their timing, but its garbage
lands in that window's GC columns. A checkpoint holding another map, seed, other AI seats, tribes, rules or
another content IR version is refused by name rather than measured, and a restore that does not
reproduce the state hash the checkpoint was written with fails.

One 60k run of the twelve-player map under AI that leaves every late-game starting point behind, then
a profile from the 50k one (the profile repeats the session knobs the checkpoint is checked against):

```bash
export ON_BENCH_MAP=magiczny_las_12_players ON_BENCH_SEATS=0,1,2,3,4,5,7,8,9,10,11,12 \
  ON_BENCH_PROGRESSION=on ON_BENCH_NEEDS=on
ON_BENCH_TICKS=60000 ON_BENCH_WINDOWS=12 ON_BENCH_CHECKPOINT=bench-out/ml12.checkpoint \
  ON_BENCH_CHECKPOINTS=10000,20000,30000,40000,50000,60000 npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/ml12.t50000.checkpoint npm run bench:profile
```

`npm run bench:parity` takes the same session knobs and checkpoint. One world runs `ON_BENCH_TICKS`
(default 3000) ticks and records its hash every 50; its save at `ON_BENCH_PARITY_POINTS` (default 12)
evenly spaced ticks, around the first heavy link pass, AI decision and planner tick of the second half,
and at any absolute ticks `ON_BENCH_PARITY_AT` lists, is restored into a fresh world that must reproduce
every later hash. A divergence names its tick and fails the run; bisect it with `npm run diag -- diff`.
`ON_BENCH_PARITY_FRESH=on` instead builds the world twice from tick zero and compares the runs.

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
everyone is. The creator's lobby card links the next player in a new tab, its room and a free nick
filled in. A `nick=` in the URL gets its own reconnect token for that relay, so tabs of one browser
play as different people and a reload rejoins the same seat; without one, the tab uses the menu's
identity. Enter opens the
chat line. The perf overlay's third line and `perf().net` carry the round trip, the assigned input
delay, the click-to-apply time and the jitter buffer's depth. The runtime has no write access to the
world, so a forced divergence for a resync check runs in the headless multi-client harness under
`packages/net-server/test/support/`, not from a browser console.

## Build version

`ON_VERSION=1.2.3 npm run build` stamps a semantic version into the main menu's version line and
writes `version.json` beside `index.html`: `version`, `build` (the entry script, which changes with
any rebuild) and `restore` (a hash of the client sources and `content/ir.json`, null without content).
Without `ON_VERSION` the version reads `dev`. A released web tab polls `version.json` (`src/update/`)
and, when the host serves another `build`, reloads from the menu, offers a local game a reload that
resumes it when `restore` matches, and returns to the menu when the relay closes with
`CLOSE_SERVICE_RESTART`. To try it, serve one build, open a tab, rebuild with another `ON_VERSION`
into the same `dist/`. The relay image takes its identifier as `--build-arg RELAY_BUILD=...` and
reports it on `/healthz`.

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
README logo and the main menu lockup, all from the stacked lockup and the emblem. Edit a master, run
the command and commit the outputs together. Sizes up to 32 px, including the favicon, come from
`emblem-small.svg`, a flat drawing of the same shield, because the painted longship turns to mud
that small, and 16 px from `emblem-16.svg`, the same drawing placed pixel by pixel;
`emblem-mono.svg` is the single-colour ship for badges and print. The macOS `icon.icns` sets the
emblem on a rounded square, the shape macOS expects; Windows and Linux get the bare shield. The
horizontal lockup and the wordmark are kept for the website and press material; the build does not
use them. The script fails on a master drawn up to its canvas edge, which means the generator
cropped it.

## Web image

The web image is the web app of a commit: nginx serving `packages/app/dist` and `content/` from one
document root, the app at `/`, the hashed `/assets/` cached for good, everything else revalidated, a
missing path a plain 404, and `/healthz` for the host. `deploy/web/Dockerfile` copies the two prebuilt
trees without rebuilding them. The nginx master and workers run as the unprivileged `nginx` user;
PID and temporary files live under `/tmp`, while configuration and served files remain root-owned.
The image supports a read-only root filesystem with a writable `/tmp` tmpfs.

To build and run the image locally, after `npm run build` with a `content/` in place:

```bash
npm run web:image
docker run --rm --publish 8080:80 open-northland-web
```

The internal port remains 80. Docker permits unprivileged binds by default; runtimes that restrict
low ports need `net.ipv4.ip_unprivileged_port_start=0` in the container network namespace.

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
| `RELAY_BUILD` | unset | Build identifier reported by `/healthz` and `welcome` (a printable line, at most 128 characters); set by the `RELAY_BUILD` build argument |

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
