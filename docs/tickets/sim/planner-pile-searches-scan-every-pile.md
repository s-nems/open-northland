# Ring-bucket loose ground piles and keep the planner's stockpile cell index across ticks

**Area:** sim · **Focus:** settlers/targets · **Priority:** P2

`InteractionCellIndex` (`settlers/targets/cell-index.ts`) buckets a candidate by its static interaction
node and puts every candidate without one in a `dynamic` tail that `nearest` scans linearly on every
call (`linearNearest` -> `nearestByCell`). A loose ground pile has no static interaction node, so every
building-less pile on the map lands in the tail. The index itself is rebuilt each tick:
`TargetCandidates.stockpileCells` (`targets/candidates.ts`) constructs it over every stockpile, and
`TargetBands.sinksFor` and `groundPiles` build theirs the same way. The porter's pile search
(`nearestGroundPile`, `drives/economy/haul-targets.ts`) never sleeps, since `porterScanVersion` includes
the Stockpile value generation, which moves every tick. A gatherer's pile search
(`nearestCollectablePileFor`, `targets/resources.ts`) merges the per-good lists through `piles.flat()`,
a `Set` and a sort on every plan.

Measured on `krwawa_rzeka`, 12 AI seats, t100k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): 3351
building-less piles hold about 8700 units, 3272 of them without `GroundDrop`. A porter scan resolves
3359 piles per call at about 3.9 ms, 186 calls over 2200 ticks, 2.06% of the profile
(`nearestGroundPile` 2.69% inclusive), each pile paying `interactionCell` and a signpost `allowsNode`.
`nearestFoodStore` scans the 3380-pile tail on every ring hit and 3683 candidates on each cap fallback
(0.65%). The per-tick index builds allocate 115 KB a tick plus 22 KB promoted; the gatherer's pile merge
144 KB a tick. The cell index's small-list path (64 buckets or fewer) serves owner-blind lists with 12
seats: 106 and 35 candidates per missing-input and store-holding query.

Whether 3351 idle piles is itself an economy defect (mostly flag-yard goods nobody fetches) is not
known; say so in the closing report if the work shows it.

## Scope

- A pile is ring-bucketed by its own node, with the largest interaction-cell offset as slack; the ring
  search stops once the ring minus the slack exceeds the best exact distance, keeping the
  `(distance, cell, id)` order and the gate's bounds.
- The stockpile and building cell indexes are kept across ticks from Stockpile and Building membership
  and Position value writes, like the existing journaled ledgers, instead of rebuilt per tick.
- Owner-scoped queries read per-owner lists.
- The gatherer's pile search walks the already-sorted per-good lists without merging them into new
  arrays.
- Hash-identical.

## Verify

- State hash unchanged over 2000 ticks from the reference's t100k checkpoint; the target search and
  planner tests pass.
- Piles resolved per porter query (temporary counter), the porter-scan spikes in the planner's max, and
  the cell-index and pile-merge rows in `ON_BENCH_PROFILE=alloc`, against the numbers above.
- `npm test`, `npm run check`.
