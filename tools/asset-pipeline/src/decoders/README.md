# Decoders

Each original file format has a small decoder with a pure byte-oriented core. Layout decisions must
be supported by inspection of files from an owned game copy, a published format specification, or
observed behavior, then pinned with synthetic fixtures.

| Decoder | Input | Status and basis |
|---|---|---|
| `cif.ts` | encrypted `.cif` tables | Implemented; owned-file inspection and synthetic round trips |
| `lib.ts` | `.lib` archives | Implemented; owned-file inspection and boundary tests |
| `palette.ts` | palettes and `.hlt` remaps | Implemented; decoded palette checks |
| `pcx.ts` | `.pcx` images | Implemented from the published PCX layout |
| `png.ts` | RGBA output | Implemented from the PNG specification |
| `bmd/` | `.bmd` sprites and animation metadata | Implemented; owned-file inspection and synthetic frame tests |
| `atlas.ts` | decoded frames | Packs frames into an RGBA atlas and JSON manifest |
| `ini.ts` | `.ini` and decoded `.cif` rules | Incremental typed extractors validated by `@open-northland/data` |
| `mapdat/` | `map.dat` chunks and packed lanes | Container and X8el lanes implemented; X6el and some lane semantics remain incomplete |

Guidelines:

- Prefer readable `.ini` files over `.cif` when both exist.
- Keep decoding cores pure: `(bytes: Uint8Array, ...) => decoded value` where practical.
- Generate test fixtures in the test itself. Do not commit original or decoded game data.
- Write generated content only under the gitignored `content/` directory.
- Keep format notes in `docs/formats/`; comments should state only the evidence needed to maintain
  the code.
