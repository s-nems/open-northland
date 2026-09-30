# Stop finished wall segments counting as delivery sinks

**Area:** sim · **Focus:** settlers/targets · **Priority:** P2

Every wall segment spawns with an empty `Stockpile` (`systems/palisades/index.ts`), and `finishWall`
(`systems/economy/construction.ts`) keeps it. `canStoreGood` (`targets/stores/stock.ts`) then admits a
finished segment: it is no `GroundDrop`, `isYardHeap` excludes `Palisade`, and `UnderConstruction` is
gone. `stockCapacity` (`systems/stores/capacity.ts`) takes its building-less branch and gives it
`MAX_GROUND_STACK` of any good while its build hold is empty, so each such finished segment is a sink
for every good in both producer modes.

`StoreSinks` files every finished segment with an empty hold under every good. `InteractionCellIndex.pileCellSealed`
explicitly exempts `Palisade`, so a segment whose interaction cell is its blocked anchor survives the
target scan. `planDelivery` sends a load there, pathfinding fails, and stranded recovery raises
`settlerLost`. Even when a wall interaction is reachable, `pileupIntoStore`
(`atomics/effects/goods/transfer.ts`) refuses a wall without the carrier's palisade claim.

Verified with a full synthetic `Simulation` using `testContent`, seed 1 and `grassNodeMap(32,16)`:
an owned woodcutter at node (4,8), carrying one unit of wood, chooses a finished one-node wall at
(10,8) over an empty own headquarters at (24,8). Within 500 ticks it raises `settlerLost` and then
delivers the wood to the headquarters after the failed-goal memo excludes the wall. The map is open
and no signpost restriction is involved. This confirms a cause of lost notifications beside walls;
it does not identify which tester reports came from it. Source basis: current simulation behavior.

## Scope

- Make a wall's build hold a sink only through the wall delivery rules: reject `Palisade` in
  `takesDeposits`, or give a wall zero capacity outside its bill.
- Check the wall builder's own delivery path still lands its material, and name the behaviour change in
  the commit, moving any golden it changes.

## Verify

- A unit test: a finished segment is no sink for any good, a wall site still takes its bill material from
  its claimed builder.
- Run the carrying-worker scenario above: the first delivery goal is the headquarters, it receives
  the wood, and no `settlerLost` is emitted. Cover several finished segments so rejected wall targets
  cannot consume successive retry windows.
- `world.verifyCaches()` clean on a walled map; `npm test`, `npm run check`, `npm run build`.
