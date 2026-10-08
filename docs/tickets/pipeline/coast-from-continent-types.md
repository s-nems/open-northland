# Take the land/water split from the map's continent table

**Area:** pipeline, app, sim · **Priority:** P3

`landVertexMask` (`packages/app/src/content/collision.ts`) decides land and water per cell from the
two ground triangles, so this build's coast can sit a node or two off the original's `lmco`
continents, in either direction. Ship rules that the original evaluates on its continent lane break on
such a coast: on `mroczny_swiat` the raid ships at (256,234) have `lmco` land three nodes away but no
walkable node within their door distance of 4, and the dock ring around (254,290) has no node of the
hull's size class here, while the original's `lmms` lane has one. Two named approximations now cover
this: `laneMooring` reads any `lmco` id other than the anchor's own as land, with a walkable-ring
fallback (`systems/vehicles/create.ts`), and `DOCK_RING_SLACK` widens the dock search
(`systems/vehicles/dock.ts`). An anchor the lane puts on land still misses the lane rule: across the
124 owned maps 1,275 plausible ship-site anchors read a land id under the ship.

The `laco` chunk holds the continent table, records `{ type, anchorX, anchorY, size }` with type 1
land, 2 water and record 0 type 0; on `Mroczny_Swiat` the sizes match the `lmco` node counts
(`docs/formats/MAPDAT.md` lists it as derivable and unverified).

## Scope

- Verify the `laco` layout across the owned maps, then import the per-continent type beside `lmco`.
- Read land/water per node from it in `buildCollisionTerrain`, or at minimum in the ship spawn test,
  and drop whichever of the two approximations above the import makes unnecessary.

## Verify

`npm run test:pipeline` for the import; `npm run test:content`, including
`scripted-attack-ships.test.ts`, with the ship spawn on a lane-land anchor mooring by type. A
walkability change on every map moves real-content goldens; name it in the commit.
