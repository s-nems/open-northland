# Consolidate duplicated decoder/stage machinery in asset-pipeline

**Area:** pipeline · **Origin:** data+pipeline refactor review, 2026-07-12 (re-anchored 2026-07-13
after the mapdat/gui/bmd/goods module splits) · **Priority:** P3

`tools/asset-pipeline/src` — the decoders and stages re-roll the same low-level machinery in several
places. Each item below is real duplication with 2+ call sites (re-verified 2026-07-13; the ini
god-module dedup, the class-reader unification, the ASCII-encode fold, the gui/font LUT-helper
extraction, the shared `ByteWriter`, the pcx+atlas `paletteToRgba` extraction, and the inline-`DataView`
`viewOf` consolidation (item 1, 2026-07-14) already landed — this is the remainder). All are
behavior-preserving: the round-trip test suite + a byte-identical `content/` regeneration guard them.
Do them as separate commit-sized units; byte-reading utils extend `decoders/byte-cursor.ts`, colour
utils live beside the palette decoders — no flat `utils/`. Anchors below are file + symbol (line
numbers rot).

## Scope

### 1. Inline-`DataView` read sites — resolved (2026-07-14)

**Landed:** every fixed-layout decode site that re-rolled `new DataView(bytes.buffer, bytes.byteOffset,
bytes.byteLength)` — `decoders/mapdat/{container,layers,dictionary}.ts`, `palette.ts`, `fnt.ts`,
`cur.ts`, `pcx.ts`, `png.ts`, `bmd/container.ts`, and the `cif.ts` offsets view — now routes through
one `viewOf(bytes)` primitive in `byte-cursor.ts` (which the `ByteCursor` constructor uses too). That
is the right fix for these random-access decoders: this item's own note keeps the fixed-layout
serializers on `DataView` by design, so forcing sequential `ByteCursor` onto them was never wanted —
`viewOf` removes the boilerplate and the `new DataView(x.buffer)` slice footgun instead.

**Declined:** folding the `[u32 id][u32 version]` storable-header read (`decodePalette`/`decodeBmd`/
`decodeFnt`, plus `readCMemory`/`decodeCifStringArray`) onto one helper. It converges the per-format
error text the tests assert on (`/storable id is not CPalette/`, `/not a CFont/`, `/root is not a
CBobManager/`, `/not a CStringArray/`) — an observable behavior change — while each per-format message
is locally appropriate. Reopen only with an explicit decision to change those messages (and the tests).

### 2. Palette / RGBA utilities

- Indexed→RGBA expansion (`p = idx*3; rgba[o..o+3] = pal[p..]`): the closest pair **landed** — `pcx`
  `expandToRgba` and `atlas` `expandBobFrame` now share `paletteToRgba(pixels, palette, alphaOf)` in
  `decoders/image.ts`. **Remaining:** `decoders/player-palette.ts` `buildPlayerLutImage` is the same
  shape (fold it in); the index-in-red (`atlas` `expandBobFrameIndexed`) and BGR (`cursor` `decodeDib`)
  variants are related but need channel-layout params — evaluate.
- The 768-byte palette guard: the constant is shared (`PALETTE_RGB_BYTES`, `decoders/image.ts`) but
  the assertion is copied with its own message 6×: `atlas.ts` `expandBobFrame`, `pcx.ts`
  `expandToRgba` + `encodePcx`, `palette.ts` `encodePalette`, `player-palette.ts` `assertPalette`,
  `cursor.ts` `encodeDib8`.
- The palette shadow-lift colour math (`liftPaletteShadows`, now in
  `stages/gui/window-bitmaps.ts`) is a colour-domain concern buried in a wiring stage — move it
  beside the palette utils.

### 3. One case-insensitive path resolver

Three implementations answer "resolve a mixed-case path": `stages/bmd/convert.ts` `indexOutTree`
(normalized `rel→realPath` map; `stages/player-colors.ts` then recomputes the same normalized key by
hand), `stages/game-file.ts` `readGameFile` (leaf-only case-fold), `stages/maps/case-path.ts`
`findPathCaseInsensitive` (per-segment). Unify to one resolver.

### 4. Shared LUT-PNG emit

The gui/font halves already share `stages/game-file.ts` `buildPaletteLut`
(`convertGuiPaletteLut`/`convertFontColorLut` are thin wrappers), and the indexed+preview atlas emit
now shares `emitIndexedAndPreviewAtlas` + `writeAtlasBeside` (same file). **Remaining:** the raw
`mkdir(BOBS_DIR)` + `writeFile(encodePng(buildPlayerLutImage(…)))` LUT-PNG emit is still copied at
`stages/goods/index.ts` (`convertGoodsStage`, the goods-palettes LUT), `stages/player-colors.ts`
(`convertPlayerColorLut`), and inside `buildPaletteLut` itself — extract one write-LUT-PNG helper.

### 5. Generic RLE run/literal codec

The high-bit run-vs-literal codec is written per element width in `decoders/mapdat/layers.ts`:
`unpackMapLayer`/`packMapLayer` (bytes) vs `unpackX6elLayer`/`packX6elLayer` (u16) differ only in
element width. Fold those twins first; `decoders/bmd/frame.ts` `decodeBobFrame` and the 0xC0 run codec
in `decoders/pcx.ts` are related but diverge more — evaluate after.

## Verify

`npm test` (round-trip suite), `npm run check`, `npm run build`. Then regenerate and diff:
`npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content` must leave
`content/ir.json` (and the emitted atlases/LUTs) byte-identical to the pre-change baseline — a moved
byte means a decode changed.

## Source basis

Pure internal dedup; no mechanic/extraction semantics change. Decoder correctness is pinned by the
existing OpenVikings-oracle round-trip fixtures.
