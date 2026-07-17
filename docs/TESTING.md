# Testing & the agent feedback loop

This project is built largely by LLM agents. An agent is only as good as its ability to **check its
own work**. The architecture is shaped to make that possible: because the simulation is
**deterministic and headless**, almost everything that matters can be validated by running
`npm test` and reading pass/fail — no screen, no human in the loop. The one exception (pixels /
"feel") is called out explicitly so an agent never *claims* it when it can't prove it.

## The core principle

> If a change can break the game, there must be a test an agent can run that fails when it does.

The sim mutates state **only** through serializable commands, advances in fixed deterministic
ticks, and exposes a canonical `hashState()` over all components. That gives us, for free:
same-seed reproducibility, replay, faster-than-real-time runs, and the ability to localize the
exact tick a regression appears. Lean on it.

## The pyramid (all levels run under `npm test` / vitest)

### 1. Unit — pure functions & single systems
Fast, many, no `Simulation`. Targets: `fixed.ts` math (and its overflow assertions), `rng.ts`
reproducibility, the ECS (`world.ts`) query/insertion-order contract, and **one system over a
hand-built world** (e.g. `movementSystem` advances positions by velocity).
See `packages/sim/test/core/determinism.test.ts`.

### 2. Integration — many systems over many ticks
Build a `Simulation` from the synthetic `testContent()` fixture, run hundreds of ticks, and assert:
- **Determinism:** two sims, same seed + inputs ⇒ identical `hashState()`.
- **Invariants** (`src/harness/invariants.ts`): no negative stock, hunger in range, building sanity — and
  domain laws as they land: **goods conservation** (goods are created only by production, destroyed
  only by consumption), **liveness/no-deadlock** (some settler makes progress each interval),
  **path validity** (waypoints are walkable cells).
See `packages/sim/test/core/scenario.test.ts`.

### 3. E2E at the game level — headless scenarios (the key agent layer)
The `scenario()` harness (`src/harness/scenario.ts`) scripts the **same commands the UI issues**
(place building, spawn settler, set production), runs the deterministic sim for N ticks, and
asserts outcomes plus invariants **after every tick** (so a failure reports the exact breaking
tick, not just "something's wrong at the end"). This exercises the whole game loop —
placement → AI → atomic actions → economy → population — as an ordinary test an agent runs itself.

```ts
scenario(content)
  .placeBuilding('headquarters', 10, 10)   // a serializable CommandSystem command
  .spawnSettler('woodcutter')
  .run(2000, { checkInvariantsEachTick: true })
  .expect('settlement produced planks', (sim) => totalGood(sim, PLANK) > 0)
  .assertOk();
```

### 4. Save/load & replay equivalence
Two deterministic checks, both headless:
- **Replay:** run a command log from seed → state A; replay the same log → state B; `A === B`.
- **Snapshot round-trip:** run K ticks, snapshot, run K more → hash H; reload the snapshot, run K
  more → hash H′; assert `H === H′`. This guards the save format and any hidden nondeterminism.

### 5. Golden traces — behavioral regression
Beyond state hashes, record the **canonical sequence of atomic actions** a settler performs in a
fixed scenario (e.g. `[walk, harvest, pickup, walk, pileup, …]`) and diff against a committed
golden. When AI/economy tuning changes behavior, the diff is human/agent-readable — far more
useful than "hash changed." Intentional change → update the golden in the same commit.

### 6. Command-stream fuzz — determinism over inputs the goldens never construct
The goldens pin ONE curated scenario; nondeterminism and command-validation bugs hide in the input
space they never reach. `packages/sim/test/core/fuzz-determinism.test.ts` drives the real `step()`
schedule with **seeded-random command streams** — deliberately including invalid commands (unknown
type ids, stale or wrong-kind entity targets, tech-gated placements), since in lockstep any peer
can send anything and rejection must be deterministic — and asserts, per stream: two live runs are
byte-identical at hash checkpoints; replaying the recorded log reproduces the final hash; the core
invariants (including cache re-derivation, `cachesCoherent`) hold every tick. A failure reproduces
from the fuzz seed. New command variants belong in its generator the same commit they land.

## Running & debugging tests

All levels run under `npm test` (vitest). For the inner loop:
- **One file/suite:** `npm test -- scenario` (a name-substring filter) — e.g. `npm test -- hygiene`
  for just the determinism scan, `npm test -- determinism` for the unit goldens.
- **Watch mode:** `npm run test:watch` typechecks once, then re-runs Vitest on save while you iterate.
- **Typecheck only:** `npm run typecheck` builds and checks workspace sources plus every test/support
  source without emitting test artifacts. `npm run build` adds the production Vite bundle.

**Debug a failing invariant.** Integration/scenario invariants assert *after every tick*, so a
failure names the **exact tick** it broke (`… at tick N`). Re-run that one scenario, narrow to that
tick, and inspect — don't re-read the whole run. A determinism failure (two same-seed runs diverge)
means a nondeterministic global or a `Map`/`Set` iteration leaked into a game decision: the hygiene
test catches the global class, the hash-divergence test catches the rest.

**Updating a golden** (state-hash or atomic-trace) is a deliberate act, never a reflex: confirm the
diff is exactly the mechanic you intended (a pure refactor must move *no* golden), update the
expected value in the same commit, and name the mechanic in the commit message. Full golden
discipline: `packages/sim/AGENTS.md` ("Proving your change").

## What an agent CANNOT self-validate (be honest)

- **Pixel fidelity & "feel"** — isometric depth-sort correctness, animation anchors, pathing
  smoothness. Approaches: (a) **deterministic Playwright screenshots** an agent eyeballs for
  *gross* correctness (blank screen, missing terrain, sprites in the wrong iso half) — see
  *Visual validation via Playwright* below; (b) explicitly defer to a human and *say so* rather
  than asserting it works from a green typecheck. Either way: never auto-pass a render result.
- **Asset-decode correctness** — use decoder round-trip tests against tiny locally generated
  fixtures, inspect decoded dimensions and metadata, and compare locally rendered output with the
  running original when visual fidelity matters. Never commit copyrighted fixtures or output.
- **Behavioral fidelity to the original** — the pyramid proves the sim is self-consistent and
  deterministic *against the synthetic fixture*; it does **not** prove a mechanic behaves like
  *Cultures*. There is no automatic mechanics oracle. Faithfulness
  is pinned to extracted data, readable `.ini` semantics, byte-level format evidence, published
  specifications, or calibration by observation. Record that basis in the code, test, commit, or relevant plan progress
  note. Green + deterministic != faithful.

### Visual validation via Playwright — the decision (and why not the MCP)

Playwright closes *part* of the pixel gap — deliberately, and as a **committed script, not the
Playwright MCP**:

- **The lever is agent vision, not Playwright.** A deterministic screenshot is something an agent
  *can* look at and judge for **gross** correctness; the sim's determinism makes that frame a
  reproducible input. Playwright is just the cheapest way to produce the frame. Fidelity and
  "feel" (sub-pixel anchor drift, pathing smoothness) still need human eyes.
- **Committed `npm run shot` script, not the MCP.** The Playwright MCP's edge — accessibility-tree
  snapshots + click-by-role — is **blind to a `<canvas>`**, and the game is one canvas with no
  inner DOM (Canvas-2D, then Pixi/WebGL). So the MCP collapses to "a screenshot, statefully,
  outside git." A committed script is reproducible, lives in the repo, runs in CI, and can graduate
  to golden-image diffs. (The MCP is fine for a one-off "boot it and look," never the backbone.)
- **Prerequisite — a deterministic, headless render entry (now built).** The harness needs *"render
  scenario X at seed S, advance N ticks, draw one frame, then signal ready"* — not the wall-clock
  `requestAnimationFrame` loop. That entry now exists: `packages/app/src/entries/shot.ts` (`?shot[&seed&ticks]`)
  builds the vertical slice (`vertical-slice.ts`), steps a fixed N ticks, draws ONE frame via the Pixi
  renderer (`packages/render/src/gpu/pixi-app.ts`), and sets `window.__opennorthlandShotReady`. `npm run
  shot` (`packages/app/scripts/shot.mjs`) boots the app's Vite dev server, drives Chromium via the
  committed Playwright script, waits on that flag, and writes a PNG (`--seed/--ticks/--out`). The
  renderer draws placeholder geometry (iso tile diamonds + feet-anchored body boxes) — atlas sprites
  are a later leg, since real bobs are copyrighted/gitignored.
- **Golden images are secondary and brittle.** The rendered frame is *not* byte-stable across
  machines (float interpolation, devicePixelRatio, canvas AA, GPU/fonts) even though the sim is.
  Start with *eyeball-the-PNG*; add `toHaveScreenshot()` baselines only once the render stabilizes,
  treat any diff as **needs human** (never auto-pass), and keep them sparse — they're binary churn
  and capture the *OpenNorthland* synthetic render, never original assets.

**Manual poke via the Playwright MCP (ad-hoc, not the backbone).** A `playwright` MCP server is
available at *local* scope (`claude mcp get playwright`; private to this project, not committed) for
**interactive** visual checks while iterating — the complement to the committed `npm run shot`
script, not a replacement. Workflow once something renders: run `npm run dev`, point the MCP browser
at the Vite URL (`http://localhost:5173`), screenshot, and eyeball for **gross** correctness only.
The `<canvas>` has no accessibility tree, so the MCP's snapshot/click-by-role tools are blind here —
**screenshots are the only usable surface**. It is manual and stateful: nothing it does lands in git
or CI. For anything
you'd want to *re-run or gate on*, write the `npm run shot` script instead.

## Reproducibility of fixtures

Golden/scenario tests must reproduce on any machine, but `content/` is generated from a copyrighted
game copy and is gitignored. Therefore tests use the **committed synthetic fixture**
(`packages/sim/test/fixtures/content.ts`) — hand-authored, no copyrighted data. Keep it in lockstep
with the schema. Never make a golden test depend on generated `content/`.

## Real-content test modes (manual, local — `test:content` / `test:pipeline`)

The pyramid above proves the sim against the synthetic fixture; a separate class of regression is
schema-valid content the game economically dies on (raw id-space joins, zeroed balance nobody
overlays, a field good that neither farms nor produces). Two explicit modes cover it, both bound to
a local game copy so **CI never runs them** — they are an agent/developer gate, not a merge gate:

- **`npm run test:content`** — the real-content suite (`packages/app/test/content/`): property
  invariants over the generated `content/ir.json` + its `mergeRealContent` output, cross-file
  invariants between the decoded maps and the IR, the loader/catalog/roster/animation pins to the
  real bytes, and the gathering + field-farming cycles (with same-seed determinism) over the merged
  real content. Under plain `npm test`
  these files `runIf`-skip on a bare checkout; this mode hard-fails instead when `ir.json` is
  absent, so it can never pass vacuously (the guard requires the IR, maps, and bob lanes).
  Assertions are overwhelmingly properties (references resolve, balance is live-or-reported, a
  trade can harvest the core goods) so the suite survives mod/data drift; the one exception is the
  loader's dated full-parse count pin, updated deliberately when the data refreshes. No goldens:
  golden tests stay on the committed synthetic fixture.
- **`npm run test:pipeline`** — the executable form of "pipeline or schema changes need a real
  pipeline run": runs the full pipeline against the owned game copy (`CULTURES_GAME_DIR`, default
  `../Cultures 8th Wonder`; `CULTURES_MOD`, default `DataCnmd`) into a throwaway directory, then
  points the same suite at that fresh output via `ON_CONTENT_DIR`. The checkout's `content/` is
  never touched; a failing run keeps the output directory for inspection.

Run `test:content` when a change touches real-content consumers (loaders, id joins, merge overlays,
content-driven UI tables); run `test:pipeline` when it touches the pipeline or the content schema.

## The sim benchmark (manual, local — `bench:sim`)

The suite proves *behavior*; golden rule 6 ("per-tick sim cost scales with active work, never
entities²") is about *cost*, and a test cannot assert it portably — wall-times vary by machine. **`npm
run bench:sim`** is the measuring tool: it runs an RTS-scale headless world (N copies of the sandbox
scene's authored settlement tiled across one grass map, plus two armies — all synthetic content, built
by the acceptance scenes' own builders) and reports median/p95 ms **per system**, plus whole-tick cost
and each system's share.

Timing lives outside the sim: the bench injects its timer through `Simulation.setInstrument` (the
per-system seam the app's `?debug=perf` marks also use), so `performance.now` never enters
`packages/sim/src`, which the hygiene test enforces. `packages/app/bench/*.bench.ts` never matches
vitest's default `include`, so `npm test` and CI never collect the bench; `packages/app/bench/vitest.config.ts`
is what makes it runnable.

Knobs (env): `ON_BENCH_SETTLEMENTS` / `ON_BENCH_FIGHTERS` size the world (turn them up across runs for
a scaling curve — a system whose cost grows faster than the population is the O(n²) this exists to
catch), `ON_BENCH_WARMUP` / `ON_BENCH_TICKS` size the window, `ON_BENCH_JSON=<path>` writes the
machine-readable report. Needs stay off, so the population is stable across the window and the
needs/eat/sleep drives are under-measured. There is deliberately **no pass/fail threshold** — absolute
ms are machine-dependent; a human reads the table, and the bench's own check only proves the measured
world is deterministic (two runs, one hash).

## The agent's checklist (also in AGENTS.md)

1. Write/extend the test at the **lowest level** that proves the change (unit > integration > e2e).
2. Run `npm test`. Read failures; if invariants fired, note the **tick** they reported.
3. Determinism golden changed? Only update it if the change was **intentional** — say which mechanic.
4. Touched real-content consumers or the pipeline? Run `npm run test:content` / `npm run test:pipeline`
   (local-only — they need the game copy; see *Real-content test modes* above).
5. Visual/render change? Run the screenshot diff if available; otherwise state plainly it needs a
   human. Never claim a visual result from a passing typecheck.
