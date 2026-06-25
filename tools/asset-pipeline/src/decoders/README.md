# Decoders

One module per original format. Each ports the **byte-layout / decompression logic** (not the
architecture) from the matching OpenVikings C# file. Put a header comment in every decoder naming
the source file + commit you referenced, for traceability.

| Decoder | Original format | Port from `../../OpenVikings_reversing/Source/` |
|---|---|---|
| `cif.ts` ✅ | `.cif` container (encrypted CStringArray) | `NXBasics/XBStorable.cs`, `CStringArray.cs`, `CMemory.cs`, `XBTools.cs` |
| `lib.ts` ✅ | `.lib` archive (directory + payload views) | `NXBasics/CSimpleFileLibrary.cs`, `Dexter/DexterEndian.cs` |
| `palette.ts` | palettes, `.hlt` | `NXBasics/CPalette.cs`, `CRemapTable.cs`, `CHighColorCreator.cs` |
| `pcx.ts` ✅ | `.pcx` picture | `NXBasics/CPicture.cs`, `XBPictureTool.cs` |
| `png.ts` ✅ | PNG **output** container (RGBA → PNG) | — (not an original format; ports the PNG spec: zlib + IHDR/IDAT/IEND) |
| `bmd.ts` | `.bmd` bob/anim | `NXBasics/CBobManager.cs`, `CBitmap.cs` — **hardest, do last** |
| `atlas.ts` | bob atlas **output** (frames → sheet + manifest) | — (not an original format; shelf-packs `decodeBobFrame` output into one RGBA atlas + a per-bob JSON manifest) |
| `ini.ts` ✅ | `.ini` **and** decoded-`.cif` rules | plain text parse; emit IR validated by `@vinland/data` (parser + `goodtypes`/`landscapetypes`/`jobtypes`/`tribetypes` extractors + the atomic vocabulary — `atomicFor*`/`allowatomic`/`setatomic` — done; more type extractors incremental) |
| `mapdat.ts` ⏳ | `map.dat` `hoix`-chunk container | `NC2Logic/CIoHelper.cs` (`SIoHelperChunk` / `IO_File_Chunk_*`) — container + `lsiz` dims done; `pck`/`X8el` layer unpack pending |

Guidance:

- **Prefer `.ini` over `.cif`.** The `culturesnation` mod ships readable `.ini` for most rule
  types under `DataCnmd/types/`. Only attempt `.cif` decoding for types with no `.ini` source.
- Decoders are pure functions `(bytes: Uint8Array, ...) => IR` where possible — unit-testable with
  a tiny captured fixture (do NOT commit copyrighted fixtures; generate them locally).
- Output goes to `content/` (gitignored). Never write decoded assets into the repo source tree.
