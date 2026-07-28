# Stop copying the whole work-flag blocked set per `ignoreFlag` query

**Area:** packages/sim · **Priority:** P2

`workFlagPlacementBlocks(world, content, terrain, ignoreFlag)`
(packages/sim/src/systems/footprint/placement/work-flag/incremental-blocks.ts) returns the shared live
set directly when `ignoreFlag` is absent, but allocates `new Set(state.blocked)` when it is present —
a full copy of every blocked node on the map (every resource + building body cell; order 10⁴–10⁵ on a
large forested map) just to withhold the handful of nodes one flag reserves.

The cost is per command, not per tick, but a box-select Ctrl+Right-Click issues one `setWorkFlag`
**per selected gatherer** (packages/app/src/view/unit-controls/orders.ts), so N selected gatherers
pointed at one patch is N full-map set copies in a single tick. fix/iron-pickup halved the constant by
dropping a redundant `canPlaceWorkFlag` pre-test (the snap's own `r = 0` ring covers it), which is why
this is a P3 rather than a blocker.

Since the semantics are membership-only, the copy is avoidable: return a small `ReadonlySet` façade
whose `has(n)` is `state.blocked.has(n) && !unblockedByIgnore.has(n)`. Winners cannot shift — every
consumer reads the set through `.has` alone — so goldens must not move.

## Scope

Replace the copy with a façade (or an equivalent no-allocation form), keeping the shared live set
untouched so the registered `verifyBlocksMemo` verifier still compares like for like. Confirm every
caller really is membership-only before changing the return type.

## Verify

`npm test` (goldens must NOT move — a moved golden here means the winner changed, which this must
not do), `npm run check`, `npm run build`. Measure first and after with a command-burst case under
`npm run bench:sim` — never `performance.now` in `src`.

The "close it if `|blocked|` is only a few thousand nodes" escape no longer applies: `magiczny_las`
stands up 35 170 `Resource` entities plus every building body, and the identical per-tick copy in the
since-removed `dynamicBlockedCells` profiled at 33% of `Simulation.step` on that map before it was
replaced by the `dynamicBlockOverlay` membership view. The façade here should follow the same shape
(`LayeredBlocks` in `nav/block-overlay.ts` answers union membership; the ignore carve-out still needs
its own subtractive wrapper) rather than reinvent it.
