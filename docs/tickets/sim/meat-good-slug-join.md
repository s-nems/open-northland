# Converge the hunter cadaver yield on the slug-resolved meat good

**Area:** sim · **Priority:** P3

"Which good is meat" has two owners with conflicting resolutions. The hunter cadaver award
(`systems/settlers/atomics/effects/combat/hit/reactions.ts`) mints the numeric pin
`MEAT_GOOD = 21` (`readviews/tribes/animals.ts`), while the livestock feed-cycle byproduct
resolves meat by good slug (`livestockMeatGoodOf`, `core/content-index/livestock.ts`). Under the
sandbox catalog the two disagree: its `meat` rides the +100 catalog offset (`GOOD_MEAT = 121`),
so a sandbox hunter mints good 21, which no sandbox store or icon knows.

## Scope

- Route the cadaver award through `livestockMeatGoodOf` (skip the award when the content ships no
  meat good) and retire the numeric constant, or narrow it to the base-data documentation role.
- Check the sim hunter tests' fixture carries a good with slug `meat` (the livestock fixture
  already does).

## Verify

- `npm run check`, `npm test`; the hunter-strike tests still award meat, and a sandbox-content
  hunt awards the catalog's own meat id.
