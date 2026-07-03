# Sources & format reference

This project reads two sibling folders (read-only) at `~/Projects/vikings/`:

- `Cultures 8th Wonder/` — the original game **+ the `culturesnation` mod** (`DataCnmd/`). The
  *input* to the asset pipeline. Copyrighted; never copied into this repo.
- `OpenVikings_reversing/` — a C#/.NET binary-faithful reverse engineering. **Our format manual.**

## Original file formats (what the pipeline must decode)

Counts observed in `Cultures 8th Wonder` (base `Data` + `DataX` + mod `DataCnmd`):

| Ext | ~Count | What it is | Decode reference in OpenVikings (`Source/`) |
|---|---|---|---|
| `.wav` | 752 | sound effects (16-bit mono 22050 Hz PCM) | browser plays PCM natively (no transcode); `soundfx.cif` maps them to events/terrain — see FIDELITY.md "Sound bank" + `@vinland/audio` |
| `.pcx` | 426 | palette-indexed pictures | `NXBasics/CPicture.cs`, `NXBasics/XBPictureTool.cs` |
| `.bmd` | 247 | "bob" framed sprite animations | `NXBasics/CBobManager.cs` (3.8k lines), `NXBasics/CBitmap.cs` |
| `.hlt` | 242 | lighting / remap tables | `NXBasics/CRemapTable.cs`, `CHighColorCreator.cs`, `CTrueColorCreator.cs` |
| `.cif` | 167 | compiled/**encrypted** "Cultures Information File" (rules, maps) | decrypt: `NXBasics/XBTools.cs` `XB_Decrypt_Memory`; also `NC2Logic/CIoHelper.cs`, `Dexter/DexMD5.cs` |
| `.ini` | 66 | **readable** rule config | trivial text parse; prefer these |
| `.sgt`/`.dls` | 49+ | **DirectMusic** segments/instruments — Windows-only | transcode offline to ogg; do not depend on DirectMusic |
| `.fnt` | 63 | bitmap fonts | `NXBasics/CFont.cs` |
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
its counts are smaller — see the ground-graphics section and docs/FIDELITY.md): `housetypes.cif`
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
sethuman  <?0> "<tribe>" "<role>" <X> <Y> <a> <b>                          e.g. "viking" "civilist" 385 83 0 0
setanimal <...> <X> <Y> <...>
addgoods  "<good>" <amount>            # applies to the preceding sethouse's stock
```

The building **name is the original `[GfxHouse]` `EditName`** ("viking tower", "viking bakery", …),
NOT the clean IR `id`; `<level>` selects among the leveled typeIds (`"viking home" 4` → `home_level_04`).
So resolving a placement to a sim `typeId` needs the `EditName`+`level → LogicType` map, which lives in
the `[GfxHouse]` graphics sections the pipeline already walks (`extractBuildingBobs` et al.). Importing
these placements (replacing the app's synthetic first-walkable-cells fallback) is a tracked slice —
see docs/ROADMAP.md.

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
  half-res copies). `lmhe` (height, 0..~240) and `embr` (~127-centred, a brightness/shading lane) are
  per-CELL (1 B); `empa`/`empb`/`emla` are u16 half-cell...-vs-cell as below.
- **Lane semantics** (pinned empirically on `Arabskie Wyspy` + cross-checked against the decrypted
  `landscapes.cif` twin; exact per-lane count matches):
  - **`lmlt`** (u8, half-cell) — the **logic landscape-OBJECT type**: raw value **IS** the 1-based
    `landscapetypes.ini` typeId of the object standing there (`[GfxLandscape].LogicType` — clay-mine
    decals hold 12 = `mud_mine`, palms 4 = `tree`, wave fx 1 = `void`), raw **0 = no object**.
    `lmltToTerrainMap` reduces each cell's 2×2 half-cell block to the dominant value (0 → `void`).
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
    (unconsumed). **`emt1..emt4`** (u8, per cell, 255 = none) — sparse pattern overrides/overlays
    (u8-ranged pattern-dictionary indices; superseded by `empa`/`empb` for ground, still unconsumed).
- The record-list chunks are **name dictionaries + object tables**: `eapd` = the `[GfxPattern]`
  EditName list (927, positional — how a map references patterns version-robustly BY NAME), `eald` =
  the `[GfxLandscape]` EditName list (866), `eatd` = the editor's ground-group names (38);
  `laco`/`lasw`/`lafm` are binary record lists (coords + ids — unconsumed). Grammar: `[u32 count]`
  then `[u8 len][bytes][0x00]` per entry (`decodeStringListChunk`).

**Status:** container + both packed codecs + the dictionaries are decoded, and the pipeline emits the
full render model per map (`stages/maps.ts` `mapDatToTerrain`): the sim grid (`typeIds`, from `lmlt`)
+ `ground` (per-triangle pattern names, from `empa`/`empb`+`eapd`) + `objects` (sparse half-cell
placements, from `emla`+`eald`) → `content/maps/<id>.json`, all consumed by the renderer end-to-end
(`?map=<id>`). **Remaining:** `lmhe` heights, the `emt3`/`emt4` overlay lanes (roads/house
foundations), `lmpa`/`lmpb` → sim water/walkability, `laco`/`lasw`/`lafm`. (No decoded bytes are
committed — `map.dat` is copyrighted input, like every other game file.)
- **Atomic actions are the behavior vocabulary** (see docs/ECS.md) and are partly free in readable
  data: `tribetypes.ini` `setatomic` (atomic→animation per tribe), `jobtypes.ini` `allowatomic`,
  `goodtypes.ini` `atomicFor*`. The atomic *timings/effects* live in `atomicanimations.cif` — **but
  the mod ships a readable twin** `DataCnmd/atomicanimations12/atomicanimations.ini` (~6900 lines:
  `length`, `event <frame> <kind> <arg>`, `startdirection`, `interruptable`). This defuses a top
  roadmap risk: the timings are not blocked on `.cif` reversing. Calibration-by-observation may
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
  square's (TL, BR, BL), `coordsB` = (TL, TR, BR) — so triangle A/B map onto the iso diamond's left/right halves
  (`packages/render/src/terrain.ts`). `landscapetypes.ini` also carries a `debugcolor R G B` per type (the
  flat-tint fallback).
- **The 1:1 pattern choice is NOT algorithm-blocked — it is stored in the map.** The earlier "oracle-blocked
  pattern algorithm" reading was wrong: the `empa`/`empb` lanes hold the final per-triangle `GfxPattern` pick
  (via the `eapd` name dictionary), i.e. the editor runs its placement algorithm at AUTHOR time and bakes the
  result into `map.dat`. The renderer replays it verbatim (`WorldRenderer.buildGroundTerrain`), so decoded maps
  draw coastlines/transition blocks exactly; only a SYNTHETIC grid still uses the approximated per-typeId
  representative ground (`buildTerrainPatterns`). Reversing the *generator* would only matter for a future
  in-app map editor.

### Building graphics families (render multi-`.bmd` scope)

Scoped from the emitted `buildingBobs` IR (336 rows) for the render's multi-`.bmd` rung (ROADMAP Phase 2,
Render-breadth-ladder rung 1 remainder). The bind path is one universal `.bmd`→atlas decoder (the same as
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

**Named `ls_gui_window` frame ids** (for the future frame→name map; oracle `CGuiManager.cs`): `0x33`
tool background · `0x2a/0x2d/0x2e/0x2c/0x32/0x2b/0x38/0x2f/0x30` the 9 left command buttons · `0x31`
speed (`0x34/0x35/0x36` its speed-factor states) · `0x3f` priority frame · `0x40` priority button
(`0x41/0x42` its states) · `0x91` overview toggle.

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
`CLAUDE.md` point here.

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
