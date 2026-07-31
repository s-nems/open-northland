# Resolve half-water shoreline cells without sealing the shore

**Area:** app · **Priority:** P2

`buildCollisionTerrain` classes a cell by its worst triangle (`worseGroundClass`), so a cell whose
`empa` is land and whose `empb` is water becomes `TERRAIN_IMPASSABLE`. A whole shoreline band drawn
with half-water cells is therefore unwalkable. The rule is a deliberate approximation (it keeps
a building wall off a half-water cell), but it is applied to walking as well as building.

Measured on the owned corpus: three bridge crossings stay severed purely because their authored
strip runs through mixed cells: `flagomania_1_0_01` `bridge wood 01` @(246,112), `zgielk2`
`bridge small 01` @(224,71), `straznicypolnocy` `bridge small 02` @(350,218). Each carries 12 to 15
mixed cells in the bridge footprint, and each joins into one component when a mixed cell resolves
walkable-but-unbuildable instead of impassable.

## Scope

- Split the collapse per flag instead of taking one worst class: a mixed cell keeps the conservative
  build refusal but stays walkable (`TERRAIN_MARGIN`), while both-water stays `TERRAIN_IMPASSABLE`.
- Confirm against the real triangle flags before changing the rule: check whether the original
  blocks walking per triangle or per cell, and record which it is.
- Do not extend this to a per-triangle sub-cell nav resolution; the half-cell lattice is the grid.

## Verify

- Unit test in `packages/app/test/collision.test.ts`: a land/water mixed cell is walkable and not
  buildable; a both-water cell stays impassable.
- The three bridges above join into one nav component; no map gains a component.
- `npm test`, `npm run check`, `npm run build`, and `npm run test:content` pass.
