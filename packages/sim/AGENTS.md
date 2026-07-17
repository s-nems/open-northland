# packages/sim — determinism contract

The `sim` package is **deterministic and pure**. This is the detailed contract for working *here*;
the root [`AGENTS.md`](../../AGENTS.md) carries the one-paragraph version + the project-wide rules.
Also read [`docs/ECS.md`](../../docs/ECS.md) (the model) and [`docs/TESTING.md`](../../docs/TESTING.md)
(how to prove a change).

## The invariant

Two runs from the same seed + same inputs must produce **byte-identical** state
(`Simulation.hashState()`). That is what makes mechanics testable headless and lockstep-multiplayer
possible later. Randomness comes only from the injected seeded RNG (`src/core/rng.ts`); sim state is
fixed-point integers (`src/core/fixed.ts`), never floats. No DOM, no I/O, no `import` from
`render`/`app`/Pixi.

## Determinism anti-patterns (an LLM reaches for these — don't)

- `Math.random` / `Date.now` / `new Date` / `performance.now` → use `world.rng` (seeded) or the tick
  counter. **Enforced:** `test/core/hygiene.test.ts` regex-scans `src/**.ts` and fails the build (and CI)
  — a violation can't land green. The scan also bans transcendental float math (`Math.sqrt/sin/cos/
  pow/…` — last-bit results vary across engines; `fixed.ts` is the one sanctioned wrapper) and
  locale-dependent APIs (`localeCompare`/`toLocale*`/`Intl` — output varies by environment).
- Iterating a `Map`/`Set` for a **game decision** (insertion order is history-dependent) → iterate a
  canonical order: `world.canonicalEntities()` (sorted ids), `stockpileEntries()` (sorted by
  goodType). Membership (`.has`) is fine.
- Floats for state → `fx` fixed-point (`fixed.ts`); no `Math.sqrt/sin/cos` (use `fx.isqrt`; the
  hygiene scan enforces this). Mint `Fixed` only via `fx.*` — it's a branded type, a raw `number`
  won't assign.
- Recycling entity ids → ids are monotonic, never reused.
- Bespoke per-job logic / hardcoding "two tribes" → behavior is an **atomic planner** over the data
  vocabulary; tribes/jobs/atomics are **data** (see `docs/ECS.md`).
- Letting `render` read live component stores → one-shot facts go through `ctx.events` (typed
  `SimEvent`), never callbacks (a subscriber must not mutate sim state).

## Fixed-point

`fixed.ts` is scaled integers in a JS double (exact to 2^53) with dev-mode overflow assertions.
Truncation bites: `ONE / duration` truncates, so don't accumulate a per-tick `Fixed` fraction to
reach `ONE` — count an integer `elapsed` to the exact `elapsed >= duration`.

## Proving your change (the golden rule of the goldens)

`hashState()` canonically hashes all components on all entities; `test/` holds the golden state-hash
+ golden atomic-trace tests — the tripwire. **Only update a golden if the change was intentional,
and name the mechanic in the commit.** A moved golden on a *refactor* means a real change crept in —
stop and reassess. Run `npm test`; if an invariant fires (`src/harness/invariants.ts`) it reports the exact
tick — use it. Beyond the goldens, `test/core/fuzz-determinism.test.ts` runs seeded-random command
streams (run-twice hash equality + replay fidelity + invariants) — **add new command variants to its
generator in the same commit**, and register any new incrementally-maintained cache in
`World.verifyCaches()` (the `cachesCoherent` invariant re-derives every cache each checked tick).

**Component stores are owned by the `World`** (`defineComponent` returns a pure key; each `World` holds its
own `Map<Entity, value>` per component). So `new World()` — and thus `new Simulation()` — is a complete
reset: two sims in one process are fully independent, with no shared state to clear between them. Each
store iterates in the insertion order of *that* World's `add` calls, so same seed + same inputs still
produces byte-identical query order.

## Scaling to thousands of units

Very large maps, thousands of units, up to 8 players: per-tick cost must scale with **active work**,
never `entities²`. Don't write per-unit whole-world scans — consume the existing levers: memoized
`World.canonicalEntities()` (shared + read-only; never mutate it), per-tick candidate lists +
`NodeBuckets`/`NodeBuckets.nearest` ring search (`systems/spatial.ts` — new nearest-X code uses this,
not another scan), `core/content-index.ts` for content lookups, and dormancy gates that elide only
provably-empty work. Any optimization must keep canonical winners (ascending-id / `(distance, id)`
picks) so goldens stay byte-identical. Profile per-system with `npm run bench:sim` (median/p95 ms per
system over an RTS-scale headless world; `ON_BENCH_SETTLEMENTS`/`ON_BENCH_FIGHTERS` turn the population
up for a scaling curve, `ON_BENCH_JSON` writes the machine-readable report) — never add
`performance.now` to `src`: the timer belongs in the caller, behind `Simulation.setInstrument`, and the
hygiene scan fails the build otherwise.

## Layout

`src/`, for a cold agent — each concern has ONE home:

- **`simulation.ts`** + **`simulation/`** + **`index.ts`** — the `Simulation` façade (step loop,
  `snapshot()` memo) with its read seams and `hashState()` body beside it, and the public barrel.
- **`core/`** — deterministic primitives: `fixed.ts` (the `fx` fixed-point kit), `rng.ts` (seeded RNG),
  `commands.ts` + `command-queue.ts`, `events.ts` (typed `SimEvent`s + `eventNode`), `loop.ts`,
  `content-index.ts` + `content-index/` (memoized O(1) content lookups, one file per domain),
  `atomic-effect.ts`, `brand.ts`.
- **`ecs/world.ts`** — the `World`: entities, queries, `canonicalEntities()`, `verifyCaches()`.
- **`components/`** — the component keys (`defineComponent`; the entity→value stores live on the `World`):
  `settler.ts`, `movement.ts`, `combat.ts`, `equipment.ts`, `ownership.ts`, `rules.ts`, `economy/`.
  `rules.ts` is the exception to "keys only": each world-rule singleton owns its own reader + writer
  (`fogMode`/`setFogMode`, …), so a rule's read and write stay one edit apart.
- **`systems/`** — the per-tick systems, grouped by concern: `agents/` (AI, the atomic planner,
  effects), `economy/` (jobs, production, construction, farming, berries, flags), `conflict/`,
  `lifecycle/`, `movement/`, `orders/`, `command/` (command application + placement), `vision/`,
  `footprint/`, `progression/`, `readviews/` (pure content-derived rule tables), `stores/`; plus
  `spatial.ts` (`NodeBuckets` + candidate lists — feed it a `canonicalById` list), `schedule.ts`
  (`SYSTEM_ORDER`), `context.ts`, and the resource/berry/stockpile indexes.
- **`nav/`** — pathfinding and the half-cell lattice: `halfcell.ts` (the ONE cell↔node conversion seam,
  both directions), `pathfinding/` (A* + its heap/scratch), `terrain/` graphs, `nearest.ts`,
  `metric.ts` + `node-metric.ts` (the measured 68×38 pitch in `Fixed` column units and integer px
  respectively), `block-overlay.ts`.
- **`replay/`** — command-stream replay + divergence debugging (`localize-divergence.ts`,
  `scrub-window.ts`, `rebase-content.ts`).
- **`inspect/`** — state introspection: `snapshot.ts` (plain `WorldSnapshot`), `snapshot-diff.ts`,
  `hashtrace.ts` (a capped per-tick hash list), `entity-dump.ts`.
- **`harness/`** — test/scenario helpers: `invariants.ts`, `scenario.ts`, `populate.ts`.
