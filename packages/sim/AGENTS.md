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

The game targets **very large maps with thousands of units and up to 8 players**, so per-tick cost must
scale with **work**, not with `entities²`. The recurring anti-pattern (an LLM writes it naturally): a
system loops every unit and, for each, scans `world.canonicalEntities()` to find a target — and that used
to `[...alive].sort()` the whole world **per call**, so `aiSystem` + `jobSystem` were `O(units² · log n)`
and pinned ~2.8k idle settlers at **~480 ms/tick** (1 fps) while the renderer sat at ~1 ms. It's a PATTERN,
not one bug — combat/reproduction will show it too as counts grow. Profile per-system before optimizing
(patch `SYSTEM_ORDER` with timers from a throwaway node script over `dist/` — never add `performance.now`
to `src`, the hygiene scan fails the build).

**Landed (480 → 1.9 ms/tick at 2848 units, ~250×; goldens byte-identical). Every step preserved the
ascending-id scan order or elided only provably-empty work, so the winner never changed:**
- `World.canonicalEntities()` **memoized per alive-set generation** — invalidated only by `create`/
  `destroy`, so scanning it N times a tick costs one sort, not N. Result is **shared + read-only**; never
  mutate it (sort/reverse a copy).
- **Per-tick candidate lists** — `canonicalById(world.query(C))` (`systems/spatial.ts`); scan the matching
  entities, not the whole world. Used in `aiSystem` (resources/stockpiles/buildings) + `jobSystem`.
- **Dormancy gate** — `hasHaulableOutput` decides ONCE per tick whether any carrier work exists; if not,
  idle settlers skip the per-settler `nearestWorkplaceOutput` scan. The lever that makes an idle crowd ~0:
  a unit with no reachable work does not re-scan every tick. Safe because a false means every scan returns
  null anyway (it's the same predicate the scan applies, minus the deliverability check, so it only ever
  elides a provably-null scan).
- **`NodeBuckets`** (`systems/spatial.ts`) — a per-tick spatial bucket of entities by integer node; O(1)
  "what's on this node?". `jobSystem`'s adopt-check (am I standing on a workplace I staff?) is now a
  same-node lookup, not a building scan per settler. Feed it a `canonicalById` list — the ring
  search's min-id pick is only canonical over ascending-id buckets.
- **`NodeBuckets.nearest`** — the grid ring search: expands Manhattan bands from the unit, **finishes
  the whole minimum-distance band and picks canonically by (distance, id)** (never stops at the first
  hit, so the winner is unchanged), and short-circuits past `maxDist`. First consumer: `combatSystem`'s
  nearest-enemy query — 23× faster than a full scan at 400 combatants, ~O(seekers·sight²) not
  quadratic; combat also has its own dormancy gate (no hostile pair ⇒ zero work). New nearest-X code
  should consume this, not write another scan.
- **Content-index** (`core/content-index.ts`) — WeakMap-memoized O(1) Maps over a `ContentSet`,
  each table reproducing the duplicate-key semantics of the exact scan it replaced (mostly first-wins
  = what `.find` returned; the `setatomic` binding tables are last-wins, the source's override rule).
  Replaced every hot linear content scan, including the per-combatant weapon lookups.

**Remaining follow-ups** (economy nearest-X onto a ring index, `separationSystem` constant cuts,
sim in a Web Worker) are tickets under `docs/tickets/` — this file keeps the rules and the landed
levers, not the roadmap.
