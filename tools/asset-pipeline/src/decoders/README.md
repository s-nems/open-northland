# Decoders

One module per original format. Each ports the **byte-layout / decompression logic** (not the
architecture) from the matching research notes C# file. Put a header comment in every decoder naming
the source file + commit you referenced, for traceability.

| Decoder | Original format | Port from `../../research notes/Source/` |
|---|---|---|
| `cif.ts` ✅ | `.cif` container (encrypted CStringArray) | `an original routine/XBStorable.cs`, `CStringArray.cs`, `CMemory.cs`, `XBTools.cs` |
| `lib.ts` | `.lib` archive | `an original routine/CSimpleFileLibrary.cs` |
| `palette.ts` | palettes, `.hlt` | `an original routine/CPalette.cs`, `CRemapTable.cs`, `CHighColorCreator.cs` |
| `pcx.ts` | `.pcx` picture | `an original routine/CPicture.cs`, `XBPictureTool.cs` |
| `bmd.ts` | `.bmd` bob/anim | `an original routine/CBobManager.cs`, `CBitmap.cs` — **hardest, do last** |
| `ini.ts` ✅ | `.ini` **and** decoded-`.cif` rules | plain text parse; emit IR validated by `@vinland/data` (parser + `goodtypes`/`landscapetypes`/`jobtypes`/`tribetypes` extractors + the atomic vocabulary — `atomicFor*`/`allowatomic`/`setatomic` — done; more type extractors incremental) |
| `map.ts` | map files | landscape grid + placements |

Guidance:

- **Prefer `.ini` over `.cif`.** The `culturesnation` mod ships readable `.ini` for most rule
  types under `DataCnmd/types/`. Only attempt `.cif` decoding for types with no `.ini` source.
- Decoders are pure functions `(bytes: Uint8Array, ...) => IR` where possible — unit-testable with
  a tiny captured fixture (do NOT commit copyrighted fixtures; generate them locally).
- Output goes to `content/` (gitignored). Never write decoded assets into the repo source tree.
