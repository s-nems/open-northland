# Get a gatherer's flag-yard heaps hauled into the settlement's stores

**Area:** packages/sim · **Origin:** fix/iron-pickup diagnostic soak, 2026-07-20 · **Priority:** P2

Over 20 000 ticks of `?map=magiczny_las&ai=0,1,2,3,4,5` (the `realMapWorld` harness), loose ground
heaps grew monotonically while building stores drained:

| tick | loose heaps (mud / stone / wood) | building stores (mud / stone) |
| ---- | -------------------------------- | ----------------------------- |
| 4000 | 67 / 62 / 45 | 31 / 41 |
| 20000 | 216 / 140 / 135 | 19 / 3 |

The heaps are the flag yards the gatherers bank into: each fills to `MAX_GROUND_STACK` (5) and is then
abandoned for a fresh tile, 50 heaps at tick 6000 and 81 at tick 12000. Nothing ever carries them in,
so a settlement's whole harvest sits on the ground while its workshops and sites starve.

The inbound half of the carrier rule is `planPorter` → `porterPickupTarget` → `nearestGroundPile`
(packages/sim/src/systems/agents/economy/hauling.ts, haul-targets.ts), gated on
`isPorterBoundToStore` — a settler bound via `JobAssignment` to a storage sink. In the sampled world
**no settler of job 24 (`carrier`) was bound to anything** (jobs 11/12/18/19/20/24 showed `bound 0`
for 24 while the operator trades were bound), so the rung never ran for any seat. Whether that is the
AI allocator never staffing a warehouse's transport slot (`CARRIER_STAFFED_BUILDING_IDS` lists only
the two bakeries) or the JobSystem's report-in pass not binding a loose carrier was **not**
determined — establish that first. A third possibility worth ruling out is `deliverableGoodProbe`
rejecting the goods (it deliberately ignores construction-site sinks), which would make a bound
porter skip every pile anyway.

Note this is separate from the builder's own fetch, which is healthy: a builder *does* source a
construction material straight off a loose heap (`nearestStoreHolding` accepts yard heaps), verified
against real content on this branch.

## Scope

Make a settlement's gathered goods reach its stores. Diagnose the binding gap, fix it at whichever
layer owns it, and keep the existing policy seams intact — the "leave a pile whose good has no
reachable sink" rule (`deliverable`) and the porter dormancy gate exist to stop pickup/shed
livelocks and per-tick rescans.

## Verify

`npm test`; then the soak shape above over ≥20 000 ticks, asserting loose-heap totals stop growing
without bound and building stores rise. Real-content only — local, never CI.
