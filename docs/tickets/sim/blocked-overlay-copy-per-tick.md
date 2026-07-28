# Stop materializing the walk-block union set once per system per tick

**Area:** sim · **Priority:** P1

`dynamicBlockedCells` (`systems/footprint/blocked.ts`) copies `buildingBlockedCells ∪
resourceBlockedCells` into a fresh `Set` on every call. On a decoded map that union is the size of the
map's scenery, not of the settlement: `magiczny_las` stands up roughly 35 000 `Resource` entities and
stays within a few dozen of that across a run, each contributing its extracted `walkBlockAreas` cells.

Four systems call it, each lazily once per tick, and every one of them only ever asks `.has`:

- `drainPathRequests` → `dynamicOnly` (`systems/movement/routing.ts`), which then puts the copy
  straight into a `LayeredBlocks` and hands it to `findPath` as a `BlockOverlay`;
- `PlannerSpacing.blockedCells` (`systems/settlers/planner/spacing.ts`), read by `nearestFreeCell`,
  `restingCell`, `planChildWander`, `buildYard`, and `constructionWorkCells` (which already declares
  `BlockOverlay`);
- `safeLanding` (`systems/movement/collision/separation.ts`), whose whole use is
  `!blockedOverlay.has(node)`;
- `buildSowScan` (`systems/settlers/drives/farming/targets.ts`), read by `nextSowNode` as
  `blocked.has(node)`.

`dynamicBlockOverlay` already sits in the same module and answers the same membership question through
`LayeredBlocks` without copying either cached layer. Its own doc states the rule this ticket enforces:
a caller that only tests membership should prefer it.

## Evidence

A V8 CPU profile of `Simulation.step` over ticks 2000-4000 of
`?map=magiczny_las&ai=0,1,2,3,4,5&fog=reveal` ranks `dynamicBlockedCells` first at **33.4% of step,
almost entirely self time** (54 839 ms self of 54 862 ms inclusive — the copy loop itself, not
anything it calls). The two largest call chains are `dynamicOnly` at 15.2% inclusive and
`PlannerSpacing.blockedCells` at 9.8%.

That share is a ranking, not a promise: V8 sampling inflates absolute time roughly eightfold here and
over-weights tight loops, which is what this is. The A/B below is what pins the real number.

The same session measured in the browser at tick ~46 500 spends 121.7 ms per frame in the sim and
delivers ×2.65 of a requested ×10 at 6 fps, with `planner` 38.1%, `separation` 9.7% and `pathfinding`
9.6% of the tick — the three schedule slots this copy sits inside.

Reproduce the schedule shares from `window.__opennorthland.perf().systems` under `?debug=profile`; the
function-level attribution needs a V8 CPU profile taken around `Simulation.step` on the same real-map
world, which `packages/app/test/content/real-map-world.ts` builds headlessly.

## Scope

Return a `BlockOverlay` instead of a materialized `ReadonlySet<NodeId>` at all four call sites, so the
two shared caches are composed rather than copied. `routing.ts` should fold the two cached layers into
the `LayeredBlocks` it already builds rather than nesting an overlay inside an overlay. Widen
`SowScan.blocked` and `PlannerSpacing.blockedCells`'s return type with it.

Keep `dynamicBlockedCells` for any caller that genuinely needs an owning, mutable set; delete it if
none remains.

Non-goal: the work-flag blocked-set copy, which has its own ticket
([work-flag-blocks-ignoreflag-set-copy](work-flag-blocks-ignoreflag-set-copy.md)) and a different
verification path.

## Verify

Every consumer is membership-only today, so no winner may shift: `npm test` with **no golden or
atomic-trace movement**. A moved golden means the change altered a pick and must be reverted, not
re-baselined.

One `.size` reader exists and constrains the change: `findPath` tests `blocked.size === 0`, which
`LayeredBlocks` honours ("0 means empty") even though it may over-count shared nodes. Confirm no new
caller compares `.size` to anything else.

`npm run bench:compare` before and after on the same world for the real number, plus `npm run check`
and `npm run build`. Build `packages/sim` first — see
[bench-map-measures-stale-dist](../tooling/bench-map-measures-stale-dist.md).
