# Key the building graphics join on the drawing entity's tribe

**Area:** app · **Focus:** content/sprite-sheet + render bindings · **Priority:** P2

`buildSpriteSheet` joins all four building graphics tables against `VIKING_TRIBE`
(`packages/app/src/content/sprite-sheet/human-sheet.ts`: house bobs, construction layers, upgrade
layers, overlays), the flag-point join does the same for sign and garrison anchors
(`packages/app/src/content/building-gfx/flag-points.ts`, whose own note records that the frank tower
authors a different mast height on the same typeId), and the details panel does the same for its icon
(`packages/app/src/hud/details-panel/assets.ts`). Render has nowhere to put a tribe either:
`SpriteBindings.building.byType` is keyed by `typeId` alone, and `layered.ts` looks the ref up with
that key only.

The extracted rows are already per-tribe (`buildingBobs` and `constructionLayers` carry `tribeId`,
and `building-gfx/families.ts` filters on it), so the join drops data the pipeline produced. A
saracen mill and a viking mill share a `typeId` and therefore draw the same Norse body.

This is decoded-map wide, not a placement edge case: of the 98 shipped maps that author buildings, 66
place bobs of a non-viking tribe, and 2675 of 3912 authored buildings resolve to tribes 2, 3, 4, 5 or
7. Placement now stamps the seat's roster tribe, so a player's own buildings join them.

## Scope

- Key the join on the drawing entity's tribe rather than a constant: a tribe dimension on the render
  binding, `Building.tribe` carried into the draw item, and the app-side ref tables built per tribe.
  Cover the flag-point anchors too, not just the bodies.
- Decide what the atlas loads. Packing six tribes' building bobs where one is loaded today is the
  cost driver; loading only the tribes a world actually fields is the obvious bound, and the choice
  belongs in the ticket's commit rather than left implicit.
- The animal and settler character lanes already resolve per tribe; leave them alone.

## Verify

- Unit tests over the per-tribe ref join: a type present for several tribes resolves each to its own
  bob, and a tribe with no row for that type falls back rather than drawing a wrong body.
- Measure the atlas size and load time before and after, since this multiplies the building pages.
- Human seam: `?map=wielka_inwazja`, whose human seat 0 is saracen and starts with 11 saracen
  buildings, and confirm the settlement reads as its own civilization, both for authored buildings
  and for one the player raises.
