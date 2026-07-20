# Spacing drives should not rest a unit on a door or in a sealed nook

**Area:** sim (movement/agents) · **Origin:** building-upgrades branch, 2026-07-18 · **Priority:** P3

The footprint eviction pass now refuses to LAND a displaced settler on a building's door node or on a
sealed nook (a walkable cell whose every orthogonal neighbour is walk-blocked) — see
`nearestFreeCellOutside` in `packages/sim/src/systems/movement/evict.ts` and `buildingDoorNodes` in
`systems/footprint/blocked.ts`. The idle spacing drives still can: `deStackIdle`'s `nearestFreeCell`
and `loiterCell`'s yard scan (`systems/agents/destack.ts`) accept any unblocked unoccupied cell, so a
de-stacked or loitering unit can come to rest on another building's door (visually inside the
building; a stray body on the node `presentOperatorCount` reads) or wedged in a nook between bodies.

Apply the same two target rules to both drives: exclude `buildingDoorNodes` (loiterCell already
excludes only its OWN anchor) and require at least one unblocked orthogonal neighbour. Both sets are
already built per planner tick in `SpacingState` consumers, so memoise them on `SpacingState` beside
`blockedCells`. Keep canonical search order; expect no golden movement unless a scenario actually
rests a unit on a door/nook (if one moves, that is the intended behavior change — name it in the
commit). Test like `evict.test.ts`'s nook cases: a stack beside a doored/U-walled fixture must fan
out onto open cells only.

**Update (2026-07-20, needs-pacing branch):** the rest-spot rung
(`systems/agents/rest-spot.ts` `isOpenGround`) landed a third, independent version of the
"require an unblocked neighbour" clearance — for choosing where a tired settler lies down. There are
now three "where may a unit come to rest" rules in the tree: `evict.ts`, the two drives this ticket
names, and rest-spot. Fold them onto one shared predicate as part of this work rather than adding a
fourth; `rest-spot.ts` also traverses blocked nodes while refusing to land on them, which the others
may or may not want. See the related dedup ticket
[ring-search-duplicated-three-ways](ring-search-duplicated-three-ways.md).
