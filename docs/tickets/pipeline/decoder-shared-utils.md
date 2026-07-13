# Consolidate duplicated decoder/stage machinery in asset-pipeline

`tools/asset-pipeline/src` — the decoders and stages re-roll the same low-level machinery in many
places. Each item below is real duplication with 2+ call sites (found during the data+pipeline
refactor; the ini god-module and buildings-gfx dedup already landed — this is the cross-decoder
remainder). All are behavior-preserving: the 397 round-trip tests + a byte-identical `content/`
regeneration guard them. Do them as separate commit-sized units; a shared util lives in a new
`src/decoders/bytes/` (or similar) feature folder, not a flat `utils/`.

## 1. Adopt the shared `ByteCursor` at the inline-`DataView` sites
The reader consolidation **landed** (`decoders/byte-cursor.ts`: `ByteCursor` + `readCMemory` +
`LATIN1`): the three near-identical class readers were unified onto it, so `ByteReader`/`LibReader`
no longer exist and `bmd.ts`/`cif.ts`/`lib.ts` use `ByteCursor`. **Remaining:** the sites that still
re-roll inline `new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)` + explicit-LE getters
were not migrated — `decoders/{mapdat/layers.ts, palette.ts, fnt.ts, cursor.ts, pcx.ts, png.ts}` (and
the leftover raw reads in `bmd.ts`/`cif.ts`). Adopt `ByteCursor` there, and fold the `[u32 id][u32
version]` storable header (`palette.ts`, `bmd.ts`, `fnt.ts`) onto it. The lone remaining `ByteWriter`
(`bmd.ts`) has no duplicate and can stay.

## 2. Palette / RGBA utilities
- Indexed→RGBA expansion (`p=idx*3; rgba[o..o+3]=pal[p..]`) is implemented 3×: `pcx.ts:130`
  (`expandToRgba`), `atlas.ts:81` (`expandBobFrame`), `player-palette.ts:215` (`buildPlayerLutImage`).
- The 768-byte / "256 RGB triples" palette-size assertion has 5 copies, each its own message:
  `atlas.ts:76`, `pcx.ts:123`, `palette.ts:92`, `player-palette.ts:97`, `cursor.ts:250`.
- The palette shadow-lift colour math (`stages/gui.ts:269 liftPaletteShadows` + luma/HSV arithmetic)
  is a colour-domain concern buried in a wiring stage — move it beside the palette utils.

## 3. One case-insensitive path resolver
Three implementations answer "resolve a mixed-case path": `stages/bmd.ts:51 indexOutTree` (normalized
`rel→realPath` map; `player-colors.ts:51` then recomputes the same key by hand), `stages/game-file.ts:25
readGameFile` (leaf-only case-fold), `stages/maps/case-path.ts:12 findPathCaseInsensitive` (per-segment).
Unify to one resolver.

## 4. Shared LUT-PNG emit template
`encodePng(buildPlayerLutImage(ordered))` + `mkdir(BOBS_DIR)` + `writeFile(<stem>.png)` is copied at
`stages/gui.ts:217`, `stages/goods.ts:390`, `stages/fonts.ts:140`, `stages/player-colors.ts:84`. And
`stages/gui.ts:201 convertGuiPaletteLut` ≈ `stages/fonts.ts:124 convertFontColorLut` structurally
(read carriers → identity-fill missing → stack → write LUT). Extract one helper.

## 5. Generic RLE run/literal codec
The high-bit run-vs-literal codec is written per element width: `mapdat.ts:310 unpackMapLayer`
(bytes) and `mapdat.ts:479 unpackX6elLayer` (u16) differ only in element width; likewise their packers
`mapdat.ts:360`/`532`. `bmd.ts:460 decodeBobFrame` and the 0xC0 variant in `pcx.ts:83` are related but
diverge more — fold the two mapdat twins first, evaluate the others.

Also fold the two byte-identical ASCII-encode helpers `mapdat.ts:404 LATIN1ish` (misleading name — it
is an ASCII *encoder*, not a latin1 decoder) and `lib.ts:169 asciiBytes`.

## Verify
`npm test` (397 round-trip tests), `npm run check`, `npm run build`. Then regenerate and diff:
`npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content` must leave
`content/ir.json` (and the emitted atlases/LUTs) byte-identical to the pre-change baseline — a moved
byte means a decode changed.

## Source basis
Pure internal dedup; no mechanic/extraction semantics change. Decoder correctness is pinned by the
existing OpenVikings-oracle round-trip fixtures.
