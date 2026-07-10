# Sources & format reference

This project reads two sibling folders (read-only) at `~/Projects/vikings/`:

- `Cultures 8th Wonder/` — the original game **+ the `culturesnation` mod** (`DataCnmd/`). The
  *input* to the asset pipeline. Copyrighted; never copied into this repo.
- `OpenVikings_reversing/` — a C#/.NET binary-faithful reverse engineering. **Our format manual.**

## Original file formats (what the pipeline must decode)

Counts observed in `Cultures 8th Wonder` (base `Data` + `DataX` + mod `DataCnmd`):

| Ext | ~Count | What it is | Decode reference in OpenVikings (`Source/`) |
|---|---|---|---|
| `.wav` | 752 | sound effects (16-bit mono 22050 Hz PCM) | browser plays PCM natively (no transcode); `soundfx.cif` maps them to events/terrain, consumed by `@vinland/audio` |
| `.pcx` | 426 | palette-indexed pictures | `NXBasics/CPicture.cs`, `NXBasics/XBPictureTool.cs` |
| `.bmd` | 247 | "bob" framed sprite animations | `NXBasics/CBobManager.cs` (3.8k lines), `NXBasics/CBitmap.cs` |
| `.hlt` | 242 | lighting / remap tables | `NXBasics/CRemapTable.cs`, `CHighColorCreator.cs`, `CTrueColorCreator.cs` |
| `.cif` | 167 | compiled/**encrypted** "Cultures Information File" (rules, maps) | decrypt: `NXBasics/XBTools.cs` `XB_Decrypt_Memory`; also `NC2Logic/CIoHelper.cs`, `Dexter/DexMD5.cs` |
| `.ini` | 66 | **readable** rule config | trivial text parse; prefer these |
| `.sgt`/`.dls` | 49+ | **DirectMusic** segments/instruments — Windows-only | transcode offline to ogg; do not depend on DirectMusic |
| `.fnt` | 63 | bitmap fonts (CFont `0x3F5` wrapping a CBobManager `0x3F4`) — the **in-game UI set** (12 fonts under `Data/gui/fonts/{,latin,rus}`) is **decoded** by `decoders/fnt.ts` + `stages/fonts.ts` (see "Fonts" below); the per-map briefing/hypertext `.fnt` are out of scope | `NXBasics/CFont.cs` |
| `.lib` | — | packed archive (group + files + checksum) | `NXBasics/CSimpleFileLibrary.cs` |
| file IO base | — | low-level readers, endian | `NXBasics/CFile.cs`, `Dexter/DexterFile.cs`, `Dexter/DexterEndian.cs` |
| palettes | — | palette objects | `NXBasics/CPalette.cs` |

### Key facts learned from inspection

- **`.cif` is on the critical path — do NOT plan to avoid it.** Header begins `fd 03 00 00 ...`
  (high-entropy). **Decryption is already solved** in OpenVikings: `NXBasics/XBTools.cs`
  `XB_Decrypt_Memory` implements the `(in - 1) ^ key` scheme (~40 lines). The verified reality:
  - The primary **readable** rule sources are in **base** `Data/logic/*.ini` (goods, jobs,
    landscape, animals, vehicles, experience) — note they begin with a `<CULTURES_CIF_BEGIN>`
    header line but are otherwise plain text. The mod (`DataCnmd`) overlays only a *subset*
    (`houses.ini`, `weapons.ini`, graphics). NOTE the two distinct house files: `types/houses.ini`
    is the **logic** table (`[logichousetype]`: workers/stock/production/homesize), while
    `budynki12/houses/houses.ini` is the **graphics** table (`[GfxHouse]`: bob/coords) that ALSO
    carries the per-level `LogicConstructionGoods` **build-material cost** — the only readable source
    of construction cost, overlaid by `extractConstructionCosts` (the logic table has no cost key).
  - But **`housetypes`, `weapontypes`, `trianglepatterntypes`, and `atomicanimations` are
    `.cif`-only with no `.ini` twin**, and **every map is `map.cif`**. You cannot ship without them.
  - ~~The genuine unknown is therefore **not decryption but the decrypted payload/record layout**.~~
    **SOLVED** (see "CIF container format" below) and implemented in
    `tools/asset-pipeline/src/decoders/cif.ts`.

### CIF container format (solved Phase-1 spike)

A `.cif` is a serialized **`CStorable`** object graph. Every object on disk is
`[u32 id][u32 version][body]`; the factory (`XBStorable.cs`) maps ids to classes
(`0x3E9` CMemory, `0x3F3` CBitmap, `0x3F4` CBobManager, `0x3F5` CFont, `0x3F6` CPalette,
`0x3F7` CRemapTable, `0x3FD` CStringArray).

Type tables (`housetypes`, `weapontypes`, `trianglepatterntypes`, …) and **maps** root at a
**`CStringArray` (0x3FD)**, whose body is:

```
u32 forceSequentialIds, u32 stringCount, u32 usedIdCount, u32 slotCount, u32 stringPoolUsedBytes
CMemory offsets   = [0x3E9][ver][u32 size][size bytes]   -> decrypt(Mode1) -> u32[] offsets
u8  hasStringPool flag
CMemory stringPool = [0x3E9][ver][u32 size][size bytes]  -> decrypt(Mode1) -> NUL-terminated strings
```

`CMemory` on disk is just `[u32 size][size raw bytes]` — **not** auto-decrypted; the consumer calls
`Decrypt(Mode1)` (XBTools `XB_Decrypt_Memory`, `out = (in-1)^key`). The decrypted string pool is a
set of **depth-prefixed text lines**: the first byte is a nesting level (`1` = section header like
`logichousetype`, `2` = property like `debugname "headquarters"`), the rest is the same key/value
grammar as the readable `.ini`. Strings are latin1 in the oracle; display text with Polish glyphs is
CP1250 — re-decode at the IR layer where it matters, not in the container decoder.

Verified end-to-end — counts here are **raw decoded string-lines out of the container**, not
extracted records (the extractor collapses a section's header + property lines into one record, so
its counts are smaller — see the ground-graphics section): `housetypes.cif`
(798), `weapontypes.cif` (2995), `trianglepatterntypes.cif` (82 lines = **10** `TrianglePatternType`
records: 10 headers + 72 properties), and `CnModMaps/tutorial_001/map.cif` (476, incl. `mapsize`,
`mapguid`, `MissionData`). A map's **declarative logic-header metadata** (`mapsize`/`mapguid` from
`logiccontrol` + `misc_maptype`/`misc_mapname`) is now extracted to a `MapInfo` IR record by
`decoders/ini.ts` `extractMapInfo` and wired into the pipeline (`cli.ts` `decodeMapTree` → 13 maps).
The map's **binary tile grid is NOT in `map.cif`** — that file is *only* the logic-header
`CStringArray` (0 trailing bytes, confirmed on two real maps). The grid lives in the sibling
**`map.dat`** (see below). The `map.cif` string-array ALSO carries the campaign layer as readable
`level`-tagged lines once decoded (`decoders/cif.ts` `decodeCifStringArray`): a `MissionData`
section per trigger (goal/result opcodes), a `playerdata` section (per-player + diplomacy), and —
the key one for map import — a **`StaticObjects`** section of the map's authored placements. Its
verbs (counts on `SPECJALNA- MOSTY NA RZECE`, a 6-player map): **`sethouse` 62**, **`sethuman` 168**,
**`setanimal` 433**, plus `addgoods`/`setproducedgood`/`setguide`. Line grammar (all coords are
**half-cells** — the 2W×2H lattice `emla` uses; `÷2` → cell):

```
sethouse  <class=5> "<GfxHouse EditName>" <level> <player> <X> <Y> <rot>   e.g. "viking headquarters house" 0 1 171 330 2
sethuman  <player 0-based> "<tribe>" "<role>" <X> <Y> <a> <b>              e.g. "viking" "civilist" 385 83 0 0  (trailing <a> <b> semantics unknown, dropped)
setanimal <...> <X> <Y> <...>
addgoods  "<good>" <amount>            # applies to the preceding sethouse's stock
```

The building **name is the original `[GfxHouse]` `EditName`** ("viking tower", "viking bakery", …),
NOT the clean IR `id`; `<level>` selects among the leveled typeIds (`"viking home" 4` → `home_level_04`).
So resolving a placement to a sim `typeId` needs the `EditName`+`level → LogicType` map, which lives in
the `[GfxHouse]` graphics sections the pipeline already walks (`extractBuildingBobs` et al.). Importing
these placements (replacing the app's synthetic first-walkable-cells fallback) is a tracked slice —
see `docs/plans/`.

### `map.dat` chunk container (located Phase-2 spike — tile grid found, decode pending)

The per-cell landscape grid + entity map sits beside `map.cif` as **`map.dat`** (e.g.
`CnModMaps/tutorial_001/{map.cif 19 KB, map.dat 576 KB}`). It is a flat sequence of **`hoix`
chunks** — the engine's `CIoHelper` container format (oracle: `NC2Logic/CIoHelper.cs`
`SIoHelperChunk` / `IO_File_Chunk_*`; **format only**, not its architecture). Each chunk is a
**0x20-byte header** then `Length` payload bytes, read sequentially to EOF (0 trailing bytes on
both probed maps):

```
+0x00 u32 Marker   = 0x78696F68 "hoix"
+0x04 u32 Id       = a 4-char subtag; the 4 bytes read low→high spell it reversed (disk "zisl" = tag "lsiz")
+0x08 u32 Version
+0x0C u32 Length   = payload size in bytes (0 for bracket/group chunks)
+0x10 u32 Depth    = nesting level (groups bracket sub-chunks; MaxChunkDepth=5)
+0x14 u32 Checksum
+0x18 u32 / +0x1C u32 reserved
```

Chunk order on a real tutorial map (40 chunks): a **landscape group** (`logi`,`lgmm` brackets →
`lsiz`,`lmhe`,`lmpa/lmpb`,`lmlt`,`lmlv`,`lmms`,… terminated by `xend`) then an **entity/object-map
group** (`emmm` → `embr`,`empa/empb`,`emt1..4`,`emla`,… → `xend`) then `tend`. Decoded facts:
- **`lsiz`** payload = `[u32 width][u32 height]` — cross-checks the `map.cif` `mapsize` **exactly**
  (tutorial_001 128×218, tutorial_002 142×146). The one *raw* chunk (8-byte payload).
- The grid layers are **RLE-packed planes** — decoded (`decoders/mapdat.ts` `unpackMapLayer` for the
  byte `X8el` codec, `unpackX6elLayer` for the u16 `X6el` codec). The 21-byte inner header
  (reverse-engineered across 5 real maps; the original engine's packer is not in the oracle) is:
  `[u8 ver][u32 innerSize]` then the on-disk marker **`"kcp"`** ("pck" reversed, like a chunk tag) +
  the codec id **`X8el`/`X6el`** (the `8`/`6` is the element bit depth: u8 vs u16) + a constant
  **`0x72`** sub-format byte + `[u32 unpackedLength][u32 innerSize-again]`, then the packed stream to
  the payload end. The codec **is** the `.bmd` packed-line family (`CBobManager.cs`) with the raw/run
  roles swapped: a control byte with the high bit **set** = a run of `(b&0x7F)` copies of the next
  element, **clear** = a literal run of `b` elements; decode stops at exactly `unpackedLength`.
- **Layer resolutions.** A "4 B/cell" landscape lane is NOT a per-cell corner quad: it is a plain
  **row-major `2W × 2H` half-cell grid** (pinned by rendering the lanes as images — the half-cell
  layout draws the map's island shapes cleanly; a per-cell 2×2 interleave draws two side-by-side
  half-res copies). `lmhe` (height, 0..250 observed) and `embr` (~127-centred, a brightness/shading lane) are
  per-CELL (1 B); `empa`/`empb`/`emla` are u16 half-cell...-vs-cell as below.
- **Lane semantics** (pinned empirically on `Arabskie Wyspy` + cross-checked against the decrypted
  `landscapes.cif` twin; exact per-lane count matches):
  - **`lmlt`** (u8, half-cell) — the **logic landscape-OBJECT type**: raw value **IS** the 1-based
    `landscapetypes.ini` typeId of the object standing there (`[GfxLandscape].LogicType` — clay-mine
    decals hold 12 = `mud_mine`, palms 4 = `tree`, wave fx 1 = `void`), raw **0 = no object**.
    `lmltToTerrainMap` reduces each cell's 2×2 half-cell block to the dominant value (0 → `void`).
  - **Half-cell VERBATIM anchoring** (what the sim's collision join relies on): stamping each `emla`
    placement's `LogicWalkBlockArea` offsets verbatim at its half-cell anchor aligns with the map's
    own `lmlt` lane best — measured on `oasis_o_plenty` + `WICHRY_ZIMY`: ~55 % of stamped nodes hit
    an lmlt-marked node at matching total magnitude (≈46k stamped vs ≈53k marked), the old ÷2 cell
    collapse over-stamps ~2× at 33–42 % precision, and every ±1 anchor shift scores strictly worse
    than zero shift. Best-available ALIGNMENT evidence, not a byte-exact proof (the residual sits in
    unconsumed per-half-cell flags like `lmlv`).
  - **`empa`/`empb`** (u16, per CELL) — the **1:1 ground pattern per triangle** (A/B): an index into
    the map's own `eapd` pattern-name dictionary → a `pattern.cif` `[GfxPattern]`. **The editor bakes
    its pattern algorithm's OUTPUT into the save** — no algorithm needs reversing for 1:1 ground.
  - **`emla`** (u16, half-cell) — the **placed landscape object**: an index into the map's `eald`
    dictionary → a `landscapes.cif` `[GfxLandscape]` record by `EditName` (every tree/stone/bush/
    mine decal/animated wave; 0xffff = none). The sea is covered in `wave`/`fx wave` records — the
    water surface IS placed wave objects.
  - **`lmpa`/`lmpb`** (u8, per cell) — the per-triangle **logic pattern type**
    (`trianglepatterntypes.cif` ids: water/land/mountain/… — the walkability/water classification).
  - **`lmms`** — water-depth/shore gradient bands (rings 1..6 around land, 7 = open sea);
    **`lmtw`** — coastline transition codes (63 = not-coast); **`lmco`** — island/region ids
    (connected components); **`lmlv`**/`lmwb`/`lmbb`/`lmsb`/`lmpr` — further per-half-cell flags
    (unconsumed). **`emt1..emt4`** (u8, per cell, 255 = none) — the per-TRIANGLE **transition
    overlays** (see "terrain tessellation" below): `emt1`/`emt2` = layer 1 (topmost) for triangles
    A/B, `emt3`/`emt4` = layer 2; a value `v < 255` selects transition `⌊v/6⌋` from the map's
    `eatd` dictionary and pair variant `v % 6` of the record's six UV pairs. The earlier
    "superseded roads/foundations overlays" reading was wrong — these lanes ARE the organic
    biome-seam look.
- The record-list chunks are **name dictionaries + object tables**: `eapd` = the `[GfxPattern]`
  EditName list (927, positional — how a map references patterns version-robustly BY NAME), `eald` =
  the `[GfxLandscape]` EditName list (866), `eatd` = the `transitions.cif` `[transition]` name list
  (38 — the `emt*` lanes' `⌊v/6⌋` join target);
  `laco`/`lasw`/`lafm` are binary record lists (coords + ids — unconsumed). Grammar: `[u32 count]`
  then `[u8 len][bytes][0x00]` per entry (`decodeStringListChunk`).

**Status:** container + both packed codecs + the dictionaries are decoded, and the pipeline emits the
full render model per map (`stages/maps.ts` `mapDatToTerrain`): the sim grid (`typeIds`, from `lmlt`)
+ `ground` (per-triangle pattern names, from `empa`/`empb`+`eapd`) + `objects` (sparse half-cell
placements, from `emla`+`eald`) → `content/maps/<id>.json`, all consumed by the renderer end-to-end
(`?map=<id>`); the per-cell `elevation` lane (raw height, from `lmhe` — 1 byte/cell, 0..250 observed) rides
along too (`elevationFromMapDat`) and is consumed by the render elevation lift
(`packages/render/src/data/elevation.ts`), and the per-cell `brightness` lane (baked shading, from
`embr` — 1 byte/cell, 127 = neutral, border rows 0) is consumed by the ground's per-fragment shading
+ the landscape-object anchor multiplier, response curve luminance × embr/127 measured against the
reference corpus (`packages/render/src/data/brightness.ts`); and the `transitions` layer
(`emt1..emt4` + `eatd`, verbatim — `transitionsFromMapDat`) is consumed by the ground's
per-triangle transition compositing (see "terrain tessellation" below). **Remaining:**
`lmpa`/`lmpb` → sim water/walkability, `laco`/`lasw`/`lafm`. (No decoded
bytes are committed — `map.dat` is copyrighted input, like every other game file.)
- **Atomic actions are the behavior vocabulary** (see docs/ECS.md) and are partly free in readable
  data: `tribetypes.ini` `setatomic` (atomic→animation per tribe), `jobtypes.ini` `allowatomic`,
  `goodtypes.ini` `atomicFor*`. The atomic *timings/effects* live in `atomicanimations.cif` — **but
  the mod ships a readable twin** `DataCnmd/atomicanimations12/atomicanimations.ini` (~6900 lines:
  `length`, `event <frame> <kind> <arg>`, `startdirection`, `interruptable`). This defuses a top
  plan risk: the timings are not blocked on `.cif` reversing. Calibration-by-observation may
  still be needed for tuning, but the vocabulary *and* base timings are free.
- **Rules are largely declarative, behavior is not.** The type tables (`Data/logic/` +
  `DataCnmd/types/`) make the *rules* port tractable. The *behavior* — settler AI/atomic planner,
  the economy feedback loops, pathfinding, atomic timings — is the hard part and is **not** in the
  data nor reversed in OpenVikings (its logic tick is a stub counter).
- **Mod content** (`DataCnmd`) is data + new campaigns (`OsmyCudSwiata` = 8th Wonder,
  `WyprawaNaPolnoc` = expedition north, `BramyAsgardu` = gates of Asgard) + ~125 maps in
  `CnModMaps/`. It is portable to a new engine as content, not as binary patches.
- **OpenVikings status (as of its Feb 2026 commits):** boots an SDL window, decodes graphics,
  loads archives, renders intro — but the **game simulation is not implemented** (its logic tick
  dispatcher just increments a counter). So it helps us with *formats*, not with *mechanics*.

### Terrain ground graphics + landscape objects (data model mapped — render WIRED 1:1)

Two graphics families sit beside the map grid; **both decode with existing decoders** (`.bmd`/`.pcx`/`.cif`).

- **Landscape OBJECTS** (trees, bushes, signs, wonders, harbours, waves) — `Data/engine2d/inis/landscapes/landscapes.cif`,
  a `.cif`-only `[GfxLandscape]` list (866 records): the `[jobgraphics]` analog for static map decor. Each record carries
  `EditName "yew 01"`, `EditGroups`, the **logic half** (`LogicType` = a `landscapetypes.ini` typeId,
  `LogicMaximumValency`, `LogicIsWorkable`, repeated `LogicWalkBlockArea`/`LogicBuildBlockArea`/`LogicWorkArea`
  footprints — the future object-collision data), `GfxBobLibs "<body>.bmd" "<shadow>.bmd"` (e.g.
  `ls_trees.bmd`/`ls_trees_s.bmd`), `GfxPalette "<editname>"` (resolved via `palettes.ini`, e.g. `tree_yew01` →
  `palettes\landscapes\tree_yew01.pcx`), per-state `GfxFrames <stage> <bobIds…>` (a loop-animated record's frame
  list — trees sway, waves roll), `GfxStatic`/`GfxLoopAnimation`, `GfxDynamicBackground` (set on exactly the 8
  wave records = the translucent water blit) and `GfxTransition` (unconsumed). A decrypted twin ships in
  `EdytorByRemik/ajhefbcsirbdvbkuysrghdkrbg.ini`. **WIRED twice:** `extractLandscapeGraphics` derives the
  `(bmd, palette)` atlas work list → `convertBmdTree`; `extractLandscapeGfx` extracts the FULL table into IR
  (`landscapeGfx`) — a decoded map's `objects` placements join onto it by `EditName` and the app draws every
  placed object with animation (`app/src/content/objects.ts` → `WorldRenderer.setMapObjects`). The **same atlas path covers
  `ls_houses_*.bmd`** for the buildings — see "Building graphics families" below.
- **Ground TEXTURES** (the triangle-mesh terrain) — `Data/engine2d/bin/textures/text_*.pcx` (58) + `tran_*.pcx`
  (27 transition tiles), 64-px indexed tiles with inline palette, **already decoded to `text_*.png`** by the pcx
  stage. The texture→cell binding is `Data/engine2d/inis/patterns/pattern.cif`, a `.cif`-only `[GfxPattern]` list
  (927 records): `EditName`, `EditGroups "meadow all" "meadow green"`, `LogicType` (= a
  `Data/logic/trianglepatterntypes.cif` `type`, **10 records**, type ids 1..10: water/land/blocked/mountain/sand/
  beach/desertstone/moor/snow/plaster, each with `iswater`/`humancanwalkon`/`debugcolor` — "82" is the file's
  decoded *string* count (10 headers + 72 property lines), not the record count), `GfxTexture "…text_NNN.pcx"`, `GfxCoordsA`/`GfxCoordsB` = the two triangles' UVs (3 pixel-coord
  points each, into the texture). Every real record lists its UV points in ONE convention — `coordsA` = the tile
  square's (TL, BR, BL), `coordsB` = (TL, TR, BR) — mapped onto the two per-cell mesh triangles in point order
  (see "terrain tessellation" below; `packages/render/src/data/terrain.ts`). `landscapetypes.ini` also carries a
  `debugcolor R G B` per type (the flat-tint fallback).
- **Ground TRANSITIONS** (the organic biome seams) — `Data/engine2d/inis/patterntransitions/transitions.cif`,
  a `.cif`-only list of 19 `[pointtype]` (editor grouping, unextracted) + 38 `[transition]` records:
  `name "meadow 1"` (the `eatd` join key), `pointtype`, `GfxTexture "…tran_*.pcx"` (RGB) +
  `GfxTextureAlpha "…tran_*_a.pcx"` (the mask picture — its RAW palette-index byte IS the alpha
  value, no palette expansion), and SIX repeated `GfxCoordsA`/`GfxCoordsB` pairs in file order (the
  pair index a map lane's `v % 6` selects; same TL/BR/BL // TL/TR/BR point convention as patterns).
  Extracted to IR `gfxPatternTransitions` (`extractPatternTransitions`); the pipeline composes each
  texture+mask pair into one RGBA `<stem>.masked.png` (`composeMaskedTransitionPages`) that the
  renderer alpha-blends over the base ground triangles.

### Terrain tessellation (the original ground mesh — render REBUILT on it)

Source basis: **martianboy/cultures2-gl + cultures2-wasm** (MIT) — a working WebGL renderer of
Cultures 2 maps whose output matches the original; read as a format/geometry oracle (its
`tessellate.rs` vertex builder, `texture.ts` lane→triangle/UV mapping, `ground/*.glsl` compositing,
and `map.ts` section table pin everything below). This retro-explains the failed
`fix/terrain-transitions` branch: the old diamond-per-cell mesh was the wrong geometry, so every
orientation/stencil heuristic fitted to it was an epicycle.

- **Mesh vertices are CELL-CENTRE NODES** (cell `(c,r)` ↔ node `(2c+(r&1), 2r)` on the half-cell
  lattice). Per cell, TWO triangles span BETWEEN neighbouring centres: **A = △ [own, SE-below,
  SW-below]**, **B = ▽ [own, E, SE-below]** (cell indices `[i, i+w+(r%2), i+w+(r%2)−1]` and
  `[i, i+1, i+w+(r%2)]`). The oracle pins the LATTICE + divisor rules only; the pixel scale is OUR
  measured projection (`x = hx·34`, `y = hy·19` native px from the 68×38 cell pitch, source basis
  "projection" — the reference renderer itself draws at its own 34×19.5 unit scale).
- **Every per-cell ground lane is per-TRIANGLE data on this mesh**: `empa`/`empb` → base pattern of
  A/B; `emt1..emt4` → transition overlays (A,layer1), (B,layer1), (A,layer2), (B,layer2).
- **UVs verbatim**: page pixel coords ÷ page size (256), plain **LINEAR** filtering; `coordsA`'s
  (TL, BR, BL) points map onto A's [apex, SE, SW], `coordsB`'s (TL, TR, BR) onto B's [own, E, SE],
  in point order. Compositing per fragment: base pattern, then layer 2 alpha-mix, then layer 1
  alpha-mix on top. No stencil cutoffs, no texel-centre tricks, no orientation solving.
- **Elevation**: each node lifts UP by `elevation/16` half-row-steps (= `rowStep/2/16` = 1.1875 px
  per unit at the measured 38 px row step; supersedes the earlier photogrammetric ≈1.24 fit, which
  ran ≈4% higher). Border handling is a named ADAPTATION: the oracle zeroes elevation per emitting
  border CELL (an interior cell's triangles still read a border-ring node's true value — cracks if
  it were non-zero), while we clamp per NODE (watertight by construction); the two agree on the real
  data because border-ring elevation is 0 on all 125 decoded maps (verified corpus-wide). Per-node
  lighting (`(lighting[node] − 0x7F)/256 + 1` in the oracle) interpolates across triangles — our
  `embr` per-fragment lane sampling at node cell-centres is the same model.

Implemented in `packages/render/src/data/terrain.ts` (pure lattice/UV math, unit-tested) +
`gpu/terrain/terrain-layer.ts` (chunked meshes; overlays as translucent per-page meshes composited
by child order).
- **The 1:1 pattern choice is NOT algorithm-blocked — it is stored in the map.** The earlier "oracle-blocked
  pattern algorithm" reading was wrong: the `empa`/`empb` lanes hold the final per-triangle `GfxPattern` pick
  (via the `eapd` name dictionary), i.e. the editor runs its placement algorithm at AUTHOR time and bakes the
  result into `map.dat`. The renderer replays it verbatim (`TerrainLayer.buildGround`), so decoded maps
  draw coastlines/transition blocks exactly; only a SYNTHETIC grid still uses the approximated per-typeId
  representative ground (`buildTerrainPatterns`). Reversing the *generator* would only matter for a future
  in-app map editor.

### Gathering pipeline (per-good landscape lifecycle)

How a raw good is gathered off the map is a **data table**, not code: the original models each raw
good as a chain of `[landscapetype]` states a cell passes through as a settler works it. Two base
files (both plaintext `Data/logic/*.ini`; the `culturesnation` mod ships **no** overriding logic
twin, so these ARE the source):

- **`Data/logic/goodtypes.ini`** `[goodtype]` — the gathering fields (extended `extractGoods`):
  - `landscapeToHarvest` / `landscapeToPickup` / `landscapeToStore` — the three stage `[landscapetype]`
    ids: the settler HARVESTS the source object, it becomes a PICKUP-able intermediate, and the finished
    good rests on the ground as a STORE landscape until a carrier stocks it. → `GoodType.gathering`.
  - `isBioLandscapeFlag` — the pipeline is living/growing vs mined. Set on exactly **3** goods
    (wood, herb, mushroom); clear on the rest incl. wheat (`isBioLandscapeFlag 0`). →
    `GoodType.gathering.bioLandscape`.
  - `landscapetype` — present on **every** good (65/65): the landscape type that represents the good
    as a placed object (its on-the-ground lane). For a gathered good it equals `landscapeToStore`; for
    a produced good a distinct dropped-good type; for a vehicle/animal token the `void` type (1). →
    `GoodType.landscapeType`.
  - `atomicForHarvesting` (+ `atomicForCultivating`/`atomicForPlanting`) — already extracted onto
    `GoodType.atomics` (the action a settler runs); surfaced on the pipeline as `harvestAtomic`.

  The 11 goods carrying a `landscapeTo*` chain and their stages (harvest → pickup → store, atomic):
  **wood** `tree(4) → trunk(6) → wood(7)` a24 · **stone** `rock(15) → stone_ore(16) → stone(17)` a25 ·
  **mud** `mud_mine(12) → mud_ore(13) → mud(14)` a26 · **iron** `iron_mine(18) → iron_ore(19) →
  iron(20)` a27 · **gold** `gold_mine(21) → gold_ore(22) → gold(23)` a28 · **wheat** `27 → 28 → 29`
  a29 · **herb** `herbmine(33) → herbore(34) → herb(35)` a31 · **mushroom** `36 → 36 → 37` a32 ·
  **leather** `cadaver_leather(79) → 79 → leather(25)` a33 · **meat** `cadaver_meat(80) → 80 →
  meat(44)` a33 · **honey** `(no harvest) → honey(32) → 32` (picked up, not cut). Every stage id
  resolves to a defined `[landscapetype]`.

- **`Data/logic/landscapetypes.ini`** `[landscapetype]` (87 records; extended `extractLandscape`) —
  `type`, `name` (`"tree"`, `"stone_ore"`, `"cadaver_leather"`), `maximumValency`, `allowedonland`/
  `allowedonwater`/`allowedoneverything`, and repeated `transition` tuples. `debugcolor`/
  `playeridallowed` (editor/map-gen concerns) are skipped.
  - **`transition` caveat — semantics NOT decoded.** The tuples drive the lifecycle (how a `tree`
    becomes a `trunk`, how a mine depletes) but the field meanings are unknown, so they are captured
    **verbatim** as raw int lists (`LandscapeType.transitions`) — *do not read meaning into the
    positions*. Arity is variable: most are 5 ints (`transition <a> <b> <c> <d> <e>`), the four `mine`
    source types carry a 2-int form (`transition 12 13`). (The two `cadaver_*` records write the
    5-tuple twice on one line separated by `//`; the parser's inline-comment strip keeps the first.)

- **The gfx ↔ logic join** is `[GfxLandscape].LogicType == [landscapetype].type` (the exact analog of
  the buildings' `[GfxHouse].LogicType`). It already flows into IR as `LandscapeGfx.logicType` (many
  gfx records share a logic type — e.g. every tree species has `LogicType 4`), so a stage id resolves
  to a *list* of placeable gfx records. `buildGatheringPipeline` materializes the full join once as the
  **`gatheringPipeline`** artifact: per gathered good, each stage's landscape id + the `LandscapeGfx.index`
  values whose `logicType` matches (empty when a stage is a pure-logic lane no gfx places). Later
  gathering slices consume that instead of re-deriving the good→landscape→gfx chain. (The `[GfxLandscape]`
  block-area footprints — `walkBlockAreas`/`buildBlockAreas`/`workAreas` — already survive into
  `LandscapeGfx` and the emitted content, so a stage's gfx record carries its collision/work footprint.)

### Building graphics families (render multi-`.bmd` scope)

Scoped from the emitted `buildingBobs` IR (336 rows) for the render's multi-`.bmd` step. The bind path is one universal `.bmd`→atlas decoder (the same as
trees), but the **selection** is the hard part:

- **A building type spans many `.bmd`s × palettes.** Viking buildings alone draw from `ls_houses_viking.bmd`,
  `ls_houses_viking2/3/4.bmd`, `frank_well_hive.bmd`, `frank_mill.bmd`, `f_bakery/f_potter/f_druid/f_herb/
  f_krawiec.bmd`, plus `ls_wonders*.bmd`/`ls_houses_vehicles.bmd` for wonders/vehicles. **Every `(bmd, palette)`
  is a separate decoded PNG atlas** (a palette = a recolour skin: `house01`/`house02`/`caves`/`dungeon01`/…),
  so the render must load and address MANY building layers, not the single `ls_houses_viking.house01` it does
  today. The current `SpriteSheet.kindLayers` holds one layer per kind — the rung's render sub-step generalises
  it to a family→layer map the per-type binding indexes.
- **`(tribe, typeId)` is NOT a unique key.** The same logic `typeId` recurs across families: viking `typeId 10`
  is the well in `house01` (bob 131) but a different bob in `house02`/`dungeon01`; `typeId 12` appears in four
  families. So the canonical bob can't be picked by `(tribe, typeId)` + highest-level alone — disambiguate by
  **`editName`** (`"viking home"`, `"viking headquarters"`, …), the field the IR carries for exactly this.
- **Anchors confirmed from the data.** Viking **HQ = `ls_houses_viking4.bmd` bob 34** (`editName "viking
  headquarters"`; bob 44 is the alt "headquarters house"); the miller is `housemiller01`, the druid
  `housedruid01`. Per-tribe HQs: frank `ls_houses_frank.bmd` caves bob 4; byzantine `ls_houses_byzantine.bmd`
  bob 16 ("byzantine cathedral"); saracen `ls_houses_saracen.bmd` bob 40; egypt `ls_houses_egypt.bmd` caves
  bob 0. The `buildingBobs` table already covers all 6 tribes — the work is render plumbing + the editName
  disambiguation, not more extraction.

### GUI / in-game HUD (art, palettes, strings, cursors) — extracted by `stages/gui.ts`

The whole in-game HUD is a small, self-contained asset set that ships as **loose files** (the
`culturesnation` mod does not override it, and the packed `DataX/Libs/data0001.lib` is only a mirror —
**do not unpack it** for these). The `gui` pipeline stage (`tools/asset-pipeline/src/stages/gui.ts` +
`decoders/cursor.ts`) reads them straight from the game tree.

**Sources (all under the game root):**

| File(s) | Format | What it is |
|---|---|---|
| `Data/engine2d/bin/bobs/ls_gui_window.bmd` | CBobManager `0x3F4`, **193 bobs** | the entire HUD chrome: left tool-panel + icons, order/context buttons, window frames/borders, progress/hit/disabled bars, minimap frame |
| `Data/engine2d/bin/bobs/ls_gui_bubbles.bmd` | CBobManager `0x3F4`, **23 bobs** | speech / thought bubbles |
| `Data/gui/palettes/*.pcx` | 2×2 PCX **palette carriers** (real payload = the 256-colour trailer) | per-element colorization palettes (see the map below) |
| `Data/engine2d/bin/palettes/gui/gui_bubbles.pcx` | palette carrier | the bubble sheet's palette |
| `Data/text/{eng,pol,…}/strings/ingamegui/ingamegui<table>.cif` | `CStringArray 0x3FD` | the **9** UI string tables `main, misc, miscwindow, misclogic, messages, humanwindow, humanlistwindow, housewindow, vehiclewindow` (filenames carry an `ingamegui` prefix); plaintext refs live in the sibling `backup (errors)/*.ini` (note `misclogic` there is `ingameguimisclogic_backup.ini`) |
| `DataX/Mouse/{MouseNormal,MousePressed,MouseRight}.cur` | Win32 `.cur` (multi-depth 1/4/8-bpp, 32×32, DIB + AND mask) | mouse cursors; hotspots (1,1)/(1,1)/(10,10) |
| `Data/gui/bitmaps/bg*.pcx` | PCX pictures | 299×299 window/dialog backgrounds (decoded by the existing pcx stage) |

The bobs are **8-bit indexed** and carry no embedded palette — the engine colours each element at draw
time with an explicit palette (oracle: `CBobManager.PrintBob(..., CPalette?)` takes the palette as an
argument). The **per-language `Data/gui/lang/{eng,ger,pol,rus}/bobs/ls_gui_window.bmd` copies are
byte-identical** to the `engine2d` one (sha256-verified), so we extract the single `engine2d` copy.

**Element → palette map** (oracle: `Source/NC2GuiToolsBase/CGuiBaseDataManager.cs` loads them;
`Source/NC2InGameGuiManager/CGuiManager.cs` uses them):

- **`iconsleft`** — the whole left tool panel: the background strip (bob `0x33`), the 9 command buttons
  (`CreateToolButton`), the speed button (`0x31`), the priority frame/button (`0x3f`/`0x40`), the
  overview toggle (`0x91`). This is the palette **most** of `ls_gui_window` is drawn through, so it is the
  stage's **default preview palette** for the window sheet.
- **`context`** — the radial human order/command icon buttons (per-command icon id from
  `GetHumanCommandIconId`).
- **`frame` / `bg_normal`** — window frames/borders + the normal window background (both **manager-loaded
  palettes**: `PalFrame`, `PalBgNormal`); **`bar_standart` / `bar_hitpoints` / `bar_disabled`** — the
  normal / active / greyed selection bars; **`papyrus`** — scroll panels. Their draw sites live in the
  window/selection classes OpenVikings hasn't ported, so the pairing is by asset+field name, not a quoted
  usage site. **`bg_hilite` / `bg_invert`** are real `Data/gui/palettes` carriers extracted by filename,
  but the oracle loads **no palette by those names** (its highlight is a `bg_button_hilite.pcx` *bitmap*,
  `DynamicData_Load`), so their element pairing is unconfirmed — extracted for completeness alongside
  **`ingame_remap_01..03`**, which are the world-darkening remap tables (`CWorldDisplayElement.DarkenBitmap_Init`).
- `font_{white,dark,dimmed,red}` are the **font step's** concern; `campaignmap`/`campaignbuttons`/
  `menu_remap` are menu/campaign, not in-game HUD — none are in the GUI palette LUT.

**Named `ls_gui_window` frame ids** — the checked-in frame→name map is
`packages/app/src/content/gui-atlas-map.ts` (`GUI_FRAMES` catalog + `GUI_FRAME` constants + `guiFrameIndex`);
totality is enforced by `packages/app/test/gui-atlas-map.test.ts`. `firstBobId=0`, so a **gfx id equals the
atlas frame index directly**. Per-frame provenance is the map's `source` field:
- **`openvikings`** (authoritative, from `CGuiManager.cs` `Desktop_Open`/`MiscButtons_*`/`MiscWindows_*`):
  `0x33` tool-panel background · the 9 left buttons, each pinned by its tooltip stringId — `0x2a` buildings,
  `0x2b` population, `0x2c` diplomacy, `0x2d` extras, `0x2e` mission, `0x2f` options, `0x30` help, `0x32`
  statistics, `0x38` tech-tree (the decompiler's `_btnHelp`/`_btnButtonN` field names are unreliable; the
  stringId→tooltip binding is ground truth) · `0x31` speed (`0x34/0x35/0x36` = ×2/×3/paused states) · `0x3f`
  priority frame · `0x40` priority button (`0x41/0x42` = important/only-important states) · `0x6b` order-icon
  fallback · `0x91` overview toggle.
- **`montage`** — every other frame, identified by eye from a numbered render of all 193 frames (the
  labeled-montage technique): window-border 9-slice pieces, large papyrus window backgrounds, the round
  wooden order-command icons (`context` palette), resource glyphs, progress/hit **bars** (they render as
  solid blocks under the `bar_*` palettes), directional/scroll arrows. These keep a placeholder
  `unknown_NNN` name + a best-guess `role`/`note` until a human confirms them, then get promoted.
- The **per-command order-icon gfx ids** are NOT recovered from code — OpenVikings'
  `sHumanCommandTypeToIconId` (`DAT_1003337c8`) is an unfilled placeholder, so only the `0x6b` fallback is
  code-pinned; the specific radial-command icons (~`0x48`–`0x88`) are montage guesses.

**Stage outputs** (under the gitignored `content/`; the app reads them via the `vite.config.ts` routes):

- **Atlases + palette LUT ride `/bobs/`** (they are bob atlases): per sheet a recolourable **indexed**
  atlas `Data/engine2d/bin/bobs/<sheet>.indexed.{png,atlas.json}` (palette index in red, mask in alpha)
  and an **RGBA preview** `<sheet>.<previewPalette>.{png,atlas.json}` (default-coloured, for human
  inspection); plus the **`gui-palettes-lut.png`** — a `256 × 14` LUT stacking every GUI palette (row
  order fixed by `GUI_PALETTES`, mirrored in `packages/app/src/content/gui-gfx.ts`), loaded like the
  player-colour LUT so the renderer colours an indexed pixel through its element's row.
- **`content/gui/strings/<lang>.json`** — `{ <table>: { <stringId>: <displayText> } }`, CP1250-decoded
  (served at `/gui/…`). `eng` + `pol` extracted. Each `.cif` is a `[control]`/`[text]` config (verified vs
  the `backup (errors)/*.ini`): `[control] stringidmultiplier <N>` then a `[text]` run of `stringn <id>
  "<text>"` (sets the running id) / `string "<text>"` (auto-increments) — so the key is the **in-game
  string id** (`id × multiplier`, and every shipped table's multiplier is 1), not the container slot id.
  Parsed with the existing `cifLinesToSections`.
- **`content/gui/cursors/<name>.{cur,png}`** — the verbatim `.cur` (for CSS `cursor: url()`) + a decoded
  RGBA PNG, with hotspots in the manifest.
- **`content/gui/manifest.json`** — the top-level index (atlases, palette LUT + row names, string
  languages/tables, cursors) the app's `loadGuiManifest` reads.

### UI fonts (`.fnt`) — extracted by `stages/fonts.ts`

The UI bitmap fonts are the last loose-file HUD asset. A `.fnt` is a **`CFont` (storable id `0x3F5`)**
that is a *thin wrapper around the same `CBobManager` (`0x3F4`) `.bmd` bob container the settlers/HUD
use* — so the glyph atlas is just the ordinary bob atlas of the inner container, and
`decoders/fnt.ts` reuses `decoders/bmd.ts` wholesale. On disk (oracle: `NXBasics/CFont.cs` +
`XBStorable.cs`):

```
[u32 id=0x3F5][u32 version]   CFont header
[u32 value08]                 unknown font word (carried verbatim)
[u32 value0C]                 empirically the NOMINAL PIXEL SIZE (8/10/12 for font08/10/12; 8 debug)
[u32 id=0x3F4][ CBobManager ] the nested bob container — decodeBmd() parses the rest
```

i.e. a 16-byte CFont prefix in front of a `.bmd`. **Glyph lookup** (CFont): character `c` (≥ `0x20`)
draws bob `c − 0x20`. **Whitespace**: CFont's `GetPixelWidth` measures a space through bob `0x49`, so a
space takes that bob's **advance** — but it **draws nothing** (its own bob 0 is empty); we reproduce only
the width redirect, not the literal `PrintCharacter` blit of `0x49` (which is the `'i'` glyph, the
original's own quirk). **Layout formulas** (ported to `fnt.ts`): advance `= spacing + rect.X + rect.W + 1`
(`GetCharacterWidth`), glyph extent `= rect.H + rect.Y + 1` (`GetCharacterHeight`), line height
`= max extent over glyphs` (`GetPixelHeight`) — where `GetBobAreaRectanglePtr` **nulls a `Type == 0`
(empty) bob**, so advance/extent are **0** for an empty slot and empty bobs are skipped for line height
(an undefined CP1250 slot advances 0; a stale rect on an empty bob can't inflate the height). `spacing`
(CFont+0x10) is NOT stored — it is applied externally via `SetSpacing`, so decoded advances use spacing 0.
A **baseline** is derived (advisory) from a reference capital's bottom edge; the original has no baseline
(it lays out top-anchored).

**Sources (under the game root):**

| File(s) | Format | What it is |
|---|---|---|
| `Data/gui/fonts/{font08,font10,font12,fontdebug}.fnt` | CFont `0x3F5`, **224 glyphs** (chars `0x20‑0xFF`) | the central-European (CP1250) UI fonts — carry the full Polish glyph range; `fontdebug` is a partial debug face |
| `Data/gui/fonts/{latin,rus}/*.fnt` | CFont `0x3F5` | the alternate-codepage sets the engine swaps in per language (extracted, keyed by variant; the fonts are byte-indexed, so the codepage belongs to the consuming language) |
| `Data/gui/palettes/font_{white,dark,dimmed,red}.pcx` | PCX palette carriers (256-colour trailer) | the four text colours (glyph pixels are palette indices; the colour palette resolves them) |

**Stage outputs** (under the gitignored `content/`):

- **Glyph atlases + colour LUT ride `/bobs/`** (they are bob atlases): per font a recolourable
  **indexed** atlas `<key>.indexed.{png,atlas.json}` (palette index in red, mask in alpha) and an
  **RGBA preview** `<key>.white.{png,atlas.json}` (default colour, for human inspection); plus the
  **`font-palettes-lut.png`** — a `256 × 4` LUT stacking the four font colours (row order fixed by
  `FONT_COLORS`, mirrored in `packages/app/src/content/font-gfx.ts`), loaded like the player/GUI LUTs
  so the renderer colours a glyph index through its text-colour row. `<key>` is the size stem
  (`font10`) for the default set, `<variant>_<stem>` (`latin_font10`) otherwise.
- **`content/gui/fonts/<key>.metrics.json`** — the `FontMetrics`: `firstChar`/`charCount`,
  `lineHeight`, `baseline`, `spaceBobId`, `nominalSize`, and a per-glyph `{char, bobId, advance,
  offsetX, offsetY, width, height, empty}` table in char order (the atlas gives *where the pixels
  are*; the metrics give *how to lay them out*).
- **`content/gui/fonts/manifest.json`** — the top-level index (fonts + their stems/metrics paths, the
  colour LUT + row names) the app's `loadFontManifest` reads.

## How to use OpenVikings as reference

When writing a pipeline decoder, open the matching C# file above and translate the **format
reading logic** (byte layout, decompression, palette application) into TypeScript in
`tools/asset-pipeline/src/decoders/`. Port the *format*, not the engine architecture. Record the
source file + commit you referenced in the decoder's header comment for traceability.

**OpenVikings as an oracle.** Beyond reading its code, *run* it: OpenVikings boots and renders the
original `.bmd`/`.pcx` assets. Use that to validate the pipeline's decoded PNG/atlas output
pixel-for-pixel — the highest-value reuse, turning "I think the decoder is right" into a diff.

## Legal line

This is the canonical statement of the project's legal posture; `README.md` **Legal** and
`AGENTS.md` point here.

- **License: GPL-3.0-or-later** (`LICENSE` at the repo root; declared in `package.json`). Same
  family as OpenMW; mirrors OpenVikings' stance.
- **Code only — never assets.** No original assets, decoded content, or game binaries are ever
  committed. `content/` is gitignored (derived from the user's own copy); tests use the committed
  **synthetic fixture**, not real game data (see `docs/TESTING.md`).
- **Bring-your-own game data.** Users run the pipeline against their own legally-owned copy. We
  distribute no copyrighted content.
- **Clean-room, not a port.** `OpenVikings_reversing/` is consulted as *format documentation*
  (facts about binary layouts) — its source/architecture is not copied. Reading file formats to
  achieve interoperability is the established basis for engine reimplementations (OpenMW, OpenRA,
  devilutionX).
- **No trademark use / no affiliation.** *Vinland* is an independent project, not affiliated with,
  authorized, or endorsed by the rights holders of the *Cultures* series. Don't ship the original's
  names or logos as project branding. *Cultures – 8th Wonder of the World* and related marks belong
  to their respective owners (Funatics Software GmbH and/or its licensors).
