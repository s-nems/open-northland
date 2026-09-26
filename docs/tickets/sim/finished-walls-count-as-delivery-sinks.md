# Stop finished wall segments counting as delivery sinks

**Area:** sim · **Focus:** settlers/targets · **Priority:** P2

Every wall segment spawns with an empty `Stockpile` (`systems/palisades/index.ts`), and `finishWall`
(`systems/economy/construction.ts`) keeps it. `canStoreGood` (`targets/stores/stock.ts`) then admits a
finished segment: it is no `GroundDrop`, `isYardHeap` excludes `Palisade`, and `UnderConstruction` is
gone. `stockCapacity` (`systems/stores/capacity.ts`) takes its building-less branch and gives it
`MAX_GROUND_STACK` of any good, so each finished segment is a sink for every good in both producer modes.

A scratch test on `testContent` showed `canStoreGood` accepting all 27 goods on a finished wall, and
`nearestStoreFor(WOOD)` from node (2,4) picking a wall at (4,4) over a headquarters at (12,4). The deposit
(`pileupIntoStore`, `atomics/effects/goods/transfer.ts`) refuses a wall without the carrier's palisade
claim, so a hauler near a wall is routed to a sink that rejects its load. `StoreSinks` also files every
standing segment under every good.

## Scope

- Make a wall's build hold a sink only through the wall delivery rules: reject `Palisade` in
  `takesDeposits`, or give a wall zero capacity outside its bill.
- Check the wall builder's own delivery path still lands its material, and name the behaviour change in
  the commit, moving any golden it changes.

## Verify

- A unit test: a finished segment is no sink for any good, a wall site still takes its bill material from
  its claimed builder.
- `world.verifyCaches()` clean on a walled map; `npm test`, `npm run check`, `npm run build`.
