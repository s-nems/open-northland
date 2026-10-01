# Bound each fighter's per-tick target search at army scale

**Area:** sim · **Focus:** conflict · **Priority:** P3

Measured on the `magiczny_las` six-AI checkpoints (`bench-out/ml6.t80000` and `ml6.t100000`, 625 and 885
fighters, 3000-tick CPU profiles). `combat` is 7.5% of the tick at t80k and 13% at t100k. Its largest
terms are the combat index build (`CombatIndex` constructor, 3.8%: `CombatGrid.syncUnits` and `moveUnit`
2.4%, `firingBuildings` 0.5%), then `heldOrPicked` 1.2% and the chase 0.8%. The target search this ticket
covers is `CombatIndex.bandScan` at 0.63% inclusive (`appendBand` 0.53%) and `nearestFew` at 0.65%, under
`pickByTier`, `lessCrowdedInReach`, `fleeDrive` and the vehicle scan.

`bandScan` (`conflict/combat-index.ts`) collects every hostile (member, node) key in the coarse cells of
the box around a seeker before the first candidate is offered, though `nearest` and `nearestFew` mostly
stop within a few map points.

## Scope

- Take the band's coarse cells lazily, in ascending order of a lower bound on their distance, and treat
  the sorted keys as final only below the next untaken cell's bound, so the scan stops where the consumer
  stops. The (distance, id) order, the per-depth reuse across tiers and the dedupe of a body admitted at
  several nodes stay as they are. Bounds over a cell whose nodes span `dx`/`dy` from the seeker at the
  nearest: Manhattan `dx + dy`; map points `max(dy, dx - 1 + ceil(dy / 2))`, checked against
  `hexDistanceBetween` over every node of a cell. The cell edge lives in `conflict/combat-grid.ts`
  (`COARSE_CELL_NODES`, unexported).
- With the owner's ruling, measured on the same battle first: doubling the chase and flight repath
  cadences (`REPATH_CADENCE` 8, `FLEE_REPATH_CADENCE` 6, `RESCAN_PERIOD_TICKS` with them) halves the
  repath and rescan load under contact at the price of a slightly later turn toward a moving target or
  away from a moving threat. The owner takes it only if the gain over the hash-identical cuts is large
  and the battle still reads well; it moves goldens.

## Verify

- Same state hash on both checkpoints and on `ON_BENCH_FIGHTERS=300 npm run bench:sim`; the combat
  tests unchanged, `combat-index-search.test.ts` included.
- A CPU profile at t100k: `bandScan` inclusive share down.
- `npm test`, `npm run check`, `npm run build`.
