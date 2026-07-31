# Resolve half-water shoreline cells without sealing the shore

**Area:** app · **Priority:** P1

`buildCollisionTerrain` classes a cell by its worst triangle (`worseGroundClass`), so a cell whose
`empa` is land and whose `empb` is water becomes `TERRAIN_IMPASSABLE`. A whole shoreline band drawn
with half-water cells is therefore unwalkable. The rule is a deliberate approximation (it keeps a
building wall off a half-water cell), but it is applied to walking as well as building.

This is what severs river crossings. A bridge's `LogicWalkBlockArea` is a parapet outline, not a
deck: inside that area's own bounding box the corridor the crossing runs through is mostly land
(`flagomania_1_0_01` `bridge wood 01` @(246,112) 41 land / 9 mixed / 22 water of 72 corridor nodes,
`zgielk2` `bridge small 01` @(224,71) 6 / 5 / 8 of 19, `straznicypolnocy` `bridge small 02` @(350,218)
6 / 5 / 5 of 16, `zgielk2` `bridge wood 02` @(66,89) 47 / 15 / 40 of 102). The mixed cells in that
corridor are the cut.

`content/collision.ts` currently drops a bridge's walk body entirely so the crossings work at all.
That contradicts the map's own derivable `lmwb` plane, which bakes bridge block areas like every
other object's, and it lets settlers walk the parapets and abutment stonework. Fixing the ground rule
is what makes that exception removable.

## Scope

- Split the collapse per flag instead of taking one worst class: a mixed cell keeps the conservative
  build refusal but stays walkable (`TERRAIN_MARGIN`), while both-water stays `TERRAIN_IMPASSABLE`.
- Confirm against the real triangle flags before changing the rule: check whether the original
  blocks walking per triangle or per cell, and record which it is.
- Then revert the bridge exception in `objectFootprints` and re-verify the crossings with the walk
  body stamped again.
- Do not extend this to a per-triangle sub-cell nav resolution; the half-cell lattice is the grid.

## Verify

- Unit test in `packages/app/test/collision.test.ts`: a land/water mixed cell is walkable and not
  buildable; a both-water cell stays impassable.
- With the bridge body stamped again, each of the four crossings above still joins its two banks, and
  no map gains a nav component.
- A settler ordered across a `zgielk2` bridge walks the corridor, not the parapet.
- `npm test`, `npm run check`, `npm run build`, and `npm run test:content` pass.
