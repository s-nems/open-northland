# packages/sim — determinism contract

The `sim` package is **deterministic and pure**. This is the detailed contract for working *here*;
the root [`CLAUDE.md`](../../CLAUDE.md) carries the one-paragraph version + the project-wide rules.
Also read [`docs/ECS.md`](../../docs/ECS.md) (the model) and [`docs/TESTING.md`](../../docs/TESTING.md)
(how to prove a change). Recurring gotchas live in [`docs/LESSONS.md`](../../docs/LESSONS.md).

## The invariant

Two runs from the same seed + same inputs must produce **byte-identical** state
(`Simulation.hashState()`). That is what makes mechanics testable headless and lockstep-multiplayer
possible later. Randomness comes only from the injected seeded RNG (`src/rng.ts`); sim state is
fixed-point integers (`src/fixed.ts`), never floats. No DOM, no I/O, no `import` from
`render`/`app`/Pixi.

## Determinism anti-patterns (an LLM reaches for these — don't)

- `Math.random` / `Date.now` / `new Date` / `performance.now` → use `world.rng` (seeded) or the tick
  counter. **Enforced:** `test/hygiene.test.ts` regex-scans `src/**.ts` for these four patterns and
  fails the build (and CI) — a violation can't land green.
- Iterating a `Map`/`Set` for a **game decision** (insertion order is history-dependent) → iterate a
  canonical order: `world.canonicalEntities()` (sorted ids), `stockpileEntries()` (sorted by
  goodType). Membership (`.has`) is fine.
- Floats for state → `fx` fixed-point (`fixed.ts`); no `Math.sqrt/sin/cos` (use `fx.isqrt`). Mint
  `Fixed` only via `fx.*` — it's a branded type, a raw `number` won't assign.
- Recycling entity ids → ids are monotonic, never reused.
- Bespoke per-job logic / hardcoding "two tribes" → behavior is an **atomic planner** over the data
  vocabulary; tribes/jobs/atomics are **data** (see `docs/ECS.md`).
- Letting `render` read live component stores → one-shot facts go through `ctx.events` (typed
  `SimEvent`), never callbacks (a subscriber must not mutate sim state).

## Fixed-point

`fixed.ts` is scaled integers in a JS double (exact to 2^53) with dev-mode overflow assertions.
Truncation bites: `ONE / duration` truncates, so don't accumulate a per-tick `Fixed` fraction to
reach `ONE` — count an integer `elapsed` to the exact `elapsed >= duration` (see `docs/LESSONS.md`).

## Proving your change (the golden rule of the goldens)

`hashState()` canonically hashes all components on all entities; `test/` holds the golden state-hash
+ golden atomic-trace tests — the tripwire. **Only update a golden if the change was intentional,
and name the mechanic in the commit.** A moved golden on a *refactor* means a real change crept in —
stop and reassess. Run `npm test`; if an invariant fires (`src/invariants.ts`) it reports the exact
tick — use it.
