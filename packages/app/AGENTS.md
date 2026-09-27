# App package contract

`packages/app` is the browser shell. It translates input into sim commands, advances a
`@open-northland/lockstep` session driver from the frame loop, and gives snapshots and events to
render, audio, and the HUD. For the `?map=` and `?relay=` entries a worker owns the simulation, the
session driver and the clock; the main thread owns the mirror, the renderer and the HUD. It is the
only package allowed to host both a simulation and a renderer. Audio may use the pure
`@open-northland/render/data` projection helpers.

The root [`AGENTS.md`](../../AGENTS.md) still applies.

## Boundaries

- Browser APIs, I/O, wall-clock time, and presentation floats belong here, not in sim.
- The sim stays single-threaded and synchronous inside its worker: no parallel section inside a tick.
  The renderer stays on the main thread and interpolates the mirror; rendering in a worker would split
  one Pixi scene between two threads without making a frame cheaper. Worlds cross to the main thread
  over `postMessage` as per-tick deltas of written components after an opening rebuild that carries
  every entity whole (as does a rebuild after the touched log overflows); a full structured clone of a
  developed map costs hundreds of milliseconds, a delta a few. `SharedArrayBuffer` is not used.
- Submit a running session's state changes through the session driver's `submit()` in a seat or admin
  envelope, and pre-tick world assembly through `sim.enqueueSetup()`. Tempo and pause are session clock
  operations, not loop fields. Do not mutate live component stores from UI or renderer glue.
- The runtime reads the world through `src/session/` `SessionHost` alone. Per-frame reads answer
  synchronously off a delta-fed `SnapshotMirror` and the facts the host keeps beside it, so a snapshot
  kept past the next tick copies its entity list. Probes and request-shaped reads answer Promises of
  cloneable data; a consumer that must read one synchronously goes through a `LastAnswerCache` and
  keys its memos on the cache's version as well, so an answer that lands under an unchanged snapshot
  still shows. A click never orders on a last answer: it awaits the host's answer as of now.
  A kind subset, an owner's entities, a per-key group or count and the actors come from the indexes the
  mirror maintains per change (`indexesOf`, `entitiesWith`, `groupedBy`, `countedBy` in `@open-northland/sim`;
  `actorsOf` and the group readers in `game/snapshot-base.ts`), never from a per-tick walk over
  `snapshot.entities`. A walk is for a click, an order or a one-off setup. An index the frame reads
  joins `FRAME_INDEX_READERS` (`view/projections/frame-indexes.ts`, render's own beside its readers),
  which the mirror probe registers to measure the upkeep.
- `Simulation` is constructed and typed only by hosts: the entries' world builders, scenes,
  `game/sandbox/`, `game/world/`, the inline host, and in `session/worker/` the served session, its
  facts and the network worker's world port; the `biome.json` override lists them. The inline host
  serves scenes and tests. `entries/shot.ts` and one-off sims, such as a sub-mission's restore check,
  step their `Simulation` on the main thread with no host.
- Two worker entries run a world off the main thread, and in both the worker steps at most
  `leadTickLimit`, about two of the runtime's frames, past the delivered tick. `entries/map/sim-worker.ts`
  serves the `?map=` world over the loopback transport, so its clock slows to what the runtime draws.
  `entries/relay/net-worker.ts` starts with a `NetworkConnection` and owns the relay link, the
  `RelayClient` and each world the client adopts. There the relay runs the clock: a runtime that
  draws too slowly leaves the client's acknowledgements behind, and its load (`TickCostSink` in
  `session/worker/serve.ts`) carries what a tick costs the display, so the relay governs the room
  for it. A hidden tab draws nothing: it stops acknowledging and is listed slow, but its last load
  is a drawing one, so the room runs on while its kick countdown runs, and it catches up on return.
- No relayed world's `Simulation` is referenced on the main thread. The main thread reads the client
  through `RelayClientMirror` (the relay messages the worker's client applied, and its facts), each
  adopted world through that world's `WorkerSession`, and matches a save to the running world by
  `worldId`.
- Load generated content through `src/content/net.ts` by its root-relative URL and validate it with
  the `@open-northland/data` schemas. A checkout without `content/` must still boot using synthetic
  fallback content or a clear unavailable state.
- Keep `main.ts` and `launch.ts` a small URL dispatcher. Entry modules assemble their mode and share
  the common game runtime. Reach them only through the `src/routes.ts` thunks: a static `entries/`
  import anywhere in the shell puts every mode back into the first download, which the build's size
  report shows but does not block.
- A world is assembled from the session descriptor alone, never from the local seat: two clients of
  one relayed session must enqueue the same setup. The `?relay=` entry assembles the shared map boot
  on the main thread when the worker's client asks for a world, and posts its inputs to the network
  worker, which builds, adopts and serves it.
- The menu hands over to a game through `swapToEntry`, never by assigning `window.location`. A
  document navigation ends the browser's fullscreen grant, and the next document can only take it
  back on the player's next click. Entries that still navigate owe the player that flash.

The supported development entries and debug flags are documented in
[`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md). Add a new entry only when it is a distinct mode,
not as a shortcut around normal UI.

## Content and scenes

`src/content/` adapts decoded files to sim, render, and audio. Keep network loading separate from pure
joins so the join can be tested headlessly.

`src/catalog/` is committed fallback data. `src/game/sandbox/` assembles the shared fallback
`ContentSet`. Scenes consume that shared content and define setup only; they do not copy jobs, goods,
buildings, or animation rules.

For player-visible mechanics, add a registered scene when it provides useful acceptance coverage.
Each scene needs headless checks, localized menu text, and a human browser pass. See
[`docs/SCENES.md`](../../docs/SCENES.md).

## Presentation packs

World art that replaces the original's enters through `src/presentation/pack.ts`. A checkout that adds
its own art supplies `src/custom/`, `vite/custom/plugins.ts` and `scripts/custom-art-policy.mjs`,
which the pack seam, `src/routes.ts`, `vite.config.ts` and `check:assets` load when present. This
repository never contains them. Keep those hooks and the pack interface working, and keep the
original-art path complete without a pack.

## Graphics settings

Player-facing graphics options belong in the shared Graphics settings, with persisted defaults,
localized labels, and an explicit next-game hint when they cannot apply live. World smoothing must
not change HUD text rendering.

## Diagnostics

Use `src/diag/` instead of ad hoc logging:

- `diag.warn(channel, message, data?)` writes to the bounded diagnostic ring;
- `debug=diag` records state-hash diagnostics;
- `debug=perf` emits browser performance measures;
- `debug=trace` records an exportable trace;
- `debug=profile` accumulates per-system sim cost in constant memory.

`?debug=` is a comma-separated set. The sim exposes one instrument slot, so every consumer of it is
fanned out from `installSessionInstruments`, the one caller of the host's `installInstruments`.

`window.__opennorthland.perf()` is the machine-readable performance seam an automated probe reads
instead of the on-canvas overlay. It answers a Promise, since the per-system rows are kept where the
sim runs. Keep it JSON-serialisable: it is returned through `page.evaluate`, which throws on anything
that does not survive structured cloning.

Do not add raw `console.*` calls to app source. A diagnostic report must remain bounded and safe to
serialize. Replays rebuild the named entry/world, discard setup enqueues already represented by that
world, then apply the recorded command log to the stored tick.

## Structure

Group code by user-facing concern:

- `entries/`: top-level URL modes;
- `session/`: the host interface the runtime reads the world through, the inline host, the worker host
  (`session/worker/`) and the last-answer cache;
- `view/runtime/`: shared playable runtime, frame loop and the host's cached answers;
- `content/`: generated-content loaders and pure bindings;
- `catalog/` and `game/sandbox/`: fallback content and rules;
- `game/world/`: the deterministic worlds a playable entry builds over decoded or fallback content;
- `hud/`: interface models, layout, drawing, and controllers;
- `scenes/`: deterministic acceptance setups;
- `diag/`: logging, crash reports, replay diagnostics, and performance instrumentation.

Do not extend this list with a file-by-file inventory. The tree and local barrels are the current
source of truth.

## Performance and verification

- `bench/` holds the benchmark programs. `tsconfig.bench.json` compiles them, and the two real-map
  test helpers they share, into `dist/` beside the package's own output; that output is rooted at the
  package rather than at `src/`, so a compiled helper's `../../src/...` import still resolves.
- Snapshot at the normal runtime seam; do not clone or scan the full world again in individual HUD
  controls. A control that needs a subset or an aggregate reads or defines a snapshot index.
- Cache decoded assets and joins by stable inputs.
- Do not cache small images as one canvas each. Chrome backs every 2d canvas, `OffscreenCanvas`
  included, with its own GPU surface until garbage collection; thousands of them exhaust macOS
  surfaces and lose the map's WebGL context. Pack them onto a shared page or keep `ImageBitmap`s
  and `close()` them on eviction.
- Keep viewport-driven work screen-bounded.
- Accumulate events from every sim step in a display frame before handing them to audio or effects.
- Test pure layout, content joins, and input decisions without a browser where possible.
- Run `npm run test:content` for changes that consume generated maps or IR rows.
- Use the screenshot harness for reproducible input, then ask a human to judge visual output.
