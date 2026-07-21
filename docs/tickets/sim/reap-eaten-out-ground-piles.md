# Reap a loose ground pile emptied by eating

**Area:** sim · **Priority:** P2

`consumeFood` (`packages/sim/src/systems/agents/effects-goods/consume.ts:18-31`) decrements the
source stockpile and returns. It is the only stock-draining path that never calls
`reapEmptyLoosePile` — the reap has exactly one caller, `pickupFromStore`
(`effects-goods/transfer.ts:37`). The eat drive targets any positioned `Stockpile` holding a food
good, including loose yard heaps and dropped piles (`targets/food.ts` accepts every candidate in
`stockpileCells`), so the bite that takes the **last** unit of a ground heap leaves the pile entity
alive forever, holding a `{good: 0}` map entry. Nothing revisits an empty pile
(`storedFoodGood`/`lowestStockedGood` skip zero), so a long game accretes one dead
`Stockpile+Position` entity per eaten-out heap — plus the on-map zero-heap artifact
`reapEmptyLoosePile`'s own doc warns about (`piles.ts:110-116`: mis-renders as a flag, reads as
"free but unfillable" to the yard scan).

## Scope

- In `consumeFood`'s store branch, after decrementing, reap the source when emptied:
  `reapEmptyLoosePile(world, from)` (it already no-ops for warehouses/hulls — only loose piles
  vanish).
- Add a test: a settler eats a 1-unit ground heap down to zero → the pile entity is destroyed;
  eating from a building store leaves the store entity alive.
- Goldens containing an eaten-out ground heap may move — that is the intended behavior change;
  name it in the commit.

## Verify

`npm test`, `npm run check`, `npm run build`. The fuzz-determinism suite exercises eat paths;
confirm invariants stay green.
