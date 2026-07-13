# Consolidate duplicated decoder/stage machinery in asset-pipeline

**Area:** pipeline · **Origin:** data+pipeline refactor review, 2026-07-12 (re-anchored 2026-07-13
after the mapdat/gui module splits) · **Priority:** P3

`tools/asset-pipeline/src` — the decoders and stages re-roll the same low-level machinery in several
places. Each item below is real duplication with 2+ call sites (re-verified 2026-07-13; the ini
god-module dedup, the class-reader unification, the ASCII-encode fold, and the gui/font LUT-helper
extraction already landed — this is the remainder). All are behavior-preserving: the round-trip test
suite + a byte-identical `content/` regeneration guard them. Do them as separate commit-sized units;
byte-reading utils extend `decoders/byte-cursor.ts`, colour utils live beside the palette decoders —
no flat `utils/`. Anchors below are file + symbol (line numbers rot).

## Scope

### 1. Adopt the shared `ByteCursor` at the inline-`DataView` read sites

`decoders/byte-cursor.ts` (`ByteCursor` + `asciiBytes` + `LATIN1`) and `readCMemory`
(`decoders/cif.ts`) already replaced the old class readers. **Remaining:** decode paths that still
re-roll `new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)` + explicit-LE getters —
`decoders/mapdat/{container,layers,dictionary}.ts`, `decoders/palette.ts` (`decodePalette`),
`decoders/fnt.ts` (`decodeFnt`), `decoders/cursor.ts` (`decodeCursor`), `decoders/pcx.ts`
(`decodePcx`), `decoders/png.ts` (`decodePng`), plus the leftover raw reads in `decoders/bmd.ts`
(`decodeBmd`'s bob/line table views) and `decoders/cif.ts` (the string-table offsets view). Adopt
`ByteCursor` there, and fold the `[u32 id][u32 version]` storable-header read (`decodePalette`,
`decodeBmd`, `decodeFnt`) onto it. Encoder-side `DataView`s over freshly allocated output buffers
and the lone `ByteWriter` (`decoders/bmd.ts`) have no duplicate and stay.

### 2. Palette / RGBA utilities

- Indexed→RGBA expansion (`p = idx*3; rgba[o..o+3] = pal[p..]`) is implemented 3×:
  `decoders/pcx.ts` `expandToRgba`, `decoders/atlas.ts` `expandBobFrame`,
  `decoders/player-palette.ts` `buildPlayerLutImage`.
- The 768-byte palette guard: the constant is shared (`PALETTE_RGB_BYTES`, `decoders/image.ts`) but
  the assertion is copied with its own message 5×: `atlas.ts` `expandBobFrame`, `pcx.ts`
  `expandToRgba` + `encodePcx`, `palette.ts` `encodePalette`, `player-palette.ts` `assertPalette`,
  `cursor.ts` `encodeDib8`.
- The palette shadow-lift colour math (`liftPaletteShadows`, now in
  `stages/gui/window-bitmaps.ts`) is a colour-domain concern buried in a wiring stage — move it
  beside the palette utils.

### 3. One case-insensitive path resolver

Three implementations answer "resolve a mixed-case path": `stages/bmd.ts` `indexOutTree`
(normalized `rel→realPath` map; `stages/player-colors.ts` `readCreaturePalette` then recomputes the
same normalized key by hand), `stages/game-file.ts` `readGameFile` (leaf-only case-fold),
`stages/maps/case-path.ts` `findPathCaseInsensitive` (per-segment). Unify to one resolver.

### 4. Shared LUT-PNG emit

The gui/font halves already share `stages/game-file.ts` `buildPaletteLut`
(`convertGuiPaletteLut`/`convertFontColorLut` are thin wrappers). **Remaining:** the raw
`mkdir(BOBS_DIR)` + `writeFile(encodePng(buildPlayerLutImage(…)))` emit is still copied at
`stages/goods.ts` (`convertGoodsStage`, the goods-palettes LUT), `stages/player-colors.ts`
(`convertPlayerColorLut`), and inside `buildPaletteLut` itself — extract one write-LUT-PNG helper.

### 5. Generic RLE run/literal codec

The high-bit run-vs-literal codec is written per element width in `decoders/mapdat/layers.ts`:
`unpackMapLayer`/`packMapLayer` (bytes) vs `unpackX6elLayer`/`packX6elLayer` (u16) differ only in
element width. Fold those twins first; `decoders/bmd.ts` `decodeBobFrame` and the 0xC0 run codec in
`decoders/pcx.ts` are related but diverge more — evaluate after.

## Verify

`npm test` (round-trip suite), `npm run check`, `npm run build`. Then regenerate and diff:
`npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content` must leave
`content/ir.json` (and the emitted atlases/LUTs) byte-identical to the pre-change baseline — a moved
byte means a decode changed.

## Source basis

Pure internal dedup; no mechanic/extraction semantics change. Decoder correctness is pinned by the
existing OpenVikings-oracle round-trip fixtures.
