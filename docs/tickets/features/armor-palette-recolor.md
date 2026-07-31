# Per-armor soldier recolor (the `human_armor_%3.3d` palettes)

A soldier wearing armor should be recognizable in the world. The original does this with a palette
recolor of the same body bob, not separate sprites: `the original`/`the original` carry the
format string `human_armor_%3.3d`, and `Data/engine2d/inis/humans/randompalette.ini` defines the five
recipes `human_armor_000`..`004` (indexed by `TArmorType` 0=none..4=plate). Each recipe overwrites
body-palette patches 5/9/11/12 with named 16-color ramps:

- wool (001): bright grey cloth; leather (002): brown hide (`hair brown`); chain (003): grey steel;
  plate (004): pale/bright yellow (polished plate).

Ramp names resolve through `Data/engine2d/inis/palettes/palettes.ini` (`[GfxPalette16] editname` →
`gfxcolorrange "<GfxPalette256 name>" <range>`), and the `[GfxPalette256]` sources are the palette
trailers of `Data/engine2d/bin/palettes/creatures/colors.pcx`, `colors_pale.pcx`, `hair.pcx` (range N
= indices `[16N, 16N+15]`, the same convention `player-palette.ts` uses for `Player NN` range 1). A
`Patch <a> <b> 10` line with a numeric source copies patch `b` onto patch `a` (the idiom
`composePlayerPalette` already implements for the player recipe's `Patch 5 10 10`).

## Task

Extend the existing player-color LUT mechanism (indexed character atlases + per-row palette LUT,
`tools/asset-pipeline/src/stages/player-colors.ts` + `decoders/player-palette.ts`):

1. Pipeline: decode the `human_armor_001..004` recipes and named ramps; compose LUT rows per
   (armor tier, player) as base → player recipe → armor recipe. Lay rows out `row = 16*tier + player`
   so rows 0-15 stay byte-identical to today's player-only rows (existing content keeps working; the
   `human_armor_000` recipe's patch-10 mirror onto 9/11/12 is deliberately not applied to tier 0 -
   named approximation, keeps current unarmored looks).
2. App: map the worn armor good to its tier (`armortypes.ini` `goodtype` 33-36 → `type` 1-4; the sim
   already indexes this as `armorByGoodType`) and hand the row scheme to render with the sheet data.
3. Render: read the worn `Equipment.armor` good in the unit snapshot readers (twin of
   `readEquipmentWeaponGood`), carry it on `DrawItem`, and select LUT row `16*tier + player` in
   `gpu/sprite-pool/bind-layers.ts` (today `row = item.player`). The details-panel portrait path
   (`hud/details-panel/worker-sprites.ts`) selects rows the same way.
4. Verify: `npm run test:pipeline` against the owned copy; the `equipment` scene (its soldier wears
   chain armor) plus a human browser pass on all four armors - recolors are pixels, not asserted.

Combat already honors worn armor (`targetMaterial`, `conflict/weapons.ts`); this ticket is the
presentation half. Related: `features/barracks-recruitment.md` (recruits fetching best-available
armor).
