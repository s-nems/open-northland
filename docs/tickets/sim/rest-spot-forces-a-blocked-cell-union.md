# Measure whether the rest-spot rung should read the block overlay instead of the union set

**Area:** sim · **Origin:** needs-pacing worktree review, 2026-07-20 · **Priority:** P3

`restingCell` (`systems/agents/rest-spot.ts`) opens with
`spacing.blockedCells ??= dynamicBlockedCells(world, ctx, terrain)`, which materialises a fresh `Set`
holding the union of every building *and* resource blocked node (`systems/footprint/blocked.ts`). It is
memoised on the planner tick's `SpacingState`, so it is built at most once per tick — but the rest-spot
rung now *forces* that build on ticks where no de-stack, loiter or construction consumer would have
needed it, and it only ever calls `.has` on the result.

`dynamicBlockOverlay` (same file) is the non-copying membership view built for exactly this use. The
catch is that `SpacingState.blockedCells` is typed as a `ReadonlySet` shared with the other consumers,
so switching one caller means either widening that field to a membership interface or giving rest-spot
its own overlay handle.

**Measure before changing anything.** On a forested 256² map the union is O(all tree + building
footprint cells); on a settled map the other consumers fire nearly every tick anyway, in which case the
marginal cost of rest-spot forcing it is ~zero and this is not worth the type churn. Use
`npm run bench:sim` per-system medians with and without a tired-settler population
(`ON_BENCH_SETTLEMENTS` turns the population up).

Determinism is not at risk either way: the reads are membership-only and cannot reorder a pick.

## Verify

- `npm run bench:sim` before/after, reported in the commit — if the delta is noise, close the ticket
  with that measurement instead of making the change.
- `npm test` with no golden movement.
