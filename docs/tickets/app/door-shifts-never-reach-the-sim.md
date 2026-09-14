# Make the door settlers walk to agree with the door the own houses paint

**Area:** app · **Focus:** own-assets, content joins · **Priority:** P2 · **Complexity:** small

`DOOR_SHIFTS` (`packages/app/src/catalog/building-tweaks.ts`) is applied only in
`buildingFootprints(ir)` (`packages/app/src/content/ir/joins.ts`), and every browser entry passes that
map as `footprints` next to the real content set. `resolveWorldContent`
(`packages/app/src/game/sandbox/content/index.ts`) returns the real content set whole, so with local
content the sim, `buildingModels` and the door badges all use the extracted door and the shifts never
apply. Both files still claim the shift is the one seam that keeps the sim and the overlay agreeing.

Consequence: the five published house packages (`packages/app/src/assets/own/buildings/house-1..5`,
`doorNode {x: -1, y: 3}`) were aligned to the shifted door while the sim's door for `home_level_00..04`
is `(-2, 3)`, so on a real-content map a settler enters one node (34 world px) beside the painted
entrance. The farm, headquarters and stonemason packages match the extracted door. The art gallery
(`?art=gallery&tab=buildings&asset=buildings/house-1&geometry=1`) shows the gap as the reference
civilian standing beside the green cell.

## Scope

Pick one seam and delete the other:

- apply `DOOR_SHIFTS` where the real content set is merged (`mergeRealContent`), which moves the sim's
  walk-to-door target for the listed types and the goldens that place them; the farm package then
  needs `doorNode (0, 2)`; or
- delete `DOOR_SHIFTS`, the dead `footprints` wiring in `entries/map/boot.ts`, `entries/scene.ts`,
  `entries/backdrop.ts` and `entries/main-menu/network/save.ts`, and re-author the five house
  `doorNode`s (and their `entrancePixel`) to `(-2, 3)`.

Either way rewrite the two comments that describe the shift as the single seam.

## Verify

- `packages/app/test/building-points.test.ts` and `art-gallery-geometry.test.ts` pin the chosen door
  through the seam the sim uses, not through `buildingFootprints(ir)`.
- In the gallery with `geometry=1`, the civilian stands on the green cell for every house package.
- On a real-content map, a settler entering an own house stops on the painted doorstep.
- `npm test`, `npm run check`, `npm run build`; `npm run test:content` with local content.
