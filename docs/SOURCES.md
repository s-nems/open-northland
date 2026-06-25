# Sources & format reference

This project reads two sibling folders (read-only) at `~/Projects/vikings/`:

- `Cultures 8th Wonder/` — the original game **+ the `culturesnation` mod** (`DataCnmd/`). The
  *input* to the asset pipeline. Copyrighted; never copied into this repo.
- `OpenVikings_reversing/` — a C#/.NET binary-faithful reverse engineering. **Our format manual.**

## Original file formats (what the pipeline must decode)

Counts observed in `Cultures 8th Wonder` (base `Data` + `DataX` + mod `DataCnmd`):

| Ext | ~Count | What it is | Decode reference in OpenVikings (`Source/`) |
|---|---|---|---|
| `.wav` | 752 | sound effects | — (use as-is / transcode to ogg) |
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
    (`houses.ini`, `weapons.ini`, graphics).
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

Verified end-to-end (decoder output): `housetypes.cif` (798 records), `weapontypes.cif` (2995),
`trianglepatterntypes.cif` (82), and `CnModMaps/tutorial_001/map.cif` (476, incl. `mapsize`,
`mapguid`, `MissionData`). A map's **declarative logic-header metadata** (`mapsize`/`mapguid` from
`logiccontrol` + `misc_maptype`/`misc_mapname`) is now extracted to a `MapInfo` IR record by
`decoders/ini.ts` `extractMapInfo` and wired into the pipeline (`cli.ts` `decodeMapTree` → 13 maps).
The map's **binary tile grid is NOT in `map.cif`** — that file is *only* the logic-header
`CStringArray` (0 trailing bytes, confirmed on two real maps). The grid lives in the sibling
**`map.dat`** (see below); `MissionData`/`StaticObjects` scripting is the Phase-5 campaign layer.

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
- The per-cell grid layers (`lmhe`,`lmlt`,`lmlv`,`lmms`,`lmpa/lmpb`,`embr`,`empa/empb`,`emt1..4`,
  `emla`,…) are **packed-bitmap** payloads, each opening with a small sub-header
  `[u8 ver][u32 innerSize]` (the inner packed-stream length) then the ASCII marker **`pck`** +
  **`X8el`/`X6el`** (the trailing `X8`/`X6` is the per-pixel bit depth) then a small per-layer
  header not yet fully decoded (a constant `0x0072` field + a per-layer count). So the on-disk size
  varies per map and is *not* a raw `width×height` byte array; the codec is the engine's packed-image
  format (very likely the **same packed-line family the `.bmd` decoder already implements**,
  `CBobManager.cs` — confirm when porting the unpack). `lmhe` (height) unpacks to ≈ one byte per cell;
  the landscape-**type** grid (the Phase-2 cell-graph input) is one of these layers — `lmlt`/`lmlv`
  are the prime candidates (size ≈ `cells × 1–2`).
- Not every chunk is a grid: `laco`/`lasw`/`lafm` (landscape) and `eapd`/`eatd`/`eald` (entity) are
  **structured record lists** — depth-prefixed text/object tables (e.g. `eatd` holds `meadow 1`/…
  type names, `eald` holds `player01 sign 0…` placements), the same depth-prefixed grammar as the
  `.cif` string pool. These are the pre-placed-objects / per-player layers (Phase-5 territory),
  separate from the per-cell terrain grid.

**Status:** the **container is decoded** — `tools/asset-pipeline/src/decoders/mapdat.ts`
(`decodeMapDat` walks the flat `hoix`-chunk table to EOF; `decodeMapSize` reads the raw `lsiz` dims;
round-trip tested via `encodeMapDat`, no committed fixtures; hands-on verified on two real maps:
FORTECA 39 chunks/250×250, oasis_o_plenty 40 chunks/250×250). **Remaining:** the `pck`/`X8el`
packed-layer unpack (cross-check the `.bmd` packed-line codec first), then identifying which `lm**`
tag is the landscape-type id grid → feeds `buildTerrainGraph`. (No decoded bytes are committed —
`map.dat` is copyrighted input, like every other game file.)
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
