# Execute the goods, stock, and technology opcodes

**Area:** sim · **Focus:** `systems/missions` · **Priority:** P2
**Blocked by:** [map-scripts-3-entities-and-ownership.md](map-scripts-3-entities-and-ownership.md)

Map-scripts epic, stage 5 of 10. Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md).

Scripts stock the player's buildings (`AddGoodsToHouses` 933 lines), drop goods on the ground
(`AddGoodsToMapArea` 368), unlock production (`EnableGood` 101, `EnableHouse` 52), and ask for
economic milestones (`GoodProduceable` 139 goals, `NumberOfGoodsInArea` 262).

## Scope

- Results `AddGoodsToHouses`, `AddGoodsToAnyStock` (warehouses that store the good, spilling to the
  next), `AddGoodsToMapArea` and `RemoveGoodsFromMapArea` (spiral outward until placed),
  `EnableJob`, `AllowJob`, `EnableHouse`, `AllowHouse`, `EnableGood`, `AllowGood`, mapped onto the
  progression system's gates. The original's extra good flags for three house types are an
  id-specific rule; express any needed equivalent as content data or leave it out and record the
  approximation.
- Goals `GoodsInHouses`, `GoodsGlobal`, `NumberOfGoodsInArea`, `NumberOfGoodsInHousesInArea`,
  `GoodProduceable`, `JobEnabled`, `NumberOfGoodsTraded`.
- Read the open progression tickets in `docs/tickets/sim/` on building unlock gates and job enabling
  first; the enable and allow flags must land in the same state those tickets reshape.
- Non-goals: vehicles and their cargo, tributes.

## Where to look

`packages/sim/src/systems/stores` (house stock), `systems/economy` (ground goods), `systems/progression`
(unlock gates), `components/rules.ts`.

## Verify

Headless scenarios per opcode, including the spill order of `AddGoodsToAnyStock` and an area count
that sums ground and house goods. Coverage delta. Normal gates, `npm run test:content` where a
real-content join is touched.
