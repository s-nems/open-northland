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

**Component stores are module-level singletons shared by every `Simulation`/`World`** (`defineComponent`
makes one `Map`; `new World()` resets the id counter, NOT the stores). So anything that builds >1 sim in
one process — a test file, or a hands-on smoke/determinism harness — MUST clear the whole component
namespace between runs, or the earlier run's entities leak onto the later run's reused ids and a
query-order decision diverges: `for (const c of Object.values(components)) if (c?.store instanceof Map)
c.store.clear()` (a hand-picked subset misses a component a future system adds). The vitest suites do this
in `beforeEach`; a throwaway harness does not get it for free. This is the loop's most-rediscovered trap
and belongs in every new multi-sim harness.

## Scaling to thousands of units

Very large maps, thousands of units, up to 8 players: per-tick cost must scale with **active work**,
never `entities²`. Don't write per-unit whole-world scans — consume the existing levers: memoized
`World.canonicalEntities()` (shared + read-only; never mutate it), per-tick candidate lists +
`NodeBuckets`/`NodeBuckets.nearest` ring search (`systems/spatial.ts` — new nearest-X code uses this,
not another scan), `core/content-index.ts` for content lookups, and dormancy gates that elide only
provably-empty work. Any optimization must keep canonical winners (ascending-id / `(distance, id)`
picks) so goldens stay byte-identical. Profile per-system with a throwaway node script over `dist/` —
never add `performance.now` to `src` (the hygiene scan fails the build).

## Layout

`src/`, for a cold agent — each concern has ONE home:

- **`simulation.ts`** + **`index.ts`** — the `Simulation` façade (step loop, `hashState()`,
  `snapshot()`) and the public barrel.
- **`core/`** — deterministic primitives: `fixed.ts` (the `fx` fixed-point kit), `rng.ts` (seeded RNG),
  `commands.ts` + `command-queue.ts`, `events.ts` (typed `SimEvent`s), `loop.ts`,
  `content-index.ts` (memoized O(1) content lookups), `atomic-effect.ts`, `brand.ts`.
- **`ecs/world.ts`** — the `World`: entities, queries, `canonicalEntities()`, `verifyCaches()`.
- **`components/`** — the component stores (module-level singletons — see above): `settler.ts`,
  `movement.ts`, `combat.ts`, `equipment.ts`, `ownership.ts`, `rules.ts`, `economy/`.
- **`systems/`** — the per-tick systems, grouped by concern: `agents/` (AI, the atomic planner,
  effects), `economy/` (jobs, production, construction, farming, berries, flags), `conflict/`,
  `lifecycle/`, `movement/`, `orders/`, `command/` (command application + placement), `vision/`,
  `footprint/`, `progression/`, `readviews/` (pure content-derived rule tables), `stores/`; plus
  `spatial.ts` (`NodeBuckets` + candidate lists), `schedule.ts` (`SYSTEM_ORDER`), `context.ts`, and
  the resource/berry indexes.
- **`nav/`** — pathfinding and the half-cell lattice: `halfcell.ts` (the ONE cell↔node conversion
  seam), `terrain/` graphs, `nearest.ts`, `metric.ts`, `block-overlay.ts`.
- **`replay/`** — command-stream replay + divergence debugging (`localize-divergence.ts`,
  `scrub-window.ts`, `rebase-content.ts`).
- **`inspect/`** — state introspection: `snapshot.ts` (plain `WorldSnapshot`), `snapshot-diff.ts`,
  `hashtrace.ts` (per-tick hash ring buffer), `entity-dump.ts`.
- **`harness/`** — test/scenario helpers: `invariants.ts`, `scenario.ts`, `populate.ts`, `stores.ts`
  (the clear-every-component-store multi-sim reset).
