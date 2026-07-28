# Build the sim before a benchmark run instead of measuring whatever `dist` holds

**Area:** tooling · **Priority:** P2

`@open-northland/sim` publishes `"exports": { ".": "./dist/index.js" }`, so a benchmark importing it
runs the built output, not `src`. Neither `bench:map` (`scripts/bench-map.mjs`, which only guards for
generated content and spawns Vitest) nor `bench:sim` builds first.

`npm test` hides this because `test` is `npm run typecheck && vitest run` and `typecheck` is
`tsc --build`, which emits `dist` as a side effect. A benchmark invoked on its own has no such step, so
it silently measures the last build — which may predate the change being measured.

The failure is quiet and it corrupts the one tool the scaling budget rests on: a run can report a
regression or an improvement that is purely a stale build. `bench:compare` then puts two such numbers
side by side with no signal that either is void.

`tsc --build` also never removes outputs whose sources are gone, so `dist` accumulates orphans after
every rename. Those do not change what `dist/index.js` resolves, but they make a stale tree hard to
spot by eye and they emit sourcemap warnings that read as noise rather than as the warning they are.

## Scope

Make a benchmark run measure the working tree:

- run the project build before the Vitest spawn in `scripts/bench-map.mjs`, and give `bench:sim` the
  same guarantee;
- either clean `dist` as part of that build or make the build fail loudly on an orphaned output, so a
  stale tree cannot survive a rename series.

An alias from `@open-northland/sim` to `src` in the benchmark Vitest config is the alternative shape
and would also close it; pick one and apply it to both benchmark entry points rather than leaving them
asymmetric. Whichever is chosen, `docs/DEVELOPMENT.md`'s measurement table should stop implying a bare
`npm run bench:map` is sufficient.

Non-goal: changing the package's `exports`. Consumers outside the repository need the built entry.

## Verify

Edit a sim source file so its cost is visibly different, run the benchmark without any prior build, and
confirm the report reflects the edit. Confirm a rename leaves no orphaned `dist` output behind, or
fails. `npm run check` and `npm run build`.
