# Recolour the carried load per good from the `good_<name>` palettes

**Area:** app (content/settler-gfx), pipeline · **Origin:** fix/carry-good-graphic, 2026-07-19 · **Priority:** P3
**Needs user:** yes — "does this load read as honey rather than a potion?" is a human-eye call.

Which carry cycle a good plays is now data-driven: the pipeline extracts the mod's `[gfxwalkatomic]`
records into `ir.json` `gfxWalkAtomics` and `carryAnimsByGood` binds from them. What is still missing is
the **second** layer the original applies on top — a per-good palette remap.

`Data/engine2d/inis/humans/randompalette.ini` defines 31 `good_<name>` **RandomPalette** records, two
`Patch` recolours each (`good_honey`: `Patch 14 "colors yellow"`, `Patch 15 "colors grey"`). They exist
for goods with an authored cycle of their own (`good_Wood`, `good_stone`, `good_crockery`) *and* for
goods that share someone else's (`good_honey`, `good_wool`, `good_herb`) — consistent with recolouring
whichever cycle `[gfxwalkatomic]` names, not with picking the cycle. The sharing is what makes it
load-bearing: honey and every potion both draw `human_man_generic_walk_potion`, and six amulets all draw
`walk_tile`, so without the remap a honey pot and a healing potion are pixel-identical in the player's
hands. The palette names do not join good slugs cleanly (`good_clay` for the `mud` good, `good_Wood`
capitalised, `good_holyoil` vs slug `holy_oil`), so the join needs its own resolution pass.

## Scope

1. Extract the `good_<name>` RandomPalette records in the pipeline (`randompalette.ini` is plaintext,
   already under `Data/engine2d/inis/`) into an IR lane beside the existing palette lanes; resolve the
   `good_<name>` → good-slug join explicitly rather than assuming a name match.
2. Apply the remap when drawing a carrying settler. `PalettedSprite` (`packages/render/gpu/paletted-sprite/`)
   already does band-limited palette remapping for team colour — extend that seam rather than adding a
   second recolour path, and keep it batched.
3. Confirm the two `Patch` slots' meaning against the sprites (which band is the load, which the
   container) before committing to a mapping; state the source basis.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:pipeline` for the extraction.
`packages/app/test/content/carry-looks.test.ts` must stay green.
Human pass: `?anim&char=civilian&filter=walk_potion` recoloured per good, then an in-game delivery of
honey vs a healing potion — they must be tellable apart at a glance.
