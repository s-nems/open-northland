# Keep each seat's stock figure as a ledger instead of refolding the map per AI decision

**Area:** sim · **Focus:** stores, ai-player · **Priority:** P2

`seatStockOf` (`systems/stores/seat-stock.ts`) memoizes on the generations of `STOCK_STORES`, which
include the value generations of `Position` and `Carrying`. Those move on every tick with a walker, so
every AI seat decision (`SeatSupply.of` in `ai-player/workforce/supply.ts`, `upgrade-supply.ts`) pays
`deriveSeatStock` from scratch:

```ts
for (const e of world.query(Stockpile)) { /* every pile on the map; unowned ones become heaps */ }
for (const e of world.query(Owner)) { /* every owned entity of every seat */ }
const inReach = heapReach(anchors);
for (const heap of heaps) { /* ... */ if (inReach(nodeOfPosition(p.x, p.y))) add(/* ... */); }
```

`heapReach`'s test builds nine template-string keys (`${bx + dx}:${by + dy}`) per heap. Each decision
pays O(piles + owned entities), not the changes, and seven seats pay it on seven consecutive ticks.

Measured on `magiczny_las`, AI seats 0-6, profile from the 80k checkpoint (2000 ticks, busy box):
`seatStockOf` 3.3% of the whole profile, `deriveSeatStock` 3.0%, of which the closure `heapReach`
returns is 2.2% self time. It all lands on AI decision ticks, feeding the `aiPlayer` p95 and max in
[the AI decision ticket](ai-decision-tick-slicing.md).

## Scope

- Replace the string bucket key with a numeric one (`heapReach` is shared with the HUD model in
  `packages/render/src/data/hud/model.ts`, which benefits too).
- Keep per-seat totals across ticks with `JournaledCaptures`, the `FetchableStock` pattern: owned stock
  and upgrade inventories per seat from the `Stockpile`, `Owner` and `Upgrading` journals, carried units
  from `Carrying` and `Owner`, and heap contributions re-tested only for a heap that changed and for
  the heaps near an anchor (building or signpost) that appeared or left. Heaps and anchors do not move
  once placed; confirm that no in-place `Position` write reaches either before relying on membership
  journals alone.
- Register a verifier through `World.registerCacheVerifier` that compares every seat's ledger with
  `deriveSeatStock`, which stays as the reference.
- The figure is read-state, never hashed: the state hash must not move.

## Verify

- A test changes heaps, buildings, signposts, carried units and upgrades between reads and runs the
  verifier.
- On an idle box, `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5
  ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint npm run bench:profile` (checkpoint from one 100k
  `bench:map` run with `ON_BENCH_CHECKPOINTS=80000`, see `docs/DEVELOPMENT.md`, Measuring performance):
  `seatStockOf` below 0.3%, same state hash; `bench:map` for 4000 ticks from the same checkpoint and
  `npm run bench:compare` show the `aiPlayer` mean falling.
- `npm test`, `npm run check`, `npm run build`.
