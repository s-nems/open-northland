# App package contract

`packages/app` is the browser shell. It translates input into sim commands, runs the frame loop over
a `@open-northland/lockstep` session driver, and gives snapshots and events to render, audio, and the
HUD. It is the only package allowed to
own both a live simulation and a renderer. Audio may use the pure `@open-northland/render/data`
projection helpers.

The root [`AGENTS.md`](../../AGENTS.md) still applies.

## Boundaries

- Browser APIs, I/O, wall-clock time, and presentation floats belong here, not in sim.
- Submit a running session's state changes through `LockstepDriver.submit()` in a seat or admin
  envelope, and pre-tick world assembly through `sim.enqueueSetup()`. Tempo and pause are session clock
  operations, not loop fields. Do not mutate live component stores from UI or renderer glue.
- Read the world through snapshots and explicit simulation probes.
- Load generated content through `src/content/net.ts` by its root-relative URL and validate it with
  the `@open-northland/data` schemas. A checkout without `content/` must still boot using synthetic
  fallback content or a clear unavailable state.
- Keep `main.ts` and `launch.ts` a small URL dispatcher. Entry modules assemble their mode and share
  the common game runtime. Reach them only through the `src/routes.ts` thunks: a static `entries/`
  import anywhere in the shell puts every mode back into the first download, which the build's size
  report shows but does not block.
- A world is assembled from the session descriptor alone, never from the local seat: two clients of
  one relayed session must enqueue the same setup. The `?relay=` entry runs the shared map boot
  through `@open-northland/net-client`, which is the session driver and clock there.
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
fanned out from `installSessionInstruments`; do not call `setInstrument` a second time.

`window.__opennorthland.perf()` is the machine-readable performance seam an automated probe reads
instead of the on-canvas overlay. Keep it JSON-serialisable: it is returned through `page.evaluate`,
which throws on anything that does not survive structured cloning.

Do not add raw `console.*` calls to app source. A diagnostic report must remain bounded and safe to
serialize. Replays rebuild the named entry/world, discard setup enqueues already represented by that
world, then apply the recorded command log to the stored tick.

## Structure

Group code by user-facing concern:

- `entries/`: top-level URL modes;
- `view/runtime/`: shared playable runtime and frame loop;
- `content/`: generated-content loaders and pure bindings;
- `catalog/` and `game/sandbox/`: fallback content and rules;
- `game/world/`: the deterministic worlds a playable entry builds over decoded or fallback content;
- `hud/`: interface models, layout, drawing, and controllers;
- `scenes/`: deterministic acceptance setups;
- `diag/`: logging, crash reports, replay diagnostics, and performance instrumentation.

Do not extend this list with a file-by-file inventory. The tree and local barrels are the current
source of truth.

## Performance and verification

- Snapshot at the normal runtime seam; do not clone or scan the full world again in individual HUD
  controls.
- Cache decoded assets and joins by stable inputs.
- Keep viewport-driven work screen-bounded.
- Accumulate events from every sim step in a display frame before handing them to audio or effects.
- Test pure layout, content joins, and input decisions without a browser where possible.
- Run `npm run test:content` for changes that consume generated maps or IR rows.
- Use the screenshot harness for reproducible input, then ask a human to judge visual output.
