# Make derived output paths independent of the source layer's spelling

**Area:** pipeline · **Priority:** P2

Derived files are written at their source's relative path, while the app addresses them through fixed
routes: atlases by **basename** stem (`servedAtlasStem`, `packages/app/src/content/ir/joins.ts:10`)
under the flat `/bobs/` route (`BOBS_ROOT = Data/engine2d/bin/bobs`,
`packages/content-resolver/src/routes.ts:43`), matched case-sensitively
(`resolveFileUnderRoot`, `packages/content-resolver/src/under-root.ts:13`). Two source spellings break
that agreement.

**Subdirectories.** The routes agree only while every bob `.bmd` sits directly under `bobs/`.

The culturesnation mod breaks that: 17 `.bmd` referenced by real graphics bindings live in
`Data/engine2d/bin/bobs/nowe/` and `.../bobs/test/` (`f_bakery`, `f_druid`, `f_herb`, `f_krawiec`,
`f_potter`, `frank_mill`, `frank_well_hive`, `mur`, `frank_farmm`, plus their `_s` shadows). The shipped
`content/ir.json` already carries 23 `buildingBobs` rows pointing at them, so the app asks for
`/bobs/f_bakery.ship_house.png` and gets a 404 — the file is at `bobs/nowe/f_bakery.ship_house.png`.
`buildBobsIndexEntries` reads `bobsRoot` non-recursively, so the `?icons` gallery misses them too.

Before the loose-over-lib precedence fix these atlases were never generated at all (the index read only
the unpacked archive, which has no `nowe/`); now they are generated but unreachable.

**Directory casing.** The `.lib` unpack folds a member's head segment to the exact-case `Data/`
(`libMemberRelPath`, `tools/asset-pipeline/src/stages/lib.ts:21-28`) precisely because the routes match
case-sensitively; nothing folds a *loose* layer's spelling. A tree spelling `data/` or
`Data/Engine2D/Bin/Bobs/` writes every derived file outside its route on a case-sensitive host, and the
loaders read the 404 as absent content and fall back silently. Pre-existing for the `/textures/` pages
(the loose `.pcx` walk has always mirrored the loose spelling); the atlas stages now inherit it too. The
owned copy is consistent — all 1365 shared paths agree in spelling — so this is latent, not live.

## Scope

- Pick one convention for served atlases and apply it end to end: either emit subdirectory atlases flat
  under `BOBS_DIR` (rejecting a basename collision loudly), or carry the subpath through
  `servedAtlasStem`, `servedShadowStem`, the `/bobs/` route, and `buildBobsIndexEntries`.
- Canonicalize the served relative path of every derived file the same way for every layer, so the
  output tree's spelling stops depending on which layer won.
- Keep the existing stems byte-identical for every `.bmd` already directly under `bobs/`.
- Cover both with synthetic sources: one in a subdirectory, one in a differently-cased tree.

## Verify

`npm test`, `npm run check`, `npm run build`, and a real `npm run test:pipeline` against the owned copy.
Human review on `?map=` that the mod's bakery/potter/druid/mill/wall buildings draw their own bobs
instead of falling back.
