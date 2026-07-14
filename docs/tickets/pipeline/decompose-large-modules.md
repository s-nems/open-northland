# Fold sprawling asset-pipeline signatures into param objects

**Area:** pipeline · **Origin:** /refactor-cleanup on tools/asset-pipeline, 2026-07-12 (rescoped
2026-07-13 — the `mapdat`, `ini/graphics-bindings`, `stages/gui`, `decoders/bmd`, `stages/bmd`, and
`stages/goods` splits + the `stages/maps/terrain` `tryLayer` fold all landed) · **Priority:** P3

`tools/asset-pipeline/src` — the oversized-module decomposition this ticket originally tracked has
**landed**: `decoders/mapdat/`, `decoders/bmd/`, `decoders/ini/bindings/`, `stages/goods/`, and
`stages/bmd/` are all feature folders with `index.ts` barrels now, `stages/gui/` was already split,
and `stages/maps/terrain.ts`'s five copy-pasted try/catch lane blocks collapsed into a `tryLayer`
helper. `npm run scan:structure` shows no oversized pipeline module. What remains is the
sprawling-signature cleanup where several values always travel together. Behavior-preserving: the
round-trip suite + a byte-identical `content/` regeneration guard it.

## Scope

### 1. `convertBmdTree(bindings, palettes, outDir, opaqueAlphaBmds)` → a `GraphicsBindingSet`

`stages/bmd/convert.ts` — three of the four params (`bindings`, `palettes`, `opaqueAlphaBmds`) are
exactly what `resolveGraphicsBindings` (`stages/bmd/bindings.ts`) returns as
`{ bindings, palettes, opaqueAlphaBmds }`. Thread that object as one `GraphicsBindingSet` param
(defined beside `resolveGraphicsBindings`) plus `outDir`, instead of destructuring it at the `cli.ts`
call site only to re-spread it.

### 2. `perCellLaneFromMapDat(map, size, tag, label)` → a `DecodedMap { map, size }`

`stages/maps/terrain.ts` — `(map, size)` thread through every lane helper in the file (`ground`,
`transitions`, `objects`, `elevation`, `brightness`). Collapse them into a `DecodedMap { map, size }`
decoded once in `mapDatToTerrain` and passed down.

While restructuring these lane helpers, drop two type/readability nits in the same file:
`transitions()`'s `lanes as [number[], number[], number[], number[]]` cast (build the four-lane tuple
directly so the arity is proven, not asserted) and `tryLayer`'s `plural: boolean` grammar flag (pass
the pre-pluralized noun phrase instead of toggling `'lanes'`/`'lane'` + `'them'`/`'it'` inline).

### 3. Named decoder types over `ReturnType`

`stages/gui/cursors.ts` (`ReturnType<typeof decodeCursor>` → the exported `DecodedCursor`) and
`stages/lib.ts` (`ReturnType<typeof decodeLib>['files']`) type locals as `ReturnType<…>` where the
decoder already exports the named type — use the names.

### 4. Dedup the map-tree scan

`stages/maps/convert.ts` and `stages/maps/info.ts` copy the same `walkFiles` → `map.dat`/`map.cif`
directory scan — extract one helper.

## Verify

`npm test`, `npm run check`, `npm run build` (`scan:structure` already clean). Regenerate `content/`
(`npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content`) and diff
`ir.json` byte-for-byte against baseline — a moved byte means a decode changed.

## Source basis

Pure structural refactor; no mechanic/extraction change. Decoder correctness pinned by the existing
OpenVikings-oracle round-trip fixtures.
