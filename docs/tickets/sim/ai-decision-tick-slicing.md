# Bound one AI seat's decision pass and spread the seats over the interval

**Area:** sim · **Focus:** ai-player · **Priority:** P2
**Needs user:** moving a seat's decision slot or its flag-relocation round changes when AI commands land

A due seat runs all five strategic modules in one tick (`runAiPlayerModules`, `ai-player/index.ts`).
Seat `p` is due when `ctx.tick % AI_DECISION_INTERVAL_TICKS === seat.player % AI_DECISION_INTERVAL_TICKS`
(24), so seats 0-6 decide on seven consecutive ticks and the next 17 carry none. `flagRelocateDue`
(`workforce/collectors/upkeep.ts`) reads only `floor(tick / 24) % FLAG_RELOCATE_EVERY_DECISIONS`, so
every seat re-aims all its collector flags in the same seven-tick run, once per 720 ticks.

Measured on `magiczny_las`, AI seats 0-5 plus the map's seat 6, busy box (shares hold, ms indicative):
late-window `aiPlayer` median 0.003 ms, p95 15-37 ms, max 357 ms, the top system in 10.2k slow ticks.
All ten slowest ticks of the 80k and 100k profiles sit on ticks 0-6 of a relocation round (for example
89280-89285, 100800-100805), 100-210 ms of `aiPlayer` each: about a second of stall per minute of play,
on top of the seven-tick cluster every 24 ticks.

80k-checkpoint profile (2000 ticks), share of the whole profile: `aiPlayer` 15.8%, `runWorkforce` 13.7%:

- `upkeepHolders` 5.7%. `patchWorked` -> `patchHarvestable` -> `anyResourceNear` -> `region.someNear`
  2.9%, paid by every holder not mid-action on every decision. `replantSpot` -> `flagSpotNear` ->
  `cheapestRingNode` -> `legOf` (lazy `WalkFlood.costTo`) 2.5%, 4.5% in a window with two relocation
  rounds: a relocating seat pays a drift check per holder and up to `REPLANT_ATTEMPTS` spot searches.
- `SeatSupply.of` -> `seatStockOf` 3.2%, owned by [the seat stock ledger](ai-seat-stock-ledger.md).
- `allocateScout` -> `nextSignpostTarget` 2.1%, mostly `corridorGoals` -> `nearestLiveResource`, which
  doubles its box up to `RESOURCE_BOX_REACH_MAX` and then scans every resource whenever a collected good
  has no live node on the seat's own ground.
- Generic collector allocation 0.6%.

## Scope

- Without changing answers (state hash unchanged at the same checkpoint and tick count): share the
  drift check's nearest resource per (good, anchor) within a decision, reuse `patchHarvestable`'s verdict
  for a holder whose flag and reach did not change, and let `corridorGoals` stop rescanning the map for
  a good the seat's ground holds none of.
- With the owner's ruling, one commit each, goldens moved and named: stagger the relocation round by
  seat (for example `(floor(tick / 24) + player) % 30 === 0`), and spread the seat slots over the
  interval (for example seat `p` on `(p * 7) % 24`, which keeps seats 0-6 at least three ticks apart).
- Splitting one seat's modules across ticks stays out unless warm passes still exceed about 10 ms after
  both; modules then must be shown not to couple through the tick they share today.

## Verify

- On an idle box, from the 80k checkpoint of one 100k run (`docs/DEVELOPMENT.md`, Measuring
  performance): `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5
  ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint ON_BENCH_TICKS=4000 npm run bench:map` before and
  after, then `npm run bench:compare`. `aiPlayer` p95 and max fall, the slowest-tick list shows no run of
  consecutive seat ticks, and the hash-identical step keeps the printed state hash.
- `npm test`, `npm run check`, `npm run build`.
