# Convert a dish at the carry-mint seam, not only at store pickup

**Area:** packages/sim · **Origin:** fix/food-export-conversion review, 2026-07-20 · **Priority:** P3

`exportedGoodForm` (`systems/readviews/food.ts`) turns a dish into its edible form, and
`pickupFromStore` applies it. That covers goods lifted out of a STORE, but not the two seams that mint a
good straight onto a settler's back:

- `effects-goods/harvest.ts` — a hunter's cadaver yield. The decoded IR gives good 21 (`meat`) a harvest
  atomic (33), so this fires in real content.
- `effects-combat/hit/reactions.ts` — the same meat constant on a kill reaction.

So a hunter carries RAW meat, and `planDelivery` routes the raw form. `work_animal_farm` is the only
holder of good 21 in the decoded IR, so that load reaches the animal farm or is shed at the hunter's
feet; it becomes edible only on a second hop, when a porter lifts the ground heap (that pickup does
convert). Not a regression — raw meat had no larder sink before this branch either — but it contradicts
the readview's "a dish becomes an edible on the way out" framing, whose doc comment now names this
exception.

## Scope

- Decide the seam: apply `exportedGoodForm` where the carry is minted (`addCarry` callers in
  `effects-goods/`), or once in `planDelivery` before routing. One place, not three.
- A hunter's kill then banks as `food_simple` on the first trip instead of after a ground-heap round trip.
- Check the original first: `goodtypes.ini` gives meat `landscapeToHarvest`/`landscapeToPickup` 80 and
  `landscapeToStore` 44 — three distinct landscape stages — which may mean the original really does carry
  raw meat to a store and convert there. If so, the current behaviour is the faithful one and this ticket
  closes as "no change", with the finding recorded in the readview comment.

## Verify

`npm test`, `npm run check`. A golden may legitimately move if any golden fixture hunts — check which
before updating, and name the mechanic in the commit.
