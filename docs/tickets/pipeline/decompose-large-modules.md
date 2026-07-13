# Decompose the remaining oversized asset-pipeline modules

**Area:** pipeline · **Origin:** /refactor-cleanup on tools/asset-pipeline, 2026-07-12 (rescoped
2026-07-13 — the `mapdat`, `ini/graphics-bindings`, and `stages/gui` splits already landed) · **Priority:** P3

Four `tools/asset-pipeline/src` modules are still well over the ~300-line budget (`npm run
scan:structure`, `wc -l`) and fold several concerns into one file (`decoders/atlas.ts` at 310 and
`stages/ir.ts` at 303 are marginal single-concern overages — deliberately left alone). Split each by domain concern into
a feature subfolder with an `index.ts` barrel (external import paths stay stable), moving bodies
verbatim — a move, not a rewrite. Behavior-preserving: the round-trip test suite + a byte-identical
`content/` regeneration guard it. One module per commit.

## Scope

### 1. `decoders/bmd.ts` (448) — three concerns
- the CBobManager container decode (`decodeBmd`, via `ByteCursor` + `readCMemory`)
- the container encode (`ByteWriter`/`writeCMemory`/`encodeBmd`)
- the packed-line RLE pixel codec (`BobFrame`/`decodeBobFrame`)

The `decoder-shared-utils` ticket §1 wants `decodeBmd`'s leftover inline `DataView` reads moved onto
`ByteCursor` and its RLE-codec item relates `decodeBobFrame` to the pcx run codec — do those before
or as part of this split to avoid moving code twice.

### 2. `stages/goods.ts` (406) — four concerns
Palette-alias resolution + palette loading (`loadPaletteAliases`/`loadGoodsPalette`), icon join
(`resolveGoodIcons`/`buildGoodIcons`/`loadGoods`), name-locale join
(`resolveGoodNames`/`loadGoodNames`), and the emit orchestrator (`convertGoodsStage` + the
manifest/constant block).

### 3. `stages/bmd.ts` (357)
The ~100-line `resolveGraphicsBindings` orchestrator inlines reads of 8 ini/cif sources and repeats
the same `(bmd, palette)` `seen`-set dedup-push block twice (the landscape and building legs) —
split it from the atlas-conversion half (`bmdToAtlas`/`convertBmdTree`/`indexOutTree`) and extract
the dedup helper. Param object while the signature is open: `convertBmdTree(bindings, palettes,
outDir, opaqueAlphaBmds)` — bindings/palettes/opaqueAlphaBmds already travel as a unit
(`resolveGraphicsBindings` returns `{bindings, palettes, opaqueAlphaBmds}`); pass a
`GraphicsBindingSet`.

### 4. `stages/maps/terrain.ts` (323)
Each lane decoder (`groundFromMapDat`/`transitionsFromMapDat`/`objectsFromMapDat`/
`elevationFromMapDat`/`brightnessFromMapDat`) repeats find-chunk → guard → unpack → length-check
(only partly shared via `perCellLaneFromMapDat`), and `mapDatToTerrain` has 5 copy-pasted try/catch
warn-and-omit blocks. `(map, size)` threads through every function — collapse to a
`DecodedMap { map, size }` param object while splitting.

## Verify

`npm test`, `npm run check`, `npm run build`, `npm run scan:structure` (the four modules drop off
the oversized list). Regenerate `content/` (`npm run pipeline -- --game "../Cultures 8th Wonder"
--mod DataCnmd --out content`) and diff `ir.json` byte-for-byte against baseline.

## Source basis

Pure structural refactor; no mechanic/extraction change. Decoder correctness pinned by the existing
round-trip fixtures.
