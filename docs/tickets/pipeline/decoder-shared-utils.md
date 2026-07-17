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
  `decoders/image.ts`. The LUT stacker **moved** there too (2026-07-17): `player-palette.ts`
  `buildPlayerLutImage` is now `decoders/image.ts` `buildPaletteLutImage` — it was never
  player-specific, and 3 of its 4 callers (font / GUI / goods LUTs) are not player colours. It still
  keeps its own row loop; folding it onto `paletteToRgba` is the **remaining** half. The index-in-red
  (`atlas` `expandBobFrameIndexed`) and BGR (`cur` `decodeDib`) variants are related but need
  channel-layout params — evaluate.
- The `[B,G,R,pad]` 256-entry colour-table write **landed** (2026-07-17): `palette.ts` `encodePalette`
  and `cur.ts` `encodeDib8` now share `writeBgraTable(out, offset, rgb)` in `decoders/image.ts`.
- The 768-byte palette guard: the constant is shared (`PALETTE_RGB_BYTES`, `decoders/image.ts`) but
  the assertion is copied with its own message 5×: `atlas.ts` `expandBobFrame`, `pcx.ts`
  `expandToRgba` + `encodePcx`, `palette.ts` `encodePalette`, `player-palette.ts` `assertPalette`,
  `cur.ts` `encodeDib8`.
- The palette shadow-lift colour math (`liftPaletteShadows`, now in
  `stages/gui/window-bitmaps.ts`) is a colour-domain concern buried in a wiring stage — move it
  beside the palette utils.

### 3. One case-insensitive path resolver

**Four** implementations answer "resolve a source path", each with *different* case semantics
(re-verified 2026-07-17):

| helper | case rule | used by |
|---|---|---|
| `roots.ts` `resolveSourceFile` | exact path | `stages/ir/{sources,cif-tables}.ts`, `stages/bmd/bindings.ts` |
| `stages/game-file.ts` `readSourceFile` | leaf filename case-folded | `stages/gui/*`, `fonts.ts`, `goods/*`, `pcx.ts` |
| `stages/maps/case-path.ts` `findPathCaseInsensitive` | every segment case-folded | `stages/maps/{meta,convert}.ts` |
| `roots.ts` `collectSourceFiles` | case-folded union walk | `stages/pcx.ts`, `stages/lib.ts`, the maps walk |

The consequence is concrete: **the same file resolves by two different rules in one run.**
`Data/logic/goodtypes.ini` is exact via `stages/ir/sources.ts` and leaf-folded via `stages/goods/icons.ts`;
`landscapes.cif` is exact via `stages/ir/index.ts` + `stages/bmd/bindings.ts` and leaf-folded via
`stages/goods/icons.ts`. Not a live bug on the owned corpus — every real `map.cif`/`map.dat`/
`staticobjects.inc` is uniformly lower-case, so all four rules agree today.

`stages/bmd/convert.ts` `indexOutTree` is a related but distinct thing (a normalized `rel→realPath`
index of the **output** tree, not the source roots); it now has a named `OutTreeIndex` type and is
built once per run and threaded into its five consumers (2026-07-17), so leave it out of the unify.

**Landed 2026-07-17:** the one read that bypassed all four — `stages/maps/convert.ts` read
`join(mapDir, 'map.cif')` directly while every sibling read in the same function went through
`findPathCaseInsensitiveInDirs` — now resolves case-insensitively per candidate dir.

**Remaining:** collapse the four into one resolver in `roots.ts` with one documented case rule. Note
this is only behavior-preserving *on the owned corpus*: it changes resolution on a case-sensitive
filesystem with mixed-case sources, which is the point. Resolution order is load-bearing for the mod
overlay — `roots.test.ts` + `overlay.test.ts` must stay green, and a regenerated `content/ir.json`
must stay byte-identical.

### 4. Shared LUT-PNG emit

The gui/font halves already share `stages/game-file.ts` `buildPaletteLut`
(`convertGuiPaletteLut`/`convertFontColorLut` are thin wrappers), and the indexed+preview atlas emit
now shares `emitIndexedAndPreviewAtlas` + `writeAtlasBeside` (same file). **Remaining:** the raw
`mkdir(BOBS_DIR)` + `writeFile(encodePng(buildPaletteLutImage(…)))` LUT-PNG emit is still copied at
`stages/goods/index.ts` (`convertGoodsStage`, the goods-palettes LUT), `stages/player-colors.ts`
(`convertPlayerColorLut`), and inside `buildPaletteLut` itself — extract one write-LUT-PNG helper.

### 5. Generic RLE run/literal codec

The high-bit run-vs-literal codec is written per element width in `decoders/mapdat/layers.ts`:
`unpackMapLayer`/`packMapLayer` (bytes) vs `unpackX6elLayer`/`packX6elLayer` (u16) differ only in
element width. Fold those twins first; `decoders/bmd/frame.ts` `decodeBobFrame` and the 0xC0 run codec
in `decoders/pcx.ts` are related but diverge more — evaluate after.

## Verify

`npm test` (round-trip suite), `npm run check`, `npm run build`. Then regenerate and diff:
`npm run pipeline -- --game "../Cultures 8th Wonder" --out content` must leave
`content/ir.json` (and the emitted atlases/LUTs) byte-identical to the pre-change baseline — a moved
byte means a decode changed.

## Source basis

Pure internal dedup; no mechanic/extraction semantics change. Decoder correctness is pinned by the
existing synthetic round-trip fixtures.
