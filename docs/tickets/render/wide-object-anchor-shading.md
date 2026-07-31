# Shade a wide landscape object across its span, not from one anchor cell

**Area:** render · **Priority:** P2

A map object takes the `embr` multiplier of its anchor cell alone (`content/objects.ts` passes
`brightness.brightnessAt(hx / 2, hy / 2)`). The ground under the same sprite samples the lane per
fragment, so any object wider than a cell is graded against ground it does not match.
`data/terrain/brightness.ts` already records the same failure for entities: one cell's value blackened
whole footprints on baked slope shadow.

Bridges make it obvious because they are the widest objects in the corpus (`ls_bridge` bob 3 is
498 px, about 7 cells) and they span a river gorge, where the lane's shadow band is narrow and deep.
On `zgielk2` the bridge at cell (19,12) anchors on `embr` 58 (×0.46) while the deck it carries runs
over cells at 100 to 190: the whole sprite draws muddy dark over lit ground. The bridge at (132,34),
anchored on 193, looks correct.

## Scope

- Grade a wide object across its own footprint instead of at one point. The two draw paths need
  separate answers: a tall object is a pooled `Sprite` carrying one flat tint (which also clamps at
  ×1, since a batch tint cannot brighten), a decor object a quad with one per-vertex constant.
- Decide what a sprite drawn above the ground plane samples: the deck art sits screen-up from the
  anchor, so a naive screen→cell inverse would read cells north of where the object stands.
- Record the choice as measured or approximated. There is no source evidence yet for how the
  original's alpha blit picks its shade argument for a multi-cell bob.

## Verify

- The `zgielk2` bridges at (19,12) and (132,34) both read as the same wood under different ground
  shading; no visible seam between a wide sprite and the ground it covers.
- Trees stay exempt (`UNSHADED_LANDSCAPE_TYPES`), waves and mine stains keep tracking the lane.
- Human browser pass on a slope-shadowed map; `npm test`, `npm run check`, `npm run build`.
