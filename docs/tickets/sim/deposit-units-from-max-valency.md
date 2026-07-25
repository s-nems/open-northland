# Size mineral deposits from the record's LogicMaximumValency instead of the observed catalog constants

**Area:** app (catalog + map spawn) · **Priority:** P2

`catalog/mining.ts` sizes deposits from recollection (`STONE=5`, `CLAY=5`, `IRON=4`, `GOLD=3`), self-labelled
"demonstrative pending calibration". The data states the size explicitly: every `[GfxLandscape]` mine record
carries `LogicMaximumValency` (gold/iron/clay mines 5, stone rocks 4 or 5), already extracted and present in
`content/ir.json` as `landscapeGfx[].maxValency`.

The gap now has a player-visible cost. Since `feat/mine-deposit-levels` maps a placement's authored `lmlv`
level onto its starting yield, a good holding fewer units than its record authors states collapses its lowest
levels onto one unit — and a 1-unit deposit is destroyed by its first completed unit
(`harvest.ts` `depleteNode`), so it never emits `resourceMined`, never hands over to the sprite pool, and
never draws a shrink frame. Measured over the 125-map corpus: **60% of gold placements and 40% of iron
placements** spawn as such 1-unit deposits. A mid-size gold pile at `lmlv 3` pops out of existence after one
ore, so its decal stops predicting its yield for the two scarcest goods.

Deriving `units` from `maxValency` makes level L map to exactly L units and removes the collapse. Gold's mean
yield is unchanged from today (uniform mean of 1..5 is 3, exactly `GOLD_DEPOSIT_UNITS`) while it gains a real
5-step ladder; iron rises to a mean of 3.

## Scope

- Source a mined good's deposit size per placement from the record's `maxValency`
  (`packages/app/src/content/ir/rows.ts` `LandscapeGfxRow` does not expose it yet), falling back to the
  `catalog/mining.ts` constant for a record without one and for admin/scene spawns that have no record.
- Consider setting `MineDeposit.levels` per node to the same count rather than the flat `MINE_LEVELS = 5`.
  That makes `span === frames.length` in `resolveResourceDraw`, removing the ladder rescale and the last
  rounding mismatch between the static object layer and the sprite pool.
- Keep `catalog/mining.ts` as the sandbox/no-record source; note which values became data-derived.

## Verify

- Unit test: level L over a record of N states spawns exactly L units for each mined good.
- A regression test composing `authoredDepositUnits` → `depositVisualLevel` → `resolveResourceDraw` against
  the static layer's `stateIndexForLevel`, pinning that the two ladders agree. This is the one acceptance
  criterion `feat/mine-deposit-levels` left to human eyes, because the composed path crosses app and render
  and neither package can express it alone today.
- `?map=` with gold at `lmlv 3` — **user's eyes** that the pile shrinks rather than vanishing on the first
  chipped ore.
