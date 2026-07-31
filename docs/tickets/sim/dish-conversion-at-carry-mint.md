# Convert a dish at the carry-mint seam, not only at store pickup

**Area:** packages/sim · **Priority:** P3

`exportedGoodForm` (`systems/readviews/food.ts`) turns a dish into its edible form, and
`pickupFromStore` applies it. That covers goods lifted out of a STORE, but not the seam that mints a
good straight onto a settler's back: the bare-node pluck in `atomics/effects/goods/harvest.ts`, which
`addCarry`s the node's own `goodType` with no ground stage between. A hunter's carcass nodes (spawned
by `combat/hit/carcass.ts`) are bare nodes, so every hunted meat unit now flows through this one seam.

So a hunter carries RAW meat, and `planDelivery` routes the raw form. `work_animal_farm` is the only
holder of good 21 in the decoded IR, so that load reaches the animal farm, piles at the hunter's flag,
or is shed at its feet. `carriedGoodForm` converts only on a lift out of a building that PRODUCES the
good, and a `GroundDrop` produces nothing, so a heap lift keeps the meat raw: it becomes edible only
when a carrier lifts it back out of `work_animal_farm`. Not a regression, raw meat had no larder sink
before this branch either, but it contradicts the readview's "a dish becomes an edible on the way out"
framing, whose doc comment now names this exception.

## Scope

- Decide the seam: apply `exportedGoodForm` at the bare-node pluck mint, or once in `planDelivery`
  before routing. One place, not two. Do NOT sweep every `addCarry` caller: `pickupFromStore` already
  passes `carriedGoodForm` and would double-convert, and the equip and stow callers re-shoulder a worn
  item rather than minting one.
- A hunter's kill then banks as `food_simple` on the first trip, instead of only after a round trip
  through `work_animal_farm`.
- Check the original first: `goodtypes.ini` gives meat `landscapeToHarvest`/`landscapeToPickup` 80 and
  `landscapeToStore` 44 — three distinct landscape stages — which may mean the original really does carry
  raw meat to a store and convert there. If so, the current behaviour is the faithful one and this ticket
  closes as "no change", with the finding recorded in the readview comment.

## Verify

`npm test`, `npm run check`. A golden may legitimately move if any golden fixture hunts — check which
before updating, and name the mechanic in the commit.
