# Resolve half-water shoreline cells without sealing the shore

**Area:** app · **Priority:** P2

`buildCollisionTerrain` classes a cell by its worst triangle (`worseGroundClass`), so a cell whose
`empa` is land and whose `empb` is water becomes `TERRAIN_IMPASSABLE`. A whole shoreline band drawn
with half-water cells is therefore unwalkable. The rule is a deliberate approximation (it keeps a
building wall off a half-water cell), but it is applied to walking as well as building.

Measured on the owned corpus: three bridge crossings stay severed after bridges stopped stamping
their decks. Flooding the built grid from each deck's near row never reaches its far row, because
the deck's own half-cell nodes are impassable: `flagomania_1_0_01` `bridge wood 01` @(246,112) has
39 of 54 nodes impassable, `zgielk2` `bridge small 01` @(224,71) 8 of 16, `straznicypolnocy`
`bridge small 02` @(350,218) 11 of 14. A crossing that does work (`zgielk2` `bridge wood 02`
@(66,89)) leaves 27 of 54 walkable, which is the shape of a real authored strip.

Mixed cells are only part of the cause. Of the distinct ground cells under those three decks,
4 of 24 / 2 of 7 / 3 of 9 are land+water mixed, while 12 / 2 / 3 are water on **both** triangles. So
relaxing the mixed rule alone will not reconnect them, and the remaining question is whether the
original derives a bridge deck's walkability from the object lane rather than from the ground under
it.

## Scope

- Split the collapse per flag instead of taking one worst class: a mixed cell keeps the conservative
  build refusal but stays walkable (`TERRAIN_MARGIN`), while both-water stays `TERRAIN_IMPASSABLE`.
- Confirm against the real triangle flags before changing the rule: check whether the original
  blocks walking per triangle or per cell, and record which it is.
- Then re-measure the three crossings above. If they are still severed, that is the separate
  question of where a deck's walkability comes from; file it rather than widening this rule.
- Do not extend this to a per-triangle sub-cell nav resolution; the half-cell lattice is the grid.

## Verify

- Unit test in `packages/app/test/collision.test.ts`: a land/water mixed cell is walkable and not
  buildable; a both-water cell stays impassable.
- No map gains a nav component; report the per-deck node counts above after the change.
- `npm test`, `npm run check`, `npm run build`, and `npm run test:content` pass.
