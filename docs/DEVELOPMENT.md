# Development reference

This page collects commands and local-only tools. The design rules live in [`AGENTS.md`](../AGENTS.md)
and the test strategy in [`TESTING.md`](TESTING.md).

## Common commands

```bash
npm ci                  # install the locked dependency set
npm run dev             # browser development server
npm run desktop         # Electron development build
npm run build           # typecheck and build the browser app
npm test                # normal Vitest suite
npm test -- scenario    # tests matching a name
npm run test:watch      # watch mode
npm run check           # Biome formatting and lint checks
npm run check:fix       # apply safe formatting and lint fixes
npm run check:docs      # validate Markdown and ticket links/contracts
npm run tickets:list    # priority-sorted ticket view
```

Use `npm install` only when dependencies or the lockfile need to change.

`dev` and `shot` compile the workspace packages before starting Vite, which resolves every
`@open-northland/*` import to that package's `dist/`. A running server keeps serving the build it
started with: restart it after changing sim, render, data, or audio source.

## Local game content

Generate content from your own game installation:

```bash
npm run pipeline -- --game "../Cultures 8th Wonder" --out content
```

The pipeline detects `DataCnmd/` inside the game directory. Pass `--mod-root <dir>` when the
CulturesNation mod is unpacked elsewhere. CnMod 1.3.1 is the current verified input; treat a newer
release as unverified until the real pipeline and content gates pass. The generated `content/` tree
is ignored by Git.

Local content gates:

```bash
npm run test:content
npm run test:pipeline
```

`test:content` checks consumers against an existing `content/` directory. `test:pipeline` performs a
fresh conversion into a temporary directory and validates the result. It uses
`CULTURES_GAME_DIR` and, when needed, `CULTURES_MOD_ROOT`.

## Browser entries

`npm run dev` opens the main menu. With `content/backdrops/` present (see `npm run menu-backdrops`
below) the menu rotates captured settlement stills behind the grade; without them the static brand
art stands in. Direct entries are useful during focused work:

| URL query | Purpose |
| --- | --- |
| `?scene=<id>` | registered deterministic acceptance scene |
| `?map=<id>` | decoded map |
| `?anim` | character animation gallery |
| `?icons` | decoded sprite-frame gallery |
| `?sounds` | sound-binding gallery |
| `?shot` | single-frame screenshot entry used by the harness |
| `?backdrop=<id>` | one ambient-settlement frame of a decoded map, used by the menu-backdrop harness |

Common modifiers include `lang=<pol|eng>`, `fog=<...>`, `player=<...>`, `ai=<...>`, and
`sound=off`. Without `lang` the language follows the browser, and English stands in for a browser
language with no shipped catalog. The graphics settings (render scale, frame-rate limit,
post-processing) live in the stored settings and never enter the URL; `postfx=<on|off>` overrides
the stored post-fx choice for one session, so captures stay reproducible whatever the machine's
settings. The HUD scales from the canvas height sampled at game start times the stored
interface-scale setting; `uiscale=<n>` pins an absolute scale for reproducible diagnostics and is
not carried across menu/game switches. The menu's settings screen covers the player-facing options,
so direct query parameters are mainly for reproducible diagnostics.

Debug modes:

- `debug=diag` records replay and state-hash diagnostics;
- `debug=perf` adds browser performance marks;
- `debug=trace` records a trace that can be exported for offline profiling;
- `debug=profile` accumulates per-system sim cost for the whole session.

Flags combine: `?debug=profile,trace` runs both.

A running game exposes `window.__opennorthland`. Besides the live `sim`, `renderer`, `sheet` and
`cameraCtl`, it answers `perf()` with one JSON-serialisable performance report, so an automated probe
reads numbers instead of screenshotting the on-canvas readout. `resetPerf()` opens a fresh measurement
window, and `setSpeed()` / `setPaused()` put the session into a state worth measuring: `setSpeed(1)`
gives a baseline the per-frame step cap cannot distort, and pausing isolates the render half of a
frame. Read `sampling.hidden` before trusting any timing: a background tab throttles its frame loop
and every millisecond becomes fiction.

## Screenshots

Create a deterministic screenshot:

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Useful options are `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, and `--no-hud`.
Screenshots still need human review.

Regenerate the menu-backdrop stills (the curated framings live in
`packages/app/scripts/menu-backdrops.mjs`):

```bash
npm run menu-backdrops
```

It boots each curated map through `?backdrop=<id>` and writes JPEGs into `content/backdrops/`,
which the menu rotates through. The stills render decoded original art, so they are gitignored
content, never repository files; re-run the command after `npm run pipeline`.

## Measuring performance

| question | reach for |
| --- | --- |
| what does the sim spend a tick on, and does it grow as the settlement develops? | `npm run bench:map` |
| does one axis (settlers, fighters) drive a system's cost? | `npm run bench:sim` |
| did my change make it slower? | `npm run bench:compare` |
| what does a live session spend a frame on, sim or render? | `?debug=profile` and `window.__opennorthland.perf()` |

Every report judges the machine that produced it. Numbers under an untrustworthy banner are void
rather than weak: re-run on an idle box instead of reading them.

`bench:sim` and `bench:map` each rebuild the workspace from scratch before measuring, so a bare run
describes the working tree rather than whatever was last built.

Run the synthetic simulation benchmark with `npm run bench:sim`. Its main controls are
`ON_BENCH_SETTLEMENTS`, `ON_BENCH_FIGHTERS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS`,
and `ON_BENCH_JSON`.

Run the real-map benchmark with `npm run bench:map`. It needs generated content and its controls are
`ON_BENCH_MAP`, `ON_BENCH_SEATS`, `ON_BENCH_TICKS`, `ON_BENCH_WARMUP`, `ON_BENCH_WINDOWS`, and
`ON_BENCH_JSON`. `ON_CONTENT_DIR` points it at a content directory outside the checkout. The default
run is 20k ticks; `ON_BENCH_TICKS=50000` covers a full AI build-out.

Every run keeps its report under `bench-out/` (untracked), so a baseline exists without having been
planned for. `npm run bench:compare` with no arguments compares the two most recent runs of the same
world; `npm run bench:compare -- before.json after.json` names two explicitly, and `ON_BENCH_JSON`
overrides where a run writes.

## Desktop packaging

```bash
npm run desktop
npm run desktop:dist
```

The packaged app stores generated content in the user's application-data directory. It never writes
playable content into the repository or application bundle.
