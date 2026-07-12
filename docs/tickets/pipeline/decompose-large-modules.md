# Decompose the remaining oversized asset-pipeline modules

`tools/asset-pipeline/src` — after the `ini.ts` split, these modules are still over the ~300-line
budget (`npm run scan:structure`) and fold several concerns into one file. Split each by domain
concern into a feature subfolder with an `index.ts` barrel (external import paths stay stable), moving
bodies verbatim — a move, not a rewrite. Behavior-preserving: 397 round-trip tests + a byte-identical
`content/` regeneration guard it. One module per commit.

## 1. `decoders/mapdat.ts` (731) — five concerns
- container decode/`findChunk`/`decodeMapSize` (`102-173`) + container ENCODE (`175-220`)
- the X8el byte-RLE codec (`222-408`) and the X6el u16-RLE codec (`410-577`) — near-duplicates
  (see the `decoder-shared-utils` ticket §5; do that dedup either before or as part of this split)
- the half-cell→terrain semantic reduction `reduceHalfCellsToCell`/`lmltToTerrainMap` (`579-686`) —
  this is stage-level *policy* (it even documents an APPROXIMATED rule with no oracle), arguably not
  on-disk format; consider moving it to a `stages/maps/` helper rather than the decoder
- the string-dictionary parse `decodeStringListChunk` (`688-730`)

## 2. `decoders/bmd.ts` (499)
Extract the `ByteReader`/`ByteWriter` (`127`/`269`) to the shared reader (other ticket), then split
the container decode (`readCMemory`/`decodeBmd`, `165-266`) from the packed-line RLE pixel codec
(`BobFrame`/`decodeBobFrame`, `369-499`).

## 3. `decoders/ini/graphics-bindings.ts` (440)
Left oversized by the ini split. It bundles: the palette/BMD binding foundation (`PaletteAlias`,
`extractPaletteIndex`, `BmdPaletteBinding`, `extractGraphicsBindings`), landscape graphics
(`LandscapeGraphicsBinding`/`extractLandscapeGraphics`), bob-sequences + anim-atomics
(`extractBobSequences`/`extractGfxAnimAtomics`), and the indexed human-graphics managers
(`IndexedBobManager`/`parseIndexedBobManager`/`extractIndexedGraphics`/`extractJobBaseGraphics`/
`extractJobChangeGraphics`). Split into an `ini/graphics-bindings/` folder by these groups; keep the
barrel re-exporting the same public symbols so `decoders/ini.ts` is untouched.

## 4. Stage god-files
- `stages/gui.ts` (468): six independent sub-stages (atlases / palette-LUT / window-bitmap recolour /
  strings / cursors / manifest). Split by output; the shadow-lift colour math moves to the palette util.
- `stages/goods.ts` (408): palette-alias resolution + icon join + name-locale join + emit.
- `stages/bmd.ts` (360): the 100-line `resolveGraphicsBindings` orchestrator (`258-360`) inlines reads
  of 8+ ini/cif sources and has two duplicated `seen`-set dedup blocks (`302-308`, `345-352`).
- `stages/maps/terrain.ts` (323): each lane decoder repeats find-chunk → guard → unpack → length-check;
  `mapDatToTerrain` has 5 copy-pasted try/catch warn-and-omit blocks (`275-314`).

## 5. Param objects (fold in where the split already touches the signature)
- `convertBmdTree(bindings, palettes, outDir, opaqueAlphaBmds)` (`stages/bmd.ts:156`) — the first three
  already travel as a unit (`resolveGraphicsBindings` returns `{bindings, palettes, opaqueAlphaBmds}`);
  pass a `GraphicsBindingSet`.
- `perCellLaneFromMapDat(map, size, tag, label)` (`stages/maps/terrain.ts:227`) — `(map, size)` thread
  through every function in the file; collapse to a `DecodedMap { map, size }`.
- Minor: `stages/gui.ts:398`/`stages/lib.ts:54` use `ReturnType<typeof decodeX>` where a named exported
  type exists (`DecodedCursor`, …) — use the name. Dedup the `walkFiles`→`map.dat`/`map.cif` scan copied
  across `stages/maps/convert.ts:63` and `stages/maps/info.ts:47`.

## Verify
`npm test`, `npm run check`, `npm run build`, `npm run scan:structure` (the split modules should drop
off the oversized list). Regenerate `content/` and diff `ir.json` byte-for-byte against baseline.

## Source basis
Pure structural refactor; no mechanic/extraction change. Decoder correctness pinned by the existing
round-trip fixtures.
