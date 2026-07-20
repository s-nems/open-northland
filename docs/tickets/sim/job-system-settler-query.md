# Drive jobSystem's matching loop from a Settler query, not a whole-world scan

**Area:** sim (economy/jobs) · **Origin:** ticket scout, 2026-07-20 · **Priority:** P2

`packages/sim/src/systems/economy/jobs/system.ts:70` walks every alive entity every tick, with a
`tryGet(Settler)` plus a `has(JobAssignment)` per entity and no dormancy gate:

```ts
for (const e of world.canonicalEntities()) {
  const settler = world.tryGet(e, Settler);
  if (settler === undefined || world.has(e, JobAssignment)) continue; // already bound: nothing to do
```

On a decoded map that is ~17k entities — the figure `packages/sim/src/systems/stockpile-index.ts:10`
already cites as the reason that pattern was abandoned there. Nearly all of them are resource nodes
that fail the first test, and nearly all real settlers take the `JobAssignment` early-out, so the
loop's useful work is the handful of unemployed settlers.

The same function already avoids rescans everywhere else: lines 57–68 build `buildings`, the
`staffing` tally and a `NodeBuckets` index once per tick precisely so the inner passes are O(1) —
then the driving loop rescans the world.

This is the last per-tick whole-world scan in the sim. The other `canonicalEntities()` callers are
legitimate: `simulation/hash.ts:58` and `inspect/snapshot.ts:95` are genuinely whole-world, and
`systems/signposts/network.ts:53` is memoized per `World` (a `WeakMap` invalidated only by an
erect/tear-down).

## Scope

- Replace the loop head with `canonicalById(world.query(Settler))`.
  `packages/sim/src/systems/spatial.ts:18` documents this as yielding the same ascending-id
  subsequence the `canonicalEntities()`-then-filter scan did, so picks and first-match tie-breaks
  land on the identical winner.
- The stated precondition of that equivalence is the ECS `store ⊆ alive` invariant (a store never
  keeps a destroyed entity). Confirm it holds for the `Settler` store before relying on it — a
  use-after-`destroy` would make the query-based scan diverge from the `alive`-based one.
- Update the loop's comment to say what the new scan set is; drop the now-redundant `tryGet`
  undefined-check if the query makes it dead.

## Verify

- `npm test` with **goldens byte-identical** — this is a pure scan-set change; a moved golden means
  a job binding changed and the equivalence argument above is wrong.
- `npm run check`, `npm run build`.
- Optional signal: `npm run bench:sim` before/after. Note that today's bench world contains no
  scenery entities, so it will show little or nothing here — see
  `docs/tickets/sim/bench-world-scenery-mix.md`, which is what makes this measurable.

## Source basis

None needed — an engine cost budget (golden rule 6), not a mechanic. No original behavior changes.
